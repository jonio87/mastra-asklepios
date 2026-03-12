import { z } from 'zod';

/**
 * Brain Pattern Schemas — Cross-patient diagnostic wisdom.
 *
 * The Asklepios Brain learns diagnostic patterns from anonymized case data.
 * These patterns represent clinical wisdom accumulated over many cases —
 * NOT individual patient records. The brain stores 6 types of patterns:
 *
 * - diagnostic-shortcut: Symptom combos that efficiently narrow differentials
 * - common-misdiagnosis: Conditions frequently confused + differentiating features
 * - key-differentiator: Single feature distinguishing similar conditions
 * - research-tip: Which databases/tools work best for which conditions
 * - temporal-pattern: Typical progression timelines and symptom onset order
 * - phenotype-genotype: When genetic testing was decisive, which genes for which phenotypes
 */

// ─── Pattern Category ──────────────────────────────────────────────────

export const brainPatternCategoryEnum = z.enum([
  'diagnostic-shortcut',
  'common-misdiagnosis',
  'key-differentiator',
  'research-tip',
  'temporal-pattern',
  'phenotype-genotype',
]);

export type BrainPatternCategory = z.infer<typeof brainPatternCategoryEnum>;

// ─── Brain Pattern (stored record) ─────────────────────────────────────

export const brainPatternSchema = z.object({
  id: z.string(),
  pattern: z.string().describe('The diagnostic pattern or insight text'),
  category: brainPatternCategoryEnum,
  phenotypeCluster: z
    .array(z.string())
    .describe('HPO terms or symptom keywords that this pattern applies to'),
  supportingCases: z.number().int().min(0).describe('Number of cases that support this pattern'),
  confidence: z.number().min(0).max(1).describe('Confidence in this pattern (0-1)'),
  relatedDiagnoses: z
    .array(z.string())
    .optional()
    .describe('ICD-10 codes or diagnosis names this pattern relates to'),
  relatedGenes: z.array(z.string()).optional().describe('Gene symbols relevant to this pattern'),
  sourceCaseLabels: z
    .array(z.string())
    .describe('Anonymized case labels that contributed to this pattern'),
  createdAt: z.string().describe('ISO 8601 creation timestamp'),
  updatedAt: z.string().describe('ISO 8601 last update timestamp'),
});

export type BrainPattern = z.infer<typeof brainPatternSchema>;

// ─── Brain Pattern Input (create/update) ───────────────────────────────

export const brainPatternInputSchema = z.object({
  pattern: z.string(),
  category: brainPatternCategoryEnum,
  phenotypeCluster: z.array(z.string()),
  supportingCases: z.number().int().min(0).default(1),
  confidence: z.number().min(0).max(1).default(0.5),
  relatedDiagnoses: z.array(z.string()).optional(),
  relatedGenes: z.array(z.string()).optional(),
  sourceCaseLabels: z.array(z.string()),
});

export type BrainPatternInput = z.infer<typeof brainPatternInputSchema>;

// ─── Brain Pattern Query ───────────────────────────────────────────────

export const brainPatternQuerySchema = z.object({
  symptoms: z.array(z.string()).optional().describe('Symptoms to match against phenotype clusters'),
  hpoTerms: z.array(z.string()).optional().describe('HPO terms for precise matching'),
  category: brainPatternCategoryEnum.optional().describe('Filter by pattern category'),
  minConfidence: z.number().min(0).max(1).optional().describe('Minimum confidence threshold'),
  limit: z.number().int().min(1).max(50).optional().describe('Max patterns to return'),
});

export type BrainPatternQuery = z.infer<typeof brainPatternQuerySchema>;

// ─── Case Resolution (fed to brain at case completion) ─────────────────

export const caseResolutionSchema = z.object({
  caseLabel: z.string().describe('Anonymized case label'),
  phenotypeCluster: z.array(z.string()).describe('HPO terms or symptom keywords'),
  initialHypotheses: z
    .array(
      z.object({
        diagnosis: z.string(),
        confidence: z.number().min(0).max(100),
      }),
    )
    .describe('Initial hypotheses before research'),
  finalDiagnosis: z.string().optional().describe('Final diagnosis if reached'),
  diagnosisConfidence: z.number().min(0).max(100).optional(),
  keyDifferentiator: z
    .string()
    .optional()
    .describe('Single most important differentiating finding'),
  misleadingFindings: z
    .array(z.string())
    .optional()
    .describe('Findings that initially pointed wrong direction'),
  diagnosticJourney: z
    .object({
      timeToResolution: z
        .string()
        .optional()
        .describe('Duration description (e.g., "3 months", "2 years")'),
      totalResearchQueries: z.number().int().optional(),
      pivotalMoment: z.string().optional().describe('What changed the diagnostic direction'),
    })
    .optional(),
  treatmentOutcome: z
    .object({
      drugClassesTried: z.array(z.string()).optional(),
      effectiveTreatment: z.string().optional(),
      pharmacogenomicFactors: z.array(z.string()).optional(),
    })
    .optional(),
});

export type CaseResolution = z.infer<typeof caseResolutionSchema>;
