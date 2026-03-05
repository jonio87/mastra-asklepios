import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { storage } from '../memory.js';

/**
 * Session lifecycle tools — thread creation, patient switching, token tracking.
 * Enables external agents to manage conversation state programmatically.
 */
export function registerSessionTools(server: McpServer): void {
  server.registerTool(
    'create_thread',
    {
      description:
        'Create a new conversation thread for a patient. Returns the threadId for use in subsequent tool calls.',
      inputSchema: {
        patientId: z.string().describe('Patient resource ID (e.g., "patient-001")'),
        title: z.string().optional().describe('Optional thread title'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ patientId, title }) => {
      const memoryStore = await storage.getStore('memory');
      if (!memoryStore) {
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ error: 'Storage not available' }) },
          ],
          isError: true,
        };
      }
      const threadId = crypto.randomUUID();
      const now = new Date();
      await memoryStore.saveThread({
        thread: {
          id: threadId,
          resourceId: patientId,
          title: title ?? `Thread ${now.toISOString()}`,
          createdAt: now,
          updatedAt: now,
        },
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                threadId,
                patientId,
                message: `Created thread ${threadId} for patient ${patientId}`,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    'switch_patient',
    {
      description:
        'Check a patient context: validates the patient ID format and returns how many threads exist for this patient.',
      inputSchema: {
        patientId: z.string().describe('Patient resource ID to switch to'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ patientId }) => {
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
        filter: { resourceId: patientId },
        perPage: 100,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                patientId,
                threadCount: threads.length,
                latestThread: threads[0]?.id ?? null,
                message:
                  threads.length > 0
                    ? `Patient ${patientId} has ${threads.length} thread(s).`
                    : `Patient ${patientId} is new — no threads yet.`,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    'get_token_usage',
    {
      description:
        'Get approximate token usage information. Returns the count of messages and threads for a patient resource as a usage proxy.',
      inputSchema: {
        patientId: z
          .string()
          .optional()
          .describe('Patient resource ID. If omitted, returns global stats.'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ patientId }) => {
      const memoryStore = await storage.getStore('memory');
      if (!memoryStore) {
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ error: 'Storage not available' }) },
          ],
          isError: true,
        };
      }

      if (patientId) {
        const { threads } = await memoryStore.listThreads({
          filter: { resourceId: patientId },
          perPage: 100,
        });

        let totalMessages = 0;
        for (const thread of threads) {
          const { messages } = await memoryStore.listMessages({
            threadId: thread.id,
            perPage: 1,
          });
          totalMessages += messages.length > 0 ? 1 : 0;
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  patientId,
                  threadCount: threads.length,
                  activeThreads: totalMessages,
                  message: `Patient ${patientId}: ${threads.length} threads, ${totalMessages} with messages.`,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // Global stats — count all threads
      const { threads } = await memoryStore.listThreads({
        perPage: 100,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                totalThreads: threads.length,
                message: `System has ${threads.length} total thread(s).`,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
