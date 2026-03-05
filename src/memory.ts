import { LibSQLStore } from '@mastra/libsql';
import { Memory } from '@mastra/memory';
import { anthropic } from './utils/anthropic-provider.js';

/**
 * Storage: LibSQL (SQLite-based) for zero-infrastructure local persistence.
 * Stores threads, messages, workflow state, and observational memory.
 */
export const storage = new LibSQLStore({
  id: 'asklepios-storage',
  url: process.env['ASKLEPIOS_DB_URL'] ?? 'file:asklepios.db',
});

/**
 * Memory: Observational Memory with resource-scoped observations.
 *
 * The killer feature — cross-patient learning via Observational Memory (OM):
 * - Observer agent compresses conversations into dense observation logs
 * - Reflector agent condenses observations when they grow too large
 * - Resource-scoped: observations span all threads for a patient
 * - The agent accumulates diagnostic wisdom across every patient case
 *
 * Two memory scopes in practice:
 * 1. Patient-scoped (per resourceId): "patient-anon-001" — everything about one patient
 * 2. Research-scoped (shared resourceId): "asklepios-knowledge" — cross-patient patterns
 */
export const memory = new Memory({
  storage,
  options: {
    lastMessages: 20,
    semanticRecall: false,
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
      template: `# Patient Research Profile

## Patient ID
(auto-populated)

## Key Symptoms
- (list primary symptoms)

## HPO Terms
- (standardized phenotype terms)

## Current Hypotheses
- (ranked diagnostic hypotheses with confidence)

## Evidence Summary
- (key research findings)

## Research Status
- (current stage of diagnostic investigation)

## Important Notes
- (cross-patient patterns, warnings, key insights)`,
    },
  },
});
