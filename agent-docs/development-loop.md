# Development Loop

Every task follows this exact loop. Do not skip steps.

## Phase 1: Understand Before Building

```
1. Read EVERY file you're about to modify (use view tool — never edit blind)
2. Read related files to understand existing patterns
3. Check CLAUDE.md for project-specific conventions
4. If the task has dependencies, verify they're actually implemented (not just planned)
```

Do NOT start coding until you understand: what exists, what patterns to follow, what the acceptance criteria require.

## Phase 2: Write Tests FIRST (TDD)

```bash
# Create the test file BEFORE the implementation
# e.g., for src/agents/planner.ts → create src/agents/planner.test.ts first

# Write tests that define the expected behavior:
# - Happy path (the thing works)
# - Error cases (bad input, missing data)
# - Edge cases (empty arrays, null values, boundary conditions)

# Run the test — it MUST fail (red phase)
npm run test:single src/agents/planner.test.ts
```

Why TDD: AI agents tend to write tests that match their implementation rather than the spec. Writing tests first forces you to think about the contract, not the code.

## Phase 3: Implement (Make Tests Pass)

```bash
# Write the minimum code to make tests pass (green phase)
# Follow existing patterns (check neighboring files)
# Run tests after each meaningful change:
npm run test:single src/agents/planner.test.ts

# Type-check continuously:
npm run typecheck
```

Rules during implementation:
- One file at a time. Complete it before moving to the next.
- If you need a type/interface, define it in the same file or a shared types file.
- If you hit a blocker from a dependency that doesn't exist yet, create a minimal stub and move on.

## Phase 4: Verify (The Full Gate)

```bash
# Run the complete quality pipeline:
npm run check    # typecheck → lint → test (all three must pass)
```

The Stop hook runs `npm run check` automatically when you finish, but run it yourself first — catching errors earlier is faster.

## Phase 5: Commit

```bash
# Stage changes (never stage .env)
git add -A
git status                    # Review what's staged

# Commit with context
git commit -m "feat(agents): implement planner agent with goal decomposition

Adds Mastra agent definition for planning with Zod-validated output.
Uses structured prompt with domain-specific instructions.

Closes #4"

# Push and create PR
git push -u origin feat/<branch-name>
gh pr create --title "feat(agents): planner agent" \
  --body "## What\n...\n\n## Testing\n- \`npm run check\` passes\n\nCloses #4"
```

## Phase 6: Log Learnings

After completing a task, if you discovered something useful, append it to CLAUDE.md:

```markdown
<!-- Format: [date] [context] insight -->
[2026-03-01] Zod .transform() is better than manual mapping for API responses
```

## The Loop Visualized

```
┌─────────────────────────────────────────────────────────────┐
│ 1. UNDERSTAND: read files, patterns, dependencies           │
│ 2. TEST FIRST: write failing tests from acceptance criteria │
│ 3. IMPLEMENT: make tests pass, one file at a time           │
│ 4. VERIFY: npm run check (typecheck + lint + test)          │
│ 5. COMMIT: git commit + gh pr create                        │
│ 6. LEARN: append insights to CLAUDE.md                      │
│                                                              │
│ ┌── if any step fails ──→ go back to appropriate phase ──┐  │
│ └────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```
