#!/usr/bin/env bash
# Integration test for scripts/pg-lab/symbol-graph.ts (--rebuild) and
# scripts/pg-lab/symbol-graph.sh (canned queries). Run by CI (Lint · Types · Patterns job)
# via scripts/run-hook-tests.sh's `.claude/hooks/test-*.sh` glob.
#
# That job has NO postgres service (only the Tests/Coverage jobs do — see
# .github/workflows/ci.yml, and even those never provision `ocrecipes_lab`, only
# `ocrecipes_test`), so this test must SKIP cleanly, never fail, when Postgres is
# unreachable — same fail-silent-in-CI contract as
# .claude/hooks/test-pg-lab-codify-neardup.sh. Locally (or in any environment with a live
# Postgres) it does a real --rebuild + canned-query round-trip against a throwaway database
# and a fixture mini-project, via symbol-graph.ts's `--project` test seam (mirrors
# codify-neardup.sh's PG_LAB_SOLUTIONS_DIR seam).
set -uo pipefail
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$HOOK_DIR/../.." && pwd)"
TS_SCRIPT="$PROJECT_ROOT/scripts/pg-lab/symbol-graph.ts"
SH_SCRIPT="$PROJECT_ROOT/scripts/pg-lab/symbol-graph.sh"
INIT="$PROJECT_ROOT/scripts/pg-lab/init.sh"
FAIL=0
assert_exit0()      { if [ "$2" -eq 0 ]; then echo "ok: $1"; else echo "FAIL: $1 — expected exit 0, got $2"; FAIL=1; fi; }
assert_nonzero()    { if [ "$2" -ne 0 ]; then echo "ok: $1"; else echo "FAIL: $1 — expected non-zero exit, got 0"; FAIL=1; fi; }
assert_contains()   { if grep -qF -- "$3" <<<"$2"; then echo "ok: $1"; else echo "FAIL: $1 — missing: $3"; FAIL=1; fi; }
assert_not_contains() { if grep -qF -- "$3" <<<"$2"; then echo "FAIL: $1 — should NOT contain: $3"; FAIL=1; else echo "ok: $1"; fi; }
assert_eq()         { if [ "$2" = "$3" ]; then echo "ok: $1"; else echo "FAIL: $1 — expected $3, got $2"; FAIL=1; fi; }

command -v psql >/dev/null 2>&1 || { echo "skip: psql not installed"; exit 0; }
command -v npx >/dev/null 2>&1 || { echo "skip: npx not installed"; exit 0; }

# Hard safety rail, checked before any live DB is needed: LAB_DATABASE_URL resolving to a
# real app database must be refused loudly by BOTH scripts.
REBUILD_ERR=$(cd "$PROJECT_ROOT" && LAB_DATABASE_URL="postgresql://localhost/nutricam" npx tsx "$TS_SCRIPT" --rebuild --project "$PROJECT_ROOT/tsconfig.json" 2>&1 1>/dev/null); REBUILD_RC=$?
assert_nonzero "symbol-graph.ts refuses LAB_DATABASE_URL=nutricam" "$REBUILD_RC"
assert_contains "symbol-graph.ts refusal names nutricam" "$REBUILD_ERR" "nutricam"

SH_ERR=$(LAB_DATABASE_URL="postgresql://localhost/nutricam" bash "$SH_SCRIPT" cycles 2>&1 1>/dev/null); SH_RC=$?
assert_nonzero "symbol-graph.sh refuses LAB_DATABASE_URL=nutricam" "$SH_RC"
assert_contains "symbol-graph.sh refusal names nutricam" "$SH_ERR" "nutricam"

# The rest needs a live local Postgres to create a throwaway test DB. Skip (not fail) when
# there is none.
psql -X -q -d postgres -c 'SELECT 1' >/dev/null 2>&1 || { echo "skip: no local Postgres reachable"; exit 0; }

TEST_DB="pg_lab_symbol_graph_test_$$"
TEST_URL="postgresql://localhost/$TEST_DB"
FIX=""
cleanup() {
  psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$TEST_DB\"" >/dev/null 2>&1
  [ -z "$FIX" ] || rm -rf "$FIX"
}
trap cleanup EXIT

LAB_DATABASE_URL="$TEST_URL" bash "$INIT" >/dev/null 2>&1
assert_exit0 "init.sh creates the throwaway DB" "$?"

# Fixture mini-project: an alias-resolved cycle (a <-> b via @fixture/*), a genuinely dead
# export (dead.ts's unusedHelper, still dead even after a dynamic import of its module), a
# dynamic import()/alias edge (dynamic.ts), a layering violation (server/routes importing
# server/storage/internal.ts directly via a NAMESPACE import — this also exercises the
# expensive pass-2 reference count, since a namespace import contributes nothing to the
# cheap pass-1 count, mirroring server/storage/index.ts's real pattern in this repo), a
# NAMED barrel re-export of an otherwise-unimported export (barrel.ts/reexport-only.ts --
# the barrel's own `export {...} from` specifier must not itself count as a reference), and
# a plain .js entrypoint importing into the graph (entry.js -- mirrors client/index.js
# being invisible to blast/cycles before symbol-graph.ts's loadProject glob fix).
#
# "allowJs": true + the "**/*.js" include entry are needed for THIS fixture's project load
# to pick up entry.js at all -- unlike symbol-graph.ts's production loadProject (which adds
# client/index.js via an explicit addSourceFilesAtPaths entry, working without allowJs),
# this fixture always takes ts-morph's default auto-add-from-tsconfig path (its tsconfig is
# never DEFAULT_TSCONFIG), which silently excludes .js files from `include` unless allowJs
# is set.
FIX=$(mktemp -d)
mkdir -p "$FIX/server/routes" "$FIX/server/storage"

cat > "$FIX/tsconfig.json" <<'JSON'
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2020",
    "module": "commonjs",
    "moduleResolution": "node",
    "skipLibCheck": true,
    "allowJs": true,
    "baseUrl": ".",
    "paths": { "@fixture/*": ["./*"] }
  },
  "include": ["**/*.ts", "**/*.js"]
}
JSON

cat > "$FIX/a.ts" <<'TS'
import { valueFromB } from "@fixture/b";
export function valueFromA(): number {
  return valueFromB() + 1;
}
TS

cat > "$FIX/b.ts" <<'TS'
import { valueFromA } from "@fixture/a";
export function valueFromB(): number {
  return 1;
}
export function callsA(): number {
  return valueFromA();
}
TS

cat > "$FIX/dead.ts" <<'TS'
export function unusedHelper(): string {
  return "never imported";
}
TS

cat > "$FIX/dynamic.ts" <<'TS'
export async function loadDead(): Promise<unknown> {
  return import("@fixture/dead");
}
TS

cat > "$FIX/server/storage/internal.ts" <<'TS'
export function getOrderInternal(): string {
  return "order";
}
TS

cat > "$FIX/server/storage/index.ts" <<'TS'
export * from "./internal";
TS

cat > "$FIX/server/routes/orders.ts" <<'TS'
import * as storageInternal from "../storage/internal";
export function getOrder(): string {
  return storageInternal.getOrderInternal();
}
TS

cat > "$FIX/reexport-only.ts" <<'TS'
export function reexportOnlyDead(): string {
  return "only reachable via a barrel that nobody imports";
}
TS

cat > "$FIX/barrel.ts" <<'TS'
export { reexportOnlyDead } from "./reexport-only";
TS

cat > "$FIX/entry.js" <<'JS'
import { valueFromA } from "@fixture/a";
console.log(valueFromA());
JS

REBUILD_OUT=$(cd "$PROJECT_ROOT" && LAB_DATABASE_URL="$TEST_URL" npx tsx "$TS_SCRIPT" --rebuild --project "$FIX/tsconfig.json" 2>&1); REBUILD_RC=$?
assert_exit0 "--rebuild against fixture project" "$REBUILD_RC"
assert_contains "--rebuild reports rebuilt tables" "$REBUILD_OUT" "rebuilt repo.modules"

MODULE_COUNT=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM repo.modules")
assert_eq "rebuild loads all 10 fixture modules" "$MODULE_COUNT" "10"

# blast: server/storage/internal.ts has two direct dependents (index.ts's `export *` and
# orders.ts's direct namespace import).
BLAST_OUT=$(LAB_DATABASE_URL="$TEST_URL" bash "$SH_SCRIPT" blast server/storage/internal.ts)
assert_contains "blast finds server/storage/index.ts" "$BLAST_OUT" "server/storage/index.ts"
assert_contains "blast finds server/routes/orders.ts" "$BLAST_OUT" "server/routes/orders.ts"

# blast on the dead-export target also proves the dynamic import() edge was captured.
DEAD_BLAST_OUT=$(LAB_DATABASE_URL="$TEST_URL" bash "$SH_SCRIPT" blast dead.ts)
assert_contains "blast finds dynamic.ts via the dynamic import() edge" "$DEAD_BLAST_OUT" "dynamic.ts"

# blast on a.ts proves entry.js's plain-.js import edge was captured (mirrors
# client/index.js's import of client/App.tsx in the real repo).
ENTRY_BLAST_OUT=$(LAB_DATABASE_URL="$TEST_URL" bash "$SH_SCRIPT" blast a.ts)
assert_contains "blast finds entry.js via the .js entrypoint's import edge" "$ENTRY_BLAST_OUT" "entry.js"

# dead-exports: dead.ts's unusedHelper is genuinely dead (the dynamic import of its module
# doesn't reference the export itself). getOrderInternal must NOT be flagged even though it
# has zero NAMED-import references — it's only ever reached via orders.ts's namespace
# import, which pass 1 (cheap) can't see; pass 2's findReferencesAsNodes must catch it.
# reexportOnlyDead must BE flagged even though barrel.ts's `export { reexportOnlyDead }
# from "./reexport-only"` gives it a nonzero apparent reference in both passes if the
# barrel-reexport fix regresses -- pass 1's cheapCounts must not count the "reexport" kind
# edge, and pass 2's findReferencesAsNodes must not count the barrel's own ExportSpecifier
# as a reference either.
DEAD_OUT=$(LAB_DATABASE_URL="$TEST_URL" bash "$SH_SCRIPT" dead-exports)
assert_contains "dead-exports finds dead.ts's unusedHelper" "$DEAD_OUT" "unusedHelper"
assert_not_contains "dead-exports does not flag getOrderInternal (namespace-import usage)" "$DEAD_OUT" "getOrderInternal"
assert_contains "dead-exports finds reexportOnlyDead despite the barrel re-export" "$DEAD_OUT" "reexportOnlyDead"

# cycles: a.ts and b.ts import each other (through the @fixture/* alias).
CYCLES_OUT=$(LAB_DATABASE_URL="$TEST_URL" bash "$SH_SCRIPT" cycles)
assert_contains "cycles finds a.ts" "$CYCLES_OUT" "a.ts"
assert_contains "cycles finds b.ts" "$CYCLES_OUT" "b.ts"

# layering: server/routes/orders.ts imports server/storage/internal.ts directly, bypassing
# the server/storage/index.ts barrel.
LAYERING_OUT=$(LAB_DATABASE_URL="$TEST_URL" bash "$SH_SCRIPT" layering)
assert_contains "layering finds the routes->storage-internal violation" "$LAYERING_OUT" "server/routes/orders.ts"
assert_contains "layering names the bypassed storage file" "$LAYERING_OUT" "server/storage/internal.ts"

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
