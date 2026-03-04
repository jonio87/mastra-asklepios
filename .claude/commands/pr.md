# /pr — Create Pull Request

Generate a PR description from the branch commits and create via GitHub CLI.

## Steps

1. Get the current branch name: `git branch --show-current`
2. Get commits on this branch vs main: `git log main..HEAD --oneline`
3. Read the full diff: `git diff main...HEAD --stat`
4. Generate a PR using `gh pr create` with:
   - **Title**: derived from branch name (e.g., `feat/planner-agent` → `feat(agents): implement planner agent`)
   - **Body**: using the PR template format from `.github/pull_request_template.md`
   - Fill in the What/Why/How sections based on the commits and diff
   - Check all applicable checklist items
5. If there's a GitHub issue linked (check commit messages for `#N`), add `Closes #N`
6. Show the PR URL.

Requires: `gh` CLI installed and authenticated.
