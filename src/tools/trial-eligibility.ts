import type { Tool } from '@mastra/core/tools';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getBiomedicalTools } from '../clients/biomedical-mcp.js';
import { getClinicalStore } from '../storage/clinical-store.js';
import { logger } from '../utils/logger.js';

function findMcpTool(tools: Record<string, Tool>, ...candidates: string[]): Tool | undefined {
  for (const candidate of candidates) {
    const exact = tools[candidate];
    if (exact) return exact;
  }
  const toolNames = Object.keys(tools);
  for (const candidate of candidates) {
    const suffix = toolNames.find((n) => n.endsWith(candidate));
    if (suffix) return tools[suffix];
  }
  return undefined;
}

async function executeMcpTool(tool: Tool, input: Record<string, unknown>): Promise<string> {
  if (!tool.execute) return '';
  try {
    const result = await tool.execute(input, {});
    if (typeof result === 'string') return result;
    if (result && typeof result === 'object') {
      const r = result as Record<string, unknown>;
      if (typeof r['content'] === 'string') return r['content'];
      if (Array.isArray(r['content'])) {
        return (r['content'] as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n');
      }
      return JSON.stringify(result);
    }
    return String(result);
  } catch {
    return '';
  }
}

const criterionMatchSchema = z.object({
  criterion: z.string(),
  evidence: z.string(),
  source: z.string(),
});

const criterionFailSchema = z.object({
  criterion: z.string(),
  reason: z.string(),
  overridable: z.boolean(),
});

const trialEvaluationSchema = z.object({
  nctId: z.string(),
  title: z.string(),
  phase: z.string().optional(),
  status: z.string(),
  conditions: z.array(z.string()),
  eligibilityCriteria: z.object({
    inclusion: z.array(z.string()),
    exclusion: z.array(z.string()),
  }),
  patientMatch: z.object({
    metCriteria: z.array(criterionMatchSchema),
    failedCriteria: z.array(criterionFailSchema),
    unknownCriteria: z.array(z.string()),
    matchScore: z.number().min(0).max(1),
    eligible: z.enum(['likely', 'unlikely', 'insufficient-data']),
  }),
  location: z.string().optional(),
  contactInfo: z.string().optional(),
});

export const trialEligibilityTool = createTool({
  id: 'trial-eligibility',
  description:
    'Check patient eligibility against clinical trial criteria from ClinicalTrials.gov. Takes patient clinical profile and matches against structured eligibility criteria. Returns per-criterion match analysis with evidence sources.',
  inputSchema: z.object({
    patientId: z.string().describe('Patient resource ID'),
    nctIds: z.array(z.string()).optional().describe('Specific NCT IDs to evaluate'),
    searchQuery: z.string().optional().describe('Search ClinicalTrials.gov for matching trials'),
    maxTrials: z.number().optional().describe('Max trials to evaluate (default: 10)'),
  }),
  outputSchema: z.object({
    evaluatedTrials: z.array(trialEvaluationSchema),
    bestMatches: z.array(z.string()),
  }),
  execute: async (input) => {
    const { patientId, nctIds, searchQuery, maxTrials = 10 } = input;
    logger.info('Evaluating clinical trial eligibility', { patientId, nctIds, searchQuery });

    const tools = await getBiomedicalTools();
    const store = getClinicalStore();

    const patientProfile = await loadPatientProfile(patientId, store);
    const trialTexts = await fetchTrials(tools, { nctIds, searchQuery, maxTrials });

    const evaluatedTrials = trialTexts.map(({ nctId, text }) =>
      evaluateSingleTrial(nctId, text, patientProfile),
    );

    evaluatedTrials.sort((a, b) => b.patientMatch.matchScore - a.patientMatch.matchScore);
    const bestMatches = evaluatedTrials
      .filter((t) => t.patientMatch.eligible !== 'unlikely')
      .slice(0, 3)
      .map((t) => t.nctId);

    await persistTrialFindings(store, patientId, evaluatedTrials);

    return { evaluatedTrials, bestMatches };
  },
});

// ─── Types ───────────────────────────────────────────────────────────────

interface PatientProfile {
  labTests: Map<string, { value: string | number; unit: string; flag?: string | undefined }>;
  medications: string[];
  specialties: string[];
  diagnoses: string[];
}

interface MatchResult {
  status: 'met' | 'failed' | 'unknown';
  evidence: string;
  source: string;
  reason: string;
  overridable: boolean;
}

type TrialEvaluation = z.infer<typeof trialEvaluationSchema>;

// ─── Extracted helpers ───────────────────────────────────────────────────

async function loadPatientProfile(
  patientId: string,
  store: ReturnType<typeof getClinicalStore>,
): Promise<PatientProfile> {
  const [labs, treatments, consultations] = await Promise.all([
    store.queryLabs({ patientId }),
    store.queryTreatments({ patientId }),
    store.queryConsultations({ patientId }),
  ]);

  return {
    labTests: new Map(
      labs.map((l) => [l.testName.toLowerCase(), { value: l.value, unit: l.unit, flag: l.flag }]),
    ),
    medications: treatments.map((t) => t.medication.toLowerCase()),
    specialties: [...new Set(consultations.map((c) => c.specialty))],
    diagnoses: consultations.flatMap((c) => (c.conclusions ? [c.conclusions.toLowerCase()] : [])),
  };
}

async function fetchTrials(
  tools: Record<string, Tool>,
  opts: { nctIds?: string[] | undefined; searchQuery?: string | undefined; maxTrials: number },
): Promise<Array<{ nctId: string; text: string }>> {
  const trialTool = findMcpTool(tools, 'biomcp_clinical_trial_searcher', 'clinical_trial_searcher');
  if (!trialTool) return [];

  const trialTexts: Array<{ nctId: string; text: string }> = [];

  if (opts.nctIds && opts.nctIds.length > 0) {
    for (const nctId of opts.nctIds.slice(0, opts.maxTrials)) {
      const text = await executeMcpTool(trialTool, { query: nctId, nct_id: nctId });
      if (text.length > 10) trialTexts.push({ nctId, text });
    }
  } else if (opts.searchQuery) {
    const text = await executeMcpTool(trialTool, { query: opts.searchQuery });
    const nctMatches = text.matchAll(/NCT\d{8}/g);
    const foundIds = [...new Set([...nctMatches].map((m) => m[0]))].slice(0, opts.maxTrials);
    for (const nctId of foundIds) {
      trialTexts.push({ nctId, text });
    }
  }

  return trialTexts;
}

function evaluateSingleTrial(
  nctId: string,
  text: string,
  profile: PatientProfile,
): TrialEvaluation {
  const titleMatch = text.match(/(?:Title|Study):\s*(.+?)(?:\n|$)/i);
  const phaseMatch = text.match(/Phase\s*(\d|I{1,3}V?)/i);
  const statusMatch = text.match(/(?:Status|Recruiting):\s*(\w+[\w\s]*)/i);
  const conditions = text.match(/Condition[s]?:\s*(.+?)(?:\n|$)/i);

  const { inclusion, exclusion } = parseCriteriaSections(text);
  const patientMatch = evaluateAllCriteria(inclusion, exclusion, profile);

  return {
    nctId,
    title: titleMatch?.[1]?.trim() ?? 'Unknown trial',
    ...(phaseMatch?.[1] ? { phase: `Phase ${phaseMatch[1]}` } : {}),
    status: statusMatch?.[1]?.trim() ?? 'Unknown',
    conditions: conditions?.[1]?.split(/[,;]/).map((c) => c.trim()) ?? [],
    eligibilityCriteria: { inclusion, exclusion },
    patientMatch,
  };
}

function parseCriteriaSections(text: string): { inclusion: string[]; exclusion: string[] } {
  const inclusionSection = text.match(/Inclusion\s*(?:Criteria)?:?\s*([\s\S]*?)(?:Exclusion|$)/i);
  const exclusionSection = text.match(/Exclusion\s*(?:Criteria)?:?\s*([\s\S]*?)(?:\n\n|$)/i);

  const inclusion =
    inclusionSection?.[1]
      ?.split(/\n[-•*]\s*/)
      .map((c) => c.trim())
      .filter((c) => c.length > 5) ?? [];
  const exclusion =
    exclusionSection?.[1]
      ?.split(/\n[-•*]\s*/)
      .map((c) => c.trim())
      .filter((c) => c.length > 5) ?? [];

  return { inclusion, exclusion };
}

function evaluateAllCriteria(
  inclusion: string[],
  exclusion: string[],
  profile: PatientProfile,
): TrialEvaluation['patientMatch'] {
  const metCriteria: z.infer<typeof criterionMatchSchema>[] = [];
  const failedCriteria: z.infer<typeof criterionFailSchema>[] = [];
  const unknownCriteria: string[] = [];

  for (const criterion of inclusion) {
    const match = matchCriterion(criterion, profile);
    if (match.status === 'met') {
      metCriteria.push({ criterion, evidence: match.evidence, source: match.source });
    } else if (match.status === 'failed') {
      failedCriteria.push({ criterion, reason: match.reason, overridable: match.overridable });
    } else {
      unknownCriteria.push(criterion);
    }
  }

  for (const criterion of exclusion) {
    const match = matchExclusionCriterion(criterion, profile);
    if (match.status === 'excluded') {
      failedCriteria.push({
        criterion: `EXCLUSION: ${criterion}`,
        reason: match.reason,
        overridable: false,
      });
    }
  }

  const totalCriteria = metCriteria.length + failedCriteria.length + unknownCriteria.length;
  const matchScore = totalCriteria > 0 ? metCriteria.length / totalCriteria : 0;
  const eligible: 'likely' | 'unlikely' | 'insufficient-data' =
    failedCriteria.length > 0
      ? 'unlikely'
      : unknownCriteria.length > metCriteria.length
        ? 'insufficient-data'
        : 'likely';

  return {
    metCriteria,
    failedCriteria,
    unknownCriteria,
    matchScore: Math.round(matchScore * 100) / 100,
    eligible,
  };
}

async function persistTrialFindings(
  store: ReturnType<typeof getClinicalStore>,
  patientId: string,
  evaluatedTrials: TrialEvaluation[],
): Promise<void> {
  try {
    const today = new Date().toISOString().split('T')[0] ?? '';
    for (const trial of evaluatedTrials.slice(0, 3)) {
      await store.addResearchFinding({
        id: `find-trial-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        patientId,
        source: 'ClinicalTrials.gov',
        sourceTool: 'trial-eligibility',
        externalId: trial.nctId,
        externalIdType: 'nct',
        title: trial.title,
        summary: `Eligibility: ${trial.patientMatch.eligible} (score: ${(trial.patientMatch.matchScore * 100).toFixed(0)}%) — met ${trial.patientMatch.metCriteria.length} criteria, failed ${trial.patientMatch.failedCriteria.length}, unknown ${trial.patientMatch.unknownCriteria.length}`,
        relevance: trial.patientMatch.matchScore,
        evidenceLevel: 'unknown',
        date: today,
      });
    }
  } catch (err: unknown) {
    logger.warn('Failed to persist trial eligibility results', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── Criterion matching helpers ──────────────────────────────────────────

function matchCriterion(criterion: string, profile: PatientProfile): MatchResult {
  const lc = criterion.toLowerCase();

  // Age matching
  const ageMatch = lc.match(/age\s*(?:>=?|≥)\s*(\d+)/);
  if (ageMatch) {
    return {
      status: 'unknown',
      evidence: '',
      source: '',
      reason: 'Age not available in Layer 2',
      overridable: false,
    };
  }

  // Diagnosis matching
  for (const diagnosis of profile.diagnoses) {
    if (lc.includes(diagnosis) || diagnosis.includes(lc.slice(0, 20))) {
      return {
        status: 'met',
        evidence: `Diagnosis: ${diagnosis}`,
        source: 'consultation',
        reason: '',
        overridable: false,
      };
    }
  }

  // Lab value matching
  const labMatch = lc.match(/(\w+[\w\s]*\w)\s*(?:>=?|<=?|>|<|≥|≤)\s*([\d.]+)/);
  if (labMatch?.[1]) {
    const testName = labMatch[1].trim().toLowerCase();
    for (const [name, data] of profile.labTests) {
      if (name.includes(testName) || testName.includes(name)) {
        return {
          status: 'met',
          evidence: `Lab: ${name} = ${data.value} ${data.unit}`,
          source: 'lab-result',
          reason: '',
          overridable: false,
        };
      }
    }
  }

  // Medication matching
  for (const med of profile.medications) {
    if (lc.includes(med)) {
      return {
        status: 'met',
        evidence: `Currently taking: ${med}`,
        source: 'treatment-trial',
        reason: '',
        overridable: false,
      };
    }
  }

  return {
    status: 'unknown',
    evidence: '',
    source: '',
    reason: 'Insufficient data to evaluate',
    overridable: false,
  };
}

function matchExclusionCriterion(
  criterion: string,
  profile: PatientProfile,
): { status: 'excluded' | 'clear' | 'unknown'; reason: string } {
  const lc = criterion.toLowerCase();

  // Medication exclusion
  for (const med of profile.medications) {
    if (lc.includes(med)) {
      return { status: 'excluded', reason: `Patient is currently taking ${med}` };
    }
  }

  // Diagnosis exclusion
  for (const diagnosis of profile.diagnoses) {
    if (lc.includes(diagnosis)) {
      return { status: 'excluded', reason: `Patient has diagnosis: ${diagnosis}` };
    }
  }

  return { status: 'clear', reason: '' };
}
