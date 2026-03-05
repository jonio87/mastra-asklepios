const SIMPLE_MAX = 50;
const COMPLEX_KEYWORDS = [
  'research',
  'investigate',
  'compare',
  'variant',
  'differential',
  'genetic',
  'clinvar',
  'omim',
  'pubmed',
];
const DEEP_KEYWORDS = [
  'comprehensive',
  'all possible',
  'deep dive',
  'full workup',
  'exhaustive',
  'thorough analysis',
];

/**
 * Resolve the number of maxSteps for agent.stream() based on query complexity.
 *
 * Priority:
 * 1. ASKLEPIOS_MAX_STEPS env var (explicit override)
 * 2. Heuristic based on message content:
 *    - Simple chat (greeting, short question): 5
 *    - Standard query (symptom discussion): 10
 *    - Complex research (variant analysis, differential): 15
 *    - Deep diagnostic (comprehensive, exhaustive): 20
 *
 * Result is clamped to [3, 25].
 */
export function resolveMaxSteps(message: string): number {
  const envOverride = process.env['ASKLEPIOS_MAX_STEPS'];
  if (envOverride) {
    const parsed = Number.parseInt(envOverride, 10);
    if (!Number.isNaN(parsed)) return Math.min(Math.max(parsed, 3), 25);
  }

  const lower = message.toLowerCase();
  const length = message.trim().length;

  // Deep diagnostic queries
  if (DEEP_KEYWORDS.some((kw) => lower.includes(kw))) return 20;

  // Complex research queries
  if (COMPLEX_KEYWORDS.some((kw) => lower.includes(kw))) return 15;

  // Simple chat (short messages, greetings)
  if (length < SIMPLE_MAX) return 5;

  // Standard query
  return 10;
}
