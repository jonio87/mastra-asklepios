import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { mastra } from '../mastra.js';
import { deepResearchTool } from '../tools/deep-research.js';
import { logger } from '../utils/logger.js';

/**
 * In-progress task results stored in memory.
 * Maps taskId → { status, result, error }.
 */
const taskResults = new Map<
  string,
  { status: 'running' | 'completed' | 'failed'; result?: unknown; error?: string }
>();

interface WorkflowArgs {
  workflowId: string;
  patientId: string;
  documentText?: string | undefined;
  documentType?: string | undefined;
  symptoms?: string[] | undefined;
  hpoTerms?: string[] | undefined;
  researchFocus?: string | undefined;
}

function buildWorkflowInput(args: WorkflowArgs): Record<string, unknown> {
  const inputData: Record<string, unknown> = { patientId: args.patientId };
  if (args.workflowId === 'patient-intake') {
    inputData['documentText'] = args.documentText ?? '';
    if (args.documentType !== undefined) inputData['documentType'] = args.documentType;
  } else {
    if (args.symptoms !== undefined) inputData['symptoms'] = args.symptoms;
    if (args.hpoTerms !== undefined) inputData['hpoTerms'] = args.hpoTerms;
    if (args.researchFocus !== undefined) inputData['researchFocus'] = args.researchFocus;
  }
  return inputData;
}

/**
 * Task-based MCP tools — long-running operations that return immediately
 * with a task ID, allowing clients to poll for completion.
 *
 * Uses the experimental Tasks API from @modelcontextprotocol/sdk v1.27.1.
 * Two task tools:
 *   - run_deep_research: long-running variant of deep_research
 *   - run_diagnostic_workflow: long-running variant of workflow execution
 */
export function registerTaskTools(server: McpServer): void {
  // ─── Task 1: Deep Research ───────────────────────────────────────────────
  server.experimental.tasks.registerToolTask(
    'run_deep_research',
    {
      title: 'Run Deep Research (async)',
      description:
        'Start a long-running deep research operation. Returns a task ID immediately. Poll with tasks/get and retrieve results with tasks/result. Use this instead of the synchronous deep_research tool for complex queries that may take 30+ seconds.',
      inputSchema: {
        query: z.string().describe('Detailed research query'),
        context: z.string().optional().describe('Additional patient context'),
        focusAreas: z.array(z.string()).optional().describe('Specific research focus areas'),
        maxSources: z.number().min(1).max(100).optional().describe('Maximum sources (default: 20)'),
      },
      execution: { taskSupport: 'optional' as const },
    },
    {
      createTask: async (args, extra) => {
        const task = await extra.taskStore.createTask({ ttl: 300000 });
        const taskId = task.taskId;

        taskResults.set(taskId, { status: 'running' });

        // Start background research
        if (deepResearchTool.execute) {
          deepResearchTool
            .execute(
              {
                query: args.query,
                ...(args.context !== undefined ? { context: args.context } : {}),
                ...(args.focusAreas !== undefined ? { focusAreas: args.focusAreas } : {}),
                maxSources: args.maxSources ?? 20,
              },
              { mastra },
            )
            .then(async (result: unknown) => {
              taskResults.set(taskId, { status: 'completed', result });
              await extra.taskStore.storeTaskResult(taskId, 'completed', {
                content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
              });
            })
            .catch(async (error: unknown) => {
              const msg = error instanceof Error ? error.message : String(error);
              taskResults.set(taskId, { status: 'failed', error: msg });
              await extra.taskStore.storeTaskResult(taskId, 'failed', {
                content: [{ type: 'text', text: `Research failed: ${msg}` }],
                isError: true,
              });
            });
        } else {
          taskResults.set(taskId, { status: 'failed', error: 'Deep research tool not available' });
          await extra.taskStore.storeTaskResult(taskId, 'failed', {
            content: [{ type: 'text', text: 'Deep research tool not available' }],
            isError: true,
          });
        }

        logger.info('Deep research task created', { taskId, query: args.query });
        return { task };
      },

      getTask: async (_args, extra) => {
        const task = await extra.taskStore.getTask(extra.taskId);
        return (
          task ?? {
            taskId: extra.taskId,
            status: 'failed' as const,
            statusMessage: 'Task not found',
            ttl: null,
            createdAt: new Date().toISOString(),
            lastUpdatedAt: new Date().toISOString(),
          }
        );
      },

      getTaskResult: async (_args, extra) => {
        const result = await extra.taskStore.getTaskResult(extra.taskId);
        if (result && 'content' in result) {
          return result as { content: Array<{ type: 'text'; text: string }> };
        }
        const local = taskResults.get(extra.taskId);
        if (local?.status === 'completed') {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(local.result, null, 2) }],
          };
        }
        return {
          content: [{ type: 'text' as const, text: 'Result not yet available' }],
          isError: true,
        };
      },
    },
  );

  // ─── Task 2: Diagnostic Workflow ─────────────────────────────────────────
  server.experimental.tasks.registerToolTask(
    'run_diagnostic_workflow',
    {
      title: 'Run Diagnostic Workflow (async)',
      description:
        'Start a long-running diagnostic workflow. Returns a task ID immediately. Supports patient-intake and diagnostic-research workflows. May suspend for human-in-the-loop review.',
      inputSchema: {
        workflowId: z
          .enum(['patient-intake', 'diagnostic-research'])
          .describe('Workflow to execute'),
        patientId: z.string().describe('Patient identifier'),
        documentText: z
          .string()
          .optional()
          .describe('Clinical document text (required for patient-intake)'),
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
          .describe('FHIR R4-aligned document type (for patient-intake)'),
        symptoms: z.array(z.string()).optional().describe('Symptom list (for diagnostic-research)'),
        hpoTerms: z.array(z.string()).optional().describe('HPO term IDs (for diagnostic-research)'),
        researchFocus: z
          .string()
          .optional()
          .describe('Research focus area (for diagnostic-research)'),
      },
      execution: { taskSupport: 'optional' as const },
    },
    {
      createTask: async (args, extra) => {
        const task = await extra.taskStore.createTask({ ttl: 600000 });
        const taskId = task.taskId;

        taskResults.set(taskId, { status: 'running' });

        const workflow = mastra.getWorkflow(args.workflowId);
        const run = await workflow.createRun();

        const inputData = buildWorkflowInput(args);

        run
          .start({ inputData: inputData as never })
          .then(async (result) => {
            taskResults.set(taskId, {
              status: 'completed',
              result: { runId: run.runId, ...result },
            });
            await extra.taskStore.storeTaskResult(taskId, 'completed', {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ runId: run.runId, ...result }, null, 2),
                },
              ],
            });
          })
          .catch(async (error: unknown) => {
            const msg = error instanceof Error ? error.message : String(error);
            taskResults.set(taskId, { status: 'failed', error: msg });
            await extra.taskStore.storeTaskResult(taskId, 'failed', {
              content: [{ type: 'text', text: `Workflow failed: ${msg}` }],
              isError: true,
            });
          });

        logger.info('Diagnostic workflow task created', {
          taskId,
          workflowId: args.workflowId,
          runId: run.runId,
        });
        return { task };
      },

      getTask: async (_args, extra) => {
        const task = await extra.taskStore.getTask(extra.taskId);
        return (
          task ?? {
            taskId: extra.taskId,
            status: 'failed' as const,
            statusMessage: 'Task not found',
            ttl: null,
            createdAt: new Date().toISOString(),
            lastUpdatedAt: new Date().toISOString(),
          }
        );
      },

      getTaskResult: async (_args, extra) => {
        const result = await extra.taskStore.getTaskResult(extra.taskId);
        if (result && 'content' in result) {
          return result as { content: Array<{ type: 'text'; text: string }> };
        }
        const local = taskResults.get(extra.taskId);
        if (local?.status === 'completed') {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(local.result, null, 2) }],
          };
        }
        return {
          content: [{ type: 'text' as const, text: 'Result not yet available' }],
          isError: true,
        };
      },
    },
  );
}
