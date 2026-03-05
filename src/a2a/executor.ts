/**
 * Asklepios A2A Agent Executor — bridges A2A protocol with Mastra agents.
 *
 * Receives A2A messages, routes to appropriate Asklepios agents based on
 * skill matching, and publishes A2A events (status updates, artifacts).
 */

import type { Message, TaskState } from '@a2a-js/sdk';
import type { AgentExecutor, ExecutionEventBus, RequestContext } from '@a2a-js/sdk/server';
import { mastra } from '../mastra.js';
import { resolveMaxSteps } from '../utils/max-steps.js';
import { traceOnFinish, traceOnStepFinish } from '../utils/observability.js';

type SkillId = 'diagnose' | 'research' | 'phenotype' | 'cross-patient' | 'clinical-data';
type AgentId =
  | 'asklepios'
  | 'asklepios-brain'
  | 'researchAgent'
  | 'phenotypeAgent'
  | 'synthesisAgent';

/**
 * Extract user text from A2A message parts.
 */
function extractText(message: Message): string {
  return message.parts
    .filter((p) => p.kind === 'text')
    .map((p) => ('text' in p ? (p.text as string) : ''))
    .join('\n');
}

/**
 * Detect which skill best matches the user message.
 * Falls back to 'diagnose' (orchestrator) for ambiguous requests.
 */
function detectSkill(text: string): SkillId {
  const lower = text.toLowerCase();

  if (/pubmed|orphanet|clinvar|omim|literature|search.*stud/i.test(lower)) return 'research';
  if (/phenotype|hpo|symptom.*map|extract.*symptom|parse.*document/i.test(lower))
    return 'phenotype';
  if (/cross.?patient|pattern.*match|brain.*recall|similar.*case/i.test(lower))
    return 'cross-patient';
  if (
    /lab.*result|treatment.*trial|consultation|capture.*data|clinical.*record|query.*data/i.test(
      lower,
    )
  )
    return 'clinical-data';

  return 'diagnose';
}

/**
 * Map skill to Mastra agent ID.
 */
function skillToAgent(skill: SkillId): AgentId {
  switch (skill) {
    case 'research':
      return 'researchAgent';
    case 'phenotype':
      return 'phenotypeAgent';
    case 'cross-patient':
      return 'asklepios-brain';
    case 'clinical-data':
      return 'asklepios';
    case 'diagnose':
      return 'asklepios';
  }
}

/**
 * Publish an A2A status update event.
 */
function publishStatus(
  eventBus: ExecutionEventBus,
  ctx: RequestContext,
  state: TaskState,
  text: string,
  final: boolean,
): void {
  eventBus.publish({
    taskId: ctx.taskId,
    contextId: ctx.contextId,
    status: {
      state,
      message: { role: 'agent', parts: [{ kind: 'text', text }] },
    },
    final,
  } as unknown as Parameters<typeof eventBus.publish>[0]);
}

/**
 * Run the appropriate Mastra agent and return the response text.
 */
async function runAgent(
  agentId: AgentId,
  userText: string,
  skill: SkillId,
  threadId: string,
  patientId: string,
): Promise<string> {
  const agent = mastra.getAgent(agentId);

  if (skill === 'diagnose') {
    return runNetworkAgent(agent, userText, threadId, patientId);
  }

  return runDirectAgent(agent, userText, threadId, patientId);
}

/**
 * Run the orchestrator in network mode for diagnostic reasoning.
 */
async function runNetworkAgent(
  agent: ReturnType<typeof mastra.getAgent>,
  userText: string,
  threadId: string,
  patientId: string,
): Promise<string> {
  const stream = await agent.network(userText, {
    memory: { thread: threadId, resource: patientId },
    maxSteps: resolveMaxSteps(userText),
  });

  const chunks: string[] = [];
  for await (const chunk of stream as AsyncIterable<Record<string, unknown>>) {
    const text = extractNetworkChunkText(chunk);
    if (text) chunks.push(text);
  }
  return chunks.join('');
}

/**
 * Extract text from a network stream chunk.
 */
function extractNetworkChunkText(chunk: Record<string, unknown>): string {
  const chunkType = chunk['type'] as string | undefined;
  const payload = chunk['payload'] as Record<string, unknown> | undefined;
  if (!(chunkType?.startsWith('agent-execution-event-') && payload)) return '';

  const innerType = (payload['type'] as string) ?? '';
  if (innerType !== 'text-delta') return '';

  const innerPayload = payload['payload'] as Record<string, unknown> | undefined;
  return (innerPayload?.['text'] as string) ?? '';
}

/**
 * Run a direct agent.generate() call for specific skills.
 */
async function runDirectAgent(
  agent: ReturnType<typeof mastra.getAgent>,
  userText: string,
  threadId: string,
  patientId: string,
): Promise<string> {
  const runId = `a2a-${Date.now()}`;
  const result = await agent.generate(userText, {
    runId,
    maxSteps: resolveMaxSteps(userText),
    memory: { thread: threadId, resource: patientId },
    onFinish: traceOnFinish(runId),
    onStepFinish: traceOnStepFinish(runId),
  });
  return result.text;
}

export class AsklepiosExecutor implements AgentExecutor {
  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const userText = extractText(requestContext.userMessage);
    const skill = detectSkill(userText);
    const agentId = skillToAgent(skill);
    const patientId = requestContext.contextId ?? `a2a-${requestContext.taskId}`;
    const threadId = `a2a-thread-${requestContext.taskId}`;

    publishStatus(
      eventBus,
      requestContext,
      'working',
      `Routing to ${skill} skill (agent: ${agentId})...`,
      false,
    );

    try {
      const responseText = await runAgent(agentId, userText, skill, threadId, patientId);
      publishStatus(
        eventBus,
        requestContext,
        'completed',
        responseText || 'No response generated.',
        true,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      publishStatus(eventBus, requestContext, 'failed', `Error: ${msg}`, true);
    }

    eventBus.finished();
  }

  async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    eventBus.publish({
      taskId,
      status: {
        state: 'canceled' as TaskState,
        message: {
          role: 'agent',
          parts: [{ kind: 'text', text: 'Task canceled by client request.' }],
        },
      },
      final: true,
    } as unknown as Parameters<typeof eventBus.publish>[0]);

    eventBus.finished();
  }
}
