---
title: 'node -p require(...) prints the string "undefined" for a missing field — [ -z "$VAR" ] cannot catch it'
track: bug
category: logic-errors
module: shared
tags: [bash, node, package-json, require, undefined, fail-open, shell-guard, psql, allowlist, silent-desync]
applies_to: [scripts/pg-lab/symbol-graph.sh]
symptoms: ['A bash guard reads a Node/JS field via node -p "require(...).someField" and treats a non-empty stdout as "the field was present"', 'node -p "require(...).missingField" prints the 9-character string undefined (not an empty string) with exit code 0 when the field is absent', 'A [ -z "$VAR" ] bash emptiness check silently passes when $VAR holds the string undefined, letting a missing-field case fall through to the success path', 'The literal string undefined ends up embedded downstream (e.g. in a SQL query, a file path, or a shell command) instead of the guard\'s intended loud failure']
created: '2026-07-09'
severity: medium
---

# node -p require(...) prints the string "undefined" for a missing field — [ -z "$VAR" ] cannot catch it

## Problem

In `scripts/pg-lab/symbol-graph.sh`, a bash fail-closed guard was added to derive a value
from `package.json` via:

```bash
MAIN_ENTRY=$(node -p "require('$PROJECT_ROOT/package.json').main" 2>/dev/null)
if [ -z "$MAIN_ENTRY" ]; then
    echo "Error: no main field in package.json" >&2
    exit 1
fi
```

Code review found this guard **fails open**: when `package.json` exists but lacks the
`main` field, `node -p` does **not** print an empty string — it prints the literal
9-character string `undefined` (verified empirically: `node -p '({}).main'` prints
`undefined`, exit code `0`). The `[ -z ... ]` bash test only catches an **empty** string,
not the word `undefined`, so execution falls through past the guard and the literal string
`undefined` gets silently used as if it were a real value (in this case passed into a psql
query as an allowlist entry), instead of hitting the intended refuse-loudly error path.

The TypeScript sibling in the same PR (`symbol-graph.ts`'s `readMainEntrypoint`, using
`typeof pkg.main !== "string" || pkg.main.length === 0`) does **not** have this gap because
`JSON.parse` + a real `typeof` check has no equivalent "stringified `undefined`" failure
mode.

## Symptoms

- A bash guard reads a Node/JS field via `node -p "require(...).someField"` and treats a
  non-empty stdout as "the field was present".
- `node -p "require(...).missingField"` prints the 9-character string `undefined` (not an
  empty string) with exit code 0 when the field is absent.
- A `[ -z "$VAR" ]` bash emptiness check silently passes when `$VAR` holds the string
  `undefined`, letting a missing-field case fall through to the success path.
- The literal string `undefined` ends up embedded downstream (e.g. in a SQL query, a file
  path, or a shell command) instead of the guard's intended loud failure.

## Root Cause

`node -p` (and `node -e` with `console.log`/`process.stdout.write`) prints the **string
representation** of whatever the expression evaluates to. Accessing a missing object
property in JS evaluates to the value `undefined`, and printing `undefined` coerces it to
the 9-character string `"undefined"` — there is no distinction, at the shell/stdout level,
between "the field truly held the string 'undefined'" and "the field was absent". A bash
script using only `[ -z "$VAR" ]` (checks for the empty string) cannot detect this class
of non-empty-but-meaningless output.

## Solution

Add an explicit check for the literal string `'undefined'` alongside the emptiness check:

```bash
if [ -z "$MAIN_ENTRY" ] || [ "$MAIN_ENTRY" = "undefined" ]; then
    echo "Error: no main field in package.json" >&2
    exit 1
fi
```

The actual fix applied in `scripts/pg-lab/symbol-graph.sh`'s dead-exports case was exactly
this change.

An alternative, more robust fix is to make the Node expression itself throw on a falsy
field, so that the shell sees a clean empty-stdout + non-zero exit instead of the string
`undefined`:

```bash
MAIN_ENTRY=$(node -e "
  const pkg = require('$PROJECT_ROOT/package.json');
  if (!pkg.main) { console.error('missing main'); process.exit(1); }
  console.log(pkg.main);
" 2>/dev/null)
```

This approach does not rely on the caller remembering the special-case string comparison,
but the string-comparison guard is simpler and was sufficient here.

## Prevention

1. **Never assume a shell VAR is "absent" just because a downstream tool's error-suppression
   (`2>/dev/null`) redirected stderr** — check what the tool prints to **stdout** on the
   missing-value case specifically, empirically, before trusting a bash `-z` check alone.
   For `node -p`, always test whether the expression prints `undefined` for a missing
   optional field.

2. **For any `node -p`/`-e` one-liner reading an optional field**, either:
   - explicitly guard against the literal string `undefined` in the consuming shell code, or
   - make the node expression itself fail loudly (`throw` / `process.exit(1)`) on a missing
     field so bash only ever sees a real value or a clean empty-stdout+nonzero-exit failure.

3. **When two independent scripts (e.g. one TypeScript, one bash) each derive "the same"
   value from one shared upstream source for use in different contexts, keep their
   normalization/validation logic in parity** — a stricter check in one and a looser check
   in the other is a silent drift point.

   **Concrete example from the same review**: `scripts/pg-lab/symbol-graph.sh` passes the
   derived `package.json` `main` value straight into a SQL allowlist as a raw string, while
   the TypeScript sibling (`symbol-graph.ts`) runs the same `package.json` `main` value
   through `path.join(configDir, ...)` before using it for comparison. If `package.json`'s
   `main` field ever gained a `'./'` prefix (e.g. changed from `'client/index.js'` to
   `'./client/index.js'`), the TypeScript side would still normalize and match correctly
   via `path.join`, but the bash-side allowlist entry would silently stop matching the real
   repo-relative path stored in the database — a latent desync between two
   independently-maintained derivations of "the same" value that only manifests if the
   upstream format ever changes. (Note: this is currently non-load-bearing because the
   entrypoint file has no export statements of its own so it never appears in the export
   table regardless, but it is a prevention point worth flagging.)

4. Prefer identical normalization logic (or share a single already-normalized value) over
   deriving-then-comparing raw strings in each language separately when both need the same
   downstream interpretation.

## Related Files

- `scripts/pg-lab/symbol-graph.sh` — the dead-exports case's `MAIN_ENTRY` guard (the fix)
- `scripts/pg-lab/symbol-graph.ts` — `readMainEntrypoint`, the TypeScript sibling that does
  **not** have this gap (contrast reference)

## See Also

- [psql -c skips :var substitution — another shell/SQL fail-open gotcha in the same pg-lab family](./psql-c-flag-skips-var-substitution-2026-07-05.md)