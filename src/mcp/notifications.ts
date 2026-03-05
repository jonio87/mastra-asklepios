import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * MCP notification helpers — emit event-driven updates to connected clients.
 *
 * These wrap the underlying Server notification methods with domain-specific
 * helpers that know about Asklepios resource URIs and tool categories.
 */

/**
 * Notify all subscribed clients that a patient resource has been updated.
 * Called after clinical data capture, working memory changes, or workflow state updates.
 */
export function notifyResourceUpdated(server: McpServer, uri: string): void {
  server.server.sendResourceUpdated({ uri }).catch(() => {
    /* client may not support notifications — ignore */
  });
}

/**
 * Notify clients that the tool list has changed (e.g., dynamic tools loaded/unloaded).
 */
export function notifyToolListChanged(server: McpServer): void {
  server.server.sendToolListChanged().catch(() => {
    /* client may not support notifications — ignore */
  });
}

/**
 * Emit a structured log message to connected MCP clients.
 * Levels: debug, info, notice, warning, error, critical, alert, emergency.
 */
export function mcpLog(
  server: McpServer,
  level: 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical' | 'alert' | 'emergency',
  data: unknown,
  loggerName?: string,
): void {
  server.server
    .sendLoggingMessage({
      level,
      data,
      ...(loggerName ? { logger: loggerName } : {}),
    })
    .catch(() => {
      /* client may not support logging — ignore */
    });
}
