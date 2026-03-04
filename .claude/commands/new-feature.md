# /new-feature — Scaffold a New Feature

Set up everything needed to implement a new feature following the development loop.

## Usage

Provide a description: `/new-feature Add a summarization agent that condenses documents`

## Steps

1. **Create branch**: `git checkout -b feat/<short-name>` derived from the description
2. **Identify files needed**: Based on the description, determine:
   - Which source files to create (agents/, tools/, workflows/)
   - Which test files to create
   - Which docs to update
3. **Create test files first** (TDD): Scaffold test files with:
   - Happy path test stubs
   - Error case test stubs
   - Edge case test stubs
4. **Create source file stubs**: Minimal implementations that make TypeScript happy but tests fail
5. **Update CLAUDE.md**: Add the new module to the Architecture section if it's a new directory
6. **Show the development checklist**:

```
## Feature: [description]
Branch: feat/[short-name]

### Files Created
- [ ] src/[path]/[module].test.ts (tests first)
- [ ] src/[path]/[module].ts (implementation)

### Development Loop
- [ ] Tests written and failing (red phase)
- [ ] Implementation makes tests pass (green phase)
- [ ] `npm run check` passes (verify phase)
- [ ] Acceptance criteria met
- [ ] Committed and PR created

### Next Step
Run the failing tests: `npm run test:single src/[path]/[module].test.ts`
Then implement until they pass.
```
