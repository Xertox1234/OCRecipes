#!/usr/bin/env bash
# Tests for eslint-fix.sh — run from project root.
# Hermetic: stubs `npx` on PATH so no real eslint/network runs.
set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/eslint-fix.sh"
PASS=0; FAIL=0

# Stub `npx eslint ...`. mode=clean → exit 0 silently; mode=unfixable → print a
# lint error and exit 1 (what `eslint --fix` does when problems can't be fixed).
make_stub_npx() {
  local mode="$1" dir
  dir=$(mktemp -d)
  cat > "$dir/npx" <<EOF
#!/usr/bin/env bash
[ "\$1" = "eslint" ] || exit 0
case "$mode" in
  clean)     exit 0 ;;
  unfixable) echo "  12:5  error  'foo' is assigned a value but never used  no-unused-vars"; exit 1 ;;
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

assert_contains() {
  local name="$1" needle="$2" out="$3"
  if grep -qF "$needle" <<<"$out"; then
    echo "PASS: $name"; PASS=$((PASS+1))
  else
    echo "FAIL: $name (expected substring: $needle)"
    printf '  got: %s\n' "$(printf '%s' "$out" | head -3)"
    FAIL=$((FAIL+1))
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

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
