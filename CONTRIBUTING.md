# Contributing

## Workflow

`truecost` should use a branch -> purpose -> squash workflow.

For normal work:

1. start from `main`
2. create one purposeful branch for one reviewable slice
3. keep the branch scoped to that slice
4. open a PR against `main`
5. squash merge the PR
6. delete the branch after merge

Direct commits to `main` should be treated as exceptions.

## Branch shape

Prefer names that make the purpose obvious:

- `issue-73-composable-state-refactor`
- `issue-81-comment-vote-contract`
- `task-mobile-nav-polish`

One branch should solve one coherent problem, not accumulate unrelated fixes.

## PR shape

PRs should be:

- narrow enough to review in one pass
- explicit about the user-visible contract being changed
- backed by the relevant deterministic tests

If a change touches live state, cache behavior, comments, ranking, filters, maps, or editor behavior, reference the test coverage added for that contract.

## Merge policy

- prefer squash merge
- keep the squashed commit message clear and product-facing
- do not preserve noisy intermediate fixup history in `main`

## Validation minimum

Before merge:

- run `node --check` on touched modules
- run deterministic tests for the changed state contract
- note what user-visible behavior was verified

See [TESTING.md](./TESTING.md) for the current minimum test contract.
