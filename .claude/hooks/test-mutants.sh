#!/usr/bin/env bash
# Self-test for .claude/hooks/lib/mutants.sh (spec 2026-09-27 §7.4).
# Builds a toy project root (toy.sh + test-toy.sh) and drives run_mutants through every
# verdict: killed, survived, unapplied, missing target, skipped baseline, failing baseline,
# and the MUTANTS_INNER re-entry guard.
set -uo pipefail
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$HOOK_DIR/lib/mutants.sh"
FAIL=0
assert_eq()       { if [ "$2" = "$3" ]; then echo "ok: $1"; else echo "FAIL: $1 — expected [$3], got [$2]"; FAIL=1; fi; }
assert_contains() { if grep -qF -- "$3" <<<"$2"; then echo "ok: $1"; else echo "FAIL: $1 — missing [$3] in: $2"; FAIL=1; fi; }

FX=$(mktemp -d "${TMPDIR:-/tmp}/mutants-selftest-XXXXXX")
trap 'rm -rf "$FX"' EXIT
mkdir -p "$FX/.claude/hooks"
cat > "$FX/.claude/hooks/toy.sh" <<'EOF'
#!/usr/bin/env bash
# toy: add one
echo $(( $1 + 1 ))
EOF
cat > "$FX/.claude/hooks/test-toy.sh" <<'EOF'
#!/usr/bin/env bash
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -n "${TOY_SKIP:-}" ] && { echo "skip: toy skip requested"; exit 0; }
[ -n "${TOY_BROKEN:-}" ] && exit 1
[ "$(bash "$HERE/toy.sh" 1)" = "2" ] || exit 1
exit 0
EOF

run() { ( . "$LIB"; eval "$1"; run_mutants "$FX" ".claude/hooks/test-toy.sh" ) 2>&1; }

OUT=$(run 'mutant "plus two" ".claude/hooks/toy.sh" "s/\\+ 1/+ 2/"'); RC=$?
assert_eq "killed mutant → rc 0" "$RC" "0"
assert_contains "killed mutant → counts" "$OUT" "mutants: killed 1 / applied 1 / declared 1"

OUT=$(run 'mutant "comment only" ".claude/hooks/toy.sh" "s/# toy/# yot/"'); RC=$?
assert_eq "surviving mutant → rc 1" "$RC" "1"
assert_contains "surviving mutant → named" "$OUT" "MUTANT SURVIVED: comment only"

OUT=$(run 'mutant "inert" ".claude/hooks/toy.sh" "s/NOMATCH_XYZ/x/"'); RC=$?
assert_eq "unapplied mutant → rc 1" "$RC" "1"
assert_contains "unapplied mutant → named" "$OUT" "MUTANT UNAPPLIED: inert"

OUT=$(run 'mutant "no file" ".claude/hooks/nope.sh" "s/a/b/"'); RC=$?
assert_eq "missing target → rc 1" "$RC" "1"
assert_contains "missing target → named" "$OUT" "MUTANT UNAPPLIED (no such file): no file"

OUT=$(TOY_SKIP=1 run 'mutant "plus two" ".claude/hooks/toy.sh" "s/\\+ 1/+ 2/"'); RC=$?
assert_eq "skipping baseline → rc 0" "$RC" "0"
assert_contains "skipping baseline → counted, not silent" "$OUT" "mutants: SKIPPED (baseline skipped live cases) — declared 1"

OUT=$(TOY_BROKEN=1 run 'mutant "plus two" ".claude/hooks/toy.sh" "s/\\+ 1/+ 2/"'); RC=$?
assert_eq "failing baseline → rc 1" "$RC" "1"
assert_contains "failing baseline → named" "$OUT" "unmutated baseline copy failed"

OUT=$(MUTANTS_INNER=1 run 'mutant "plus two" ".claude/hooks/toy.sh" "s/\\+ 1/+ 2/"'); RC=$?
assert_eq "MUTANTS_INNER → rc 0" "$RC" "0"
assert_eq "MUTANTS_INNER → silent" "$OUT" ""

OUT=$(run ':'); RC=$?
assert_eq "no mutants declared → rc 1" "$RC" "1"

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
