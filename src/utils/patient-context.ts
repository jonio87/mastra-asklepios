import type {
  Consultation,
  Contradiction,
  LabResult,
  PatientReport,
  TreatmentTrial,
} from '../schemas/clinical-record.js';
import type { ResearchHypothesis, ResearchSummary } from '../schemas/research-record.js';
import type { ClinicalStore } from '../storage/clinical-store.js';
import { logger } from './logger.js';

/**
 * Tier A: Compact patient context (~2K tokens).
 * The "clinician's screen" — everything you need before starting work.
 */
export interface PatientContextTierA {
  patientId: string;
  demographics: {
    age: string | undefined;
    sex: string | undefined;
    keyContext: string | undefined;
  };
  activeConcerns: Array<{
    concern: string;
    priority: string;
    since?: string;
  }>;
  currentHypotheses: Array<{
    name: string;
    confidenceRange: string;
    certaintyLevel: string;
    keyEvidence: string;
  }>;
  criticalFindings: string[];
  dataCompleteness: {
    labCount: number;
    consultationCount: number;
    treatmentCount: number;
    contradictionCount: number;
    reportCount: number;
    hasResearch: boolean;
  };
  researchState: {
    findingCount: number;
    hypothesisCount: number;
    latestResearchDate: string | undefined;
    topSources: Array<{ source: string; count: number }>;
  };
  treatmentLandscape: {
    totalTrials: number;
    effectiveCount: number;
    ineffectiveCount: number;
    activeCount: number;
    drugClassesTried: string[];
  };
}

/**
 * Tier B: Expanded patient context (~8K tokens).
 * Deep details for research planning and hypothesis generation.
 */
export interface PatientContextTierB {
  labTrends: Array<{
    testName: string;
    direction: string;
    rateOfChange: number | undefined;
    clinicalNote: string | undefined;
    latestValue: string;
    latestDate: string;
    dataPoints: number;
  }>;
  temporalMap: Array<{
    date: string;
    event: string;
    category: string;
    significance: string;
  }>;
  hypothesisTimelines: Array<{
    name: string;
    versionCount: number;
    currentConfidence: string;
    directionChanges: number;
    trajectory: string;
  }>;
  unresolvedContradictions: Array<{
    finding1: string;
    finding2: string;
    diagnosticImpact: string | undefined;
    resolutionPlan: string | undefined;
  }>;
  researchAudit: {
    totalQueries: number;
    totalFindings: number;
    evidenceLinkCount: number;
    gapAreas: string[];
    recentFindings: Array<{
      title: string;
      source: string;
      relevance: number | undefined;
      date: string;
    }>;
  };
  recentConsultations: Array<{
    specialty: string;
    date: string;
    conclusions: string | undefined;
    conclusionsStatus: string;
  }>;
}

export interface PatientContext {
  tierA: PatientContextTierA;
  tierB: PatientContextTierB;
  generatedAt: string;
  tokenEstimate: { tierA: number; tierB: number };
}

/**
 * Estimate token count from a string (rough: ~4 chars per token).
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Summarize treatment landscape from treatment trials.
 */
function summarizeTreatments(
  treatments: TreatmentTrial[],
): PatientContextTierA['treatmentLandscape'] {
  const drugClasses = new Set<string>();
  let effectiveCount = 0;
  let ineffectiveCount = 0;
  let activeCount = 0;

  for (const t of treatments) {
    if (t.drugClass) drugClasses.add(t.drugClass);
    if (t.efficacy === 'significant' || t.efficacy === 'complete') {
      effectiveCount++;
    } else if (t.efficacy === 'none') {
      ineffectiveCount++;
    }
    if (!t.endDate) {
      activeCount++;
    }
  }

  return {
    totalTrials: treatments.length,
    effectiveCount,
    ineffectiveCount,
    activeCount,
    drugClassesTried: [...drugClasses],
  };
}

type TemporalEvent = PatientContextTierB['temporalMap'][number];

/** Convert flagged labs into temporal events. */
function labsToTemporalEvents(labs: LabResult[]): TemporalEvent[] {
  const events: TemporalEvent[] = [];
  for (const lab of labs) {
    if (lab.flag && lab.flag !== 'normal') {
      events.push({
        date: lab.date,
        event: `${lab.testName}: ${String(lab.value)} ${lab.unit} (${lab.flag})`,
        category: 'lab',
        significance: lab.flag === 'critical' ? 'critical' : 'notable',
      });
    }
  }
  return events;
}

/** Convert consultations into temporal events. */
function consultationsToTemporalEvents(consultations: Consultation[]): TemporalEvent[] {
  return consultations.map((c) => ({
    date: c.date,
    event: `${c.specialty} consultation: ${c.conclusions ?? c.reason ?? 'No summary'}`,
    category: 'consultation',
    significance: c.conclusionsStatus === 'documented' ? 'confirmed' : 'pending',
  }));
}

/** Convert treatment starts/stops into temporal events. */
function treatmentsToTemporalEvents(treatments: TreatmentTrial[]): TemporalEvent[] {
  const events: TemporalEvent[] = [];
  for (const t of treatments) {
    if (t.startDate) {
      events.push({
        date: t.startDate,
        event: `Started ${t.medication}${t.dosage ? ` (${t.dosage})` : ''}`,
        category: 'treatment',
        significance: 'notable',
      });
    }
    if (t.endDate && t.reasonDiscontinued) {
      events.push({
        date: t.endDate,
        event: `Stopped ${t.medication}: ${t.reasonDiscontinued}`,
        category: 'treatment',
        significance: t.efficacy === 'none' ? 'notable' : 'routine',
      });
    }
  }
  return events;
}

/** Convert contradictions into temporal events. */
function contradictionsToTemporalEvents(contradictions: Contradiction[]): TemporalEvent[] {
  const events: TemporalEvent[] = [];
  for (const c of contradictions) {
    const date = c.finding1Date ?? c.finding2Date ?? '';
    if (date) {
      events.push({
        date,
        event: `Contradiction: ${c.finding1} vs ${c.finding2}`,
        category: 'contradiction',
        significance: 'critical',
      });
    }
  }
  return events;
}

/** Convert high-severity patient reports into temporal events. */
function reportsToTemporalEvents(reports: PatientReport[]): TemporalEvent[] {
  const events: TemporalEvent[] = [];
  for (const r of reports) {
    if (r.severity !== undefined && r.severity >= 7) {
      events.push({
        date: r.date,
        event: `Patient report (severity ${r.severity}/10): ${r.content.slice(0, 100)}`,
        category: 'patient-report',
        significance: r.severity >= 9 ? 'critical' : 'notable',
      });
    }
  }
  return events;
}

/**
 * Build temporal map from various clinical records.
 */
function buildTemporalMap(
  labs: LabResult[],
  consultations: Consultation[],
  treatments: TreatmentTrial[],
  contradictions: Contradiction[],
  reports: PatientReport[],
): PatientContextTierB['temporalMap'] {
  const events: TemporalEvent[] = [
    ...labsToTemporalEvents(labs),
    ...consultationsToTemporalEvents(consultations),
    ...treatmentsToTemporalEvents(treatments),
    ...contradictionsToTemporalEvents(contradictions),
    ...reportsToTemporalEvents(reports),
  ];

  // Sort by date descending
  events.sort((a, b) => b.date.localeCompare(a.date));

  return events;
}

/**
 * Build hypothesis summaries for Tier A.
 */
function buildHypothesisSummaries(
  hypotheses: ResearchHypothesis[],
): PatientContextTierA['currentHypotheses'] {
  return hypotheses.map((h) => ({
    name: h.name,
    confidenceRange: `${h.probabilityLow ?? 0}-${h.probabilityHigh ?? 0}%`,
    certaintyLevel: h.certaintyLevel ?? 'SPECULATIVE',
    keyEvidence: h.advocateCase ?? 'No advocate case documented',
  }));
}

/**
 * Test name prefixes for qualitative/ordinal results that should not
 * be included in numeric trend analysis. These are immunoblot intensity
 * classes (1-6 ordinal scale), urinalysis sediment counts, or
 * qualitative serology markers.
 */
const QUALITATIVE_TEST_PREFIXES = [
  'Anti-Hu',
  'Anti-Ri',
  'Anti-Yo',
  'Anti-GAD',
  'Anti-MAG',
  'Anti-myelin',
  'Anti-amphiphysin',
  'Anti-CV2',
  'Anti-Ma2/Ta',
  'Anti-recoverin',
  'Anti-SOX1',
  'Anti-titin',
  'Anti-HBc',
  'Anti-HCV',
  'Anti-HAV',
  'WBC (urine',
  'Casts (urine',
  'Crystals (urine',
  'Spermatozoa',
  'Yeast cells',
];

/**
 * Get unique flagged lab test names for trend analysis.
 * Excludes qualitative/ordinal tests (immunoblot intensity, urinalysis sediment).
 */
function getFlaggedLabNames(labs: LabResult[]): string[] {
  const isQualitative = (name: string) => QUALITATIVE_TEST_PREFIXES.some((p) => name.startsWith(p));

  const names = new Set<string>();
  for (const lab of labs) {
    if (lab.flag && lab.flag !== 'normal' && !isQualitative(lab.testName)) {
      names.add(lab.testName);
    }
  }
  // Also add labs with multiple data points (for trend tracking)
  const counts = new Map<string, number>();
  for (const lab of labs) {
    if (!isQualitative(lab.testName)) {
      counts.set(lab.testName, (counts.get(lab.testName) ?? 0) + 1);
    }
  }
  for (const [name, count] of counts) {
    if (count >= 3) names.add(name);
  }
  return [...names];
}

/**
 * Build patient context from Layer 2 clinical store.
 *
 * Queries all structured clinical data and constructs:
 * - Tier A: compact summary (~2K tokens) suitable for working memory
 * - Tier B: expanded details (~8K tokens) for research planning
 *
 * @param store - ClinicalStore instance
 * @param patientId - Patient identifier
 * @returns Complete PatientContext with both tiers and token estimates
 */
export async function buildPatientContext(
  store: ClinicalStore,
  patientId: string,
): Promise<PatientContext> {
  logger.info('Building patient context', { patientId });

  // ─── Parallel data fetch ─────────────────────────────────────────
  const [labs, treatments, consultations, contradictions, reports, hypotheses, researchSummary] =
    await Promise.all([
      store.queryLabs({ patientId }),
      store.queryTreatments({ patientId }),
      store.queryConsultations({ patientId }),
      store.queryContradictions({ patientId }),
      store.queryPatientReports({ patientId }),
      store.queryHypotheses({ patientId }),
      store.getPatientResearchSummary(patientId),
    ]);

  // ─── Tier A: Compact Context ─────────────────────────────────────
  const tierA: PatientContextTierA = {
    patientId,
    demographics: {
      age: undefined,
      sex: undefined,
      keyContext: undefined,
    },
    activeConcerns: extractActiveConcerns(labs, treatments, contradictions, reports),
    currentHypotheses: buildHypothesisSummaries(hypotheses),
    criticalFindings: extractCriticalFindings(labs, contradictions, treatments),
    dataCompleteness: {
      labCount: labs.length,
      consultationCount: consultations.length,
      treatmentCount: treatments.length,
      contradictionCount: contradictions.length,
      reportCount: reports.length,
      hasResearch: researchSummary.findingCount > 0,
    },
    researchState: {
      findingCount: researchSummary.findingCount,
      hypothesisCount: researchSummary.hypothesisCount,
      latestResearchDate: researchSummary.latestFindingDate,
      topSources: researchSummary.topSources,
    },
    treatmentLandscape: summarizeTreatments(treatments),
  };

  // ─── Tier B: Expanded Context ────────────────────────────────────

  // Lab trends for flagged/repeated tests
  const trendNames = getFlaggedLabNames(labs);
  const labTrends = await buildLabTrends(store, patientId, trendNames, labs);

  // Hypothesis timelines
  const hypothesisTimelines = await buildHypothesisTimelines(store, patientId, hypotheses);

  // Unresolved contradictions (deduplicated by finding pair)
  const contradictionsSeen = new Set<string>();
  const unresolvedContradictions = contradictions
    .filter((c) => c.resolutionStatus !== 'resolved')
    .filter((c) => {
      const key = `${c.finding1}|${c.finding2}`;
      if (contradictionsSeen.has(key)) return false;
      contradictionsSeen.add(key);
      return true;
    })
    .map((c) => ({
      finding1: c.finding1,
      finding2: c.finding2,
      diagnosticImpact: c.diagnosticImpact,
      resolutionPlan: c.resolutionPlan,
    }));

  // Recent findings for research audit
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().split('T')[0];
  const findingsParams: { patientId: string; dateFrom?: string } = { patientId };
  if (thirtyDaysAgo) findingsParams.dateFrom = thirtyDaysAgo;
  const recentFindings = await store.queryFindings(findingsParams);

  // Identify research gaps
  const gapAreas = identifyResearchGaps(
    labs,
    treatments,
    consultations,
    hypotheses,
    researchSummary,
  );

  const tierB: PatientContextTierB = {
    labTrends,
    temporalMap: buildTemporalMap(labs, consultations, treatments, contradictions, reports),
    hypothesisTimelines,
    unresolvedContradictions,
    researchAudit: {
      totalQueries: researchSummary.queryCount,
      totalFindings: researchSummary.findingCount,
      evidenceLinkCount: researchSummary.evidenceLinkCount,
      gapAreas,
      recentFindings: recentFindings.slice(0, 10).map((f) => ({
        title: f.title,
        source: f.source,
        relevance: f.relevance,
        date: f.date,
      })),
    },
    recentConsultations: deduplicateConsultations(consultations)
      .slice(0, 5)
      .map((c) => ({
        specialty: c.specialty,
        date: c.date,
        conclusions: c.conclusions,
        conclusionsStatus: c.conclusionsStatus,
      })),
  };

  // ─── Token estimates ─────────────────────────────────────────────
  const tierAJson = JSON.stringify(tierA);
  const tierBJson = JSON.stringify(tierB);

  const context: PatientContext = {
    tierA,
    tierB,
    generatedAt: new Date().toISOString(),
    tokenEstimate: {
      tierA: estimateTokens(tierAJson),
      tierB: estimateTokens(tierBJson),
    },
  };

  logger.info('Patient context built', {
    patientId,
    tierATokens: context.tokenEstimate.tierA,
    tierBTokens: context.tokenEstimate.tierB,
    hypotheses: hypotheses.length,
    labs: labs.length,
    treatments: treatments.length,
  });

  return context;
}

type ActiveConcern = PatientContextTierA['activeConcerns'][number];

/** Extract concern from abnormal lab values. */
function labConcerns(labs: LabResult[]): ActiveConcern[] {
  const abnormalLabs = labs.filter(
    (l) => l.flag === 'critical' || l.flag === 'high' || l.flag === 'low',
  );
  if (abnormalLabs.length === 0) return [];

  const latestAbnormal = abnormalLabs[abnormalLabs.length - 1];
  if (!latestAbnormal) return [];

  const concern: ActiveConcern = {
    concern: `${abnormalLabs.length} abnormal lab values (latest: ${latestAbnormal.testName} ${latestAbnormal.flag})`,
    priority: abnormalLabs.some((l) => l.flag === 'critical') ? 'critical' : 'high',
  };
  const firstDate = abnormalLabs[0]?.date;
  if (firstDate) concern.since = firstDate;
  return [concern];
}

/** Extract concern from unresolved contradictions. */
function contradictionConcerns(contradictions: Contradiction[]): ActiveConcern[] {
  const unresolved = contradictions.filter((c) => c.resolutionStatus !== 'resolved');
  if (unresolved.length === 0) return [];
  return [
    {
      concern: `${unresolved.length} unresolved contradictions in clinical data`,
      priority: 'high',
    },
  ];
}

/** Extract concern from treatment failures. */
function treatmentConcerns(treatments: TreatmentTrial[]): ActiveConcern[] {
  const failures = treatments.filter((t) => t.efficacy === 'none');
  if (failures.length < 3) return [];
  return [
    {
      concern: `${failures.length} ineffective treatments — consider alternative pathways`,
      priority: 'medium',
    },
  ];
}

/** Extract concern from high-severity patient reports. */
function reportConcerns(reports: PatientReport[]): ActiveConcern[] {
  const recentReports = reports.filter((r) => r.severity !== undefined && r.severity >= 7);
  if (recentReports.length === 0) return [];

  const latest = recentReports[0];
  if (!latest) return [];

  return [
    {
      concern: `Recent high-severity patient report (${latest.severity}/10)`,
      priority: latest.severity !== undefined && latest.severity >= 9 ? 'critical' : 'high',
      since: latest.date,
    },
  ];
}

/**
 * Extract active concerns from clinical data.
 * Identifies patterns that represent ongoing clinical issues.
 */
function extractActiveConcerns(
  labs: LabResult[],
  treatments: TreatmentTrial[],
  contradictions: Contradiction[],
  reports: PatientReport[],
): PatientContextTierA['activeConcerns'] {
  return [
    ...labConcerns(labs),
    ...contradictionConcerns(contradictions),
    ...treatmentConcerns(treatments),
    ...reportConcerns(reports),
  ];
}

/** Extract critical lab findings. */
function criticalLabFindings(labs: LabResult[]): string[] {
  return labs
    .filter((l) => l.flag === 'critical')
    .map((lab) => `CRITICAL: ${lab.testName} = ${String(lab.value)} ${lab.unit} (${lab.date})`);
}

/** Extract findings from unresolved contradictions with diagnostic impact. */
function contradictionFindings(contradictions: Contradiction[]): string[] {
  const findings: string[] = [];
  for (const c of contradictions) {
    if (c.resolutionStatus !== 'resolved' && c.diagnosticImpact) {
      findings.push(`CONTRADICTION: ${c.finding1} vs ${c.finding2} — ${c.diagnosticImpact}`);
    }
  }
  return findings;
}

/** Extract findings for exhausted drug classes. */
function exhaustedDrugClassFindings(treatments: TreatmentTrial[]): string[] {
  const classCounts = new Map<string, number>();
  const classFailures = new Map<string, number>();
  for (const t of treatments) {
    if (t.drugClass) {
      classCounts.set(t.drugClass, (classCounts.get(t.drugClass) ?? 0) + 1);
      if (t.efficacy === 'none') {
        classFailures.set(t.drugClass, (classFailures.get(t.drugClass) ?? 0) + 1);
      }
    }
  }
  const findings: string[] = [];
  for (const [drugClass, total] of classCounts) {
    const failures = classFailures.get(drugClass) ?? 0;
    if (total >= 3 && failures >= total - 1) {
      findings.push(`${drugClass} pathway EXHAUSTED: ${failures}/${total} agents failed`);
    }
  }
  return findings;
}

/**
 * Extract critical findings from clinical data.
 */
function extractCriticalFindings(
  labs: LabResult[],
  contradictions: Contradiction[],
  treatments: TreatmentTrial[],
): string[] {
  return [
    ...criticalLabFindings(labs),
    ...contradictionFindings(contradictions),
    ...exhaustedDrugClassFindings(treatments),
  ];
}

/**
 * Build lab trends for specified test names.
 */
async function buildLabTrends(
  store: ClinicalStore,
  patientId: string,
  testNames: string[],
  allLabs: LabResult[],
): Promise<PatientContextTierB['labTrends']> {
  const trends: PatientContextTierB['labTrends'] = [];

  for (const testName of testNames) {
    const trend = await store.getLabTrends({ patientId, testName });
    const labsForTest = allLabs.filter((l) => l.testName === testName);
    const latest = labsForTest[labsForTest.length - 1];

    if (latest) {
      trends.push({
        testName,
        direction: trend?.direction ?? 'unknown',
        rateOfChange: trend?.rateOfChange,
        clinicalNote: trend?.clinicalNote,
        latestValue: String(latest.value),
        latestDate: latest.date,
        dataPoints: labsForTest.length,
      });
    }
  }

  return trends;
}

interface TrajectoryPoint {
  probabilityLow: number;
  probabilityHigh: number;
}

/** Compute trajectory direction from first and latest confidence points. */
function computeTrajectory(
  first: TrajectoryPoint | undefined,
  latest: TrajectoryPoint | undefined,
): string {
  if (!(first && latest)) return 'stable';
  const firstMid = (first.probabilityLow + first.probabilityHigh) / 2;
  const latestMid = (latest.probabilityLow + latest.probabilityHigh) / 2;
  if (latestMid > firstMid + 10) return 'rising';
  if (latestMid < firstMid - 10) return 'declining';
  return 'stable';
}

/**
 * Build hypothesis timelines for Tier B.
 */
async function buildHypothesisTimelines(
  store: ClinicalStore,
  patientId: string,
  hypotheses: ResearchHypothesis[],
): Promise<PatientContextTierB['hypothesisTimelines']> {
  const timelines: PatientContextTierB['hypothesisTimelines'] = [];

  // Get unique hypothesis names
  const names = [...new Set(hypotheses.map((h) => h.name))];

  for (const name of names) {
    const timeline = await store.getHypothesisTimeline({ patientId, name });

    if (timeline.versions.length > 0) {
      const latest = timeline.confidenceTrajectory[timeline.confidenceTrajectory.length - 1];
      const first = timeline.confidenceTrajectory[0];

      timelines.push({
        name,
        versionCount: timeline.versions.length,
        currentConfidence: latest
          ? `${latest.probabilityLow}-${latest.probabilityHigh}%`
          : 'unknown',
        directionChanges: timeline.directionChanges,
        trajectory: computeTrajectory(first, latest),
      });
    }
  }

  return timelines;
}

/** Deduplicate consultations by specialty + date. */
function deduplicateConsultations(consultations: Consultation[]): Consultation[] {
  const seen = new Set<string>();
  return consultations.filter((c) => {
    const key = `${c.specialty}|${c.date}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findStructuralGaps(
  treatments: TreatmentTrial[],
  consultations: Consultation[],
  hypotheses: ResearchHypothesis[],
  summary: ResearchSummary,
): string[] {
  const gaps: string[] = [];
  if (summary.findingCount === 0) {
    gaps.push('No research findings recorded — initial research needed');
  }
  if (hypotheses.length > 0 && summary.evidenceLinkCount === 0) {
    gaps.push('Hypotheses exist but no evidence links — need evidence-hypothesis mapping');
  }
  if (treatments.length > 5 && hypotheses.length < 2) {
    gaps.push('Many treatments tried but few hypotheses — need systematic differential diagnosis');
  }
  if (summary.latestFindingDate) {
    const daysSinceResearch = Math.floor(
      (Date.now() - new Date(summary.latestFindingDate).getTime()) / 86_400_000,
    );
    if (daysSinceResearch > 60) {
      gaps.push(`Research stale — last finding ${daysSinceResearch} days ago`);
    }
  }
  if (consultations.length === 0) {
    gaps.push('No specialist consultations recorded');
  }
  return gaps;
}

function findHypothesisGaps(hypotheses: ResearchHypothesis[]): string[] {
  const gaps: string[] = [];
  const active = hypotheses.filter((h) => !h.supersededBy);
  for (const h of active) {
    if (h.certaintyLevel === 'SPECULATIVE') {
      gaps.push(`${h.name}: certainty SPECULATIVE — needs more evidence to confirm or reject`);
    }
    const mid = ((h.probabilityLow ?? 0) + (h.probabilityHigh ?? 0)) / 2;
    if (mid > 0 && mid < 20) {
      gaps.push(
        `${h.name}: probability ${h.probabilityLow ?? 0}-${h.probabilityHigh ?? 0}% — needs targeted evidence to resolve`,
      );
    }
  }
  return gaps;
}

/**
 * Identify areas where research is lacking.
 * Goes beyond simple presence/absence checks to detect hypothesis-specific gaps.
 */
function identifyResearchGaps(
  labs: LabResult[],
  treatments: TreatmentTrial[],
  consultations: Consultation[],
  hypotheses: ResearchHypothesis[],
  summary: ResearchSummary,
): string[] {
  const gaps = findStructuralGaps(treatments, consultations, hypotheses, summary);

  // Abnormal labs without corresponding research
  const abnormalLabNames = new Set(
    labs.filter((l) => l.flag && l.flag !== 'normal').map((l) => l.testName),
  );
  if (abnormalLabNames.size > 3 && summary.findingCount < abnormalLabNames.size) {
    gaps.push(
      `${abnormalLabNames.size} abnormal lab markers but only ${summary.findingCount} research findings — need targeted investigation`,
    );
  }

  gaps.push(...findHypothesisGaps(hypotheses));

  return gaps;
}
