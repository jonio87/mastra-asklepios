import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getClinicalStore } from '../storage/clinical-store.js';
import { logger } from '../utils/logger.js';
import type { PatientContext } from '../utils/patient-context.js';
import { buildPatientContext } from '../utils/patient-context.js';

// ─── Schemas ──────────────────────────────────────────────────────────────────

const researchQuestionSchema = z.object({
  question: z.string().describe('Specific research question'),
  targetHypothesis: z.string().describe('Which hypothesis this question addresses'),
  expectedImpact: z.enum(['high', 'medium', 'low']).describe('Expected diagnostic impact'),
  suggestedTools: z.array(z.string()).describe('Tools to use for this question'),
  searchTerms: z.array(z.string()).describe('Suggested search/query terms'),
  gapAddressed: z.string().describe('What evidence gap this fills'),
});

const phaseSchema = z.object({
  phase: z.enum(['immediate', 'short-term', 'deep-dive']).describe('Research urgency phase'),
  rationale: z.string().describe('Why this phase is needed'),
  questions: z.array(researchQuestionSchema),
});

const summarySchema = z.object({
  totalQuestions: z.number(),
  hypothesesCovered: z.array(z.string()),
  criticalGaps: z.array(z.string()).describe('Most important gaps to address'),
  estimatedResearchDepth: z
    .enum(['shallow', 'moderate', 'deep'])
    .describe('Overall research depth needed'),
});

const inputSchema = z.object({
  patientId: z.string().describe('Patient identifier'),
  focusHypotheses: z
    .array(z.string())
    .optional()
    .describe(
      'Specific hypotheses to prioritize research for. If empty, covers all active hypotheses.',
    ),
  maxQuestions: z
    .number()
    .int()
    .min(1)
    .max(30)
    .default(15)
    .describe('Maximum number of research questions to generate'),
});

const outputSchema = z.object({
  patientId: z.string(),
  generatedAt: z.string().describe('ISO 8601 timestamp'),
  phases: z.array(phaseSchema),
  summary: summarySchema,
});

// ─── Types ────────────────────────────────────────────────────────────────────

type ResearchQuestion = z.infer<typeof researchQuestionSchema>;
type Phase = 'immediate' | 'short-term' | 'deep-dive';

// ─── Tool suggestion mappings ─────────────────────────────────────────────────

const TOOL_MAP: Record<string, string[]> = {
  literature: ['deepResearch', 'citationVerifier'],
  gene: ['phenotypeMatch', 'pharmacogenomicsScreen'],
  trials: ['trialEligibility'],
  temporal: ['temporalAnalysis'],
  hypothesis: ['adversarialSynthesis', 'ddxGenerator'],
  lab: ['deepResearch'],
};

// ─── Helper functions ─────────────────────────────────────────────────────────

/**
 * Parse a confidence range string like "10-30%" into a midpoint number.
 */
/** @internal Exported for testing */
export function parseConfidenceMidpoint(range: string): number {
  const match = range.match(/(\d+)\s*-\s*(\d+)/);
  if (!match) return 50;
  const low = Number(match[1]);
  const high = Number(match[2]);
  return (low + high) / 2;
}

// ─── Section helpers for generateResearchQuestions ───────────────────────────

type Hypothesis = PatientContext['tierA']['currentHypotheses'][number];

/**
 * 1. Hypothesis-gap questions: low-confidence and speculative hypotheses.
 */
/** @internal Exported for testing */
export function generateHypothesisGapQuestions(
  hypotheses: Hypothesis[],
  activeConcerns: PatientContext['tierA']['activeConcerns'],
): ResearchQuestion[] {
  const questions: ResearchQuestion[] = [];

  // ─── 1. Hypothesis-gap questions ──────────────────────────────────
  for (const hyp of hypotheses) {
    const confidence = parseConfidenceMidpoint(hyp.confidenceRange);

    if (confidence < 40) {
      questions.push({
        question: `What evidence supports or contradicts "${hyp.name}"?`,
        targetHypothesis: hyp.name,
        expectedImpact: 'high',
        suggestedTools: [...(TOOL_MAP['literature'] ?? []), ...(TOOL_MAP['hypothesis'] ?? [])],
        searchTerms: [hyp.name, 'evidence', 'diagnostic criteria'],
        gapAddressed: `Low confidence (${hyp.confidenceRange}) — need stronger evidence base`,
      });
    }

    if (hyp.certaintyLevel === 'SPECULATIVE') {
      // Build symptom cluster from active concerns
      const symptomCluster = activeConcerns
        .map((c) => c.concern)
        .slice(0, 3)
        .join(', ');

      questions.push({
        question: `What case reports exist for "${hyp.name}" with symptom cluster: ${symptomCluster || 'current presentation'}?`,
        targetHypothesis: hyp.name,
        expectedImpact: 'medium',
        suggestedTools: TOOL_MAP['literature'] ?? [],
        searchTerms: [
          hyp.name,
          'case report',
          'rare presentation',
          ...(symptomCluster ? [symptomCluster] : []),
        ],
        gapAddressed: `Speculative hypothesis "${hyp.name}" lacks case-level evidence`,
      });
    }
  }

  return questions;
}

/**
 * 2. Data completeness questions: missing research and treatment failures.
 */
/** @internal Exported for testing */
export function generateDataCompletenessQuestions(
  tierA: PatientContext['tierA'],
  firstHypothesisName: string | undefined,
): ResearchQuestion[] {
  const questions: ResearchQuestion[] = [];

  // ─── 2. Data completeness questions ───────────────────────────────
  const { dataCompleteness } = tierA;

  if (!dataCompleteness.hasResearch) {
    const symptomSummary = tierA.activeConcerns
      .map((c) => c.concern)
      .slice(0, 3)
      .join('; ');

    questions.push({
      question: `Broad literature review needed for: ${symptomSummary || 'current clinical presentation'}`,
      targetHypothesis: firstHypothesisName ?? 'general',
      expectedImpact: 'high',
      suggestedTools: TOOL_MAP['literature'] ?? [],
      searchTerms: tierA.activeConcerns.map((c) => c.concern).slice(0, 5),
      gapAddressed: 'No research findings recorded — initial research needed',
    });
  }

  if (
    tierA.treatmentLandscape.ineffectiveCount > 2 &&
    tierA.treatmentLandscape.effectiveCount === 0
  ) {
    const drugClasses = tierA.treatmentLandscape.drugClassesTried.join(', ');

    questions.push({
      question: `Are there alternative therapeutic pathways beyond ${drugClasses || 'current drug classes'} for this condition?`,
      targetHypothesis: firstHypothesisName ?? 'treatment-resistant presentation',
      expectedImpact: 'high',
      suggestedTools: [...(TOOL_MAP['literature'] ?? []), ...(TOOL_MAP['trials'] ?? [])],
      searchTerms: [
        'alternative therapy',
        'treatment resistant',
        ...(drugClasses ? [drugClasses] : []),
        'novel mechanism',
      ],
      gapAddressed: `${tierA.treatmentLandscape.ineffectiveCount} treatment failures with no effective treatments found`,
    });
  }

  return questions;
}

/**
 * 3. Lab-driven questions: rising trends and critical values.
 * Filters out clinically insignificant trends and ordinal/qualitative results.
 */
function isRisingTrendClinicallySignificant(
  trend: PatientContext['tierB']['labTrends'][number],
): boolean {
  if (trend.direction !== 'rising' && trend.direction !== 'increasing') return false;
  if (trend.rateOfChange !== undefined && Math.abs(trend.rateOfChange) < 0.15) return false;
  const note = trend.clinicalNote?.toLowerCase() ?? '';
  if (note.includes('within normal') || note.includes('normalizing')) return false;
  return true;
}

function buildRisingTrendQuestion(
  trend: PatientContext['tierB']['labTrends'][number],
  targetHypothesis: string,
): ResearchQuestion {
  return {
    question: `What conditions cause progressive ${trend.testName} elevation (current: ${trend.latestValue})?`,
    targetHypothesis,
    expectedImpact: 'high',
    suggestedTools: [...(TOOL_MAP['lab'] ?? []), ...(TOOL_MAP['temporal'] ?? [])],
    searchTerms: [
      trend.testName,
      'progressive elevation',
      'differential diagnosis',
      'rising trend',
    ],
    gapAddressed: `Rising ${trend.testName} trend requires investigation (${trend.dataPoints} data points)`,
  };
}

function buildCriticalValueQuestion(
  trend: PatientContext['tierB']['labTrends'][number],
  targetHypothesis: string,
): ResearchQuestion {
  return {
    question: `Urgent: differential diagnosis for critical ${trend.testName} value (${trend.latestValue})`,
    targetHypothesis,
    expectedImpact: 'high',
    suggestedTools: [...(TOOL_MAP['lab'] ?? []), ...(TOOL_MAP['hypothesis'] ?? [])],
    searchTerms: [trend.testName, 'critical value', 'emergency differential', 'urgent workup'],
    gapAddressed: `Critical ${trend.testName} value requires immediate diagnostic clarification`,
  };
}

/** @internal Exported for testing */
export function generateLabDrivenQuestions(
  labTrends: PatientContext['tierB']['labTrends'],
  firstHypothesisName: string | undefined,
): ResearchQuestion[] {
  const questions: ResearchQuestion[] = [];
  const fallbackHypothesis = firstHypothesisName ?? 'unknown etiology';
  const fallbackAcute = firstHypothesisName ?? 'acute process';

  for (const trend of labTrends) {
    if (isRisingTrendClinicallySignificant(trend)) {
      questions.push(buildRisingTrendQuestion(trend, fallbackHypothesis));
    }
    if (trend.clinicalNote?.toLowerCase().includes('critical')) {
      questions.push(buildCriticalValueQuestion(trend, fallbackAcute));
    }
  }

  return questions;
}

/**
 * 4. Contradiction-driven questions: unresolved contradictions in clinical data.
 */
/** @internal Exported for testing */
export function generateContradictionQuestions(
  unresolvedContradictions: PatientContext['tierB']['unresolvedContradictions'],
  firstHypothesisName: string | undefined,
): ResearchQuestion[] {
  const questions: ResearchQuestion[] = [];

  // ─── 4. Contradiction-driven questions ────────────────────────────
  for (const contradiction of unresolvedContradictions) {
    questions.push({
      question: `How to resolve discrepancy between "${contradiction.finding1}" and "${contradiction.finding2}"?`,
      targetHypothesis: firstHypothesisName ?? 'diagnostic uncertainty',
      expectedImpact: 'high',
      suggestedTools: [...(TOOL_MAP['hypothesis'] ?? []), ...(TOOL_MAP['literature'] ?? [])],
      searchTerms: [
        contradiction.finding1,
        contradiction.finding2,
        'discrepancy',
        'reconciliation',
      ],
      gapAddressed: contradiction.diagnosticImpact ?? 'Unresolved contradiction in clinical data',
    });
  }

  return questions;
}

/**
 * 5. Treatment-driven questions: drug class failures and no effective treatments.
 */
/** @internal Exported for testing */
export function generateTreatmentDrivenQuestions(
  treatmentLandscape: PatientContext['tierA']['treatmentLandscape'],
  firstHypothesisName: string | undefined,
): ResearchQuestion[] {
  const questions: ResearchQuestion[] = [];

  // ─── 5. Treatment-driven questions ────────────────────────────────
  // Multiple failures in same drug class
  if (treatmentLandscape.drugClassesTried.length > 0 && treatmentLandscape.ineffectiveCount > 1) {
    for (const drugClass of treatmentLandscape.drugClassesTried) {
      questions.push({
        question: `Alternative mechanisms beyond ${drugClass} for this condition?`,
        targetHypothesis: firstHypothesisName ?? 'treatment-resistant presentation',
        expectedImpact: 'medium',
        suggestedTools: [...(TOOL_MAP['literature'] ?? []), ...(TOOL_MAP['gene'] ?? [])],
        searchTerms: [drugClass, 'alternative mechanism', 'pharmacogenomics', 'drug resistance'],
        gapAddressed: `Multiple failures in ${drugClass} class — need alternative pathways`,
      });
    }
  }

  if (treatmentLandscape.effectiveCount === 0 && treatmentLandscape.totalTrials > 0) {
    questions.push({
      question: `Novel or experimental therapies for current symptom presentation?`,
      targetHypothesis: firstHypothesisName ?? 'refractory condition',
      expectedImpact: 'medium',
      suggestedTools: [...(TOOL_MAP['trials'] ?? []), ...(TOOL_MAP['literature'] ?? [])],
      searchTerms: [
        'experimental therapy',
        'clinical trial',
        'novel treatment',
        'compassionate use',
      ],
      gapAddressed: `No effective treatments found across ${treatmentLandscape.totalTrials} trials`,
    });
  }

  return questions;
}

/**
 * 6. Research gap-driven questions: gaps identified in the research audit.
 */
/** @internal Exported for testing */
export function generateResearchGapQuestions(
  gapAreas: string[],
  firstHypothesisName: string | undefined,
): ResearchQuestion[] {
  const questions: ResearchQuestion[] = [];

  // ─── 6. Research gap-driven questions ─────────────────────────────
  for (const gap of gapAreas) {
    questions.push({
      question: `Address research gap: ${gap}`,
      targetHypothesis: firstHypothesisName ?? 'general',
      expectedImpact: 'medium',
      suggestedTools: TOOL_MAP['literature'] ?? [],
      searchTerms: gap
        .split(/\s+/)
        .filter((w) => w.length > 3)
        .slice(0, 5),
      gapAddressed: gap,
    });
  }

  return questions;
}

/**
 * Generate research questions from patient context analysis.
 */
/** @internal Exported for testing */
export function generateResearchQuestions(
  context: PatientContext,
  focusHypotheses: string[] | undefined,
  maxQuestions: number,
): ResearchQuestion[] {
  const { tierA, tierB } = context;

  // Filter hypotheses if focus is specified
  const hypotheses =
    focusHypotheses && focusHypotheses.length > 0
      ? tierA.currentHypotheses.filter((h) =>
          focusHypotheses.some((f) => h.name.toLowerCase().includes(f.toLowerCase())),
        )
      : tierA.currentHypotheses;

  const firstHypothesisName = hypotheses[0]?.name;

  const questions: ResearchQuestion[] = [
    ...generateHypothesisGapQuestions(hypotheses, tierA.activeConcerns),
    ...generateDataCompletenessQuestions(tierA, firstHypothesisName),
    ...generateLabDrivenQuestions(tierB.labTrends, firstHypothesisName),
    ...generateContradictionQuestions(tierB.unresolvedContradictions, firstHypothesisName),
    ...generateTreatmentDrivenQuestions(tierA.treatmentLandscape, firstHypothesisName),
    ...generateResearchGapQuestions(tierB.researchAudit.gapAreas, firstHypothesisName),
  ];

  // Deduplicate by question text and limit
  const seen = new Set<string>();
  const deduped: ResearchQuestion[] = [];
  for (const q of questions) {
    if (!seen.has(q.question)) {
      seen.add(q.question);
      deduped.push(q);
    }
  }

  return deduped.slice(0, maxQuestions);
}

/**
 * Group research questions into urgency phases.
 */
/** @internal Exported for testing */
export function groupIntoPhases(
  questions: ResearchQuestion[],
): Array<{ phase: Phase; rationale: string; questions: ResearchQuestion[] }> {
  const immediate: ResearchQuestion[] = [];
  const shortTerm: ResearchQuestion[] = [];
  const deepDive: ResearchQuestion[] = [];

  for (const q of questions) {
    const isContradiction =
      q.question.toLowerCase().includes('discrepancy') ||
      q.question.toLowerCase().includes('contradiction');
    const isCriticalLab =
      q.question.toLowerCase().includes('urgent:') || q.question.toLowerCase().includes('critical');

    if (q.expectedImpact === 'high' || isContradiction || isCriticalLab) {
      immediate.push(q);
    } else if (q.expectedImpact === 'medium') {
      shortTerm.push(q);
    } else {
      deepDive.push(q);
    }
  }

  const phases: Array<{ phase: Phase; rationale: string; questions: ResearchQuestion[] }> = [];

  if (immediate.length > 0) {
    phases.push({
      phase: 'immediate',
      rationale:
        'High-impact questions, contradiction resolutions, and critical lab investigations requiring urgent attention',
      questions: immediate,
    });
  }

  if (shortTerm.length > 0) {
    phases.push({
      phase: 'short-term',
      rationale:
        'Medium-impact questions and hypothesis-specific deep dives to strengthen diagnostic confidence',
      questions: shortTerm,
    });
  }

  if (deepDive.length > 0) {
    phases.push({
      phase: 'deep-dive',
      rationale:
        'Exploratory research, novel mechanism investigations, and low-impact questions for comprehensive coverage',
      questions: deepDive,
    });
  }

  return phases;
}

/**
 * Determine overall research depth needed based on data completeness and gaps.
 */
/** @internal Exported for testing */
export function estimateResearchDepth(
  context: PatientContext,
  totalQuestions: number,
): 'shallow' | 'moderate' | 'deep' {
  const { dataCompleteness } = context.tierA;
  const gapCount = context.tierB.researchAudit.gapAreas.length;
  const contradictionCount = context.tierB.unresolvedContradictions.length;

  if (!dataCompleteness.hasResearch || totalQuestions > 12 || contradictionCount > 2) {
    return 'deep';
  }

  if (gapCount > 2 || totalQuestions > 6 || contradictionCount > 0) {
    return 'moderate';
  }

  return 'shallow';
}

// ─── Tool definition ──────────────────────────────────────────────────────────

export const researchPlanTool = createTool({
  id: 'research-plan',
  description:
    'Generate a prioritized research plan from patient context. Analyzes hypotheses, evidence gaps, and data completeness to produce specific research questions grouped by urgency and expected diagnostic impact.',
  inputSchema,
  outputSchema,
  execute: async (input) => {
    const { patientId, focusHypotheses, maxQuestions = 15 } = input;
    logger.info('Generating research plan', {
      patientId,
      focusHypotheses: focusHypotheses ?? [],
      maxQuestions,
    });

    const store = getClinicalStore();
    const context = await buildPatientContext(store, patientId);

    // Generate questions based on context analysis
    const questions = generateResearchQuestions(context, focusHypotheses, maxQuestions);

    // Group into phases
    const phases = groupIntoPhases(questions);

    // Build summary
    const hypothesesCovered = [...new Set(questions.map((q) => q.targetHypothesis))];

    const criticalGaps = questions
      .filter((q) => q.expectedImpact === 'high')
      .map((q) => q.gapAddressed)
      .slice(0, 5);

    const totalQuestions = questions.length;

    const summary = {
      totalQuestions,
      hypothesesCovered,
      criticalGaps,
      estimatedResearchDepth: estimateResearchDepth(context, totalQuestions),
    };

    logger.info('Research plan generated', {
      patientId,
      totalQuestions,
      phases: phases.length,
      hypothesesCovered: hypothesesCovered.length,
      depth: summary.estimatedResearchDepth,
    });

    return {
      patientId,
      generatedAt: new Date().toISOString(),
      phases,
      summary,
    };
  },
});
