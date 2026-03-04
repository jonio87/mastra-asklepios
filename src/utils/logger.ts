import type { WriteStream } from 'node:fs';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

interface Logger {
  debug: (msg: string, ctx?: Record<string, unknown>) => void;
  info: (msg: string, ctx?: Record<string, unknown>) => void;
  warn: (msg: string, ctx?: Record<string, unknown>) => void;
  error: (msg: string, ctx?: Record<string, unknown>) => void;
  setLevel: (level: LogLevel) => void;
  setOutput: (stream: Pick<WriteStream, 'write'>) => void;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = (process.env['LOG_LEVEL'] as LogLevel | undefined) ?? 'info';
let output: Pick<WriteStream, 'write'> = process.stderr;

function formatEntry(entry: LogEntry): string {
  const ctx = entry.context ? ` ${JSON.stringify(entry.context)}` : '';
  return `[${entry.timestamp}] ${entry.level.toUpperCase()} ${entry.message}${ctx}\n`;
}

function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  if (LOG_LEVELS[level] < LOG_LEVELS[currentLevel]) return;

  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...(context !== undefined ? { context } : {}),
  };

  output.write(formatEntry(entry));
}

export const logger: Logger = {
  debug: (msg: string, ctx?: Record<string, unknown>): void => log('debug', msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>): void => log('info', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>): void => log('warn', msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>): void => log('error', msg, ctx),
  setLevel: (level: LogLevel): void => {
    currentLevel = level;
  },
  setOutput: (stream: Pick<WriteStream, 'write'>): void => {
    output = stream;
  },
};
