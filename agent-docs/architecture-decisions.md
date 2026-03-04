# Architecture Decisions

Record significant design decisions here. Future contributors (human and AI) will understand WHY things are the way they are.

## Format

Each decision follows this template:

```
## ADR-NNN: Title

**Status:** Accepted | Superseded | Deprecated
**Date:** YYYY-MM-DD
**Context:** What prompted this decision?
**Decision:** What was decided?
**Consequences:** What are the trade-offs?
```

---

## ADR-001: Biome over ESLint + Prettier

**Status:** Accepted
**Date:** {{DATE}}

**Context:** Need linting and formatting for TypeScript. ESLint + Prettier is the traditional choice but requires maintaining two tools, two configs, and plugin compatibility.

**Decision:** Use Biome v2 as the single tool for both linting and formatting.

**Consequences:**
- (+) Single config file, single tool, 100x faster than ESLint
- (+) Built-in import sorting, naming conventions, cognitive complexity limits
- (-) Smaller ecosystem of rules than ESLint
- (-) Some niche ESLint plugins have no Biome equivalent

## ADR-002: Strict TypeScript with All Safety Flags

**Status:** Accepted
**Date:** {{DATE}}

**Context:** AI agents generate code that compiles but may have subtle type safety issues. The `any` type is used 9x more often by AI agents than humans (MSR '26).

**Decision:** Enable all strict TypeScript flags including `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `verbatimModuleSyntax`. Enforce `noExplicitAny` as an error in Biome. Block `any` in Claude Code pre-edit hooks.

**Consequences:**
- (+) Catches type errors at compile time, not runtime
- (+) Forces explicit handling of `undefined` from array/object access
- (-) More verbose code (explicit null checks, type narrowing)
- (-) Some third-party types require workarounds

## ADR-003: Claude Code Hooks as Quality Gates

**Status:** Accepted
**Date:** {{DATE}}

**Context:** Traditional pre-commit hooks (Husky/lint-staged) only catch issues at commit time. When AI agents are writing code, issues should be caught earlier — at edit time.

**Decision:** Use Claude Code hooks (PreToolUse, PostToolUse, Stop) to enforce quality rules in real-time during AI-assisted development. Pre-edit hooks block known anti-patterns. Post-edit hooks auto-format. Stop hooks run the full quality gate.

**Consequences:**
- (+) Issues caught before code lands in the file, not at commit time
- (+) Auto-formatting is deterministic — agent doesn't need to remember
- (-) Only works during Claude Code sessions (CI still needed for human commits)
- (-) Hook scripts need maintenance as rules evolve

---

<!-- Add new ADRs below this line -->
