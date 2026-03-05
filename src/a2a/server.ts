/**
 * Asklepios A2A Server — agent-to-agent protocol endpoint.
 *
 * Other agents discover Asklepios at /.well-known/agent-card.json
 * and delegate diagnostic tasks via JSON-RPC at /a2a.
 *
 * Uses modern middleware approach (jsonRpcHandler + agentCardHandler)
 * instead of deprecated A2AExpressApp.
 *
 * Usage: node --env-file=.env dist/a2a/server.js
 */

import {
  DefaultExecutionEventBusManager,
  DefaultRequestHandler,
  InMemoryTaskStore,
} from '@a2a-js/sdk/server';
import { agentCardHandler, jsonRpcHandler, UserBuilder } from '@a2a-js/sdk/server/express';
import express from 'express';
import { getAgentCard } from './agent-card.js';
import { AsklepiosExecutor } from './executor.js';

export function createA2aServer(port?: number): ReturnType<typeof express> {
  const a2aPort = port ?? Number(process.env['A2A_PORT'] ?? 4113);
  const agentCard = getAgentCard(`http://localhost:${a2aPort}`);

  const taskStore = new InMemoryTaskStore();
  const executor = new AsklepiosExecutor();
  const eventBusManager = new DefaultExecutionEventBusManager();

  const requestHandler = new DefaultRequestHandler(agentCard, taskStore, executor, eventBusManager);

  const app = express();

  // CORS
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
  });

  // Agent Card discovery
  app.use(
    '/.well-known/agent-card.json',
    agentCardHandler({ agentCardProvider: async () => agentCard }),
  );

  // A2A JSON-RPC endpoint
  app.use(
    '/a2a',
    express.json(),
    jsonRpcHandler({
      requestHandler,
      userBuilder: UserBuilder.noAuthentication,
    }),
  );

  // Health check
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      server: 'asklepios-a2a',
      version: agentCard.version,
      skills: agentCard.skills.map((s) => s.id),
    });
  });

  return app;
}

// Direct entry point
if (process.argv[1]?.endsWith('a2a/server.js') || process.argv[1]?.endsWith('a2a/server.ts')) {
  const port = Number(process.env['A2A_PORT'] ?? 4113);
  const app = createA2aServer(port);
  app.listen(port, () => {
    process.stderr.write(
      `Asklepios A2A server listening on http://localhost:${port}\n` +
        `  Agent Card: GET http://localhost:${port}/.well-known/agent-card.json\n` +
        `  JSON-RPC:   POST http://localhost:${port}/a2a\n` +
        `  Health:     GET http://localhost:${port}/health\n`,
    );
  });
}
