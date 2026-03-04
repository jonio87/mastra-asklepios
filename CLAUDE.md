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
