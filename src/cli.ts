#!/usr/bin/env node

import * as readline from 'node:readline';
import type { Session } from './cli-utils.js';
import {
  AGENT_ID,
  createSession,
  getPatientInstructions,
  getPrompt,
  handleCommand,
  parseArgs,
} from './cli-utils.js';
import { mastra } from './mastra.js';
import { logger } from './utils/logger.js';
import { traceOnFinish, traceOnStepFinish } from './utils/observability.js';
import {
  createSessionUsage,
  formatSessionUsage,
  formatUsage,
  recordUsage,
} from './utils/usage-tracker.js';

const sessionUsage = createSessionUsage();

// ─── Workflow Resume ────────────────────────────────────────────────────────

async function handleResumeCommand(input: string): Promise<void> {
  const parts = input.split(/\s+/);
  const workflowId = parts[1];
  const stepId = parts[2];
  const resumeDataRaw = parts.slice(3).join(' ');

  if (!(workflowId && stepId)) {
    process.stdout.write(
      'Usage: /resume <workflowId> <stepId> [resumeData as JSON]\n' +
        'Example: /resume patient-intake review-phenotypes \'{"approvedIndices":[0,1,2]}\'\n' +
        'Example: /resume diagnostic-research review-findings \'{"approvedFindingIndices":[0,1,2]}\'\n' +
        '\nAvailable workflows: patient-intake, diagnostic-research\n',
    );
    return;
  }

  let resumeData: unknown = {};
  if (resumeDataRaw) {
    try {
      resumeData = JSON.parse(resumeDataRaw);
    } catch {
      process.stdout.write('\x1b[31mInvalid JSON in resume data\x1b[0m\n');
      return;
    }
  }

  const validWorkflows = ['patient-intake', 'diagnostic-research'] as const;
  if (!validWorkflows.includes(workflowId as (typeof validWorkflows)[number])) {
    process.stdout.write(`\x1b[31mUnknown workflow: ${workflowId}\x1b[0m\n`);
    return;
  }

  // getWorkflow returns a union type; cast to access resume() which is available on all Workflow instances
  const workflow = mastra.getWorkflow(workflowId as 'patient-intake') as unknown as {
    resume: (params: { step: string; resumeData: unknown }) => Promise<unknown>;
  };
  process.stdout.write(`Resuming workflow "${workflowId}" at step "${stepId}"...\n`);

  const result = await workflow.resume({
    step: stepId,
    resumeData,
  });

  process.stdout.write(`\nWorkflow result: ${JSON.stringify(result, null, 2)}\n`);
}

// ─── Direct Streaming Response ──────────────────────────────────────────────

async function streamDirectResponse(userMessage: string, session: Session): Promise<void> {
  const agent = mastra.getAgent(AGENT_ID);
  const patientInstructions = getPatientInstructions(session);
  const runId = `run-${Date.now()}`;

  const result = await agent.stream(userMessage, {
    runId,
    maxSteps: 10,
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
      process.stdout.write(value);
    }
  } finally {
    reader.releaseLock();
  }

  process.stdout.write('\n');

  result.usage
    .then((usage) => {
      recordUsage(sessionUsage, usage);
      process.stdout.write(`\x1b[90m[${formatUsage(usage)}]\x1b[0m\n`);
    })
    .catch(() => {
      // Usage data unavailable — silently continue
    });
}

// ─── Network Streaming Response ─────────────────────────────────────────────

/** Process a single network stream chunk, printing agent labels and text deltas. */
function processNetworkChunk(chunk: Record<string, unknown>, currentAgent: { id: string }): void {
  const chunkType = chunk['type'] as string | undefined;
  const payload = chunk['payload'] as Record<string, unknown> | undefined;

  if (!(chunkType && payload)) return;

  if (chunkType === 'agent-execution-start') {
    const agentId = (payload['agentId'] as string) ?? 'unknown';
    if (agentId !== currentAgent.id) {
      currentAgent.id = agentId;
      process.stdout.write(`\n\x1b[36m[${currentAgent.id}]\x1b[0m `);
    }
    return;
  }

  if (!chunkType.startsWith('agent-execution-event-')) return;

  const innerType = (payload['type'] as string) ?? '';
  if (innerType !== 'text-delta') return;

  const innerPayload = payload['payload'] as Record<string, unknown> | undefined;
  const text = (innerPayload?.['text'] as string) ?? '';
  if (text) process.stdout.write(text);
}

async function streamNetworkResponse(userMessage: string, session: Session): Promise<void> {
  const agent = mastra.getAgent(AGENT_ID);
  const patientInstructions = getPatientInstructions(session);

  process.stdout.write('\x1b[90m[network mode — routing to specialized agents]\x1b[0m\n');

  const networkStream = await agent.network(userMessage, {
    memory: {
      thread: session.threadId,
      resource: session.resourceId,
    },
    ...(patientInstructions ? { instructions: patientInstructions } : {}),
    maxSteps: 10,
  });

  const reader = networkStream.getReader();
  const currentAgent = { id: '' };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      processNetworkChunk(value as Record<string, unknown>, currentAgent);
    }
  } finally {
    reader.releaseLock();
  }

  process.stdout.write('\n');

  networkStream.usage
    .then((usage) => {
      recordUsage(sessionUsage, usage);
      process.stdout.write(`\x1b[90m[${formatUsage(usage)}]\x1b[0m\n`);
    })
    .catch(() => {
      // Usage data unavailable — silently continue
    });
}

// ─── Streaming Response (dispatches to direct or network) ───────────────────

async function streamResponse(userMessage: string, session: Session): Promise<void> {
  if (session.networkMode) {
    await streamNetworkResponse(userMessage, session);
  } else {
    await streamDirectResponse(userMessage, session);
  }
}

// ─── Slash Command Handling ──────────────────────────────────────────────────

interface SlashCommandResult {
  session: Session;
  quit: boolean;
}

async function handleSlashCommand(input: string, session: Session): Promise<SlashCommandResult> {
  if (input === '/usage') {
    process.stdout.write(formatSessionUsage(sessionUsage));
    return { session, quit: false };
  }

  if (input.startsWith('/resume')) {
    try {
      await handleResumeCommand(input);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      process.stdout.write(`\x1b[31mResume error: ${message}\x1b[0m\n`);
    }
    return { session, quit: false };
  }

  const result = handleCommand(input, session);
  process.stdout.write(result.output);
  return { session: result.session, quit: result.quit };
}

// ─── REPL Main Loop ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { patientId } = parseArgs(process.argv.slice(2));

  let session = createSession(patientId ? `patient-${patientId}` : undefined);

  process.stdout.write('\n');
  process.stdout.write('╔══════════════════════════════════════════════════╗\n');
  process.stdout.write('║      Asklepios — Rare Disease Research Agent     ║\n');
  process.stdout.write('║      Type /help for commands, /quit to exit      ║\n');
  process.stdout.write('╚══════════════════════════════════════════════════╝\n');
  process.stdout.write('\n');

  if (patientId) {
    process.stdout.write(`Patient case: ${patientId}\n`);
  }
  process.stdout.write(`Thread: ${session.threadId.slice(0, 8)}...\n\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: getPrompt(session),
    terminal: true,
  });

  rl.prompt();

  const inputQueue: string[] = [];
  let processing = false;

  async function handleQueuedInput(input: string): Promise<boolean> {
    if (input.startsWith('/')) {
      const result = await handleSlashCommand(input, session);
      if (result.quit) {
        rl.close();
        return true;
      }
      session = result.session;
      rl.setPrompt(getPrompt(session));
      rl.prompt();
      return false;
    }

    try {
      await streamResponse(input, session);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Agent error', { error: message });
      process.stdout.write(`\n\x1b[31mError: ${message}\x1b[0m\n`);
    }
    rl.prompt();
    return false;
  }

  async function processQueue(): Promise<void> {
    if (processing) return;
    processing = true;

    let input = inputQueue.shift();
    while (input !== undefined) {
      const shouldExit = await handleQueuedInput(input);
      if (shouldExit) return;
      input = inputQueue.shift();
    }

    processing = false;
  }

  rl.on('line', (line: string) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }
    inputQueue.push(input);
    processQueue().catch((err: unknown) => {
      logger.error('Queue processing error', { error: String(err) });
    });
  });

  rl.on('close', () => {
    if (processing) {
      // Wait for pending operations before exiting
      const check = setInterval(() => {
        if (!processing) {
          clearInterval(check);
          process.exit(0);
        }
      }, 100);
    } else {
      process.exit(0);
    }
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error('Fatal error', { error: message });
  process.stderr.write(`Fatal: ${message}\n`);
  process.exit(1);
});
