import { z } from 'zod';

/**
 * Diagnostic Synthesis Schemas — Stage 7 output and supporting types.
 *
 * These schemas define the structured output of the adversarial synthesis
 * process (advocate/skeptic/arbiter) and the flow state tracking for the
 * 9-stage diagnostic workflow.
 *
 * Design reference: research/archive/optimal-agentic-flow-design.md
 */

// ─── Certainty Levels ────────────────────────────────────────────────────

export const certaintyLevelEnum = z.enum([
  'ESTABLISHED', // Near-certain, supported by multiple T1 sources
  'STRONG', // High confidence, consistent evidence across tiers
  'MODERATE', // Reasonable support, some gaps or contradictions
  'WEAK', // Limited evidence, speculative but plausible
  'SPECULATIVE', // Hypothesis-level, needs significant validation
]);

export type CertaintyLevel = z.infer<typeof certaintyLevelEnum>;

// ─── Ranked Hypothesis ───────────────────────────────────────────────────

export const rankedHypothesisSchema = z.object({
  name: z.string().describe('Diagnosis or condition name'),
  probability: z.object({
    low: z.number().min(0).max(100).describe('Lower bound of probability range (%)'),
    high: z.number().min(0).max(100).describe('Upper bound of probability range (%)'),
  }),
  advocateCase: z.string().describe('Best case FOR this hypothesis'),
  skepticCase: z.string().describe('Best case AGAINST this hypothesis'),
  arbiterVerdict: z.string().describe('Balanced assessment weighing both sides'),
  evidenceTier: z.enum(['T1', 'T2', 'T3']).describe('Highest tier of supporting evidence'),
  certaintyLevel: certaintyLevelEnum,
  supportingEvidence: z
    .array(
      z.object({
        claim: z.string(),
        source: z.string(),
        tier: z.enum(['T1', 'T2', 'T3']),
      }),
    )
    .optional()
    .describe('Key evidence items supporting this hypothesis'),
  contradictingEvidence: z
    .array(
      z.object({
        claim: z.string(),
        source: z.string(),
        tier: z.enum(['T1', 'T2', 'T3']),
      }),
    )
    .optional()
    .describe('Key evidence items contradicting this hypothesis'),
});

export type RankedHypothesis = z.infer<typeof rankedHypothesisSchema>;

// ─── Divergence Point ────────────────────────────────────────────────────

export const divergencePointSchema = z.object({
  topic: z.string().describe('The specific clinical question where perspectives disagree'),
  advocatePosition: z.string().describe("Advocate's interpretation"),
  skepticPosition: z.string().describe("Skeptic's interpretation"),
  resolution: z
    .string()
    .describe('What test, evidence, or investigation would resolve this disagreement'),
});

export type DivergencePoint = z.infer<typeof divergencePointSchema>;

// ─── Informative Test ────────────────────────────────────────────────────

export const informativeTestSchema = z.object({
  test: z.string().describe('Name of the diagnostic test or investigation'),
  targetHypothesis: z.string().describe('Which hypothesis this test discriminates'),
  expectedImpact: z
    .string()
    .describe(
      'What the result means: "If positive: H1 rises to 70%. If negative: H1 drops to 20%."',
    ),
  urgency: z.enum(['IMMEDIATE', 'SHORT_TERM', 'PARALLEL']).describe('How urgently this is needed'),
  alreadyDone: z
    .boolean()
    .optional()
    .describe('Whether this test has already been performed (from T1 records)'),
  result: z.string().optional().describe('Result if already done'),
});

export type InformativeTest = z.infer<typeof informativeTestSchema>;

// ─── Diagnostic Synthesis (Stage 7 Output) ───────────────────────────────

export const diagnosticSynthesisSchema = z.object({
  hypotheses: z.array(rankedHypothesisSchema).describe('Ranked hypotheses from arbiter'),
  convergencePoints: z.array(z.string()).describe('What all three perspectives agree on'),
  divergencePoints: z
    .array(divergencePointSchema)
    .describe('Where advocate/skeptic/arbiter disagree and why'),
  mostInformativeTests: z
    .array(informativeTestSchema)
    .describe('Tests ranked by expected diagnostic yield'),
  unresolvedQuestions: z.array(z.string()).describe('What remains genuinely ambiguous'),
  synthesisNarrative: z.string().optional().describe('Overall synthesis narrative from arbiter'),
});

export type DiagnosticSynthesis = z.infer<typeof diagnosticSynthesisSchema>;

// ─── Specialist Input (Stage 8) ──────────────────────────────────────────

export const specialistInputSchema = z.object({
  specialistName: z.string().describe('Name of the specialist'),
  specialty: z.string().describe('Medical specialty (e.g., Neurology, Rheumatology)'),
  institution: z.string().optional().describe('Institution or clinic'),
  date: z.string().describe('Date of consultation (ISO 8601)'),
  physicalExamination: z.array(z.string()).describe('Clinical findings from physical examination'),
  clinicalImpression: z.string().describe('Overall clinical impression'),
  hypothesisAgreement: z
    .array(
      z.object({
        hypothesisName: z.string(),
        verdict: z.enum(['agree', 'disagree', 'uncertain']),
        reasoning: z.string(),
      }),
    )
    .describe('Agreement/disagreement with each ranked hypothesis'),
  recommendedTests: z.array(z.string()).optional().describe('Additional tests recommended'),
  recommendedTreatments: z.array(z.string()).optional().describe('Treatment recommendations'),
  modelBreaking: z
    .boolean()
    .optional()
    .describe('Whether findings contradict a high-confidence hypothesis'),
  modelBreakingDetail: z
    .string()
    .optional()
    .describe('Explanation of which hypothesis is contradicted and why'),
  patientId: z.string(),
});

export type SpecialistInput = z.infer<typeof specialistInputSchema>;

// ─── Contradicting Evidence (enhancement to evidence provenance) ─────────

export const contradictingEvidenceSchema = z.object({
  source: z.string().describe('Source of the contradicting evidence'),
  date: z.string().describe('Date of the contradicting finding (ISO 8601)'),
  detail: z.string().describe('What specifically contradicts'),
  tier: z.enum(['T1', 'T2', 'T3']).describe('Evidence tier of the contradicting source'),
});

export type ContradictingEvidence = z.infer<typeof contradictingEvidenceSchema>;

// ─── Flow State (9-stage progress tracking) ──────────────────────────────

export const flowStateSchema = z.object({
  currentStage: z
    .number()
    .int()
    .min(0)
    .max(9)
    .describe('Current stage in the 9-stage diagnostic flow (0 = not started)'),
  stageGates: z.object({
    recordsIngested: z.boolean().describe('Stage 1: All available records processed'),
    brainRecalled: z.boolean().describe('Stage 2: Cross-patient patterns queried'),
    interviewComplete: z.boolean().describe('Stage 3: Structured interview completed'),
    researchComplete: z.boolean().describe('Stage 4: Parallel research completed'),
    hypothesesGenerated: z.boolean().describe('Stage 5: Preliminary hypotheses generated'),
    followUpQuestionsAnswered: z
      .boolean()
      .describe('Stage 6: Research-driven follow-up questions answered'),
    adversarialComplete: z.boolean().describe('Stage 7: Adversarial synthesis completed'),
    specialistIntegrated: z.boolean().describe('Stage 8: Specialist input integrated'),
    deliverablesGenerated: z.boolean().describe('Stage 9: Final deliverables generated'),
  }),
  feedbackLoops: z.object({
    stage6ToStage4: z
      .number()
      .int()
      .min(0)
      .describe('Times model-breaking answers sent back to research'),
    stage6ToStage5: z
      .number()
      .int()
      .min(0)
      .describe('Times hypothesis-shifting answers triggered re-ranking'),
    stage8ToStage7: z
      .number()
      .int()
      .min(0)
      .describe('Times specialist findings contradicted high-confidence hypotheses'),
  }),
  coldStart: z
    .boolean()
    .describe('True when no T1 data is available — all claims are T2 (unvalidated)'),
});

export type FlowState = z.infer<typeof flowStateSchema>;

// ─── Answer Routing (Stage 6 follow-up question routing) ─────────────────

export const answerRoutingSchema = z.object({
  answerType: z.enum(['detail', 'hypothesis-shifting', 'model-breaking']),
  targetStage: z
    .number()
    .int()
    .min(4)
    .max(7)
    .describe('Stage to route to (4=research, 5=hypotheses, 7=synthesis)'),
  affectedHypothesis: z.string().optional().describe('Which hypothesis is affected'),
  impactDescription: z.string().describe('How this answer changes the diagnostic picture'),
});

export type AnswerRouting = z.infer<typeof answerRoutingSchema>;
