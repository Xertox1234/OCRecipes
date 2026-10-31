#!/usr/bin/env bash
# Tests scripts/preflight.sh --fast runs the cheap CI checks that used to be CI-only
# (harness diagnosis 2026-10-30, N2: 6 of 16 sampled PRs moved their head after review
# for a CI-only catch — React Compiler bailouts, colours, accessibility, a whole-repo
# lint after an eslint dependency bump, the contract-coverage guard test).
# Each check is gated on the files it covers, so a push only pays for what it touched:
#   - client/**/*.tsx           → accessibility, hardcoded colours, BottomSheet BackHandler
#   - client/** source (no tests) → React Compiler bailout ratchet (~7s, whole tree)
#   - client/components/**/__tests__/*.test.tsx → jsdom pragma
#   - server/storage/*.ts       → IDOR storage check
#   - docs/solutions/**/*.md    → solution frontmatter contract
#   - changed .js/.css/.json    → prettier --check on those files (TS is already
#                                 format-gated by eslint's prettier/prettier rule)
#   - any changed TS            → the repo-walk guard tests (never "related" to a file)
#   - eslint config / eslint deps changed → whole-repo `npm run lint`
#   - prettier version / .prettierignore changed → whole-repo `npm run check:format`
# DRY_RUN so every step is echoed (`▶ <cmd>`) not executed; assertions grep that echo.
set -uo pipefail
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
SCRIPT="$(cd "$(dirname "$0")/../.." && pwd)/scripts/preflight.sh"
PASS=0; FAIL=0
BIN=$(mktemp -d); trap 'rm -rf "$BIN"' EXIT
printf '#!/usr/bin/env bash\nexit 0\n' > "$BIN/pg_isready"; chmod +x "$BIN/pg_isready"

# $1 = path to change in commit B; $2 = file content (default: a TS export)
dry_out() {
  local d; d=$(mktemp -d)
  git -C "$d" init -q
  printf '{\n  "devDependencies": {\n    "eslint": "^9.25.0"\n  }\n}\n' > "$d/package.json"
  git -C "$d" add package.json
  git -C "$d" -c user.email=t@t -c user.name=t commit -q -m A
  mkdir -p "$d/$(dirname "$1")"
  printf '%s\n' "${2:-export const x = 1}" > "$d/$1"
  git -C "$d" add "$1"
  git -C "$d" -c user.email=t@t -c user.name=t commit -q -m B
  ( cd "$d" && PATH="$BIN:$PATH" PREFLIGHT_DRY_RUN=1 PREFLIGHT_STAMP_FILE="$d/.stamp" bash "$SCRIPT" --fast 2>&1 )
  rm -rf "$d"
}

has()  { if grep -qE "$3" <<<"$2"; then echo "PASS: $1"; PASS=$((PASS+1)); else echo "FAIL: $1 (missing /$3/)"; FAIL=$((FAIL+1)); fi; }
lacks() { if grep -qE "$3" <<<"$2"; then echo "FAIL: $1 (unexpected /$3/)"; FAIL=$((FAIL+1)); else echo "PASS: $1"; PASS=$((PASS+1)); fi; }

O=$(dry_out client/components/Foo.tsx)
has   "client tsx → accessibility"       "$O" 'check-accessibility\.js'
has   "client tsx → colours"             "$O" 'check-hardcoded-colors\.js'
has   "client tsx → backhandler"         "$O" 'check-bottomsheet-backhandler\.js'
has   "client tsx → bailout ratchet"     "$O" 'check-react-compiler-bailouts\.js'
has   "client tsx → walk guards"         "$O" 'vitest run .*contract-coverage-guard\.test\.ts'
lacks "client tsx → no IDOR"             "$O" 'check-idor-storage\.js'
lacks "client tsx → no whole-repo lint"  "$O" '▶ npm run lint$'
lacks "client tsx → no prettier step (eslint covers TS)" "$O" 'prettier --check'

O=$(dry_out client/hooks/useFoo.ts)
has   "client hook .ts → bailout ratchet" "$O" 'check-react-compiler-bailouts\.js'
lacks "client hook .ts → no accessibility" "$O" 'check-accessibility\.js'

O=$(dry_out client/components/__tests__/Foo.test.tsx)
has   "component test → jsdom pragma"    "$O" 'check-jsdom-pragma\.js'
lacks "component test → no bailout ratchet" "$O" 'check-react-compiler-bailouts\.js'

O=$(dry_out server/storage/foo.ts)
has   "storage → IDOR"                   "$O" 'check-idor-storage\.js'
lacks "storage → no accessibility"       "$O" 'check-accessibility\.js'
lacks "storage → no bailout ratchet"     "$O" 'check-react-compiler-bailouts\.js'

O=$(dry_out note.md hello)
lacks "docs only → no pattern checks"    "$O" 'check-(accessibility|hardcoded-colors|idor-storage|jsdom-pragma|react-compiler-bailouts)'
lacks "docs only → no walk guards"       "$O" 'contract-coverage-guard'

O=$(dry_out docs/solutions/x/foo.md hello)
has   "solution doc → frontmatter check" "$O" 'check-solution-frontmatter\.js'

O=$(dry_out app.json '{"a": 1}')
has   "json → prettier on that file"     "$O" 'prettier --check app\.json'

O=$(dry_out eslint.config.js 'module.exports = [];')
has   "eslint config → whole-repo lint"  "$O" '▶ npm run lint$'

O=$(dry_out package.json $'{\n  "devDependencies": {\n    "eslint": "^9.26.0"\n  }\n}')
has   "eslint dep bump → whole-repo lint" "$O" '▶ npm run lint$'

O=$(dry_out package.json $'{\n  "scripts": { "x": "y" },\n  "devDependencies": {\n    "eslint": "^9.25.0"\n  }\n}')
lacks "unrelated package.json edit → no whole-repo lint" "$O" '▶ npm run lint$'

O=$(dry_out .prettierignore 'dist/')
has   ".prettierignore → whole-repo format" "$O" '▶ npm run check:format$'

echo; echo "Results: $PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]
