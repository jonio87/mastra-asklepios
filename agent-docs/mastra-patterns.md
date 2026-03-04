# Mastra Patterns

## Core Concepts

Mastra is the orchestration framework. It provides:
- **Agents**: LLM-powered decision makers with tools and structured output
- **Tools**: Functions that agents can call (API wrappers, DB queries, file ops)
- **Workflows**: Multi-step orchestration with state passing between steps

## Agent Definitions

```typescript
import { Agent } from '@mastra/core/agent';
import { z } from 'zod';

export const plannerAgent = new Agent({
  name: 'planner',
  instructions: 'You are a planning agent. Break goals into actionable steps.',
  model: {
    provider: 'ANTHROPIC',
    name: 'claude-sonnet-4-20250514',
  },
  tools: { /* your tools here */ },
});
```

Key rules:
- Always use named exports for agents
- Keep instructions concise and specific
- Define Zod schemas for structured output when needed
- Tools should be defined separately and composed into agents

## Tool Definitions

```typescript
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const searchTool = createTool({
  id: 'search',
  description: 'Search for information',
  inputSchema: z.object({
    query: z.string().describe('Search query'),
  }),
  outputSchema: z.object({
    results: z.array(z.object({
      title: z.string(),
      snippet: z.string(),
    })),
  }),
  execute: async ({ context }) => {
    // Implementation here
    return { results: [] };
  },
});
```

Key rules:
- Always define both `inputSchema` and `outputSchema` with Zod
- Use `.describe()` on schema fields — agents read these descriptions
- Handle errors gracefully — return error objects, don't throw
- Keep tools focused — one tool, one responsibility

## Workflow Definitions

```typescript
import { Workflow, Step } from '@mastra/core/workflows';
import { z } from 'zod';

const analyzeStep = new Step({
  id: 'analyze',
  outputSchema: z.object({ analysis: z.string() }),
  execute: async ({ context }) => {
    // Step logic
    return { analysis: 'result' };
  },
});

export const myWorkflow = new Workflow({
  name: 'my-workflow',
  triggerSchema: z.object({ input: z.string() }),
})
  .step(analyzeStep)
  .commit();
```

Key rules:
- Define output schemas for every step
- Use trigger schemas to validate workflow input
- Call `.commit()` at the end of the chain
- Workflows are registered with the Mastra instance

## Mastra Instance

```typescript
import { Mastra } from '@mastra/core';

export const mastra = new Mastra({
  agents: { plannerAgent },
  workflows: { myWorkflow },
});
```

The Mastra instance is the central registry. Register all agents and workflows here.

## Common Gotchas

1. **Mastra is ESM-only** — always use `import`/`export`, never `require()`
2. **Agent instructions are prompts** — they go to the LLM, so write them like prompts
3. **Tool descriptions matter** — the agent decides which tool to use based on the description
4. **Zod schemas are contracts** — define them carefully, they're your type safety layer
5. **Check the installed version** — Mastra APIs evolve quickly. When unsure, check `node_modules/@mastra/core` for the actual API surface rather than guessing
