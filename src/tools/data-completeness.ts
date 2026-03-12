import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getClinicalStore } from '../storage/clinical-store.js';
import { getProvenanceStore } from '../storage/provenance-store.js';

/**
 * Data Completeness Dashboard — queries across all layers to show
 * what data exists, what's missing, and what needs attention.
 *
 * Returns structured JSON that agents can reason about instead of
 * relying on manual auditing scripts. Replaces the 11 manual data
 * quality scripts with a single queryable tool.
 */
export const dataCompletenessTool = createTool({
  id: 'data-completeness',
  description:
    'Check data completeness across all layers. Returns counts of source documents, structured records, extracted findings, pending change signals, and gaps. Use to understand what data is available, what extraction is incomplete, and what needs regeneration.',
  inputSchema: z.object({
    patientId: z.string().describe('Patient resource ID'),
  }),
  outputSchema: z.object({
    layer0: z.object({
      sourceDocuments: z.number(),
      byCategory: z.record(z.string(), z.number()),
    }),
    layer2: z.object({
      labResults: z.number(),
      consultations: z.number(),
      imagingReports: z.number(),
      imagingFindings: z.number(),
      imagingReportsWithoutFindings: z.number(),
      diagnoses: z.number(),
      progressions: z.number(),
      treatmentTrials: z.number(),
      procedureReports: z.number(),
    }),
    layer5: z.object({
      reportVersions: z.number(),
      pendingChangeSignals: z.number(),
      highPrioritySignals: z.number(),
    }),
    provenance: z.object({
      totalEntities: z.number(),
      entitiesByLayer: z.record(z.string(), z.number()),
      signalSummary: z.object({
        pending: z.number(),
        propagated: z.number(),
        acknowledged: z.number(),
        dismissed: z.number(),
      }),
    }),
    gaps: z.array(
      z.object({
        area: z.string(),
        description: z.string(),
        severity: z.string(),
      }),
    ),
  }),
  execute: async (input) => {
    const store = getClinicalStore();
    const provStore = getProvenanceStore();
    const pid = input.patientId;

    // Layer 0: Source documents
    const sourceDocs = await store.querySourceDocuments({ patientId: pid });
    const byCategory: Record<string, number> = {};
    for (const doc of sourceDocs) {
      byCategory[doc.category] = (byCategory[doc.category] ?? 0) + 1;
    }

    // Layer 2: Structured records
    const labs = await store.queryLabs({ patientId: pid });
    const consults = await store.queryConsultations({ patientId: pid });
    const imaging = await store.getImagingReports(pid);
    const imgFindings = await store.queryImagingFindings({ patientId: pid });
    const diagnoses = await store.queryDiagnoses({ patientId: pid });
    const progressions = await store.queryProgressions({ patientId: pid });
    const treatments = await store.queryTreatments({ patientId: pid });
    const procedures = await store.getAbdominalReports(pid);

    // Identify imaging reports without structured findings
    const reportsWithFindings = new Set(imgFindings.map((f) => f.imagingReportId));
    const reportsWithoutFindings = imaging.filter((r) => !reportsWithFindings.has(r.id));

    // Layer 5: Report versions
    const reportVersions = await store.queryReportVersions(pid);

    // Provenance: Entity counts and signal summary
    const entityCounts = await provStore.getEntityCountsByLayer(pid);
    const signalSummary = await provStore.getSignalSummary(pid);
    const pendingSignals = await provStore.getPendingSignals({ patientId: pid });
    const highPrioritySignals = pendingSignals.filter(
      (s) => s.priority === 'high' || s.priority === 'critical',
    );

    // Calculate total entities
    let totalEntities = 0;
    const entitiesByLayerStr: Record<string, number> = {};
    for (const [layer, count] of Object.entries(entityCounts)) {
      totalEntities += count;
      entitiesByLayerStr[`layer${layer}`] = count;
    }

    // Identify gaps
    const gaps: Array<{ area: string; description: string; severity: string }> = [];

    if (reportsWithoutFindings.length > 0) {
      gaps.push({
        area: 'Imaging Findings Extraction',
        description: `${reportsWithoutFindings.length} of ${imaging.length} imaging reports have no structured findings extracted`,
        severity: reportsWithoutFindings.length > imaging.length / 2 ? 'high' : 'medium',
      });
    }

    if (diagnoses.length === 0 && labs.length > 0) {
      gaps.push({
        area: 'Diagnosis Registry',
        description:
          'No diagnoses registered despite having clinical data. Populate diagnosis registry.',
        severity: 'high',
      });
    }

    if (pendingSignals.length > 0) {
      gaps.push({
        area: 'Pending Change Signals',
        description: `${pendingSignals.length} change signals pending — new data has not been integrated into reports`,
        severity: highPrioritySignals.length > 0 ? 'high' : 'medium',
      });
    }

    if (sourceDocs.length === 0) {
      gaps.push({
        area: 'Layer 0 Source Documents',
        description: 'No source documents tracked. Run import pipeline with Layer 0 enabled.',
        severity: 'high',
      });
    }

    if (progressions.length === 0 && imgFindings.length > 5) {
      gaps.push({
        area: 'Temporal Progression Tracking',
        description:
          'No progressions registered despite having multiple imaging findings. Track temporal changes.',
        severity: 'medium',
      });
    }

    return {
      layer0: {
        sourceDocuments: sourceDocs.length,
        byCategory,
      },
      layer2: {
        labResults: labs.length,
        consultations: consults.length,
        imagingReports: imaging.length,
        imagingFindings: imgFindings.length,
        imagingReportsWithoutFindings: reportsWithoutFindings.length,
        diagnoses: diagnoses.length,
        progressions: progressions.length,
        treatmentTrials: treatments.length,
        procedureReports: procedures.length,
      },
      layer5: {
        reportVersions: reportVersions.length,
        pendingChangeSignals: pendingSignals.length,
        highPrioritySignals: highPrioritySignals.length,
      },
      provenance: {
        totalEntities,
        entitiesByLayer: entitiesByLayerStr,
        signalSummary,
      },
      gaps,
    };
  },
});
