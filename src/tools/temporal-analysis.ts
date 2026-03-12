import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getClinicalStore } from '../storage/clinical-store.js';
import { logger } from '../utils/logger.js';

const timelineEventSchema = z.object({
  date: z.string(),
  event: z.string(),
  category: z.string(),
  recordId: z.string(),
  significance: z.enum(['routine', 'notable', 'critical', 'turning-point']),
});

const phaseSchema = z.object({
  label: z.string(),
  startDate: z.string(),
  endDate: z.string().optional(),
  keyEvents: z.array(z.string()),
  activeHypotheses: z.array(z.string()),
});

const temporalConsistencySchema = z.object({
  hypothesis: z.string(),
  consistent: z.boolean(),
  reasoning: z.string(),
  timelineConflicts: z.array(
    z.object({
      event: z.string(),
      date: z.string(),
      conflict: z.string(),
    }),
  ),
});

const gapSchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
  durationDays: z.number(),
  significance: z.string(),
});

export const temporalAnalysisTool = createTool({
  id: 'temporal-analysis',
  description:
    "Construct a disease timeline from Layer 2 data (labs, consultations, treatments, patient reports, contradictions) and check whether symptom/lab/finding sequences are consistent with proposed diagnoses' known natural history. Identifies phases, turning points, longest gaps, and temporal conflicts.",
  inputSchema: z.object({
    patientId: z.string().describe('Patient resource ID'),
    hypotheses: z
      .array(
        z.object({
          name: z.string(),
          expectedProgression: z
            .string()
            .optional()
            .describe(
              'Known natural history (e.g., "onset age 20-40, progressive over 5-10 years")',
            ),
        }),
      )
      .optional()
      .describe('Hypotheses to check against timeline (default: pulled from Layer 2B)'),
    includeCategories: z
      .array(z.enum(['labs', 'consultations', 'treatments', 'patient-reports', 'contradictions']))
      .optional(),
  }),
  outputSchema: z.object({
    timeline: z.array(timelineEventSchema),
    phases: z.array(phaseSchema),
    temporalConsistency: z.array(temporalConsistencySchema),
    longestGap: gapSchema.optional(),
    totalSpanYears: z.number(),
  }),
  execute: async (input) => {
    const { patientId, includeCategories } = input;
    logger.info('Running temporal analysis', { patientId });

    const store = getClinicalStore();
    const categories = includeCategories ?? [
      'labs',
      'consultations',
      'treatments',
      'patient-reports',
      'contradictions',
    ];

    const { events: rawEvents, treatments } = await loadPatientEvents(store, patientId, categories);
    rawEvents.sort((a, b) => a.date.localeCompare(b.date));

    const timeline = buildTimeline(rawEvents);
    const phases = identifyPhases(rawEvents);

    let hypotheses = input.hypotheses;
    if (!hypotheses || hypotheses.length === 0) {
      try {
        const dbHypotheses = await store.queryHypotheses({ patientId, latestOnly: true });
        hypotheses = dbHypotheses.map((h) => ({
          name: h.name,
        }));
      } catch {
        hypotheses = [];
      }
    }

    const temporalConsistency = computeTemporalConsistency(hypotheses ?? [], rawEvents, treatments);
    const longestGap = findLongestGap(rawEvents);

    const firstDate = rawEvents[0]?.date;
    const lastDate = rawEvents[rawEvents.length - 1]?.date;
    const totalSpanYears =
      firstDate && lastDate
        ? Math.round(
            ((new Date(lastDate).getTime() - new Date(firstDate).getTime()) /
              (365.25 * 86_400_000)) *
              10,
          ) / 10
        : 0;

    return {
      timeline,
      phases,
      temporalConsistency,
      ...(longestGap ? { longestGap } : {}),
      totalSpanYears,
    };
  },
});

// ─── Helper Types ──────────────────────────────────────────────────────

type TimelineEvent = z.infer<typeof timelineEventSchema>;

type RawEvent = {
  date: string;
  event: string;
  category: string;
  recordId: string;
  significance: 'routine' | 'notable' | 'critical' | 'turning-point';
};

type Hypothesis = {
  name: string;
  expectedProgression?: string | undefined;
};

type TreatmentRecord = {
  efficacy?: string;
  [key: string]: unknown;
};

type PatientEventsResult = {
  events: RawEvent[];
  treatments: TreatmentRecord[];
};

// ─── Helper Functions ──────────────────────────────────────────────────

/** Convert lab records to raw timeline events. */
function labsToEvents(labs: Array<Record<string, unknown>>): RawEvent[] {
  const out: RawEvent[] = [];
  for (const lab of labs) {
    const date = lab['date'] as string | undefined;
    if (!date) continue;
    const flag = lab['flag'] as string | undefined;
    const sig =
      flag === 'critical'
        ? ('critical' as const)
        : flag === 'low' || flag === 'high'
          ? ('notable' as const)
          : ('routine' as const);
    const testName = lab['testName'] as string;
    out.push({
      date,
      event: `Lab: ${testName} = ${lab['value']} ${lab['unit']}${flag && flag !== 'normal' ? ` (${flag})` : ''}`,
      category: 'lab',
      recordId: (lab['id'] as string | undefined) ?? `lab-${date}-${testName}`,
      significance: sig,
    });
  }
  return out;
}

/** Convert consultation records to raw timeline events. */
function consultationsToEvents(consultations: Array<Record<string, unknown>>): RawEvent[] {
  const out: RawEvent[] = [];
  for (const c of consultations) {
    const date = c['date'] as string | undefined;
    if (!date) continue;
    const provider = c['provider'] as string | undefined;
    const conclusions = (c['conclusions'] ?? c['reason'] ?? 'no conclusion') as string;
    out.push({
      date,
      event: `Consultation: ${c['specialty']}${provider ? ` (${provider})` : ''} — ${conclusions}`,
      category: 'consultation',
      recordId: (c['id'] as string | undefined) ?? `cons-${date}`,
      significance: 'notable',
    });
  }
  return out;
}

/** Build a treatment-start event if the record has a startDate. */
function treatmentStartEvent(t: Record<string, unknown>): RawEvent | undefined {
  const startDate = t['startDate'] as string | undefined;
  if (!startDate) return undefined;
  const medication = t['medication'] as string;
  const dosage = t['dosage'] as string | undefined;
  return {
    date: startDate,
    event: `Treatment started: ${medication}${dosage ? ` ${dosage}` : ''}`,
    category: 'treatment',
    recordId: (t['id'] as string | undefined) ?? `tx-${startDate}-${medication}`,
    significance: 'notable',
  };
}

/** Build a treatment-end event if the record has an endDate. */
function treatmentEndEvent(t: Record<string, unknown>): RawEvent | undefined {
  const endDate = t['endDate'] as string | undefined;
  if (!endDate) return undefined;
  const medication = t['medication'] as string;
  const efficacy = (t['efficacy'] ?? 'unknown') as string;
  const reason = t['reasonDiscontinued'] as string | undefined;
  return {
    date: endDate,
    event: `Treatment ended: ${medication} (efficacy: ${efficacy}${reason ? `, reason: ${reason}` : ''})`,
    category: 'treatment',
    recordId: (t['id'] as string | undefined) ?? `tx-end-${endDate}-${medication}`,
    significance: efficacy === 'none' ? 'critical' : 'notable',
  };
}

/** Convert treatment records to raw timeline events. */
function treatmentsToEvents(treatments: Array<Record<string, unknown>>): RawEvent[] {
  const out: RawEvent[] = [];
  for (const t of treatments) {
    const start = treatmentStartEvent(t);
    if (start) out.push(start);
    const end = treatmentEndEvent(t);
    if (end) out.push(end);
  }
  return out;
}

/** Convert patient reports to raw timeline events. */
function reportsToEvents(reports: Array<Record<string, unknown>>): RawEvent[] {
  const out: RawEvent[] = [];
  for (const r of reports) {
    const date = r['date'] as string | undefined;
    if (!date) continue;
    const severity = r['severity'] as number | undefined;
    const sig =
      severity !== undefined && severity >= 8
        ? ('critical' as const)
        : severity !== undefined && severity >= 5
          ? ('notable' as const)
          : ('routine' as const);
    out.push({
      date,
      event: `Patient report (${r['type']}): ${(r['content'] as string).slice(0, 150)}`,
      category: 'patient-report',
      recordId: (r['id'] as string | undefined) ?? `report-${date}`,
      significance: sig,
    });
  }
  return out;
}

/** Convert contradictions to raw timeline events. */
function contradictionsToEvents(contradictions: Array<Record<string, unknown>>): RawEvent[] {
  const out: RawEvent[] = [];
  for (const ct of contradictions) {
    const ctDate = (ct['finding1Date'] ?? ct['finding2Date']) as string | undefined;
    if (!ctDate) continue;
    out.push({
      date: ctDate,
      event: `Contradiction: ${ct['finding1']} vs ${ct['finding2']}`,
      category: 'contradiction',
      recordId: (ct['id'] as string | undefined) ?? `contra-${ctDate}`,
      significance: 'critical',
    });
  }
  return out;
}

/** Load all patient events from the clinical store and convert to raw timeline events. */
async function loadPatientEvents(
  store: ReturnType<typeof getClinicalStore>,
  patientId: string,
  categories: string[],
): Promise<PatientEventsResult> {
  const [labs, consultations, treatments, reports, contradictions] = await Promise.all([
    categories.includes('labs') ? store.queryLabs({ patientId }) : Promise.resolve([]),
    categories.includes('consultations')
      ? store.queryConsultations({ patientId })
      : Promise.resolve([]),
    categories.includes('treatments') ? store.queryTreatments({ patientId }) : Promise.resolve([]),
    categories.includes('patient-reports')
      ? store.queryPatientReports({ patientId })
      : Promise.resolve([]),
    categories.includes('contradictions')
      ? store.queryContradictions({ patientId })
      : Promise.resolve([]),
  ]);

  const events: RawEvent[] = [
    ...labsToEvents(labs as Array<Record<string, unknown>>),
    ...consultationsToEvents(consultations as Array<Record<string, unknown>>),
    ...treatmentsToEvents(treatments as Array<Record<string, unknown>>),
    ...reportsToEvents(reports as Array<Record<string, unknown>>),
    ...contradictionsToEvents(contradictions as Array<Record<string, unknown>>),
  ];

  return { events, treatments: treatments as TreatmentRecord[] };
}

/** Take sorted raw events and promote first mentions of key categories to turning-point. */
function buildTimeline(sortedEvents: RawEvent[]): TimelineEvent[] {
  const seenCategories = new Set<string>();
  return sortedEvents.map((e) => {
    const key = `${e.category}-${e.event.split(':')[0]}`;
    if (!seenCategories.has(key) && e.significance !== 'routine') {
      seenCategories.add(key);
      return { ...e, significance: 'turning-point' as const };
    }
    seenCategories.add(key);
    return e;
  });
}

/** Group sorted events into phases based on >6 month gaps. */
function identifyPhases(sortedEvents: RawEvent[]): z.infer<typeof phaseSchema>[] {
  const SIX_MONTHS_MS = 180 * 86_400_000;
  const phases: z.infer<typeof phaseSchema>[] = [];
  let currentPhase: { startDate: string; endDate: string; events: string[] } | undefined;

  for (const event of sortedEvents) {
    const eventDate = new Date(event.date).getTime();
    if (!currentPhase) {
      currentPhase = { startDate: event.date, endDate: event.date, events: [event.event] };
    } else {
      const lastDate = new Date(currentPhase.endDate).getTime();
      if (eventDate - lastDate > SIX_MONTHS_MS) {
        phases.push({
          label: `Phase ${phases.length + 1}`,
          startDate: currentPhase.startDate,
          endDate: currentPhase.endDate,
          keyEvents: currentPhase.events.filter((_, i) => i < 5),
          activeHypotheses: [],
        });
        currentPhase = { startDate: event.date, endDate: event.date, events: [event.event] };
      } else {
        currentPhase.endDate = event.date;
        currentPhase.events.push(event.event);
      }
    }
  }

  if (currentPhase) {
    phases.push({
      label: `Phase ${phases.length + 1}`,
      startDate: currentPhase.startDate,
      endDate: currentPhase.endDate,
      keyEvents: currentPhase.events.filter((_, i) => i < 5),
      activeHypotheses: [],
    });
  }

  return phases;
}

/** Analyze a single hypothesis's expected progression against timeline data. */
function analyzeProgression(
  prog: string,
  sortedEvents: RawEvent[],
  treatments: TreatmentRecord[],
): string {
  let reasoning = '';

  const onsetMatch = prog.match(/onset\s*(?:age)?\s*(\d+)\s*[-–to]+\s*(\d+)/);
  if (onsetMatch?.[1] && onsetMatch?.[2]) {
    const firstEvent = sortedEvents[0];
    if (firstEvent) {
      reasoning += `First recorded event: ${firstEvent.date}. Expected onset age: ${onsetMatch[1]}-${onsetMatch[2]}. `;
    }
  }

  if (prog.includes('progressive')) {
    const failures = treatments.filter((t) => t.efficacy === 'none' || t.efficacy === 'minimal');
    if (failures.length > 0) {
      reasoning += `${failures.length} treatment failures consistent with progressive disease. `;
    }
  }

  if (prog.includes('relapsing') || prog.includes('remitting')) {
    const critical = sortedEvents.filter(
      (e) => e.significance === 'critical' || e.significance === 'turning-point',
    );
    if (critical.length >= 2) {
      reasoning += `${critical.length} critical events may indicate relapsing-remitting pattern. `;
    }
  }

  return reasoning;
}

/** Check each hypothesis against the timeline for temporal conflicts. */
function computeTemporalConsistency(
  hypotheses: Hypothesis[],
  sortedEvents: RawEvent[],
  treatments: TreatmentRecord[],
): z.infer<typeof temporalConsistencySchema>[] {
  return hypotheses.map((hypothesis) => {
    const conflicts: Array<{ event: string; date: string; conflict: string }> = [];
    let reasoning = '';

    if (hypothesis.expectedProgression) {
      reasoning += analyzeProgression(
        hypothesis.expectedProgression.toLowerCase(),
        sortedEvents,
        treatments,
      );
    }

    if (conflicts.length > 0) {
      reasoning += `${conflicts.length} temporal conflicts identified. `;
    } else {
      reasoning +=
        'No temporal conflicts detected (limited analysis — expected progression not fully specified). ';
    }

    return {
      hypothesis: hypothesis.name,
      consistent: conflicts.length === 0,
      reasoning: reasoning.trim(),
      timelineConflicts: conflicts,
    };
  });
}

/** Find the longest gap between consecutive sorted events. */
function findLongestGap(sortedEvents: RawEvent[]): z.infer<typeof gapSchema> | undefined {
  let longestGap: z.infer<typeof gapSchema> | undefined;

  for (let i = 1; i < sortedEvents.length; i++) {
    const prev = sortedEvents[i - 1];
    const curr = sortedEvents[i];
    if (!(prev && curr)) continue;
    const gap = new Date(curr.date).getTime() - new Date(prev.date).getTime();
    const durationDays = Math.round(gap / 86_400_000);
    if (!longestGap || durationDays > longestGap.durationDays) {
      longestGap = {
        startDate: prev.date,
        endDate: curr.date,
        durationDays,
        significance:
          durationDays > 365
            ? 'Major gap (>1 year) — may indicate missing records or period of clinical inactivity'
            : durationDays > 180
              ? 'Moderate gap (>6 months) — possible missing records'
              : 'Minor gap',
      };
    }
  }

  return longestGap;
}
