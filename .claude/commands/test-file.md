# /test-file — Scaffold Test File

Create a test file for a given source module, following project conventions.

## Usage

Provide the source file path as argument: `/test-file src/agents/planner.ts`

## Steps

1. Read the source file to understand its exports (functions, classes, types)
2. Check neighboring test files for style conventions
3. Create a test file at the same path with `.test.ts` extension
4. For each exported function/class, generate test cases:
   - Happy path: valid input → expected output
   - Error case: invalid input → appropriate error
   - Edge case: boundary conditions (empty, null, zero, max)
5. Use descriptive test names: `it('returns empty array when no agents match')`
6. Use dependency injection patterns (not `jest.mock`) where possible
7. Run the test to verify it compiles: `npm run test:single <path>`

## Template

```typescript
import { exportedFunction } from './module.js';

describe('exportedFunction', () => {
  it('handles the happy path', () => {
    // Arrange
    // Act
    // Assert
  });

  it('handles error cases', () => {
    // ...
  });

  it('handles edge cases', () => {
    // ...
  });
});
```
