---
title: An unused import passes every gate here — no-unused-vars is warn-level and no gate counts warnings, so a helper left behind by a deleted block ships unless you lint the file and read its warnings
track: bug
category: code-quality
tags: [typescript, architecture, testing, eslint, lint, unused-import, preflight, ci, deletion, review]
module: server
applies_to: ["eslint.config.js", "package.json", "server/**/*.ts", "client/**/*.ts", "client/**/*.tsx", "shared/**/*.ts"]
symptoms: ["A reviewer reports an unused import on a branch whose push gate and CI lint both passed", "`grep -c <helper>` on a file returns 1 and that one line is the import", "`npx eslint <file>` prints `✖ 1 problem (0 errors, 1 warning)` and the command still exits 0"]
created: 2026-10-19
last_updated: 2026-10-19
severity: low
---

# An unused import passes every gate here

## What happened

PR #1515 deleted `getSpoonacularSubstitutes` from `server/services/recipe-catalog.ts`. The sweep after the deletion checked the symbols the function *defined* (its zod schema, the zod import) and every *caller* of the function. It did not check the helpers the deleted *body* used: the catch block had been the file's only call of `toError`, so the import on line 6 stayed behind.

Three gates then let it through:

- **`preflight:fast` on push** ran eslint on the changed files and reported success. The rule `@typescript-eslint/no-unused-vars` is configured at `warn` in `eslint.config.js`, and the gate reads the exit code, which is 0 for warnings.
- **CI "Lint · Types · Patterns"** runs `npm run lint` (`npx expo lint`) with no `--max-warnings`, so it passed too. On 2026-10-19 main already carried four such warnings, all in test files, with zero errors (`eslint server client shared -f json`, 1589 files).
- **One of two reviewers** read the diff and listed `toError` among the imports still in use. The other grepped the file and counted one line.

The import was dropped in the follow-up PR #1516, per the one-review-pass rule.

## Rule

After deleting a block of code, lint the file and read the warnings, not just the exit code:

```bash
npx eslint path/to/file.ts        # look for "warning … is defined but never used"
```

Or grep each helper the deleted body called, not only the symbols it defined. A reviewer verifying "no dangling imports" must grep each named import, not reason from the diff.

## Why the gate is shaped this way

The rule is configured at `warn` with `args: "none"` and `ignoreRestSiblings: true`, so it is deliberately lenient about parameters and destructuring remainders. Raising it to `error`, or adding `--max-warnings 0` to `lint`, is a separate decision with four existing warnings to clear first; do not fold it into an unrelated PR.

## Related

- `eslint.config.js` — the `@typescript-eslint/no-unused-vars` block (`warn`)
- `package.json` → `lint` — no `--max-warnings`
- PR #1515 (left the import), PR #1516 (dropped it)
