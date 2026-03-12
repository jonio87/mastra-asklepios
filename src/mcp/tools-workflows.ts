import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { mastra } from '../mastra.js';

/**
 * Workflow execution tools — trigger and resume diagnostic pipelines.
 * Uses createRun() → run.start() pattern for proper workflow execution.
 * Enables AI testers to run workflows, verify HITL suspension, and resume with test data.
 */
export function registerWorkflowTools(server: McpServer): void {
  server.registerTool(
    'run_patient_intake',
    {
      description:
        'Execute the patient-intake workflow. Parses clinical documents, extracts symptoms, maps to HPO terms, and suspends for human review if low-confidence phenotypes are detected. Returns workflow result with status and runId for resume.',
      inputSchema: {
        documentText: z.string().describe('Clinical document text to process'),
        patientId: z.string().describe('Patient ID for this intake'),
        documentType: z
          .enum([
            'diagnostic-report',
            'procedure-note',
            'clinical-note',
            'patient-document',
            'research-paper',
            'other',
          ])
          .optional()
          .describe('Type of clinical document (default: auto-detected)'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ documentText, patientId, documentType }) => {
      const workflow = mastra.getWorkflow('patient-intake');
      const run = await workflow.createRun();
      const result = await run.start({
        inputData: { documentText, patientId, documentType },
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ runId: run.runId, ...result }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'run_diagnostic_research',
    {
      description:
        'Execute the diagnostic-research workflow. Runs parallel searches across PubMed, Orphanet, and deep research, then generates ranked diagnostic hypotheses. Suspends for findings review before hypothesis generation. Returns runId for resume.',
      inputSchema: {
        patientId: z.string().describe('Patient ID for this research'),
        symptoms: z.array(z.string()).describe('Patient symptoms to research'),
        hpoTerms: z
          .array(
            z.object({
              id: z.string().describe('HPO term ID (e.g., "HP:0001252")'),
              name: z.string().describe('HPO term name'),
            }),
          )
          .optional()
          .describe('Mapped HPO terms for precise queries'),
        researchFocus: z
          .string()
          .optional()
          .describe('Specific research focus or question to guide the search'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ patientId, symptoms, hpoTerms, researchFocus }) => {
      const workflow = mastra.getWorkflow('diagnostic-research');
      const run = await workflow.createRun();
      const result = await run.start({
        inputData: { patientId, symptoms, hpoTerms, researchFocus },
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ runId: run.runId, ...result }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'run_diagnostic_flow',
    {
      description:
        'Execute the full 9-stage diagnostic flow. Stages: 1) Records ingestion check [HARD GATE], 2+3) Brain recall + structured interview, 4) Parallel research, 5) Preliminary hypotheses, 6) Follow-up questions with routing, 7) Adversarial synthesis [HITL], 8) Specialist integration [HITL], 9) Three-register deliverables. Suspends at stages 7 and 8 for human review. Returns runId for resume.',
      inputSchema: {
        patientId: z.string().describe('Patient ID'),
        mode: z
          .enum(['full', 'from-stage'])
          .optional()
          .describe('Run full flow or resume from a specific stage (default: full)'),
        startStage: z
          .number()
          .min(1)
          .max(9)
          .optional()
          .describe('Stage to start from (only when mode="from-stage")'),
        context: z
          .string()
          .optional()
          .describe('Additional clinical context for the diagnostic flow'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ patientId, mode, startStage, context }) => {
      const workflow = mastra.getWorkflow('diagnostic-flow');
      const run = await workflow.createRun();
      const result = await run.start({
        inputData: { patientId, mode, startStage, context },
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ runId: run.runId, ...result }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'resume_workflow',
    {
      description:
        'Resume a suspended workflow with human review data. Use after run_patient_intake, run_diagnostic_research, or run_diagnostic_flow returns a suspended status. Provide the workflow ID, run ID, step to resume from, and the review data as a JSON string.',
      inputSchema: {
        workflowId: z
          .enum(['patient-intake', 'diagnostic-research', 'diagnostic-flow'])
          .describe('Which workflow to resume'),
        runId: z.string().describe('Run ID returned from the original workflow execution'),
        stepId: z
          .string()
          .describe('Step ID to resume from (e.g., "review-phenotypes" or "review-findings")'),
        resumeData: z
          .string()
          .describe(
            'JSON string with resume data (e.g., {"approvedPhenotypes": [...], "notes": "..."})',
          ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ workflowId, runId, stepId, resumeData }) => {
      const workflow = mastra.getWorkflow(workflowId);

      let parsed: unknown;
      try {
        parsed = JSON.parse(resumeData);
      } catch {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'Invalid JSON in resumeData' }),
            },
          ],
          isError: true,
        };
      }

      // Access the existing run from the workflow's runs map
      const existingRun = workflow.runs.get(runId);
      if (!existingRun) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: `No active run found with ID: ${runId}. The run may have completed or the server may have restarted.`,
              }),
            },
          ],
          isError: true,
        };
      }

      const result = await existingRun.resume({
        step: stepId,
        resumeData: parsed,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );
}
