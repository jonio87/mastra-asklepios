import { anthropic } from './anthropic-provider.js';

/**
 * Model modes for tiered routing.
 *
 * - `quick`: fast responses (~200ms TTFT), simple structured updates, symptom diary
 * - `voice`: optimized for voice latency (~150ms TTFT)
 * - `research`: standard analysis, literature search, tool calls
 * - `deep`: complex differential diagnosis, multi-hypothesis reasoning
 */
export type ModelMode = 'quick' | 'voice' | 'research' | 'deep';

const MODEL_MAP = {
  quick: 'claude-haiku-4-5-20251001',
  voice: 'claude-haiku-4-5-20251001',
  research: 'claude-sonnet-4-20250514',
  deep: 'claude-opus-4-20250514',
} as const;

/**
 * Resolves the model mode from requestContext.
 * Falls back to 'research' (Sonnet) as the default for a research-oriented system.
 */
export function resolveMode(requestContext?: { get: (key: string) => unknown }): ModelMode {
  if (!requestContext) return 'research';
  const mode = requestContext.get('mode');
  if (typeof mode === 'string' && mode in MODEL_MAP) {
    return mode as ModelMode;
  }
  return 'research';
}

/**
 * DynamicModel function for Mastra agents.
 *
 * Routes to the appropriate Claude model based on `requestContext.mode`:
 * - quick/voice → Haiku (fast, cheap)
 * - research → Sonnet (balanced, default)
 * - deep → Opus (best reasoning)
 *
 * Usage: pass as the `model` property in AgentConfig.
 */
export function modelRouter({
  requestContext,
}: {
  requestContext: { get: (key: string) => unknown };
  mastra?: unknown;
}) {
  const mode = resolveMode(requestContext);
  return anthropic(MODEL_MAP[mode]);
}

/**
 * Returns the model ID string for a given mode.
 * Useful for logging and testing.
 */
export function getModelIdForMode(mode: ModelMode): string {
  return MODEL_MAP[mode];
}
