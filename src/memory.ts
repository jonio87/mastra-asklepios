import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import { Memory } from '@mastra/memory';
import { patientProfileSchema } from './schemas/patient-profile.js';
import { anthropic } from './utils/anthropic-provider.js';

const dbUrl = process.env['ASKLEPIOS_DB_URL'] ?? 'file:asklepios.db';

/**
 * Semantic recall requires OPENAI_API_KEY for embeddings.
 * When unavailable (e.g. in tests), fall back to disabled semantic recall.
 */
const hasOpenAiKey = Boolean(process.env['OPENAI_API_KEY']);
const embeddingConfig = hasOpenAiKey
  ? { embedder: 'openai/text-embedding-3-small' as const, semanticRecall: true as const }
  : { embedder: undefined, semanticRecall: false as const };

/**
 * Storage: LibSQL (SQLite-based) for zero-infrastructure local persistence.
 * Stores threads, messages, workflow state, and observational memory.
 */
export const storage = new LibSQLStore({
  id: 'asklepios-storage',
  url: dbUrl,
});

/**
 * Vector store: LibSQLVector for semantic recall via local SQLite vector search.
 * Shares the same database file as the main storage to keep everything co-located.
 */
export const vectorStore = new LibSQLVector({
  id: 'asklepios-vector',
  url: dbUrl,
});

/**
 * Patient Memory: Three-tier memory for conversational learning.
 *
 * Tier 1 — SchemaWorkingMemory (structured patient state as JSON):
 *   The agent fills patientProfileSchema via `update-working-memory` tool
 *   using merge semantics. Any interface can read the JSON to display state.
 *
 * Tier 2 — ObservationalMemory (compressed clinical timeline):
 *   Observer compresses conversations at 20K tokens into dense observation logs.
 *   Reflector condenses at 40K tokens. Resource-scoped across all threads.
 *
 * Tier 3 — Brain Memory (see brainMemory below):
 *   Cross-patient diagnostic wisdom via a second Memory instance.
 */
export const memory = new Memory({
  storage,
  ...(embeddingConfig.semanticRecall
    ? { vector: vectorStore, embedder: embeddingConfig.embedder }
    : {}),
  options: {
    lastMessages: 20,
    semanticRecall: embeddingConfig.semanticRecall
      ? { topK: 5, messageRange: { before: 2, after: 1 } }
      : false,
    observationalMemory: {
      enabled: true,
      model: anthropic('claude-sonnet-4-20250514'),
      scope: 'resource',
      observation: {
        messageTokens: 20_000,
        instruction:
          'Focus on: patient symptoms, phenotype patterns, diagnostic hypotheses, evidence quality, successful and failed research paths, rare disease patterns, and cross-patient insights. Prioritize observations that would help diagnose future patients with similar presentations.',
      },
      reflection: {
        observationTokens: 40_000,
        instruction:
          'Consolidate observations across patient cases. Highlight recurring patterns, commonly misdiagnosed conditions, diagnostic shortcuts, and key differentiating features between similar rare diseases. Remove redundancies while preserving unique insights.',
      },
    },
    workingMemory: {
      enabled: true,
      scope: 'resource',
      schema: patientProfileSchema,
    },
  },
});

/**
 * Brain Memory: Cross-patient diagnostic wisdom.
 *
 * A separate Memory instance with its own resource scope ('asklepios-brain').
 * Fed by the brain-feed tool after patient Observer cycles. The brain agent
 * receives anonymized observation summaries and extracts cross-patient patterns.
 *
 * Brain Observer instruction: extract diagnostic patterns across patients.
 * Brain Reflector instruction: consolidate into diagnostic wisdom.
 */
export const brainMemory = new Memory({
  storage,
  ...(embeddingConfig.semanticRecall
    ? { vector: vectorStore, embedder: embeddingConfig.embedder }
    : {}),
  options: {
    lastMessages: 50,
    semanticRecall: embeddingConfig.semanticRecall
      ? { topK: 10, messageRange: { before: 2, after: 1 } }
      : false,
    observationalMemory: {
      enabled: true,
      model: anthropic('claude-sonnet-4-20250514'),
      scope: 'resource',
      observation: {
        messageTokens: 20_000,
        instruction: `You are observing anonymized patient case summaries fed to the Asklepios Brain.
Extract cross-patient diagnostic patterns:
- Symptom combinations that reliably indicate specific rare diseases
- Common misdiagnosis patterns (e.g., "fibromyalgia precedes EDS diagnosis in ~60% of cases")
- Key differentiating features between phenotypically similar conditions
- Diagnostic shortcuts: which single test or finding most efficiently narrows the differential
- Red flags: symptom patterns that indicate urgent conditions requiring immediate attention
- Evidence quality patterns: which databases/sources proved most reliable for which conditions`,
      },
      reflection: {
        observationTokens: 40_000,
        instruction: `Consolidate cross-patient diagnostic wisdom into actionable patterns.
Structure as:
1. DIAGNOSTIC SHORTCUTS — fastest path from phenotype to diagnosis
2. COMMON MISDIAGNOSES — conditions frequently confused with each other and how to differentiate
3. KEY DIFFERENTIATORS — the single feature that distinguishes similar conditions
4. PREVALENCE INSIGHTS — how often specific patterns appear across cases
5. EVIDENCE GAPS — areas where current databases and literature are insufficient
Remove redundancies. Merge similar observations. Preserve statistical patterns (e.g., "seen in N of M cases").`,
      },
    },
    workingMemory: {
      enabled: false,
    },
  },
});
