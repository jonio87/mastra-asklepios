import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { StreamEvent } from '../cli-core.js';
import { streamDirect, streamNetwork } from '../cli-core.js';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

interface StreamCollectorResult {
  text: string;
  agentLabels: string[];
  usage: StreamEvent | undefined;
  error: string | undefined;
}

/**
 * Collect all events from a stream generator into a structured result.
 */
async function collectStream(
  streamFn: AsyncGenerator<StreamEvent>,
): Promise<StreamCollectorResult> {
  const chunks: string[] = [];
  const agentLabels: string[] = [];
  let usage: StreamEvent | undefined;

  for await (const event of streamFn) {
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
        return { text: '', agentLabels: [], usage: undefined, error: event.message };
    }
  }

  return { text: chunks.join(''), agentLabels, usage, error: undefined };
}

/**
 * Build a successful MCP tool response from collected stream data.
 */
function buildStreamResponse(
  collected: StreamCollectorResult,
  threadId: string,
  resourceId: string,
  emptyErrorMsg: string,
  extra?: Record<string, unknown>,
): ToolResult {
  if (collected.error) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: collected.error }) }],
      isError: true,
    };
  }

  if (collected.text.length === 0) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ error: emptyErrorMsg, threadId, patientId: resourceId }),
        },
      ],
      isError: true,
    };
  }

  const response: Record<string, unknown> = {
    text: collected.text,
    threadId,
    patientId: resourceId,
    ...extra,
  };

  if (collected.agentLabels.length > 0) {
    response['agents'] = [...new Set(collected.agentLabels)];
  }

  if (collected.usage?.type === 'usage') {
    response['usage'] = collected.usage.data;
  }

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
  };
}

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
      const session = { resourceId, threadId: thread, networkMode: mode === 'network' };

      try {
        const fn = mode === 'network' ? streamNetwork : streamDirect;
        const collected = await collectStream(fn(message, session));
        return buildStreamResponse(
          collected,
          thread,
          resourceId,
          'Agent returned empty response. This may indicate an authentication or API error.',
          { mode: mode ?? 'direct' },
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }],
          isError: true,
        };
      }
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
      const session = { resourceId, threadId: thread, networkMode: true };

      try {
        const collected = await collectStream(streamNetwork(message, session));
        return buildStreamResponse(
          collected,
          thread,
          resourceId,
          'Network returned empty response. This may indicate an authentication or API error.',
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }],
          isError: true,
        };
      }
    },
  );
}
