# /commit — Smart Commit

Analyze the current diff, generate a conventional commit message, and commit.

## Steps

1. Run `git diff --cached --stat` to see staged changes. If nothing staged, run `git add -A` first (excluding .env files).
2. Run `git diff --cached` to read the full diff.
3. Generate a commit message following this format:
   ```
   type(scope): concise description

   Why: explain the motivation for this change.
   What: summarize what changed at a high level.

   Co-Authored-By: Claude Code <noreply@anthropic.com>
   ```
   Types: feat, fix, refactor, test, docs, chore, ci
   Scope: the primary module affected (e.g., agents, tools, workflows, utils)
4. Run `npm run check` to verify quality gate passes.
5. If quality gate passes, commit with the generated message.
6. Show the commit hash and summary.

If quality gate fails, show the errors and DO NOT commit.
