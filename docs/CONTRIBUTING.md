# Contributing

## Workflow

`truecost` should use a short-lived topic branch + squash merge workflow.

For normal work:

1. start from `main`
2. create one purposeful branch for one reviewable slice
3. keep the branch scoped to that slice
4. open one linked issue for the slice if it does not already exist
5. open a PR against `main`
6. keep the PR in draft until the acceptance bar is met
7. squash merge the PR
8. delete the branch after merge

Direct commits to `main` should be treated as exceptions.

## Branch shape

Prefer names that make the purpose obvious:

- `issue-73-composable-state-refactor`
- `issue-81-comment-vote-contract`
- `task-mobile-nav-polish`

One branch should solve one coherent problem, not accumulate unrelated fixes.

## Issue and PR contract

Use concise tagged titles:

- issues: `(fix): admin editor and submit regressions`
- PRs: `(fix): repair admin boot, editor lifecycle, and submit autocomplete`
- squashed commits on `main`: same pattern, rewritten to match the merged scope exactly

Bodies should be short markdown sections, not raw escaped newlines or chatty prose.

Preferred structure:

- `## Summary`
- `## Acceptance` or `## Testing`

Use GitHub project-management features on every branch slice:

- assign the issue
- assign the PR
- link the PR to the issue with a closing keyword such as `Closes #80`
- keep the PR body updated so the merge action closes the issue automatically

## PR shape

PRs should be:

- narrow enough to review in one pass
- explicit about the user-visible contract being changed
- backed by the relevant deterministic tests
- updated in the relevant contract docs when a shared pattern, component family, browser fallback, or workflow rule changes

If a change touches live state, cache behavior, comments, ranking, filters, maps, or editor behavior, reference the test coverage added for that contract.

## Merge policy

- prefer squash merge
- keep the squashed commit message clear and product-facing
- keep the squash title in tagged form, for example `(fix): repair admin boot, editor lifecycle, and submit autocomplete`
- do not preserve noisy intermediate fixup history in `main`

## Validation minimum

Before merge:

- run `node --check` on touched modules
- run deterministic tests for the changed state contract
- note what user-visible behavior was verified

See [TESTING.md](./TESTING.md) for the current minimum test contract.
