#!/usr/bin/env node

import * as readline from 'node:readline';
import type { Session } from './cli-utils.js';
import { AGENT_ID, createSession, getPrompt, handleCommand, parseArgs } from './cli-utils.js';
import { mastra } from './mastra.js';
import { logger } from './utils/logger.js';

// ─── Streaming Response ─────────────────────────────────────────────────────

async function streamResponse(userMessage: string, session: Session): Promise<void> {
  const agent = mastra.getAgent(AGENT_ID);

  const result = await agent.stream(userMessage, {
    memory: {
      thread: session.threadId,
      resource: session.resourceId,
    },
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

  // Newline after streamed response
  process.stdout.write('\n');
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

  rl.on('line', async (line: string) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    // Handle slash commands
    if (input.startsWith('/')) {
      const result = handleCommand(input, session);
      process.stdout.write(result.output);
      if (result.quit) {
        rl.close();
        return;
      }
      session = result.session;
      rl.setPrompt(getPrompt(session));
      rl.prompt();
      return;
    }

    // Stream agent response
    try {
      await streamResponse(input, session);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Agent error', { error: message });
      process.stdout.write(`\n\x1b[31mError: ${message}\x1b[0m\n`);
    }

    rl.prompt();
  });

  rl.on('close', () => {
    process.exit(0);
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error('Fatal error', { error: message });
  process.stderr.write(`Fatal: ${message}\n`);
  process.exit(1);
});
