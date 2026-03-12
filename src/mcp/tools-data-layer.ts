import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { mastra } from '../mastra.js';
import { CascadeOrchestrator } from '../storage/cascade.js';
import { getClinicalStore } from '../storage/clinical-store.js';
import { getProvenanceStore } from '../storage/provenance-store.js';
import {
  dataCompletenessTool,
  extractFindingsTool,
  regenerationCheckTool,
} from '../tools/index.js';
import { mcpLog } from './notifications.js';

/**
 * Data Layer management tools — expose the full Layer 0-5 lifecycle to external agents.
 *
 * These tools enable Claude Code / Cursor / Claude Desktop to orchestrate
 * complete reimport + layer-by-layer processing workflows:
 *
 *   1. check_data_completeness → see what exists, what's missing
 *   2. extract_imaging_findings → decompose text blobs into structured findings
 *   3. process_cascade → propagate all changes to downstream layers
 *   4. check_regeneration → see which reports need updating
 *   5. query_provenance → trace data lineage and audit trail
 */
export function registerDataLayerTools(server: McpServer): void {
  // ─── extract_imaging_findings ──────────────────────────────────────
  server.registerTool(
    'extract_imaging_findings',
    {
      description:
        'Extract structured findings from an imaging report text blob. Parses free-text findings into structured per-finding rows with anatomical location, finding type, laterality, measurement, and comparison to prior. Records W3C PROV provenance and emits change signals for reactive cascade.',
      inputSchema: {
        patientId: z.string().describe('Patient resource ID'),
        imagingReportId: z
          .string()
          .describe('ID of the imaging report in clinical_imaging_reports'),
        findings: z
          .array(
            z.object({
              anatomicalLocation: z
                .string()
                .describe(
                  'Standardized location (e.g., "C6/C7", "Th6/Th7", "left maxillary sinus")',
                ),
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
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) => {
      if (!extractFindingsTool.execute) {
        return {
          content: [{ type: 'text' as const, text: 'Extract findings tool not available' }],
          isError: true,
        };
      }

      const result = await extractFindingsTool.execute(input, { mastra });

      mcpLog(
        server,
        'info',
        {
          tool: 'extract_imaging_findings',
          patientId: input.patientId,
          reportId: input.imagingReportId,
          findingsCount: (input.findings as unknown[]).length,
        },
        'data-layer',
      );

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // ─── check_data_completeness ───────────────────────────────────────
  server.registerTool(
    'check_data_completeness',
    {
      description:
        'Check data completeness across all layers (L0 source docs, L2 structured records, L5 report versions, provenance). Returns counts, gap analysis, and pending change signals. Use to understand what data exists, what extraction is incomplete, and what needs attention.',
      inputSchema: {
        patientId: z.string().describe('Patient resource ID'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (input) => {
      if (!dataCompletenessTool.execute) {
        return {
          content: [{ type: 'text' as const, text: 'Data completeness tool not available' }],
          isError: true,
        };
      }

      const result = await dataCompletenessTool.execute(input, { mastra });

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // ─── check_regeneration ────────────────────────────────────────────
  server.registerTool(
    'check_regeneration',
    {
      description:
        'Check whether diagnostic reports need regeneration due to new data at lower layers. Returns pending changes, affected sections, and regeneration priority (critical/high/medium/none). Use after new data is ingested or when asked about report currency.',
      inputSchema: {
        patientId: z.string().describe('Patient resource ID'),
        reportType: z
          .string()
          .optional()
          .describe('Filter by report type (e.g., "diagnostic-therapeutic-plan")'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (input) => {
      if (!regenerationCheckTool.execute) {
        return {
          content: [{ type: 'text' as const, text: 'Regeneration check tool not available' }],
          isError: true,
        };
      }

      const result = await regenerationCheckTool.execute(input, { mastra });

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // ─── process_cascade ───────────────────────────────────────────────
  server.registerTool(
    'process_cascade',
    {
      description:
        'Process pending change signals through the cascade orchestrator. Determines which downstream layers are affected and what actions are needed (extract-findings → update-diagnoses → flag-report-regeneration). Use dryRun=true (default) to preview; dryRun=false to execute and acknowledge signals.',
      inputSchema: {
        patientId: z.string().describe('Patient resource ID'),
        dryRun: z
          .boolean()
          .optional()
          .describe(
            'If true (default), analyze but do not modify state. Set false to execute cascade and acknowledge signals.',
          ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) => {
      const store = getClinicalStore();
      const provStore = getProvenanceStore();
      const orchestrator = new CascadeOrchestrator(provStore, store);

      const patientId = input.patientId as string;
      const dryRun = (input.dryRun as boolean | undefined) ?? true;

      const result = await orchestrator.processPendingSignals(patientId, dryRun);

      if (!dryRun) {
        mcpLog(
          server,
          'info',
          {
            tool: 'process_cascade',
            patientId,
            signalsProcessed: result.signalsProcessed,
            actionsCount: result.actions.length,
          },
          'data-layer',
        );
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // ─── query_provenance ──────────────────────────────────────────────
  server.registerTool(
    'query_provenance',
    {
      description:
        'Query the W3C PROV provenance audit trail. Actions: "derivation-chain" traces lineage from entity back to sources, "pending-signals" lists unprocessed change signals, "entity-counts" shows entities per layer, "signal-summary" shows signal status distribution.',
      inputSchema: {
        action: z
          .enum(['derivation-chain', 'pending-signals', 'entity-counts', 'signal-summary'])
          .describe('Provenance query action'),
        patientId: z.string().describe('Patient resource ID'),
        entityId: z.string().optional().describe('(derivation-chain) Entity ID to trace'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (input) => {
      const provStore = getProvenanceStore();
      const patientId = input.patientId as string;
      const action = input.action as string;

      let result: unknown;

      switch (action) {
        case 'derivation-chain': {
          const entityId = input.entityId as string | undefined;
          if (!entityId) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: 'entityId is required for derivation-chain action',
                },
              ],
              isError: true,
            };
          }
          result = await provStore.getDerivationChain(entityId);
          break;
        }
        case 'pending-signals':
          result = await provStore.getPendingSignals({ patientId });
          break;
        case 'entity-counts':
          result = await provStore.getEntityCountsByLayer(patientId);
          break;
        case 'signal-summary':
          result = await provStore.getSignalSummary(patientId);
          break;
        default:
          return {
            content: [{ type: 'text' as const, text: `Unknown action: ${action}` }],
            isError: true,
          };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
