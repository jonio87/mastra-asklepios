import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { StreamEvent } from '../cli-core.js';
import { streamDirect, streamNetwork } from '../cli-core.js';

/**
 * Streaming tools — non-blocking chat with progressive text output.
 * MCP doesn't natively support SSE in tool responses, so these tools
 * collect the full streaming output and return it as a complete result.
 * For true SSE streaming, use the Streamable HTTP transport directly.
 */
export function registerStreamingTools(server: McpServer): void {
  server.registerTool(
    'stream_asklepios',
    {
      description:
        'Chat with Asklepios using the streaming pipeline. Collects the full response with token usage. Supports direct and network mode.',
      inputSchema: {
        message: z.string().describe('Your message to Asklepios'),
        patientId: z.string().optional().describe('Patient resource ID for memory scoping'),
        threadId: z
          .string()
          .optional()
          .describe('Thread ID to continue a conversation. Omit for new thread.'),
        mode: z
          .enum(['direct', 'network'])
          .optional()
          .describe(
            'Routing mode: "direct" for single agent, "network" for multi-agent orchestration (default: direct)',
          ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ message, patientId, threadId, mode }) => {
      const resourceId = patientId ?? 'asklepios-knowledge';
      const thread = threadId ?? crypto.randomUUID();
      const session = {
        resourceId,
        threadId: thread,
        networkMode: mode === 'network',
      };

      const streamFn = mode === 'network' ? streamNetwork : streamDirect;
      const chunks: string[] = [];
      const agentLabels: string[] = [];
      let usage: StreamEvent | undefined;

      for await (const event of streamFn(message, session)) {
        switch (event.type) {
          case 'text':
            chunks.push(event.content);
            break;
          case 'agent-label':
            agentLabels.push(event.agentId);
            break;
          case 'usage':
            usage = event;
            break;
          case 'error':
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({ error: event.message }),
                },
              ],
              isError: true,
            };
        }
      }

      const response: Record<string, unknown> = {
        text: chunks.join(''),
        threadId: thread,
        patientId: resourceId,
        mode: mode ?? 'direct',
      };

      if (agentLabels.length > 0) {
        response['agents'] = [...new Set(agentLabels)];
      }

      if (usage?.type === 'usage') {
        response['usage'] = usage.data;
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'stream_network',
    {
      description:
        'Trigger multi-agent network orchestration. Routes the message through specialist agents (phenotype, research, synthesis, brain) and returns the combined result with agent attribution.',
      inputSchema: {
        message: z.string().describe('Your message to the agent network'),
        patientId: z.string().optional().describe('Patient resource ID for memory scoping'),
        threadId: z
          .string()
          .optional()
          .describe('Thread ID to continue a conversation. Omit for new thread.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ message, patientId, threadId }) => {
      const resourceId = patientId ?? 'asklepios-knowledge';
      const thread = threadId ?? crypto.randomUUID();
      const session = {
        resourceId,
        threadId: thread,
        networkMode: true,
      };

      const chunks: string[] = [];
      const agentLabels: string[] = [];
      let usage: StreamEvent | undefined;

      for await (const event of streamNetwork(message, session)) {
        switch (event.type) {
          case 'text':
            chunks.push(event.content);
            break;
          case 'agent-label':
            agentLabels.push(event.agentId);
            break;
          case 'usage':
            usage = event;
            break;
          case 'error':
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({ error: event.message }),
                },
              ],
              isError: true,
            };
        }
      }

      const response: Record<string, unknown> = {
        text: chunks.join(''),
        threadId: thread,
        patientId: resourceId,
        agents: [...new Set(agentLabels)],
      };

      if (usage?.type === 'usage') {
        response['usage'] = usage.data;
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    },
  );
}
