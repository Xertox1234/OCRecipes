---
title: "Wire kimi-review into the pre-commit hook"
status: completed
priority: low
created: 2026-05-11
updated: 2026-05-15
assignee:
labels: [code-quality, deferred]
github_issue:
---

# Wire kimi-review into the pre-commit hook

## Summary

`CLAUDE.md` claims "Pre-commit staged-diff review is automatic (pre-commit hook)"
but the actual `.husky/pre-commit` only runs `npx lint-staged --concurrent false`,
and `lint-staged` in `package.json` only configures `eslint --fix` + `prettier --write`
(plus a few targeted accessibility/IDOR checks). There is no `kimi-review` call
anywhere in the hook chain, so the documented automatic review never fires.

## Background

Discovered during the 2026-05-11 delegation-backlog session. After committing
the test-label bypass in `scripts/delegate-copilot-issue.ts`, no kimi-review
ran from the pre-commit hook. Running `kimi-review` manually after the commit
surfaced a real WARNING (a path-based block was missing for several
sensitive-area implementation files), which required a follow-up commit.
That gap should have been caught at commit time, not after pushing.

The deferral exists because there are two reasonable implementation choices
and a small design call to make first:

- Option A: add a `kimi-review --staged` invocation to `lint-staged` as a new
  glob (e.g., on `*.{ts,tsx}`), so it runs alongside ESLint/Prettier.
- Option B: append a line to `.husky/pre-commit` that runs `kimi-review` on
  the staged diff after `lint-staged` exits cleanly.

Option B keeps `lint-staged` focused on per-file linters and runs review once
on the full staged diff (closer to how `kimi-review` is designed). Option A
would re-run review per-file, which is wrong for cross-file findings.

## Acceptance Criteria

- [x] Update `.husky/pre-commit` so `kimi-review` runs on the staged diff after
      `lint-staged` succeeds, defaulting to `--tiers CRITICAL,WARNING --profile ocrecipes`
- [x] CRITICAL findings block the commit (non-zero exit); WARNINGs print but
      do not block
- [x] Hook exits early (does not run kimi-review) if no `.ts`/`.tsx` files
      are staged — kimi-review on docs-only commits is wasted tokens
- [x] A trivial way to bypass: respect `SKIP_KIMI_REVIEW=1` env var so commits
      from automation (e.g., merge commits, `lint-staged` retries) can opt out
- [x] Document the bypass env var in `CLAUDE.md` "Workflow Standards" section
- [x] Verify the hook fires by making a deliberate-violation test commit and
      confirming `kimi-review` runs and CRITICAL exit blocks
- [x] No regression on hook performance for docs-only / config-only commits

## Implementation Notes

Files in scope:

- .husky/pre-commit
- package.json

The existing per-file lint-staged checker scripts under `scripts/check-*.js`
(accessibility, hardcoded colors, IDOR storage, etc.) are unchanged — inspect
them only to mirror their exit-code conventions if helpful.

The existing `.husky/pre-commit` is a single line — `NODE_OPTIONS=...
npx lint-staged --concurrent false`. Likely shape after change:

```sh
NODE_OPTIONS="--max-old-space-size=4096" npx lint-staged --concurrent false || exit 1

if [ "$SKIP_KIMI_REVIEW" = "1" ]; then exit 0; fi

# Skip review when no .ts/.tsx changes are staged
if ! git diff --cached --name-only --diff-filter=ACM | grep -qE '\.(ts|tsx)$'; then
  exit 0
fi

kimi-review --staged --tiers CRITICAL,WARNING --profile ocrecipes \
  --base HEAD || exit 1
```

Verify that `kimi-review` supports a `--staged` mode (or equivalent — check
`kimi-review --help`); if not, pipe `git diff --cached` into it. The existing
per-file `lint-staged` scripts (`check-accessibility.js` etc.) listed above
in scope are unchanged — they're listed because the implementer may want to
inspect them to mirror their exit-code conventions.

## Dependencies

- `kimi-review` must be on PATH for all developers, not just at runtime via
  Claude's tooling. Confirm before wiring the hook, or scope to "only runs if
  `kimi-review` is on PATH" so it degrades gracefully.

## Risks

- Token cost: `kimi-review` on every commit adds up. Mitigate by the
  `.ts`/`.tsx`-only gate and the `SKIP_KIMI_REVIEW=1` escape hatch.
- Latency: if `kimi-review` takes >30s on large diffs, commits feel sluggish.
  Consider a `--max-lines` cap or async/notification mode if this becomes a
  problem in practice.

## Updates

### 2026-05-11

- Deferred from delegation-workflow fix session. The kimi-review gap was
  surfaced by my own commit not triggering automatic review, which let a
  real WARNING land on `main` until I manually ran kimi-review post-commit.

### 2026-05-15

- Implemented and verified. Hook script in `.husky/pre-commit` runs `lint-staged`
  first, exits early on non-`.ts`/`.tsx` staged sets, honors `SKIP_KIMI_REVIEW=1`
  and auto-skips when `kimi-review` is not on PATH. Output is ANSI-stripped before
  the CRITICAL regex check (supports both `[CRITICAL]` and bare `CRITICAL` line
  formats). Wraps with `timeout`/`gtimeout` when available; falls back to no
  timeout on systems missing both (macOS without coreutils).
- Verification (run by simulating `bash .husky/pre-commit` in this worktree
  against a staged index — `core.hooksPath` points at the main repo, so a real
  `git commit` here would invoke the old hook):
  - Deliberate-violation `server/__test_violation__.ts` (UUID parseInt, raw
    `req.body`, hardcoded JWT secret, secret in response): 4-5 CRITICAL findings,
    hook exited 1.
  - Docs-only commit (`.md` file): hook ran in ~0.7s with no kimi-review call.
  - `.ts` file + `SKIP_KIMI_REVIEW=1`: hook exited 0 in ~1.7s with no
    kimi-review call.
- AC #5 (CLAUDE.md docs): `CLAUDE.md` is gitignored, so the bypass docs at
  line 16 of the local `CLAUDE.md` are not propagated by this PR. Reviewers
  on other machines must add the same line manually.
