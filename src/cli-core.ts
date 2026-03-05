/**
 * Core streaming logic shared by both REPL (cli.ts) and TUI (tui.tsx).
 *
 * Exposes async generators that yield typed StreamEvents, decoupling
 * business logic (agent calls, token tracking) from rendering.
 */

import type { Session } from './cli-utils.js';
import { AGENT_ID, getPatientInstructions } from './cli-utils.js';
import { mastra } from './mastra.js';
import { resolveMaxSteps } from './utils/max-steps.js';
import { traceOnFinish, traceOnStepFinish } from './utils/observability.js';
import type { TokenUsage } from './utils/usage-tracker.js';

// ─── Stream Event Types ──────────────────────────────────────────────────────

export type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'agent-label'; agentId: string }
  | { type: 'usage'; data: TokenUsage }
  | { type: 'error'; message: string }
  | { type: 'done' };

// ─── Resume Result ───────────────────────────────────────────────────────────

export interface ResumeResult {
  success: boolean;
  output: string;
}

// ─── Direct Streaming ────────────────────────────────────────────────────────

export async function* streamDirect(
  userMessage: string,
  session: Session,
): AsyncGenerator<StreamEvent> {
  const agent = mastra.getAgent(AGENT_ID);
  const patientInstructions = getPatientInstructions(session);
  const runId = `run-${Date.now()}`;

  const result = await agent.stream(userMessage, {
    runId,
    maxSteps: resolveMaxSteps(userMessage),
    memory: {
      thread: session.threadId,
      resource: session.resourceId,
    },
    ...(patientInstructions ? { instructions: patientInstructions } : {}),
    onFinish: traceOnFinish(runId),
    onStepFinish: traceOnStepFinish(runId),
  });

  const reader = result.textStream.getReader();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      yield { type: 'text', content: value };
    }
  } finally {
    reader.releaseLock();
  }

  try {
    const usage = await result.usage;
    yield { type: 'usage', data: usage };
  } catch {
    // Usage data unavailable — skip
  }

  yield { type: 'done' };
}

// ─── Network Chunk Parsing ──────────────────────────────────────────────────

/** Parse a single network stream chunk into a StreamEvent, or null if irrelevant. */
function parseNetworkChunk(
  chunk: Record<string, unknown>,
  currentAgentId: string,
): { event: StreamEvent | null; agentId: string } {
  const chunkType = chunk['type'] as string | undefined;
  const payload = chunk['payload'] as Record<string, unknown> | undefined;

  if (!(chunkType && payload)) return { event: null, agentId: currentAgentId };

  if (chunkType === 'agent-execution-start') {
    const agentId = (payload['agentId'] as string) ?? 'unknown';
    if (agentId !== currentAgentId) {
      return { event: { type: 'agent-label', agentId }, agentId };
    }
    return { event: null, agentId: currentAgentId };
  }

  if (!chunkType.startsWith('agent-execution-event-')) {
    return { event: null, agentId: currentAgentId };
  }

  const innerType = (payload['type'] as string) ?? '';
  if (innerType !== 'text-delta') return { event: null, agentId: currentAgentId };

  const innerPayload = payload['payload'] as Record<string, unknown> | undefined;
  const text = (innerPayload?.['text'] as string) ?? '';
  if (text) {
    return { event: { type: 'text', content: text }, agentId: currentAgentId };
  }
  return { event: null, agentId: currentAgentId };
}

// ─── Network Streaming ──────────────────────────────────────────────────────

export async function* streamNetwork(
  userMessage: string,
  session: Session,
): AsyncGenerator<StreamEvent> {
  const agent = mastra.getAgent(AGENT_ID);
  const patientInstructions = getPatientInstructions(session);

  const networkStream = await agent.network(userMessage, {
    memory: {
      thread: session.threadId,
      resource: session.resourceId,
    },
    ...(patientInstructions ? { instructions: patientInstructions } : {}),
    maxSteps: resolveMaxSteps(userMessage),
  });

  const reader = networkStream.getReader();
  let currentAgentId = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const parsed = parseNetworkChunk(value as Record<string, unknown>, currentAgentId);
      currentAgentId = parsed.agentId;
      if (parsed.event) yield parsed.event;
    }
  } finally {
    reader.releaseLock();
  }

  try {
    const usage = await networkStream.usage;
    yield { type: 'usage', data: usage };
  } catch {
    // Usage data unavailable — skip
  }

  yield { type: 'done' };
}

// ─── Unified Stream (dispatches based on session.networkMode) ────────────────

export function streamAgent(userMessage: string, session: Session): AsyncGenerator<StreamEvent> {
  if (session.networkMode) {
    return streamNetwork(userMessage, session);
  }
  return streamDirect(userMessage, session);
}

// ─── Workflow Resume ─────────────────────────────────────────────────────────

const VALID_WORKFLOWS = ['patient-intake', 'diagnostic-research'] as const;

const RESUME_USAGE = [
  'Usage: /resume <workflowId> <stepId> [resumeData as JSON]',
  'Example: /resume patient-intake review-phenotypes \'{"approvedIndices":[0,1,2]}\'',
  'Example: /resume diagnostic-research review-findings \'{"approvedFindingIndices":[0,1,2]}\'',
  '',
  'Available workflows: patient-intake, diagnostic-research',
].join('\n');

export async function handleResume(input: string): Promise<ResumeResult> {
  const parts = input.split(/\s+/);
  const workflowId = parts[1];
  const stepId = parts[2];
  const resumeDataRaw = parts.slice(3).join(' ');

  if (!(workflowId && stepId)) {
    return { success: false, output: RESUME_USAGE };
  }

  if (!VALID_WORKFLOWS.includes(workflowId as (typeof VALID_WORKFLOWS)[number])) {
    return { success: false, output: `Unknown workflow: ${workflowId}` };
  }

  let resumeData: unknown = {};
  if (resumeDataRaw) {
    try {
      resumeData = JSON.parse(resumeDataRaw);
    } catch {
      return { success: false, output: 'Invalid JSON in resume data' };
    }
  }

  const workflow = mastra.getWorkflow(workflowId as 'patient-intake') as unknown as {
    resume: (params: { step: string; resumeData: unknown }) => Promise<unknown>;
  };

  const result = await workflow.resume({
    step: stepId,
    resumeData,
  });

  return {
    success: true,
    output: `Resuming workflow "${workflowId}" at step "${stepId}"...\n\nWorkflow result: ${JSON.stringify(result, null, 2)}`,
  };
}
