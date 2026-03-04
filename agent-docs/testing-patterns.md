# Testing Patterns

## General Rules

- Every exported function has at least one test
- Tests cover happy path AND error cases
- Descriptive test names: `it('returns empty array when no agents match project type')`
- No test interdependence — each test runs in isolation
- Mocks are minimal — prefer real implementations where possible
- No `any` in test files either (use Zod or explicit types for mocks)
- Test files colocated with source: `src/foo/bar.ts` → `src/foo/bar.test.ts`

## Running Tests

```bash
npm test                              # Full suite
npm run test:single src/foo/bar.test.ts  # Single file
npm run test:watch                    # Watch mode
npm run test:coverage                 # Coverage report
```

## How to Test Each Component Type

### Mastra Agents
- Unit tests: mock tools and LLM, verify prompt construction and output parsing
- Verify: agent definition has required fields (name, instructions, tools)
- Test Zod output schemas parse correctly for expected responses

### Mastra Tools
- Unit tests: mock external APIs, verify input validation and response mapping
- Test Zod schemas for both input and output
- Verify error handling for API failures, timeouts, invalid responses

### Mastra Workflows
- Unit tests: mock step functions, verify step ordering and data passing
- Test conditional branches (if/else steps)
- Verify error propagation between steps

### Utility Functions
- Unit tests: pure functions are the easiest to test
- Cover edge cases: empty inputs, null values, boundary conditions
- Test error paths: invalid input, missing data

## Testing Patterns

### Dependency Injection over Mocking

Prefer dependency injection to make functions testable:

```typescript
// GOOD: injectable dependency
function processData(data: Input[], fetcher: (id: string) => Promise<Result>): Promise<Output[]> {
  // ...
}

// In tests:
const mockFetcher = async (id: string) => ({ id, value: 'mock' });
const result = await processData(testData, mockFetcher);
```

### Zod Schema Testing

```typescript
// Test that schemas accept valid data
it('parses valid agent output', () => {
  const result = AgentOutputSchema.safeParse({ plan: 'do X', confidence: 0.9 });
  expect(result.success).toBe(true);
});

// Test that schemas reject invalid data
it('rejects output missing required fields', () => {
  const result = AgentOutputSchema.safeParse({ plan: 'do X' });
  expect(result.success).toBe(false);
});
```

### ESM Mocking with Jest

Jest + ESM requires `jest.unstable_mockModule` instead of `jest.mock`:

```typescript
// For ESM-only packages, prefer dependency injection instead.
// jest.unstable_mockModule doesn't reliably intercept all ESM imports.
```

## Coverage Thresholds

Enforced in `jest.config.js`:
- Branches: 70%
- Functions: 80%
- Lines: 80%
- Statements: 80%

These are minimums. Aim higher for critical paths (agents, tools, workflows).
