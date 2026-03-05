#!/usr/bin/env node

import * as readline from 'node:readline';
import { handleResume, streamAgent } from './cli-core.js';
import type { Session } from './cli-utils.js';
import { createSession, getPrompt, handleCommand, parseArgs } from './cli-utils.js';
import { logger } from './utils/logger.js';
import {
  createSessionUsage,
  formatSessionUsage,
  formatUsage,
  recordUsage,
} from './utils/usage-tracker.js';

const sessionUsage = createSessionUsage();

// ─── Streaming via cli-core event generators ────────────────────────────────

async function writeStreamToStdout(message: string, session: Session): Promise<void> {
  const stream = streamAgent(message, session);

  for await (const event of stream) {
    switch (event.type) {
      case 'text':
        process.stdout.write(event.content);
        break;
      case 'agent-label':
        process.stdout.write(`\n\x1b[36m[${event.agentId}]\x1b[0m `);
        break;
      case 'usage':
        recordUsage(sessionUsage, event.data);
        process.stdout.write(`\x1b[90m[${formatUsage(event.data)}]\x1b[0m\n`);
        break;
      case 'error':
        process.stdout.write(`\n\x1b[31mError: ${event.message}\x1b[0m\n`);
        break;
      case 'done':
        break;
    }
  }

  process.stdout.write('\n');
}

// ─── Slash Command Handling ─────────────────────────────────────────────────

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
      const result = await handleResume(input);
      process.stdout.write(`${result.output}\n`);
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

export async function main(): Promise<void> {
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
      await writeStreamToStdout(input, session);
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

// Auto-run when executed directly (not imported as a module by tui.tsx)
const isDirectRun = process.argv[1]?.endsWith('/cli.js') || process.argv[1]?.endsWith('/cli.ts');

if (isDirectRun) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Fatal error', { error: message });
    process.stderr.write(`Fatal: ${message}\n`);
    process.exit(1);
  });
}
