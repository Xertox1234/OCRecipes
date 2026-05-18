---
title: "Trusted Kimi PR diff gates"
track: knowledge
category: best-practices
tags: [kimi-review, github-actions, security, ci, testing]
module: server
applies_to:
  [
    ".github/workflows/kimi-review.yml",
    "scripts/ci-kimi-review.sh",
    ".husky/pre-commit",
    ".claude/hooks/kimi-review.sh",
    "scripts/kimi-review.py",
  ]
created: 2026-05-18
---

# Trusted Kimi PR diff gates

## Rule

Secret-backed Kimi CI must execute only trusted base-branch code. PR head commits are diff data only: never checkout, source, import, install from, or execute files from the fetched PR head while repository secrets are in scope.

## Smell patterns

- A `pull_request_target` workflow checks out the PR head or merge commit before passing `WORKER_API_KEY`, `OPENROUTER_API_KEY`, or other secrets to a step.
- PR review scripts diff `base.sha` directly against `head.sha` instead of `merge-base -> head`, causing unrelated base-branch changes to be re-reviewed.
- Kimi changed-file detection excludes deleted or renamed `.ts` / `.tsx` files.
- A local hook sends the whole staged diff to an external reviewer, including docs, config, or accidental secret-bearing files.
- Shell gates parse Kimi's `[CRITICAL]` output without tests for the real clean-output sentinel.

## Why

`pull_request_target` is useful for secret-backed automation because it runs in the base repository context, but it is also easy to misuse. The safe pattern is to keep the working tree on trusted base code, fetch the PR head only so Git can compute a diff, and ensure every script that sees secrets comes from the base branch.

Kimi review gates also need precise diff scope. A PR gate should review the PR branch delta, not code that landed on the base branch after the branch was cut. Local gates should avoid leaking non-code staged files to external reviewers, while still reviewing risky TypeScript deletions and renames.

## Examples

Safe PR CI shape:

```yaml
on: pull_request_target

steps:
  - uses: actions/checkout@v4
    with:
      ref: ${{ github.event.pull_request.base.sha }}
      fetch-depth: 0
  - run: git fetch --no-tags --depth=1 origin ${{ github.event.pull_request.head.sha }}
  - env:
      WORKER_API_KEY: ${{ secrets.WORKER_API_KEY }}
    run: bash scripts/ci-kimi-review.sh
```

Safe diff range:

```bash
merge_base=$(git merge-base "$KIMI_REVIEW_BASE_SHA" "$KIMI_REVIEW_HEAD_SHA")
review_diff=$(git diff --diff-filter=ACMDR "$merge_base" "$KIMI_REVIEW_HEAD_SHA" -- '*.ts' '*.tsx')
```

Safe local external-review input:

```bash
files=$(git diff --cached --name-only --diff-filter=ACMDR | grep -E '\.(ts|tsx)$' || true)
[ -n "$files" ] || exit 0
review_diff=$(git diff --cached --diff-filter=ACMDR -- '*.ts' '*.tsx')
printf '%s' "$review_diff" | kimi-review --tiers CRITICAL,WARNING
```

## Exceptions

Fork PRs should stay skipped unless the workflow is redesigned so no repository secrets are exposed. Documentation-only or config-only local commits should not be sent to the external reviewer by default; use a dedicated secret/config scanner for those file types instead of widening Kimi's staged diff input.

## Related Files

- `.github/workflows/kimi-review.yml`
- `scripts/ci-kimi-review.sh`
- `scripts/kimi-review.py`
- `.husky/pre-commit`
- `.claude/hooks/kimi-review.sh`
- `.claude/hooks/test-kimi-review.sh`
- `docs/audits/2026-05-18-kimi.md`

## See Also

- [test-fixture-must-match-real-dependency-output](test-fixture-must-match-real-dependency-output-2026-05-15.md) — Kimi clean-output parsing tests must mirror the real dependency output.
- [kimi-review-cumulative-diff-re-flags-fixes](../logic-errors/kimi-review-cumulative-diff-re-flags-fixes-2026-05-13.md) — Scope Kimi review to the changed set being evaluated.
