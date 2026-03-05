import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { mastra } from '../mastra.js';
import { storage } from '../memory.js';
import { deepResearchTool } from '../tools/deep-research.js';
import { documentParserTool } from '../tools/document-parser.js';

/**
 * State inspection + raw tool access — verification layer for AI testers.
 * Enables reading working memory, threads, messages, and directly calling
 * document-parser and deep-research tools.
 */
export function registerStateTools(server: McpServer): void {
  server.registerTool(
    'get_working_memory',
    {
      description:
        'Read the working memory (PatientProfile) for a patient resource. Returns the structured JSON profile with symptoms, diagnoses, medications, hypotheses, and other clinical data.',
      inputSchema: {
        resourceId: z.string().describe('Patient resource ID (e.g., "patient-eds-01")'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ resourceId }) => {
      const memoryStore = await storage.getStore('memory');
      if (!memoryStore) {
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ error: 'Storage not available' }) },
          ],
          isError: true,
        };
      }

      const { threads } = await memoryStore.listThreads({
        filter: { resourceId },
        orderBy: { field: 'updatedAt', direction: 'DESC' },
        perPage: 1,
      });

      const latestThread = threads[0];
      if (!latestThread) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ resourceId, workingMemory: null, message: 'No data found' }),
            },
          ],
        };
      }

      const metadata = latestThread.metadata as Record<string, unknown> | undefined;
      const workingMemory = metadata?.['workingMemory'] ?? metadata?.['mastra'] ?? null;

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ resourceId, threadId: latestThread.id, workingMemory }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'list_threads',
    {
      description:
        'List conversation threads for a patient resource. Returns thread IDs, titles, and timestamps ordered by most recent.',
      inputSchema: {
        resourceId: z.string().describe('Patient resource ID (e.g., "patient-eds-01")'),
        limit: z
          .number()
          .min(1)
          .max(100)
          .optional()
          .describe('Maximum number of threads to return (default: 10)'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ resourceId, limit }) => {
      const memoryStore = await storage.getStore('memory');
      if (!memoryStore) {
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ error: 'Storage not available' }) },
          ],
          isError: true,
        };
      }

      const { threads } = await memoryStore.listThreads({
        filter: { resourceId },
        orderBy: { field: 'updatedAt', direction: 'DESC' },
        perPage: limit ?? 10,
      });

      const threadList = threads.map(
        (t: { id: string; title?: string | null; createdAt: unknown; updatedAt: unknown }) => ({
          threadId: t.id,
          title: t.title ?? null,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        }),
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              { resourceId, count: threadList.length, threads: threadList },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    'get_thread_messages',
    {
      description:
        'Read messages from a specific conversation thread. Returns messages with role, content, and timestamps.',
      inputSchema: {
        threadId: z.string().describe('Thread ID to read messages from'),
        limit: z
          .number()
          .min(1)
          .max(100)
          .optional()
          .describe('Maximum number of messages to return (default: 20)'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ threadId, limit }) => {
      const memoryStore = await storage.getStore('memory');
      if (!memoryStore) {
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ error: 'Storage not available' }) },
          ],
          isError: true,
        };
      }

      const { messages } = await memoryStore.listMessages({
        threadId,
        perPage: limit ?? 20,
        orderBy: { field: 'createdAt', direction: 'DESC' },
      });

      const messageList = messages
        .reverse()
        .map((msg: { role: string; content: unknown; createdAt: unknown }) => ({
          role: msg.role,
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          createdAt: msg.createdAt,
        }));

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              { threadId, count: messageList.length, messages: messageList },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    'parse_document',
    {
      description:
        'Parse a clinical document to extract structured data. Returns patient demographics, symptoms, diagnoses, medications, lab values, and document sections. Direct access to the document-parser tool.',
      inputSchema: {
        text: z.string().describe('Clinical document text to parse'),
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
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ text, documentType }) => {
      if (!documentParserTool.execute) {
        return {
          content: [{ type: 'text' as const, text: 'Document parser tool not available' }],
          isError: true,
        };
      }
      const result = await documentParserTool.execute({ text, documentType }, { mastra });

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

  server.registerTool(
    'deep_research',
    {
      description:
        'Run deep research on a medical topic. Returns a research report with findings, synthesis, knowledge gaps, and suggested follow-up. Direct access to the deep-research tool.',
      inputSchema: {
        query: z.string().describe('Research query or question'),
        context: z
          .string()
          .optional()
          .describe('Additional context for the research (e.g., patient background)'),
        focusAreas: z.array(z.string()).optional().describe('Specific areas to focus research on'),
        maxSources: z
          .number()
          .min(1)
          .max(100)
          .optional()
          .describe('Maximum sources to consult (default: 10)'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ query, context, focusAreas, maxSources }) => {
      if (!deepResearchTool.execute) {
        return {
          content: [{ type: 'text' as const, text: 'Deep research tool not available' }],
          isError: true,
        };
      }
      const result = await deepResearchTool.execute(
        { query, context, focusAreas, maxSources },
        { mastra },
      );

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
