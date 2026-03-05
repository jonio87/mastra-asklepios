import { logger } from './logger.js';

/**
 * Lightweight observability layer for agent execution tracing.
 *
 * @mastra/observability requires @mastra/core <0.25.0 (peer dep conflict with our v1.9.0).
 * Instead, we use agent stream callbacks (onFinish, onStepFinish) to emit structured
 * span-like log entries for debugging and performance monitoring.
 *
 * Usage:
 *   agent.stream(messages, { onFinish: traceOnFinish(runId), onStepFinish: traceOnStepFinish(runId) })
 */

interface UsageLike {
  promptTokens?: number | undefined;
  completionTokens?: number | undefined;
  totalTokens?: number | undefined;
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  reasoningTokens?: number | undefined;
  cachedInputTokens?: number | undefined;
}

interface ToolCallLike {
  toolName: string;
  args?: Record<string, unknown> | undefined;
}

function extractTokens(usage: UsageLike | undefined | null) {
  if (!usage) return undefined;
  return {
    input: usage.inputTokens ?? usage.promptTokens,
    output: usage.outputTokens ?? usage.completionTokens,
    total: usage.totalTokens,
    reasoning: usage.reasoningTokens,
    cached: usage.cachedInputTokens,
  };
}

/**
 * Returns an `onFinish` callback compatible with Mastra's MastraOnFinishCallback type.
 */
export function traceOnFinish(runId: string) {
  const start = Date.now();
  // Accept the full event object — we only read what we need
  return (event: Record<string, unknown>) => {
    const durationMs = Date.now() - start;
    const usage = event['usage'] as UsageLike | undefined;
    const finishReason = event['finishReason'] as string | undefined;

    logger.info('Trace: stream complete', {
      runId,
      event: 'agent.stream.finish',
      durationMs,
      finishReason,
      tokens: extractTokens(usage),
    } satisfies Record<string, unknown>);
  };
}

/**
 * Returns an `onStepFinish` callback compatible with Mastra's MastraOnStepFinishCallback type.
 */
export function traceOnStepFinish(runId: string) {
  let stepIndex = 0;
  // Accept the full event object — we only read what we need
  return (event: Record<string, unknown>) => {
    stepIndex++;
    const usage = event['usage'] as UsageLike | undefined;
    const finishReason = event['finishReason'] as string | undefined;
    const rawToolCalls = event['toolCalls'] as ToolCallLike[] | undefined;

    const toolCalls = rawToolCalls?.map((tc) => ({
      name: tc.toolName,
      args: tc.args,
    }));

    const context: Record<string, unknown> = {
      runId,
      event: `agent.step.${stepIndex}`,
      finishReason,
      tokens: extractTokens(usage),
      toolCalls: toolCalls?.length ? toolCalls : undefined,
    };

    if (toolCalls?.length) {
      logger.debug('Trace: step with tool calls', context);
    } else {
      logger.debug('Trace: step complete', context);
    }
  };
}
