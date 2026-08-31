#!/usr/bin/env bash
# Run the Maestro regression suite once, then re-run ONLY the flows that
# failed, individually. Replaces the whole-suite retry in the E2E workflow.
#
# Why per-flow: the suite-level retry only passes a job when one whole
# attempt is 8/8. Run 33397038006 went 7/8 on BOTH attempts with a DIFFERENT
# single flow flaking each time — a one-flake-per-attempt rate that a suite
# retry can never absorb (P(clean attempt) ~ (1-p)^8), while a per-flow retry
# only fails the job if the same flow flakes twice in a row.
#
# Contract: exit 0 iff every regression flow passed on its first run or on
# its individual re-run. Each re-run gets the same -e vars and debug-output
# settings as the suite (Maestro suffixes repeat runs of a flow "-2" under
# --flatten-debug-output, so artifacts for both attempts survive).
#
# Single-line-invocable on purpose: reactivecircus/android-emulator-runner
# executes each `script:` line as its own `sh -c`, so the Android job cannot
# host a multi-line retry block — but it can call this script.
set -uo pipefail

USERNAME="${USERNAME:-testuser}"
PASSWORD="${PASSWORD:-testpass123}"
FLOWS_DIR="e2e"
DEBUG_OUT="e2e/maestro-output"
LOG="$(mktemp -t e2e-suite.XXXXXX)"

# Parse the flow display names from Maestro's per-flow verdict lines, e.g.
#   [Failed] Home - Navigate between tabs (1m 20s) (Assertion is false: ...)
# The name is everything between "[Failed] " and the first " (". ANSI codes
# are stripped defensively (Maestro omits them when stdout is not a TTY).
parse_failed_flows() {
  perl -pe 's/\e\[[0-9;]*m//g' "$1" | perl -ne 'print "$1\n" if /^\s*\[Failed\]\s+(.+?)\s+\(/' | sort -u
}

# Map a flow display name to its YAML file via the `name:` frontmatter.
flow_file_for() {
  # Escape every ERE metacharacter so a future name with parens/pipes/etc.
  # still maps (today's 15 names contain only spaces and hyphens).
  # shellcheck disable=SC2016  # the $ inside the sed class is a literal, not an expansion
  grep -l -E "^name: \"?$(printf '%s' "$1" | sed 's/[][\.*^$()+?{}|]/\\&/g')\"?\s*$" "$FLOWS_DIR"/flows/*/*.yaml 2>/dev/null | head -1
}

if [ "${1:-}" = "--parse-only" ]; then
  # Test seam: `scripts/ci/e2e-with-flow-retry.sh --parse-only <log>` prints
  # the failed flow names and their resolved files without running anything.
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    printf '%s => %s\n' "$name" "$(flow_file_for "$name")"
  done < <(parse_failed_flows "$2")
  exit 0
fi

echo "▶ regression suite (attempt 1)"
npm run e2e:regression 2>&1 | tee "$LOG"
suite_status=${PIPESTATUS[0]}
if [ "$suite_status" -eq 0 ]; then
  echo "✔ suite green on first run"
  exit 0
fi

# NOTE: no `mapfile` — the iOS job runs this under macOS's default bash 3.2,
# which lacks it (same constraint as scripts/preflight.sh). Read loop instead.
failed=()
while IFS= read -r name; do
  [ -n "$name" ] && failed+=("$name")
done < <(parse_failed_flows "$LOG")
if [ "${#failed[@]}" -eq 0 ]; then
  echo "::error::suite exited $suite_status but no [Failed] flow lines were found — infrastructure failure (driver/device), not a flow flake; nothing to retry"
  exit "$suite_status"
fi

echo "::warning::${#failed[@]} flow(s) failed on the first run — re-running each individually: ${failed[*]}"
rerun_status=0
for name in "${failed[@]}"; do
  file="$(flow_file_for "$name")"
  if [ -z "$file" ]; then
    echo "::error::could not map failed flow '$name' to a file under $FLOWS_DIR/flows — treat as failed"
    rerun_status=1
    continue
  fi
  echo "▶ re-running: $name ($file)"
  if maestro test -e "USERNAME=$USERNAME" -e "PASSWORD=$PASSWORD" \
      --debug-output "$DEBUG_OUT" --flatten-debug-output "$file"; then
    echo "✔ passed on re-run: $name"
  else
    echo "::error::failed twice: $name ($file)"
    rerun_status=1
  fi
done
exit "$rerun_status"
