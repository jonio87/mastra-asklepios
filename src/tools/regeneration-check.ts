import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getClinicalStore } from '../storage/clinical-store.js';
import { getProvenanceStore } from '../storage/provenance-store.js';

interface ChangeSignal {
  id: string;
  sourceEntityId: string;
  changeType: string;
  priority: string;
  summary: string;
  affectedLayers: number[];
}

interface PendingIntegration {
  dataId: string;
  dataType: string;
  integrationStatus: string;
}

function determineRegenPriority(
  signals: ChangeSignal[],
  integrations: PendingIntegration[],
): string {
  if (signals.some((s) => s.priority === 'critical')) return 'critical';
  if (signals.some((s) => s.priority === 'high')) return 'high';
  if (signals.length > 0 || integrations.length > 0) return 'medium';
  return 'none';
}

function buildSummary(
  reports: Array<{ totalPendingChanges: number; regenerationPriority: string }>,
): string {
  if (reports.length === 0) {
    return 'No report versions found. Create an initial report version to enable regeneration tracking.';
  }
  const totalPending = reports.reduce((sum, r) => sum + r.totalPendingChanges, 0);
  if (totalPending === 0)
    return `All ${reports.length} reports are up to date. No pending changes.`;
  const parts: string[] = [`${totalPending} pending changes across ${reports.length} reports.`];
  const criticalCount = reports.filter((r) => r.regenerationPriority === 'critical').length;
  const highCount = reports.filter((r) => r.regenerationPriority === 'high').length;
  if (criticalCount > 0) parts.push(`${criticalCount} reports need critical attention.`);
  if (highCount > 0) parts.push(`${highCount} reports have high-priority updates.`);
  return parts.join(' ');
}

/**
 * Regeneration Check — determines whether a report needs updating.
 *
 * Cross-references pending change signals (new data at lower layers) with
 * report_data_integration records (what data has been integrated into which
 * report version) to produce a precise regeneration report showing:
 *   - Which report sections need updating
 *   - Why (which new data triggered the change)
 *   - Priority (clinical significance of changes)
 *
 * This is the core of the reactive architecture: the system knows EXACTLY
 * which sections need updating and why, instead of regenerating blindly.
 */
export const regenerationCheckTool = createTool({
  id: 'regeneration-check',
  description:
    'Check whether a diagnostic report needs regeneration due to new data. Returns pending changes, affected sections, and regeneration priority. Use after new data is ingested or when asked about report currency.',
  inputSchema: z.object({
    patientId: z.string().describe('Patient resource ID'),
    reportType: z
      .string()
      .optional()
      .describe('Filter by report type (e.g., "diagnostic-therapeutic-plan")'),
  }),
  outputSchema: z.object({
    reports: z.array(
      z.object({
        reportName: z.string(),
        currentVersion: z.string(),
        language: z.string(),
        pendingChanges: z.array(
          z.object({
            signalId: z.string(),
            source: z.string(),
            changeType: z.string(),
            priority: z.string(),
            description: z.string(),
            affectedLayers: z.array(z.number()),
          }),
        ),
        unintegratedData: z.array(
          z.object({
            dataId: z.string(),
            dataType: z.string(),
            status: z.string(),
          }),
        ),
        regenerationPriority: z.string(),
        totalPendingChanges: z.number(),
      }),
    ),
    summary: z.string(),
  }),
  execute: async (input) => {
    const store = getClinicalStore();
    const provStore = getProvenanceStore();
    const pid = input.patientId;

    // Get all report versions for this patient
    const allVersions = await store.queryReportVersions(pid);
    const filteredVersions = input.reportType
      ? allVersions.filter((v) => v.reportName === input.reportType)
      : allVersions;

    // Get pending change signals
    const pendingSignals = await provStore.getPendingSignals({ patientId: pid });

    // Get unintegrated data for each report version
    const reports: Array<{
      reportName: string;
      currentVersion: string;
      language: string;
      pendingChanges: Array<{
        signalId: string;
        source: string;
        changeType: string;
        priority: string;
        description: string;
        affectedLayers: number[];
      }>;
      unintegratedData: Array<{
        dataId: string;
        dataType: string;
        status: string;
      }>;
      regenerationPriority: string;
      totalPendingChanges: number;
    }> = [];

    for (const version of filteredVersions) {
      // Get pending data integration records for this report version
      const pendingIntegrations = await store.getPendingIntegrations({
        patientId: pid,
        reportVersionId: version.id,
      });

      const relevantSignals = pendingSignals.filter((s) => s.affectedLayers.includes(5));
      const regenerationPriority = determineRegenPriority(relevantSignals, pendingIntegrations);

      reports.push({
        reportName: version.reportName,
        currentVersion: version.version,
        language: version.language,
        pendingChanges: relevantSignals.map((s) => ({
          signalId: s.id,
          source: s.sourceEntityId,
          changeType: s.changeType,
          priority: s.priority,
          description: s.summary,
          affectedLayers: s.affectedLayers,
        })),
        unintegratedData: pendingIntegrations.map((i) => ({
          dataId: i.dataId,
          dataType: i.dataType,
          status: i.integrationStatus,
        })),
        regenerationPriority,
        totalPendingChanges: relevantSignals.length + pendingIntegrations.length,
      });
    }

    const summary = buildSummary(reports);

    return { reports, summary };
  },
});
