---
title: "merge-review-guard.sh does not model `gh api` against the merge endpoint — a third merge route the gate never sees"
status: done
priority: medium
created: 2026-09-12
updated: 2026-09-14
assignee:
labels: [deferred, harness, security]
github_issue:
---

# `gh api … /pulls/<n>/merge` is a merge route the gate does not model

## Summary

`merge-review-guard.sh` gates two merge routes — a Bash `gh pr merge` and the
`mcp__github__merge_pull_request` MCP tool. A third route, `gh api` against the REST merge
endpoint, reaches neither: its raw text contains no literal `pr` substring, so it never
passes the hook's `*gh*pr*merge*` fast path and the gate returns a silent allow.

## Background

Found by `security-auditor` during the review of PR #941 (the merge review gate itself),
2026-09-12, and deferred out of that PR deliberately: closing it means widening the shared
fast-path filter, whose caller count `test-cmd-detect.sh` pins at 8 and whose per-row
behaviour the **required** `Outward-CLI guard corpus` check attributes. PR #941 was
verified attribution-stable as written; re-widening the filter puts that back in play, so
it belongs in its own change with its own corpus re-verification.

Measured with no review record present, both PreToolUse guards run in sequence:

```
gh api --method PUT repos/Xertox1234/OCRecipes/pulls/42/merge -f merge_method=squash
  -> outward=DENY  merge-review=ALLOW
gh api -X PUT /repos/{owner}/{repo}/pulls/42/merge
  -> outward=DENY  merge-review=ALLOW
```

`guard-outward-cli.sh` denies both today, so this is **not** currently a live bypass. But

<!-- RETRACTED 2026-09-16: the sentence above is FALSE for the field-based spelling.
     Measured on unmodified main, both guards, controls behaving, zero void rows:
     `gh api -f merge_method=squash /repos/o/r/pulls/42/merge` is ALLOWED by BOTH
     guard-outward-cli.sh AND merge-review-guard.sh. Only the explicit-method form
     (`--method PUT` / `-X POST`), which is what this todo measured, is denied.
     `gh` infers POST from the presence of -f, so the -f-only form is a POST that
     never says so. Tracked by todos/P1-2026-09-16-gh-api-field-mutation-passes-both-merge-guards.md. -->

that backstop is one agent-writable word away — its inline escape is read from the command
text (`guard-outward-cli.sh:1381`, `case "$CMD" in "ALLOW_OUTWARD_CLI=1 "*) exit 0`), and
with it the whole chain allows:

```
ALLOW_OUTWARD_CLI=1 gh api -X PUT repos/Xertox1234/OCRecipes/pulls/42/merge
  -> outward=ALLOW  merge-review=ALLOW
```

The hook's own header (`merge-review-guard.sh:34-37`) argues the crude pre-check "MUST
cover BOTH merge routes" because covering only one "is worse than none". The same argument
applies to a third route.

Related, same review, deliberately NOT folded in here because it is a different mechanism:
the `--auto` head-binding residual (`docs/superpowers/specs/2026-09-08-merge-review-gate-design.md` §8),
which is a documented accepted residual rather than an unmodelled route.

## Acceptance Criteria

- [ ] A `gh api` call targeting `/pulls/<n>/merge` with no valid review record is DENIED by `merge-review-guard.sh` on a risk-classified PR.
- [ ] The `ALLOW_OUTWARD_CLI=1`-prefixed form of the same call is also denied by the merge gate (the merge gate must not inherit the sibling guard's escape).
- [ ] A two-sided control: an ordinary read-only `gh api` call (e.g. `gh api repos/:owner/:repo`) still passes silently, and a commit message merely mentioning the endpoint is not denied.
- [ ] `.claude/hooks/repro-outward-cli-corpus.sh` passes with per-path verdicts and deny attribution unchanged, or the pin is updated with the delta explained.
- [ ] `test-cmd-detect.sh`'s `assert_wired` / non-vacuity caller count is updated in the same change if the fast-path needle set changes.
- [ ] Mutation-verified: reverting the new branch leaves the suite red.

## Implementation Notes

- Files in scope: `.claude/hooks/merge-review-guard.sh` (fast path ~:89, tool dispatch ~:81), `.claude/hooks/test-merge-review-guard.sh`, possibly `.claude/hooks/lib/fastpath-filter.sh` / `lib/cmd-detect.sh`.
- Suggested shape (from the review): add a second fast-path needle (`*gh*api*merge*` or `*pulls*merge*`), and on a match the precise detector cannot resolve to a PR number, deny through the existing unresolvable-ref path at `:172-181` — that message already names the right remedy.
- Do NOT model this on the miss-detection branch PR #941 briefly carried: it was WITHDRAWN in `22b88513` after three rounds proved it unshippable (it denied ordinary prose every time it was tightened). Read `todos/P1-2026-09-12-merge-review-guard-extractor-miss-is-a-silent-allow.md` → "Prior Attempt — READ BEFORE WRITING CODE" first; its candidate fix (gate on an unquoted verb surviving `cmd_bare_deep`, scan every token, normalise before matching) is the shape that survived review. The principle still holds — an unreadable merge is treated as a merge — but the false-positive boundary is the hard part, not the detection.
- `.claude/hooks/**` feeds a required check. Mutation-verify before pushing, and run the corpus against **branch ⊕ main**, not the bare tip.
