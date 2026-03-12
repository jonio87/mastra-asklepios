import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { ImagingFinding } from '../schemas/imaging-finding.js';
import { getClinicalStore } from '../storage/clinical-store.js';
import { getProvenanceStore } from '../storage/provenance-store.js';
import { logger } from '../utils/logger.js';

interface RawFinding {
  anatomicalLocation: string;
  findingType: string;
  description: string;
  laterality?: string | undefined;
  measurement?: number | undefined;
  measurementUnit?: string | undefined;
  severity?: string | undefined;
  nerveInvolvement?: string | undefined;
  comparisonToPrior?: string | undefined;
}

interface ParentMeta {
  date: string;
  evidenceTier: ImagingFinding['evidenceTier'];
  sourceCredibility: number;
  physician?: string;
}

type Store = ReturnType<typeof getClinicalStore>;
type ProvStore = ReturnType<typeof getProvenanceStore>;

function buildFinding(
  findingId: string,
  patientId: string,
  imagingReportId: string,
  f: RawFinding,
  meta: ParentMeta,
): ImagingFinding {
  const finding: ImagingFinding = {
    id: findingId,
    patientId,
    imagingReportId,
    anatomicalLocation: f.anatomicalLocation,
    findingType: f.findingType as ImagingFinding['findingType'],
    description: f.description,
    date: meta.date,
    evidenceTier: meta.evidenceTier,
    validationStatus: 'unvalidated',
    sourceCredibility: meta.sourceCredibility,
  };
  if (f.laterality) finding.laterality = f.laterality as ImagingFinding['laterality'];
  if (f.measurement !== undefined) finding.measurement = f.measurement;
  if (f.measurementUnit) finding.measurementUnit = f.measurementUnit;
  if (f.severity) finding.severity = f.severity as ImagingFinding['severity'];
  if (f.nerveInvolvement) finding.nerveInvolvement = f.nerveInvolvement;
  if (f.comparisonToPrior) finding.comparisonToPrior = f.comparisonToPrior;
  if (meta.physician) finding.radiologist = meta.physician;
  return finding;
}

function parentMeta(parentReport: Record<string, unknown> | undefined): ParentMeta {
  const meta: ParentMeta = {
    date: (parentReport?.['date'] as string | undefined) ?? 'unknown',
    evidenceTier: ((parentReport?.['evidenceTier'] as string | undefined) ??
      'T1-official') as ImagingFinding['evidenceTier'],
    sourceCredibility: (parentReport?.['sourceCredibility'] as number | undefined) ?? 90,
  };
  const physician = parentReport?.['physician'] as string | undefined;
  if (physician) meta.physician = physician;
  return meta;
}

async function recordExtractionActivity(
  provStore: ProvStore,
  activityId: string,
  reportId: string,
  findingCount: number,
  now: string,
) {
  await provStore.recordActivity({
    id: activityId,
    type: 'extract',
    startedAt: now,
    endedAt: now,
    metadata: JSON.stringify({ reportId, findingCount }),
    createdAt: now,
  });
}

async function recordFindingProvenance(
  provStore: ProvStore,
  findingId: string,
  patientId: string,
  reportId: string,
  activityId: string,
  f: RawFinding,
  now: string,
) {
  await provStore.recordEntity({
    id: findingId,
    type: 'imaging-finding',
    layer: 2,
    patientId,
    metadata: JSON.stringify({
      anatomicalLocation: f.anatomicalLocation,
      findingType: f.findingType,
    }),
    createdAt: now,
  });
  await provStore.recordRelation({
    id: `rel-${findingId}-derived`,
    type: 'wasDerivedFrom',
    subjectId: findingId,
    objectId: reportId,
    activityId,
    createdAt: now,
  });
}

async function processFindings(
  store: Store,
  provStore: ProvStore,
  input: { imagingReportId: string; patientId: string; findings: RawFinding[] },
  parentReport: Record<string, unknown> | undefined,
  activityId: string,
  now: string,
): Promise<string[]> {
  const findingIds: string[] = [];
  const meta = parentMeta(parentReport);
  for (let i = 0; i < input.findings.length; i++) {
    const f = input.findings[i];
    if (!f) continue;
    const findingId = `imgf-${input.imagingReportId}-${i}`;
    findingIds.push(findingId);
    const finding = buildFinding(findingId, input.patientId, input.imagingReportId, f, meta);
    await store.addImagingFinding(finding);
    await recordFindingProvenance(
      provStore,
      findingId,
      input.patientId,
      input.imagingReportId,
      activityId,
      f,
      now,
    );
  }
  return findingIds;
}

async function emitExtractionSignal(
  provStore: ProvStore,
  input: { imagingReportId: string; patientId: string },
  findingIds: string[],
  now: string,
): Promise<string | undefined> {
  if (findingIds.length === 0) return undefined;
  const id = `signal-extract-${input.imagingReportId}-${Date.now()}`;
  await provStore.emitChangeSignal({
    id,
    sourceEntityId: input.imagingReportId,
    affectedLayers: [3, 4, 5],
    affectedEntityIds: findingIds,
    changeType: 'new',
    summary: `${findingIds.length} structured findings extracted from imaging report ${input.imagingReportId}`,
    priority: 'medium',
    status: 'pending',
    patientId: input.patientId,
    createdAt: now,
  });
  return id;
}

/**
 * Extract structured imaging findings from a text-blob imaging report.
 *
 * Takes an imaging report ID from clinical_imaging_reports, parses the
 * free-text findings field, and decomposes it into structured
 * clinical_imaging_findings rows. Records W3C PROV provenance and emits
 * change signals so higher layers know new structured data is available.
 *
 * This is the LLM extraction step that automates what was done manually
 * with the 2022 Skanmex MRI reports.
 */
export const extractFindingsTool = createTool({
  id: 'extract-findings',
  description:
    'Extract structured findings from an imaging report text blob. Parses the free-text findings into structured per-finding rows with anatomical location, finding type, laterality, measurement, and comparison to prior. Records provenance and emits change signals for reactive propagation.',
  inputSchema: z.object({
    imagingReportId: z.string().describe('ID of the imaging report in clinical_imaging_reports'),
    patientId: z.string().describe('Patient resource ID'),
    findings: z
      .array(
        z.object({
          anatomicalLocation: z
            .string()
            .describe('Standardized location (e.g., "C6/C7", "Th6/Th7", "left maxillary sinus")'),
          findingType: z
            .string()
            .describe(
              'Type: herniation, protrusion, extrusion, atrophy, cyst, compression, stenosis, anomaly, other',
            ),
          description: z.string().describe('Detailed finding description'),
          laterality: z.string().optional().describe('midline, left, right, bilateral'),
          measurement: z.number().optional().describe('Numeric measurement value'),
          measurementUnit: z.string().optional().describe('mm, cm, degrees'),
          severity: z.string().optional().describe('Severity description'),
          nerveInvolvement: z.string().optional().describe('Affected nerves'),
          comparisonToPrior: z
            .string()
            .optional()
            .describe('stable, improved, worsened, new, not-compared'),
        }),
      )
      .describe('Array of structured findings extracted from the report'),
  }),
  outputSchema: z.object({
    findingsInserted: z.number(),
    findingIds: z.array(z.string()),
    changeSignalId: z.string().optional(),
  }),
  execute: async (input) => {
    const store = getClinicalStore();
    const provStore = getProvenanceStore();
    const now = new Date().toISOString();

    const reports = await store.getImagingReports(input.patientId);
    const parentReport = reports.find((r) => r.id === input.imagingReportId);

    const activityId = `extract-findings-${input.imagingReportId}-${Date.now()}`;
    await recordExtractionActivity(
      provStore,
      activityId,
      input.imagingReportId,
      input.findings.length,
      now,
    );

    const findingIds = await processFindings(
      store,
      provStore,
      input,
      parentReport,
      activityId,
      now,
    );

    const changeSignalId = await emitExtractionSignal(provStore, input, findingIds, now);

    logger.info('Findings extracted', {
      reportId: input.imagingReportId,
      count: findingIds.length,
    });

    const result: { findingsInserted: number; findingIds: string[]; changeSignalId?: string } = {
      findingsInserted: findingIds.length,
      findingIds,
    };
    if (changeSignalId) result.changeSignalId = changeSignalId;
    return result;
  },
});
