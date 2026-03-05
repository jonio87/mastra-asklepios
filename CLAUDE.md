# mastra-asklepios

Mastra AI agent project — Asklepios.

## Architecture

```
{{Draw your architecture here. Example:}}
src/
├── agents/       # Agent definitions and prompts
├── tools/        # Mastra tools (wrappers around external APIs / DB)
├── workflows/    # Multi-step orchestration workflows
└── utils/        # Shared utilities (logger, validation)
```

## Commands

```bash
npm run dev          # Start Mastra dev server + Studio at localhost:4111
npm run build        # TypeScript compile
npm run test         # Run Jest tests
npm run lint         # Biome v2 check
npm run lint:fix     # Biome auto-fix
npm run typecheck    # TypeScript strict check (tsc --noEmit)
npm run check        # ALL THREE: typecheck → lint → test (must pass before commit)
```

## Tech Stack

- **Runtime:** Node.js 22+ / TypeScript (ES2022, strict mode, bundler moduleResolution)
- **Framework:** Mastra (`@mastra/core`) — agents, tools, workflows
- **Testing:** Jest with ts-jest (ESM mode)
- **Linting/Formatting:** Biome v2 (replaces ESLint + Prettier — single tool, 100x faster)
- **Validation:** Zod schemas for all external data

## Code Patterns

- **ES modules only** (`import`/`export`), never CommonJS `require()`
- **Named exports** over default exports (enforced by Biome)
- **Zod validation** at all system boundaries (API responses, user input, DB results)
- **Structured logger** (`src/utils/logger.ts`) instead of `console.log`
- **`import type`** for type-only imports (enforced by `verbatimModuleSyntax`)

## Quality Rules (enforced by hooks — your code WILL be blocked)

- **NEVER use `any` type** — use `unknown`, Zod inference, or explicit types
- **NEVER use `@ts-ignore`, `@ts-nocheck`, `@ts-expect-error`** — fix the type error
- **NEVER use `require()`** — ES modules only
- **NEVER use `console.log` in production code** — use the structured logger

Before every commit: `npm run check` (typecheck → lint → test — all three must pass).

## TypeScript Strictness

All enabled — do not weaken:
- `strict: true` (includes strictNullChecks, strictFunctionTypes, etc.)
- `noUncheckedIndexedAccess` — array/object access returns `T | undefined`
- `exactOptionalPropertyTypes` — `prop?: string` means missing OR string, NOT `string | undefined`
- `verbatimModuleSyntax` — forces `import type` for type-only imports

## Testing

- Every exported function has at least one test
- Tests cover happy path AND error cases
- Descriptive test names: `it('returns empty array when no agents match')`
- Test files colocated: `src/foo/bar.ts` → `src/foo/bar.test.ts`
- Coverage thresholds: 80% lines, 80% functions, 70% branches

## Development Loop

Every task follows this loop — do not skip steps:

1. **Understand** — read all files you'll modify + related files + any referenced docs
2. **Test first** — write failing tests from acceptance criteria (TDD red phase)
3. **Implement** — make tests pass, one file at a time (TDD green phase)
4. **Verify** — `npm run check` (typecheck + lint + test)
5. **Commit** — imperative mood, explain WHY not just WHAT

Detailed guide: `agent-docs/development-loop.md`

## Agent-Specific Docs (progressive disclosure)

Don't read these upfront — load them when relevant to your current task:

| Doc | When to read |
|-----|-------------|
| `agent-docs/development-loop.md` | Before starting any implementation task |
| `agent-docs/testing-patterns.md` | Before writing or modifying tests |
| `agent-docs/mastra-patterns.md` | When working with agents, tools, or workflows |
| `agent-docs/architecture-decisions.md` | When making design choices or questioning existing patterns |

## Git Workflow

- Branch per feature: `feat/short-name`, `fix/short-name`, `refactor/short-name`
- Commit messages: imperative mood, explain WHY
- Run `npm run check` before every commit
- PRs link to issues: `Closes #N`
- Never commit `.env` files

## Learnings (append-only — add insights after each task)

<!-- Format: [date] [context] insight -->
<!-- Example: [2026-03-01] Zod .transform() is better than manual mapping for DB rows -->
- [2026-03-05] [Mastra agent.stream()] Default maxSteps is 5, too low for complex diagnostic workflows with 6-8 tool calls. Set maxSteps: 10 explicitly.
- [2026-03-05] [Mastra ConsoleLogger] Framework logs go to stdout by default, polluting CLI output. Extend with StderrLogger to redirect to stderr.
- [2026-03-05] [Orphanet API] API returns raw array `[...]` at top level, NOT `{ results: [...] }`. Use union schema to handle both formats.
- [2026-03-05] [CLI readline] Piped input fires all `line` events synchronously before async handlers complete. Add isProcessing mutex to prevent race conditions.
- [2026-03-05] [AI SDK v5] Token usage fields are `inputTokens`/`outputTokens` (not `promptTokens`/`completionTokens` from v4). Normalize both in observability.
- [2026-03-05] [MCP testing] McpServer internal maps accessible via `(server as any)._registeredTools` for registration tests. Not a Map — plain object with bracket notation.
- [2026-03-05] [Working memory] Resource-scoped working memory persists across thread boundaries. New thread with same patient resource gets full PatientProfile instantly (~11K tokens, 13s).
- [2026-03-05] [Network mode] Routing agent correctly identifies pure reasoning tasks and delegates to synthesis-agent without unnecessary tool calls. Single-iteration routing for simple requests.
- [2026-03-05] [Brain memory] brainFeed ingests anonymized case summaries; brainRecall returns 0 patterns initially — brain accumulates value over 50+ cases, not from day one.
- [2026-03-05] [@mastra/observability] Package requires @mastra/core >=0.18.1-0 <0.25.0-0 but project uses @mastra/core@1.9.0. Use lightweight custom tracing instead.
- [2026-03-05] [Mastra Workflow API] workflow.execute() is internal; use workflow.createRun() → run.start({ inputData }) for external invocation (MCP tools).
- [2026-03-05] [Document parser] Regex-based extraction has limits: "28F" compact format needed special handling; medication extraction captures compound strings. NLP would improve accuracy.
