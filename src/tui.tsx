#!/usr/bin/env node

import process from 'node:process';
import { parseArgs } from './cli-utils.js';
import { logger } from './utils/logger.js';

const { patientId } = parseArgs(process.argv.slice(2));

// Ink requires raw mode on stdin — only available in real TTY terminals.
// Fall back to the readline REPL when running in CI, piped input, or non-TTY.
if (!process.stdin.isTTY) {
  logger.warn('TUI requires an interactive terminal — falling back to REPL mode');
  const { main } = await import('./cli.js');
  await main();
} else {
  const { render } = await import('ink');
  const { App } = await import('./tui/App.js');
  render(<App {...(patientId ? { patientId } : {})} />);
}
