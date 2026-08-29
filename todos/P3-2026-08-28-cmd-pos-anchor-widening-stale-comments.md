---
title: "Stale _CMD_POS_PREFIX/_CMD_POS_SUFFIX comments in guard-outward-cli.sh's test/header after the anchor widening"
status: backlog
priority: low
created: 2026-08-28
updated: 2026-08-28
assignee:
labels: [deferred, harness]
github_issue:
---

# Stale \_CMD_POS_PREFIX/\_CMD_POS_SUFFIX comments in guard-outward-cli.sh's test/header after the anchor widening

## Summary

`todos/archive/P1-2026-08-17-cmd-position-anchor-boundary-gaps.md` widened
`.claude/hooks/lib/cmd-detect.sh`'s `_CMD_POS_PREFIX`/`_CMD_POS_SUFFIX` to recognize
`{`, backtick, and `!` as openers and `;`, `&`, `|`, backtick, `{`, `}` as closers. Three
comments in files outside that todo's Scope Contract now describe the OLD, narrower
character classes and are factually stale.

## Background

Surfaced by the todo-researcher during implementation of the parent todo (2026-08-28).
Left unfixed there because `guard-outward-cli.sh` and `test-guard-outward-cli.sh` were
outside that todo's Scope Contract (`.claude/hooks/lib/cmd-detect.sh`,
`.claude/hooks/test-cmd-detect.sh`, `.claude/hooks/pr-preflight-guard.sh`,
`.claude/hooks/branch-preflight.sh` only).

Stale locations, each asserting `_CMD_POS_PREFIX`/`_CMD_POS_SUFFIX` still lack
brace/backtick/bang coverage (now false):

- `test-guard-outward-cli.sh:402` — "The lib's shared `_CMD_POS_SUFFIX` is
  `([[:space:]]|[)]|$)` — it omits `;`, `&` and `|`"
- `test-guard-outward-cli.sh:428` — "`_CMD_POS_PREFIX`'s separator class omitted the
  backtick, `{`, and the shell KEYWORD positions (then/do/else/elif/time) and `!`"
  (half-false: only the keyword-absorption delta — `then|do|else|elif|time`, deliberately
  NOT added to `_CMD_POS_PREFIX` by the parent todo — remains a real prefix difference)
- `guard-outward-cli.sh:23-40` header block ("COMMAND-POSITION ANCHORS ARE GUARD-LOCAL")
  — its suffix bullet claiming the lib's suffix never matches a terminal verb is now
  wrong; post-fix the lib's suffix is actually WIDER than the guard's own
  `_OUT_POS_SUFFIX` (the lib gained `{`/`}` as closers per the parent todo's Acceptance
  Criteria; the guard's `_OUT_POS_SUFFIX` does not have them).

Separately, `branch-preflight.sh`'s lib-unsourceable fail-closed fallback regexes
(`GIT_COMMIT_RE`, `COMPOUND_COMMIT_RE` — hand-rolled, independent of
`_CMD_POS_PREFIX`/`_CMD_POS_SUFFIX`) do not recognize brace/backtick/bang either, and are
now relatively narrower than the (now-fixed) primary path. This was already true before
the parent todo (the fallback never shared the shared-lib anchors) but is worth a
one-line comment noting the divergence is deliberate, since this repo's own convention
(`test-cmd-detect.sh`'s cross-hook fast-path invariant) is "a fallback must be a superset
of what the primary matcher reads."

## Acceptance Criteria

- [ ] `test-guard-outward-cli.sh:402`'s comment updated to describe the current
      `_CMD_POS_SUFFIX` (now `([[:space:]]|[);&|`{}]|$)`), or reworded to note the guard's
    own `\_OUT_POS_SUFFIX`is now narrower than the lib's in the`{`/`}` dimension.
- [ ] `test-guard-outward-cli.sh:428`'s comment narrowed to the one delta that remains
      true: prefix keyword-absorption (`then|do|else|elif|time`) is guard-local; brace/
      backtick/bang are no longer guard-local.
- [ ] `guard-outward-cli.sh:23-40` header block's suffix bullet updated to reflect that
      the lib's suffix is now a superset of the guard's own in the `{`/`}` dimension.
- [ ] One-line comment added near `branch-preflight.sh`'s `GIT_COMMIT_RE`/
      `COMPOUND_COMMIT_RE` (~line 57-58) noting the fallback deliberately does not share
      `_CMD_POS_PREFIX`/`_CMD_POS_SUFFIX`'s brace/backtick/bang coverage.
- [ ] `bash scripts/run-hook-tests.sh` still passes (comment-only changes; no assertion
      changes expected).

## Implementation Notes

Pure comment/prose fixes — no regex or test-assertion changes. Read the current
`_CMD_POS_PREFIX`/`_CMD_POS_SUFFIX` definitions in `.claude/hooks/lib/cmd-detect.sh`
(and their explanatory comment, which documents the widening) as the source of truth for
what the corrected prose should say.

## Scope Contract

- **Mechanisms to use:** comment/prose edits only — no regex changes, no new test
  assertions, no new functions or files.
- **Files in scope:** `.claude/hooks/guard-outward-cli.sh`,
  `.claude/hooks/test-guard-outward-cli.sh`, `.claude/hooks/branch-preflight.sh`
  (comment only).
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. Depends conceptually on the already-merged
  `todos/archive/P1-2026-08-17-cmd-position-anchor-boundary-gaps.md` (the widening this
  todo's comments need to catch up to), but that todo is done, not blocking.

## Risks

- Low — comment-only change, but re-verify `bash scripts/run-hook-tests.sh` stays green
  since it touches files with self-tests, to catch an accidental syntax slip.

## Updates

### 2026-08-28

- Filed from the todo-researcher's findings during implementation of
  `todos/archive/P1-2026-08-17-cmd-position-anchor-boundary-gaps.md`, per the
  Deferred Item Todos policy (Low severity, out of that todo's Scope Contract).
