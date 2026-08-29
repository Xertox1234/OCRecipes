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

**CORRECTED 2026-08-29 — this was NOT a comment-only gap; it was a live bypass, now fixed.**
`branch-preflight.sh`'s lib-unsourceable fail-closed fallback regexes (`GIT_COMMIT_RE`,
`COMPOUND_COMMIT_RE` — hand-rolled, independent of `_CMD_POS_PREFIX`/`_CMD_POS_SUFFIX`)
did not recognize brace/backtick/bang either, and were narrower than the (now-fixed)
primary path. The original framing below ("worth a one-line comment noting the
divergence is deliberate") was wrong on its own terms — the todo's own paragraph a
sentence earlier says "this was already true before the parent todo (the fallback never
shared the shared-lib anchors)," which is organic drift, not a decision, and a `code-reviewer`
pass during PR #874's review round reproduced it live: with the lib made unsourceable
(the `NOLIB` harness `test-branch-preflight.sh`'s Test 10 already uses), a real
detached-HEAD commit written as `{ git commit -m oops; }`, `` `git commit -m oops` ``,
or `! git commit -m oops` was **silently allowed** on `branch-preflight.sh`'s Check 1 — a
BLOCKING, not advisory, gate — where the bare form correctly denied. Per this repo's own
convention (`test-cmd-detect.sh`'s cross-hook fast-path invariant), "a fallback must be a
superset of what the primary matcher reads" — this violated it. **Fixed as part of this
PR's review-repair cycle**: `GIT_COMMIT_RE`/`COMPOUND_COMMIT_RE` now also recognize
`` ` ``/`{`/`!` as valid openers, with a two-sided regression test (`test-branch-preflight.sh`
Test 10b, confirmed RED against the old regex and GREEN against the fix). See AC below.

## Acceptance Criteria

- [ ] `test-guard-outward-cli.sh:402`'s comment updated to describe the current
      `_CMD_POS_SUFFIX` (now ``([[:space:]]|[);&|`{}]|$)``), or reworded to note the
      guard's own `_OUT_POS_SUFFIX` is now narrower than the lib's in the `{`/`}` dimension.

      **State explicitly that this divergence is deliberate and must NOT be synced.**
      Reason (flagged by `security-auditor` during PR #874's review round): the guard's
      `_OUT_POS_SUFFIX` feeds the clause extraction at `guard-outward-cli.sh:567`, the one
      that gates the `--auto` immediate-merge carve-out flag scan. Adding `{`/`}` as
      closers there could truncate that extracted clause before a real `--auto` flag is
      reached — fail-safe direction (loses the carve-out, falls through to deny, not a
      live bypass), but still the wrong edit for whoever reads this comment next. This is
      exactly the "mirror the sibling's character class because they widened together"
      trap this same PR's own solution doc warns against.

- [ ] `test-guard-outward-cli.sh:428`'s comment narrowed to the one delta that remains
      true: prefix keyword-absorption (`then|do|else|elif|time`) is guard-local; brace/
      backtick/bang are no longer guard-local.
- [ ] `guard-outward-cli.sh:23-40` header block's suffix bullet updated to reflect that
      the lib's suffix is now a superset of the guard's own in the `{`/`}` dimension.
- [x] ~~One-line comment added near `branch-preflight.sh`'s `GIT_COMMIT_RE`/
      `COMPOUND_COMMIT_RE` noting the fallback deliberately does not share
      `_CMD_POS_PREFIX`/`_CMD_POS_SUFFIX`'s brace/backtick/bang coverage.~~ **Superseded
      2026-08-29**: this framing was wrong (see corrected Background above) — the gap was
      a real, live bypass, not a decision to document. Fixed instead of commented: both
      fallback regexes now recognize `` ` ``/`{`/`!`, with a two-sided regression test
      (Test 10b in `test-branch-preflight.sh`). Done as part of PR #874's own review-repair
      cycle, ahead of this todo — nothing left to do here for `branch-preflight.sh`.
- [ ] `bash scripts/run-hook-tests.sh` still passes.

## Implementation Notes

**Remaining scope (guard-outward-cli.sh + test-guard-outward-cli.sh) is still pure
comment/prose** — no regex or test-assertion changes needed there. Read the current
`_CMD_POS_PREFIX`/`_CMD_POS_SUFFIX` definitions in `.claude/hooks/lib/cmd-detect.sh`
(and their explanatory comment, which documents the widening) as the source of truth for
what the corrected prose should say. Also carry the "must not sync `_OUT_POS_SUFFIX`"
warning from the AC above into whichever comment ends up nearest `guard-outward-cli.sh`'s
`--auto` clause-extraction call site, not just the one at `test-guard-outward-cli.sh:402`.

`branch-preflight.sh`'s item was NOT comment/prose — see AC above; already done.

## Scope Contract

- **Mechanisms to use:** comment/prose edits only for `guard-outward-cli.sh` /
  `test-guard-outward-cli.sh` — no regex changes, no new test assertions there.
  `branch-preflight.sh` is now DONE (a real regex widening + regression test, not a
  comment — see corrected Background/AC above; this exceeds the original Scope Contract
  deliberately, because the original framing for that file was itself the defect).
- **Files in scope:** `.claude/hooks/guard-outward-cli.sh`,
  `.claude/hooks/test-guard-outward-cli.sh` (remaining); `.claude/hooks/branch-preflight.sh`
  - `.claude/hooks/test-branch-preflight.sh` (done, via PR #874's review-repair).
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

### 2026-08-29

- A `code-reviewer` pass during PR #874's own review round (medium-effort, dispatched
  concurrently with reviews of #871–#875) constructed and ran the exact fallback-path
  bypass this todo's AC #4 had mischaracterized as "deliberate" — proved it silently
  allowed a real detached-HEAD commit through `branch-preflight.sh`'s BLOCKING Check 1.
  Fixed directly on PR #874 rather than merely re-commented: `GIT_COMMIT_RE`/
  `COMPOUND_COMMIT_RE` widened to recognize backtick/`{`/`!`, two-sided regression test
  added (`test-branch-preflight.sh` Test 10b). A `security-auditor` pass on the same PR
  additionally flagged that this todo's original AC #1 wording could mislead a future
  implementer into unsafely syncing `_OUT_POS_SUFFIX` to match — corrected above with an
  explicit must-not-sync warning and the concrete reason (`--auto` carve-out clause
  truncation risk). Remaining scope: the `guard-outward-cli.sh` / `test-guard-outward-cli.sh`
  comment corrections only — unchanged from the original filing, still pure prose.
