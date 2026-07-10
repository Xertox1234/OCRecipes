---
title: A `cmd | grep -q` shell condition under `set -o pipefail` fails open via SIGPIPE
track: bug
category: logic-errors
module: server
severity: medium
tags: [ci, shell, bash, github-actions, pipefail, sigpipe, grep, head, awk, printf, command-substitution, change-detection, testing, flaky-tests]
symptoms: [A self-scoping CI gate green-lights a PR that DID change the guarded files, A change-detection `if cmd | grep -q ...` step takes the wrong branch only on large inputs, 'Works for small PRs, silently fails open for PRs that touch thousands of files', A script under set -euo pipefail dies with exit 141 outside its documented exit-code contract, 'A test assert_contains helper intermittently reports a needle as missing when the captured output DOES contain it, with `printf: write error: Broken pipe` nearby']
applies_to: [.github/workflows/*.yml, .husky/**, scripts/*.sh, .claude/hooks/test-*.sh]
created: '2026-06-27'
last_updated: '2026-07-09'
---

# A `cmd | grep -q` shell condition under `set -o pipefail` fails open via SIGPIPE

## Problem

A self-scoping CI gate decides whether to run by grepping the changed-file list inside an
`if` condition, under `set -euo pipefail`:

```bash
if echo "$CHANGED" | grep -qE '<target-paths>'; then
  echo "run=true"  >> "$GITHUB_OUTPUT"
else
  echo "run=false" >> "$GITHUB_OUTPUT"
fi
```

On a PR with a very large changed-file set, this silently takes the `else` branch **even
when a target file IS present**. A required gate that "self-scopes to success" when
`run=false` then passes green without running its real check — a fail-OPEN, the worst
direction for a fail-closed gate.

## Symptoms

- A required, self-scoping mutation/lint/test gate reports success on a PR that actually
  changed a guarded file, so a regression is never tested.
- The `if cmd | grep -q ...` works in every normal-sized PR and only misbehaves when the
  changed-file list is huge (big refactor, generated files, vendored drop).

## Root Cause

`grep -q` exits 0 on the **first** match and closes its stdin. If `echo` is still writing
(input larger than the ~64 KB pipe buffer), it receives **SIGPIPE** and dies with exit
**141**. `set -o pipefail` makes the pipeline's status the last non-zero exit — 141 — so
the `if` sees a non-zero pipeline and takes the **false** branch, regardless of whether
grep matched. `set -e` does not rescue you: commands in an `if` condition are exempt from
`-e`, so the script keeps running down the wrong path.

Small inputs never trigger it: `echo` writes everything into the pipe buffer and exits 0
before `grep` closes the pipe, so the bug is invisible in normal testing and only fires on
large PRs.

## Solution

Feed `grep` with a **here-string** — no second process, so no SIGPIPE:

```bash
if grep -qE '<target-paths>' <<< "$CHANGED"; then
  echo "run=true"  >> "$GITHUB_OUTPUT"
else
  echo "run=false" >> "$GITHUB_OUTPUT"
fi
```

Verified: the pipe form reproduces the fail-open with a multi-million-line input under
bash; the here-string form does not. Alternatives: `grep -qE ... < <(printf '%s\n'
"$CHANGED")`, or drop `-q` and test `[ -n "$(grep -E ... <<< "$CHANGED")" ]`. The
here-string is the smallest change.

### Variant: consumer-kills-producer pipe inside command substitution (exit 141, fail-LOUD)

The same mechanism has a second face. In a value assignment under `set -euo pipefail`:

```bash
prio="$(sed -n 's/^priority:[[:space:]]*//p' <<< "$fm" | head -n1 | tr ...)"
```

`head -n1` exits after one line; if `sed` is still writing it dies with SIGPIPE and the
pipeline exits **141**. Unlike the `if`-condition form (which is exempt from `-e` and
fails *open*), an assignment is a plain command — the script **aborts with exit 141**,
outside whatever exit-code contract it documents (callers keying on `0/1/2` misread it).
Remediation: one **self-terminating** tool instead of an early-exiting consumer —

```bash
prio="$(awk '/^priority:/{sub(/^priority:[[:space:]]*/,""); print; exit}' <<< "$fm" | tr ...)"
```

`awk ... exit` stops reading on its own, so no downstream consumer ever closes the pipe
on a still-writing producer (`tr` reads to EOF; it never exits early).

### Variant: test assert helpers flake on FOUND needles (2026-07-09)

A third face, seen in `.claude/hooks/test-pg-lab-distill.sh`'s assert helpers under
`set -uo pipefail`:

```bash
assert_contains() { if printf '%s' "$2" | grep -qF -- "$3"; then echo "ok"; else echo "FAIL — missing"; fi; }
```

An assertion whose needle WAS present flaked to `FAIL — missing` roughly 1 run in 6, with
`printf: write error: Broken pipe` printed beside it. Same mechanism, but note the input
was only a few KB — **the trigger threshold is the writer's chunk size, not the ~64 KB pipe
buffer**. bash's *builtin* `printf` flushes through a small stdio buffer (~4 KB chunks), so
`grep -q` can match in the first chunk and close the pipe while a later chunk is still
pending, even for modest strings. The "only huge inputs" intuition from the `echo` form
does not transfer. Perversely, the *earlier and more successful* the match, the likelier
the flake. Fix is the same here-string: `if grep -qF -- "$3" <<<"$2"` — the shell buffers
the whole string before grep runs, so there is no writer left to break.

## Prevention

- Treat **any** `producer | grep -q` (or `| head`, `| sed q`) used as an `if` / `&&` /
  `||` condition under `pipefail` as suspect: the consumer short-circuits, the producer
  takes SIGPIPE, and `pipefail` turns that into a non-zero pipeline. Prefer a here-string.
- The same applies to `| head -n1` in command substitutions — there it fails **loud**
  (exit 141 aborts the script) rather than open. Prefer a single self-terminating
  extractor (`awk '/pat/{print; exit}'`) over pipe-then-truncate.
- For a fail-closed required gate, exercise the condition with a large synthetic input
  (thousands of lines), not just a representative PR — the failure only appears at scale.

## Related Files

- `.github/workflows/mutation-non-excluded.yml` — change-detection step (here-string form)
- `.github/workflows/mutation-goal-safety.yml` — same change-detection pattern, same fix
- `scripts/todo-automerge-guard.sh` — priority extraction (single-awk form of the variant)
- `.claude/hooks/test-*.sh` — all assert helpers use the here-string form since the 2026-07-10 sweep (26 instances across 17 files; the shared copied preamble had propagated the pipe form everywhere)

## See Also

- [mutation target and break threshold selection](../conventions/mutation-target-and-break-threshold-selection-2026-06-27.md) — the self-scoping gate this condition guards
