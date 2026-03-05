/**
 * Custom Mastra logger that writes all output to stderr.
 *
 * The built-in ConsoleLogger uses console.info() for debug/info/warn levels,
 * which writes to stdout and pollutes CLI output. This logger routes everything
 * through console.error() so agent text responses stay clean on stdout.
 */
import { ConsoleLogger } from '@mastra/core/logger';

export class StderrLogger extends ConsoleLogger {
  override debug(message: string, ...args: unknown[]): void {
    // biome-ignore lint/suspicious/noConsole: intentional — redirect stdout to stderr
    const orig = console.info;
    // biome-ignore lint/suspicious/noConsole: intentional — redirect stdout to stderr
    console.info = console.error;
    try {
      super.debug(message, ...args);
    } finally {
      console.info = orig;
    }
  }

  override info(message: string, ...args: unknown[]): void {
    // biome-ignore lint/suspicious/noConsole: intentional — redirect stdout to stderr
    const orig = console.info;
    // biome-ignore lint/suspicious/noConsole: intentional — redirect stdout to stderr
    console.info = console.error;
    try {
      super.info(message, ...args);
    } finally {
      console.info = orig;
    }
  }

  override warn(message: string, ...args: unknown[]): void {
    // biome-ignore lint/suspicious/noConsole: intentional — redirect stdout to stderr
    const orig = console.info;
    // biome-ignore lint/suspicious/noConsole: intentional — redirect stdout to stderr
    console.info = console.error;
    try {
      super.warn(message, ...args);
    } finally {
      console.info = orig;
    }
  }
}
