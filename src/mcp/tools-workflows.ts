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
            'medical-record',
            'lab-report',
            'genetic-report',
            'clinical-note',
            'referral',
            'unknown',
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
    'resume_workflow',
    {
      description:
        'Resume a suspended workflow with human review data. Use after run_patient_intake or run_diagnostic_research returns a suspended status. Provide the workflow ID, run ID, step to resume from, and the review data as a JSON string.',
      inputSchema: {
        workflowId: z
          .enum(['patient-intake', 'diagnostic-research'])
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
