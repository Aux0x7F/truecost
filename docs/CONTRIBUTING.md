# Contributing

Keep changes purposeful, reviewable, and easy to squash.

## How we ship changes

Use a short-lived branch for one coherent slice of work:

1. branch from `main`
2. keep the branch focused
3. open a PR against `main`
4. keep the PR in draft until the bar is met
5. squash merge
6. delete the branch

Direct commits to `main` should be rare.

## Branch shape

Good branch names explain the job:

- `issue-73-composable-state-refactor`
- `issue-81-comment-vote-behavior`
- `task-mobile-nav-polish`

One branch should solve one real problem, not accumulate grab-bag fixes.

## PR shape

A good PR says:

- what changed
- why it changed
- what behavior was verified
- which docs were updated if the shared guidance changed

Keep PR bodies concise. A short summary and testing section is enough.

## Validation before merge

Before merge:

- run `node --check` on touched modules where it helps
- run the focused tests for the affected behavior
- run broader validation when shared runtime, workspace, shell, or authoring behavior changed
- update the relevant docs when a reusable pattern or workflow rule changed

See [TESTING.md](./TESTING.md) for the current bar.

## Docs changes

When you touch docs:

- use relative links inside this repo
- use `https://github.com/...` links for cross-repo or external references
- never use local filesystem paths in docs
- keep the docs practical and readable, not ceremonial

## Merge expectations

- prefer squash merge
- keep the squash message clear and scoped
- do not carry noisy fixup history into `main`
