---
title: "Extract the 7x copy-pasted two-stage fast-path filter into a shared lib helper"
status: backlog
priority: low
created: 2026-08-16
updated: 2026-08-16
assignee:
labels: [deferred, harness]
github_issue:
---

# Extract the 7x copy-pasted two-stage fast-path filter into a shared lib helper

## Summary

An 18-line, byte-identical (modulo one needle word) two-stage necessary-substring
fast-path filter is hand-copied into 7 separate `.claude/hooks/*.sh` files instead of
factored into one `lib/cmd-detect.sh` helper (e.g. `cmd_fastpath_has <needle> "$CMD"`).

## Background

Surfaced in the `/code-review` of PR #850 (`fix/cmd-words-quoting-bypass`). This PR
itself demonstrates the propagation risk: `cmd_words` already grew a third quote form
(ANSI-C `$'...'`) mid-branch, and the PR's own critical fix (adding a `$`-strip to the
filter) had to be hand-applied identically to all 7 files. Missing one silently reopens
a bypass in that one hook. The only regression-test safety net
(`test-cmd-detect.sh`'s "EVERY hook's necessary-substring fast path must be
quote-tolerant" section) checks the block's textual _presence_
(`grep -q '_T=\${CMD//'`), not its _correctness_ — a hook could satisfy the meta-test
with a subtly wrong copy (e.g. missing one of the substitutions) and still show green.

## Acceptance Criteria

> **Revised 2026-09-01 after measurement — the extraction is viable, but has an
> unstated prerequisite that is the entire cost of the job. See Updates.**

- [ ] **PREREQUISITE (do this first, or the extraction is a net loss).** Replace the
      `HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"` idiom with a fork-free
      equivalent in all 7 hooks. Measured: this subshell is ~1.9 ms and is **the whole**
      added cost of reaching a shared helper — sourcing the lib itself is free. Use
      `case "${BASH_SOURCE[0]}" in */*) HERE="${BASH_SOURCE[0]%/*}" ;; *) HERE=. ;; esac`
      — the `*/*` arm is **load-bearing**: bare `${BASH_SOURCE[0]%/*}` returns the
      filename unchanged when invoked without a slash, the source then fails, and the
      hook `exit 0`s — a silent FAIL-OPEN on a security gate.
- [ ] Shared fast-path filter function (e.g. `cmd_fastpath_has <needle> "$CMD"`)
      implementing the same two-stage (raw glob, then quote/backslash/newline/`$`-stripped
      glob) logic currently duplicated in `branch-preflight.sh`, `commit-verify.sh`,
      `core-bare-guard.sh`, `drift-detect.sh`, `drift-detect-update.sh`,
      `guard-outward-cli.sh`, `pr-preflight-guard.sh`.
      **Not in `lib/cmd-detect.sh`** — a separate small file. The fast path runs before
      `cmd-detect.sh` is sourced in all 7 hooks and several exit without ever sourcing it;
      routing the filter through it makes every Bash tool call parse the 568-line lib.
- [ ] All 7 hooks call the shared helper instead of their own inline copy.
- [ ] Re-benchmark after the change: per-hook cost must be within noise of the current
      inline block (measured baseline: inline 1.65–1.71 ms/call, fork-free shared
      1.65 ms/call, subshell-shared 3.53 ms/call).
- [ ] `test-cmd-detect.sh`'s fast-path enumeration check is strengthened to assert
      correctness (an executed bypass probe per hook), not just textual presence of the
      pattern. **This AC is independent of all the above** — it addresses the stated risk
      (a subtly wrong copy passing the meta-test) by adding a test rather than by moving
      runtime code, and is worth doing on its own even if the extraction is never done.
- [ ] All existing hook self-tests (`scripts/run-hook-tests.sh`) still pass (baseline:
      34 test files, guard suite 248/248).

## Implementation Notes

The perf comment in each hook ("four literal substitutions, not one bracket class —
~1450ms vs ~5.5ms under bash 3.2") must survive the extraction; benchmark the helper
function call overhead itself, since these hooks run on every Bash tool call
(`project_per_bash_hook_overhead` memory: ~60-75ms budget across 9 hooks).

## Scope Contract

- **Mechanisms to use (revised 2026-09-01):** one NEW small file under
  `.claude/hooks/lib/` holding the filter — explicitly **not** `lib/cmd-detect.sh`, for
  the ordering reason in AC2 — plus a fork-free `HERE` idiom in the 7 hooks. The "no new
  files" clause is lifted: reusing `cmd-detect.sh` is the thing measurement ruled out.
- **Files in scope:** the new `.claude/hooks/lib/` filter file, `.claude/hooks/{branch-preflight,commit-verify,core-bare-guard,drift-detect,drift-detect-update,guard-outward-cli,pr-preflight-guard}.sh`, `.claude/hooks/test-cmd-detect.sh`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- The perf-sensitive bash-3.2 constraint means a naive extraction (e.g. an extra
  function-call layer per hook per Bash call) could reintroduce measurable overhead —
  benchmark before/after.

## Updates

### 2026-08-16

- Filed from the PR #850 `/code-review` reuse/efficiency findings.

### 2026-09-01 — re-specced after measurement; still open

Picked this up to execute and stopped to check its premise first. The original AC1
("`lib/cmd-detect.sh` gains a shared fast-path filter function") is wrong, and the reason
generalises past this todo.

**In all 7 hooks the fast-path filter runs BEFORE `lib/cmd-detect.sh` is sourced,** and
that ordering is its entire purpose: exit on a `case` glob without paying for the lib.
Verified by comparing line numbers per hook — fast path at 34/30/42/45/46/380/40, source
at 41/43/47/50/51/394/46. Putting the filter inside the lib inverts the optimisation:
every Bash tool call would parse a 568-line file in 7 hooks instead of exiting on a glob.

Then the more useful half — **where the cost actually is.** Isolating each component
against a bare-bash baseline (400 iterations each):

| Shape                                          | ms/call  |
| ---------------------------------------------- | -------- |
| bare bash (baseline)                           | 1.86     |
| current: inline block, no source               | 1.65     |
| source a 7-line lib, `HERE` hardcoded          | 1.68     |
| **`HERE="$(cd "$(dirname …)" && pwd)"` alone** | **3.80** |
| shared: subshell `HERE` + source               | 3.53     |
| shared: fork-free `HERE` + source              | 1.65     |

**Sourcing is free. The `$(cd …)` subshell is the whole cost** — ~1.9 ms, ~13 ms across 7
hooks on every Bash tool call, against the ~60–75 ms/9-hook budget in the
`project_per_bash_hook_overhead` memory. Shrinking the shared file does not help, because
file size was never the problem. This also means the todo's original Risks note ("an extra
function-call layer could reintroduce overhead") named the wrong mechanism — the function
call is free; the path resolution is not.

So the todo is executable after all, but only with a prerequisite it never stated: convert
the `HERE` idiom to parameter expansion first. That carries its own hazard, found by
running it rather than reading it — bare `${BASH_SOURCE[0]%/*}` returns the filename
unchanged when the script is invoked with no slash in its path, the source then fails, and
the hook exits 0. On these hooks that is a **silent fail-open**. The `*/*` case arm in the
revised AC1 fixes it; verified across relative, bare-name and absolute invocation, with a
negative control confirming the probe does not simply match everything.

Net effect on scope: the job is larger and touches the prologue of 7 security hooks, so
the last AC (strengthen the meta-test) is now called out as independently shippable — it
addresses the stated risk without touching runtime code at all, and is the part worth
doing if this is only ever done in half.
