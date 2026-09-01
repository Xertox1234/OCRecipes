---
title: "guard-outward-cli.sh: avoid forking awk twice on every fast-path hit"
status: done
priority: low
created: 2026-08-16
updated: 2026-09-01
assignee:
labels: [deferred, harness]
github_issue:
---

# guard-outward-cli.sh: avoid forking awk twice on every fast-path hit

## Summary

`BARE=$(... | cmd_bare)` and `WORDS=$(... | cmd_words)` both run unconditionally once
the fast path matches, forking `awk` twice per invocation — but `$BARE` is used only by
the single blank-rendering fallback check further down.

## Background

Surfaced in the `/code-review` of PR #850. This hook runs on every Bash tool call and
its fast path matches on the bare substrings `npm`/`gh`/`eas`/`railway`/`yarn` — a large
fraction of ordinary dev commands (`npm test`, `npm install`, `git log --grep npm`, any
command piped through `gh`). Each of those pays two `awk` subprocess forks instead of
one, on exactly the hot path `project_per_bash_hook_overhead` (memory) flags as
budget-constrained (~60-75ms/9 hooks).

## Acceptance Criteria

- [ ] `$BARE` is computed lazily (only when the blank-rendering fallback check actually
      needs it) or the two computations are otherwise collapsed to one `awk` fork.
- [ ] The blank-rendering fallback's behavior (degrade to the crude smell test when
      $BARE or $WORDS renders blank from a non-blank $CMD) is unchanged — existing
      `test-guard-outward-cli.sh` assertions for this stay green.
- [ ] Benchmark the fast-path hot path before/after (per-invocation wall time on a
      representative command).

## Implementation Notes

`cmd_bare` and `cmd_words` share the same awk backend/quote-scan logic — a single-pass
awk program emitting BOTH renderings (rather than two separate `awk` invocations) may be
the cleanest fix, but changes the shared `lib/cmd-detect.sh` surface other hooks also
call — verify no other caller depends on `cmd_bare`/`cmd_words` being independently
invocable.

## Scope Contract

- **Mechanisms to use:** either lazy evaluation in `guard-outward-cli.sh` or a combined
  single-awk-pass helper in `lib/cmd-detect.sh`.
- **Files in scope:** `.claude/hooks/guard-outward-cli.sh`, possibly `.claude/hooks/lib/cmd-detect.sh`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- A combined single-pass rendering changes a shared lib function other hooks
  (`pr-verify.sh` via `cmd_gh_pr_write_subcommand`/`cmd_gh_pr_ref`, which read
  `cmd_bare` only) also call — must not change their output.

## Updates

### 2026-08-16

- Filed from the PR #850 `/code-review` reuse/efficiency findings.

### 2026-09-01 — premise CONFIRMED, both remedies problematic; recommend CLOSE

Investigated to execute. The performance claim is **real** — measured, 200 iterations:

| Shape                           | ms/call | delta     |
| ------------------------------- | ------- | --------- |
| source lib, no rendering        | 2.25    | —         |
| + `cmd_bare` only               | 4.36    | +2.11     |
| + `cmd_words` as well (current) | 7.29    | **+2.93** |

So the second fork costs ~2.9 ms on every fast-path hit, and the fast path matches the
bare substrings `npm`/`gh`/`eas`/`railway`/`yarn` — i.e. `npm test`, `npm install`,
`npm run …`, a large share of ordinary dev commands. Against the ~60–75 ms/9-hook budget
in `project_per_bash_hook_overhead` that is roughly 4%. The todo was right about the cost.

It is the **remedies** that do not survive contact with the file.

**AC option A — "compute `$BARE` lazily" — is impossible.** `$BARE` is consumed
unconditionally 15 lines after it is assigned, by the blank-rendering fail-closed detector
(`guard-outward-cli.sh`, the `[[ ! "$BARE" =~ [^[:space:]] ]]` branch). There is no later,
conditional consumer to defer to. The code says so in a comment written specifically to
stop this edit: _"Nothing else reads `$BARE` — do not delete it without deleting that
detector's `$BARE` half too."_ Making it lazy means deleting half of a two-sided detector
whose job is to notice that the awk backend has silently stopped working — the exact
failure that made `eas update`, `npm publish` and a merge command all ALLOW in review
round 3, no crafting needed.

Nor can the detector be satisfied more cheaply. It reads only `$BARE`'s _blankness_, never
its value — but blankness is not derivable from `$WORDS`, because the divergence **is** the
signal: a wholly-quoted command blanks under `cmd_bare` while `cmd_words` renders it as one
word, and that difference is what routes it to the crude smell test.

**AC option B — one awk pass emitting both renderings — is viable but poorly priced.** It
changes the shared rendering primitive in `lib/cmd-detect.sh` that `pr-preflight-guard.sh`,
`branch-preflight.sh` and `pr-verify.sh` also consume. Per `MEMORY.md`, that file is the
single most defect-prone surface in the harness: six review rounds on these guards produced
six CRITICALs, and the guard-coverage sweep found seven live defects. Spending that blast
radius to recover ~2.9 ms on a P3 is the wrong trade.

**Recommendation: close as won't-fix**, keeping this record so the measurement is not
re-derived. Reopen only if hook overhead becomes a real complaint, in which case option B
is the one to cost out — and the ~1.9 ms `$(cd …)` subshell documented in
`P3-2026-08-16-extract-shared-fastpath-filter-helper.md` is a cheaper, lower-risk saving to
take first. Left `status: backlog` pending the owner's call rather than self-closed.

### 2026-09-01 — CLOSED (won't fix)

Owner accepted the recommendation above. Closed as won't-fix, not as implemented: the
analysis and measurements in the preceding entry are the deliverable, so the cost is not
re-derived if this is ever reconsidered. (`todos/README.md` has no `wontfix` status; `done`
is the only terminal value.)
