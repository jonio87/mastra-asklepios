# /check — Full Quality Gate

Run the complete quality pipeline and report results.

## Steps

1. **TypeScript**: Run `npx tsc --noEmit` — report error count
2. **Lint**: Run `npx @biomejs/biome check src/` — report issue count
3. **Tests**: Run `npm test` — report pass/fail count
4. **Any scan**: Grep for `any` type usage in src/ (excluding test files)
5. **Console scan**: Grep for `console.log` in production code

## Output Format

```
## Quality Report

TypeScript:  ✅ 0 errors / ❌ N errors
Biome:       ✅ 0 issues / ❌ N issues
Tests:       ✅ N passed / ❌ N failed
Any types:   ✅ 0 found / ❌ N found
Console.log: ✅ 0 found / ⚠️ N found

Overall: ✅ PASS / ❌ FAIL
```

If any check fails, show the specific errors for the first failing check.
