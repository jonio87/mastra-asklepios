/**
 * Token usage tracking for monitoring API costs.
 *
 * Accumulates per-interaction and session-level token usage
 * from agent stream/generate responses.
 */

export interface TokenUsage {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  totalTokens: number | undefined;
  reasoningTokens?: number | undefined;
  cachedInputTokens?: number | undefined;
}

export interface SessionUsage {
  interactions: number;
  totals: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    reasoningTokens: number;
    cachedInputTokens: number;
  };
  history: TokenUsage[];
}

export function createSessionUsage(): SessionUsage {
  return {
    interactions: 0,
    totals: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      reasoningTokens: 0,
      cachedInputTokens: 0,
    },
    history: [],
  };
}

export function recordUsage(session: SessionUsage, usage: TokenUsage): void {
  session.interactions += 1;
  session.totals.inputTokens += usage.inputTokens ?? 0;
  session.totals.outputTokens += usage.outputTokens ?? 0;
  session.totals.totalTokens += usage.totalTokens ?? 0;
  session.totals.reasoningTokens += usage.reasoningTokens ?? 0;
  session.totals.cachedInputTokens += usage.cachedInputTokens ?? 0;
  session.history.push({ ...usage });
}

export function formatUsage(usage: TokenUsage): string {
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const total = usage.totalTokens ?? 0;
  return `${input.toLocaleString()} in / ${output.toLocaleString()} out / ${total.toLocaleString()} total`;
}

export function formatSessionUsage(session: SessionUsage): string {
  const { totals } = session;
  const lines = [
    `\nToken Usage (${session.interactions} interaction${session.interactions === 1 ? '' : 's'}):`,
    `  Input:      ${totals.inputTokens.toLocaleString()} tokens`,
    `  Output:     ${totals.outputTokens.toLocaleString()} tokens`,
    `  Total:      ${totals.totalTokens.toLocaleString()} tokens`,
  ];

  if (totals.cachedInputTokens > 0) {
    lines.push(`  Cached:     ${totals.cachedInputTokens.toLocaleString()} tokens`);
  }

  if (totals.reasoningTokens > 0) {
    lines.push(`  Reasoning:  ${totals.reasoningTokens.toLocaleString()} tokens`);
  }

  const last = session.history[session.history.length - 1];
  if (last) {
    lines.push(`  Last turn:  ${formatUsage(last)}`);
  }

  return `${lines.join('\n')}\n`;
}
