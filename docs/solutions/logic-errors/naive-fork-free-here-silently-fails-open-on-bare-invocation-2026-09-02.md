---
title: "A naive fork-free replacement for HERE=\"$(cd \"$(dirname \"${BASH_SOURCE[0]}\")\" && pwd)\" silently fails open on a bare-filename hook invocation"
track: bug
category: logic-errors
tags: [harness, bash, hooks, security, fail-open, performance, parameter-expansion]
module: shared
applies_to: [".claude/hooks/*.sh"]
symptoms: ["A security-gate hook that DENIES correctly when invoked with a qualified path (`bash .claude/hooks/x.sh`, `bash /abs/path/x.sh`) silently allows everything when invoked by bare filename from its own directory (`cd .claude/hooks && bash x.sh`)", "`bash -x` on the bare-filename invocation shows `HERE=<hookname>.sh` instead of `HERE=.`", "A `. \"$HERE/lib/...\"` source line fails with no visible error (redirected to /dev/null) and the hook takes its lib-unsourceable fallback branch, or exits silently if it has none", "The bug is invisible in every existing test, because every test harness and every real `.claude/settings.json` registration invokes hooks by an absolute or slash-qualified path"]
created: 2026-09-02
severity: high
---

# A naive fork-free replacement for the HERE=$(cd $(dirname ...) && pwd) idiom silently fails open on a bare-filename invocation

## Problem

`HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"` is the standard idiom for a script to
locate files relative to its own directory. It is also a `$(...)` subshell — measured at
~1.9ms/call on this machine — which becomes real cost the moment a hook needs to run it on
*every* invocation rather than only after a cheap pre-filter already matched (see
`docs/solutions/conventions/dollar-sigil-not-stripped-by-fastpath-prefilter-2026-08-17.md`
for the sibling "the fast path must run before the lib is sourced" constraint that creates
this exact situation).

The obvious fork-free replacement, bash parameter expansion, is wrong on its own:

```bash
HERE="${BASH_SOURCE[0]%/*}"
```

`%/*` strips the shortest suffix matching `/*` (the last path segment). When
`${BASH_SOURCE[0]}` contains no `/` at all — which happens whenever the script is invoked by
a bare filename with the current directory already equal to the script's own directory, e.g.
`cd .claude/hooks && bash some-hook.sh` — parameter removal has nothing to strip and returns
the **original string unchanged**: `HERE` becomes `"some-hook.sh"`, not `"."`. The subsequent
`. "$HERE/lib/whatever.sh"` then tries to source `"some-hook.sh/lib/whatever.sh"`, which does
not exist, and fails silently (typically redirected `2>/dev/null`).

## Symptoms

See frontmatter. The defining tell: the hook behaves correctly under every invocation shape
used by its own test suite and by production (`.claude/settings.json` registers every hook by
an absolute `$CLAUDE_PROJECT_DIR`-qualified path — see
`docs/solutions/logic-errors/relative-locator-silently-disarms-non-blocking-hook-2026-07-25.md`),
and only breaks under the one shape nothing exercises: a bare filename run from the script's
own directory, which is exactly how a human debugs a hook by hand
(`cd .claude/hooks && bash x.sh < payload.json`).

## Root Cause

`${VAR%/*}` (suffix removal) and `$(dirname ...)` are NOT equivalent on a slash-free input.
`dirname` has a defined answer for a bare filename — it returns `.` — because `dirname` is
specified to do so. Parameter-expansion suffix removal has no such special case: it is a pure
string operation, and "remove the shortest match of `/*`" on a string containing no `/`
removes nothing. The naive port assumes the two are interchangeable path-manipulation
primitives; they only agree when the input already contains at least one `/`.

Whether this becomes a **fail-open** (as opposed to a merely-broken script) depends entirely
on how the caller handles the resulting source failure — and every hook in this codebase
already treats "the lib is unsourceable" as an explicit, expected failure mode with its own
handling (fail-closed for a blocking gate, fail-silent for an advisory one, per each hook's
own documented design). A naive fork-free HERE fix does not create a new bug shape; it just
makes an EXISTING, already-handled failure mode ("lib unsourceable") trigger under a NEW,
previously-impossible circumstance (bare invocation) that nothing tests for.

## Solution

Guard the no-slash case explicitly:

```bash
case "${BASH_SOURCE[0]}" in */*) HERE="${BASH_SOURCE[0]%/*}" ;; *) HERE=. ;; esac
```

This is fork-free (measured: within noise of the original subshell-free inline baseline, and
~12x cheaper than the subshell form under repeated invocation) and correct for all three
invocation shapes a hook can actually see: bare filename (`HERE=.`), a relative path with a
slash (`HERE=` the directory portion), and an absolute path (`HERE=` the directory portion).

**Verify by executing all three shapes, not by reading the expression.** A `bash -x` trace on
the naive and guarded forms, side by side, is the fastest way to confirm which one a given
edit actually is:

```bash
$ cd .claude/hooks && printf '%s' '{...}' | bash -x some-hook.sh 2>&1 >/dev/null | grep '^+ HERE='
+ HERE=.          # guarded form
+ HERE=some-hook.sh   # naive form — WRONG
```

## Prevention

- **Design the fallback to matter, not just exist.** If a hook already has an established
  fail-closed/fail-silent branch for "lib unsourceable" (most of this codebase's hooks do),
  wire a HERE-computation refactor to fall through into that EXISTING, already-tested branch
  rather than adding a new, unreviewed early-exit. That way a HERE bug degrades performance
  (the cheap pre-filter is skipped) rather than silently changing a security decision — see
  `docs/solutions/logic-errors/relative-locator-silently-disarms-non-blocking-hook-2026-07-25.md`
  for the sibling principle ("crude-but-total beats clever-but-partial on a gate").
- **Add a permanent, executed regression test for the invocation SHAPE, not just the
  command.** A corpus that only varies the payload fed to a hook, never how the hook itself
  is invoked, cannot catch this class of bug (see
  `docs/solutions/conventions/one-axis-at-a-time-corpus-misses-co-occurrence-checks-2026-09-01.md`
  for the general form of "the corpus held a dimension fixed"). Run each hook as a real
  subprocess, bare filename, cwd = its own directory, and assert on the observable trace or
  behaviour — not on the source text of the HERE line.
- When capturing that trace via `$(cmd | grep -q ...)`, use a here-string (`<<<`) instead of a
  pipe: `grep -q` is an early-exiting reader, and piping a multi-line `bash -x` trace into it
  under `set -o pipefail` can SIGPIPE the writer and report a false failure even though the
  match was found — reproduced for real during this fix (see
  `docs/rules/harness.md`'s "Early-exiting readers fail OPEN under pipefail" rule).

## Related Files

- `.claude/hooks/branch-preflight.sh`, `.claude/hooks/commit-verify.sh`,
  `.claude/hooks/core-bare-guard.sh`, `.claude/hooks/drift-detect.sh`,
  `.claude/hooks/drift-detect-update.sh`, `.claude/hooks/guard-outward-cli.sh`,
  `.claude/hooks/pr-preflight-guard.sh` — all 7 use the guarded form.
- `.claude/hooks/lib/fastpath-filter.sh` — the shared helper this HERE idiom now exists to
  reach unconditionally on every Bash tool call.
- `.claude/hooks/test-cmd-detect.sh` — `assert_bare_here` (the "HERE resolution" section),
  the executed, mutation-verified regression test for this exact property.

## See Also

- [relative-locator-silently-disarms-non-blocking-hook](relative-locator-silently-disarms-non-blocking-hook-2026-07-25.md) — the sibling class of bug one layer up (the hook's own *registration* path, not its internal file-location idiom), and the "crude-but-total beats clever-but-partial" principle this fix's fall-through design applies.
- [a fast-path pre-filter's superset proof must be re-verified](../conventions/dollar-sigil-not-stripped-by-fastpath-prefilter-2026-08-17.md) — why the fast path (and therefore this HERE computation) must run before the heavier lib is sourced in the first place.
- [a corpus that varies one axis at a time misses co-occurrence checks](../conventions/one-axis-at-a-time-corpus-misses-co-occurrence-checks-2026-09-01.md) — the general form of "the existing tests held the invocation shape fixed."
- [gate test needs a two-sided negative control](../conventions/gate-test-needs-two-sided-negative-control-2026-07-25.md) — mutation-testing the new regression lock itself.
