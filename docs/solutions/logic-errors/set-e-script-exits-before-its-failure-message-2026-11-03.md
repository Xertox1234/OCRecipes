---
title: Under set -e a script exits before its own failure message — `status=$?` after a failing command and a missing tool inside `$(… | head)` are both dead code
track: bug
category: logic-errors
module: shared
severity: medium
tags: [harness, testing, bash, shell, errexit, set-e, pipefail, silent-failure]
applies_to: ["scripts/**/*.sh", "e2e/**/*.sh", ".claude/hooks/**/*.sh"]
symptoms: ['A wrapper prints its "Report: <path>" or summary line after a passing run but nothing after a failing one', 'A script that should say "tool X not found" exits 127 (or 1) with no output at all', 'The failure path that most needs a message is the one that never prints it']
created: '2026-11-03'
---

# Under set -e a script exits before its own failure message — `status=$?` after a failing command and a missing tool inside `$(… | head)` are both dead code

## Problem

`e2e/device/run-ios.sh` (#1710) runs under `set -euo pipefail` and had two failure paths that could never run. The code-reviewer caught both, and each was reproduced under bash.

1. **The status capture after the main command:**

   ```bash
   "$RUNNER" … test --output "$OUT" "${FLOWS[@]}"
   status=$?
   echo "Report: $OUT"     # never reached when the run fails
   exit $status
   ```

   When the runner exits non-zero, `set -e` ends the script on that line. `status=$?` and the report path never run, and the report path is the line a failed run needs most. The exit code still propagates, so the script looks correct when only its exit status is checked.

2. **A missing tool inside a command substitution with a pipe:**

   ```bash
   DEVICE="$(idevice_id -l 2>/dev/null | head -1)"
   [ -n "$DEVICE" ] || { echo "No iPhone visible …"; exit 1; }
   ```

   With `idevice_id` not installed, `pipefail` makes the pipeline fail with 127. The assignment takes that status, and `set -e` exits silently, because `2>/dev/null` also swallowed "command not found". The helpful message on the next line never runs.

## Symptoms

- A passing run prints the summary or report line and a failing run prints nothing, though the exit code is right.
- A script exits 127 with no output on a machine that lacks one of its tools.

## Root Cause

`set -e` exits on the first simple command that fails, and an assignment's status is the status of its command substitution. Anything written after a command "to handle its failure" is unreachable unless the failure is consumed on the same line. `pipefail` widens this: a pipe ending in `head` no longer masks a failing producer.

(This is the reverse of [command-substitution-unsets-errexit](command-substitution-unsets-errexit-swallowing-failures-2026-07-09.md). That doc covers errexit being *off inside* `$(…)`. Here the substitution's failure is *seen* by the outer assignment, and it kills the script.)

## Solution

Consume the failure on the same line, and check a tool exists before calling it inside `$(…)`:

```bash
status=0
"$RUNNER" … test --output "$OUT" "${FLOWS[@]}" || status=$?
echo "Report: $OUT"
exit $status

command -v idevice_id >/dev/null ||
  { echo "idevice_id not found (brew install libimobiledevice)" >&2; exit 1; }
DEVICE="$(idevice_id -l 2>/dev/null | head -1 || true)"
```

These were verified on the device. A must-fail flow exits 1 and prints the report path, a passing flow exits 0, and with `PATH` stripped of `idevice_id` the script prints the install hint.

## Prevention

In review, read every line that follows a fallible command in a `set -e` script and ask whether that line can run after the command fails. A `status=$?`, cleanup or message on the next line is dead code unless the command ends with `|| …`. To verify, force the failure. One example: `bash -c 'set -euo pipefail; f(){ false; }; f; status=$?; echo reached'` prints nothing.

## Related Files

- `e2e/device/run-ios.sh` — both fixes (#1710)

## See Also

- [command-substitution-unsets-errexit-swallowing-failures](command-substitution-unsets-errexit-swallowing-failures-2026-07-09.md) — the opposite failure mode: errexit off *inside* `$(…)`
- [pipefail-echo-grep-condition-fails-open-via-sigpipe](pipefail-echo-grep-condition-fails-open-via-sigpipe-2026-06-27.md) — another pipefail trap with `| head` / `| grep -q`
- [bash-errexit-suspended-for-whole-function-under-if-not](bash-errexit-suspended-for-whole-function-under-if-not-2026-07-06.md)
