#!/usr/bin/env bash
# Tests for eslint-fix.sh — run from project root.
# Hermetic: stubs `npx` on PATH so no real eslint/network runs.
set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/eslint-fix.sh"
PASS=0; FAIL=0

# Derived from $HOOK, not from cwd, so this test's notion of the tree is the SAME one the
# hook cds into (eslint-fix.sh:38). SUBDIR is a real repo directory rather than a mktemp -d:
# it is the scenario the hook's own comment describes (agent cwd inside a package dir), it
# needs no cleanup, and it sidesteps macOS's logical-vs-physical $PWD split under /var.
# `npx` is stubbed, so nothing under SUBDIR needs to exist.
ROOT="$(cd "$(dirname "$HOOK")/../.." && pwd)"
SUBDIR="$ROOT/server"

# Stub `npx eslint ...`. mode=clean → exit 0 silently; mode=unfixable → print a
# lint error and exit 1 (what `eslint --fix` does when problems can't be fixed);
# mode=echoargs → echo the argv and exit 1, so a test can assert on what eslint ACTUALLY
# receives (the hook only surfaces its captured output on a non-zero exit).
make_stub_npx() {
  local mode="$1" dir
  dir=$(mktemp -d)
  cat > "$dir/npx" <<EOF
#!/usr/bin/env bash
[ "\$1" = "eslint" ] || exit 0
case "$mode" in
  clean)     exit 0 ;;
  unfixable) echo "  12:5  error  'foo' is assigned a value but never used  no-unused-vars"; exit 1 ;;
  echoargs)  echo "NPX_ARGV: \$*"; exit 1 ;;
esac
EOF
  chmod +x "$dir/npx"
  printf '%s' "$dir"
}

run_hook() {
  local file="$1" mode="${2:-clean}" tool="${3:-Edit}"
  local input stubdir out
  input=$(jq -n --arg f "$file" --arg t "$tool" \
    '{"tool_name":$t,"tool_input":{"file_path":$f}}')
  stubdir=$(make_stub_npx "$mode")
  out=$(printf '%s' "$input" | PATH="$stubdir:$PATH" bash "$HOOK" 2>/dev/null)
  rm -rf "$stubdir"
  printf '%s' "$out"
}

# Like run_hook, but with an explicit cwd — the only way to observe the relative-path pin.
# The `cd` lives inside the command substitution, so the caller's cwd is untouched (the
# suite runner invokes every test from the project root). $HOOK and $stubdir are already
# absolute, so the cd cannot break either.
run_hook_in_dir() { # $1=cwd  $2=file_path  $3=mode
  local dir="$1" file="$2" mode="$3"
  local input stubdir out
  input=$(jq -n --arg f "$file" '{"tool_name":"Edit","tool_input":{"file_path":$f}}')
  stubdir=$(make_stub_npx "$mode")
  out=$(cd "$dir" && printf '%s' "$input" | PATH="$stubdir:$PATH" bash "$HOOK" 2>/dev/null)
  rm -rf "$stubdir"
  printf '%s' "$out"
}

# `--` before the needle is load-bearing: a needle starting with `-` (e.g. an eslint flag)
# is otherwise parsed as a grep option, and the resulting usage error reads as "no match" —
# a silently vacuous assertion.
assert_contains() {
  local name="$1" needle="$2" out="$3"
  if grep -qF -- "$needle" <<<"$out"; then
    echo "PASS: $name"; PASS=$((PASS+1))
  else
    echo "FAIL: $name (expected substring: $needle)"
    printf '  got: %s\n' "$(printf '%s' "$out" | head -3)"
    FAIL=$((FAIL+1))
  fi
}

assert_not_contains() {
  local name="$1" needle="$2" out="$3"
  if grep -qF -- "$needle" <<<"$out"; then
    echo "FAIL: $name (unexpected substring: $needle)"
    printf '  got: %s\n' "$(printf '%s' "$out" | head -3)"
    FAIL=$((FAIL+1))
  else
    echo "PASS: $name"; PASS=$((PASS+1))
  fi
}

assert_silent() {
  local name="$1" out="$2"
  if [ -z "$out" ]; then
    echo "PASS: $name"; PASS=$((PASS+1))
  else
    echo "FAIL: $name (expected silence)"
    printf '  got: %s\n' "$(printf '%s' "$out" | head -3)"
    FAIL=$((FAIL+1))
  fi
}

# Clean fix on a TS file → silent (no per-edit noise).
OUT=$(run_hook "server/foo.ts" clean)
assert_silent "clean lint is silent" "$OUT"

# Unfixable problems remain → surface them as actionable context.
OUT=$(run_hook "server/foo.ts" unfixable)
assert_contains "unfixable lint is surfaced" "no-unused-vars" "$OUT"
assert_contains "surfaced message names the file" "server/foo.ts" "$OUT"
assert_contains "surfaced message is PostToolUse context" "additionalContext" "$OUT"

# Non-lintable extension → silent (and never invokes eslint).
OUT=$(run_hook "docs/notes.md" unfixable)
assert_silent "non-lintable extension is silent" "$OUT"

# Empty file_path → silent.
OUT=$(run_hook "" unfixable)
assert_silent "empty file_path is silent" "$OUT"

# Works for Write and MultiEdit tool shapes too (single file_path).
OUT=$(run_hook "client/bar.tsx" unfixable Write)
assert_contains "Write tool shape is handled" "no-unused-vars" "$OUT"
OUT=$(run_hook "client/baz.tsx" unfixable MultiEdit)
assert_contains "MultiEdit tool shape is handled" "no-unused-vars" "$OUT"

# A RELATIVE file_path must be pinned to the hook's ORIGINAL cwd, not to the project root the
# hook cds into (eslint-fix.sh:30). This guards a WRITE path — `eslint --fix` rewrites whatever
# path it is handed — so losing the pin silently rewrites <root>/foo.ts, a DIFFERENT file.
#
# Assert on the STUB'S ECHOED ARGV, not on the hook's message: that message interpolates the
# same $FILE, so it tracks the pin only incidentally, and the suffix-matching needle above
# ("server/foo.ts") matches the absolute and relative forms alike — which is exactly why the
# pin shipped unasserted.
if [ ! -d "$SUBDIR" ]; then
  echo "FAIL: relative-path pin (fixture dir missing: $SUBDIR)"; FAIL=$((FAIL+1))
else
  OUT=$(run_hook_in_dir "$SUBDIR" "foo.ts" echoargs)
  assert_contains "relative file_path is pinned to the invoking cwd" \
    "NPX_ARGV: eslint --no-warn-ignored --fix $SUBDIR/foo.ts" "$OUT"
  # Negative control — the UNPINNED form. Without line 30 the hook hands eslint a bare
  # relative path, which resolves against the project root it cd'd into.
  # The exact-argv assertion ABOVE is the load-bearing one; keep it. This is a second
  # predicate over the same invocation, not an independent run, so it is strictly weaker:
  # it would still pass for a mutant that emitted some OTHER wrong absolute path.
  assert_not_contains "relative file_path is never left unresolved" \
    "--fix foo.ts" "$OUT"
  # The pin's other branch: an absolute path is passed through untouched.
  OUT=$(run_hook_in_dir "$SUBDIR" "$ROOT/client/bar.tsx" echoargs)
  assert_contains "absolute file_path is passed through unchanged" \
    "NPX_ARGV: eslint --no-warn-ignored --fix $ROOT/client/bar.tsx" "$OUT"
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
