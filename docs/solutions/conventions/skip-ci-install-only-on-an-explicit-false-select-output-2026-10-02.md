---
title: "Skip a CI install on an explicit `false` from a dependency-free select step — gate with `!= 'false'` so a missing output still installs, and prove the step needs no node_modules"
track: knowledge
category: conventions
module: shared
tags: [harness, ci, github-actions, testing, architecture]
applies_to: [".github/workflows/**/*.yml", "scripts/ci/**", "scripts/**/*.mjs"]
created: 2026-10-02
---

# Skip a CI install on an explicit `false` from a dependency-free select step

## Rule

1. When a job installs dependencies only to discover it has nothing to do, run the
   selection first in a step that needs no install (Node built-ins plus files already
   in the checkout), and gate setup-node, the install and the work on its output.
2. Gate with `!= 'false'` (skip only on an explicit `false`). A step output that was
   never set is the empty string, so `== 'true'` skips every gated step on a typo'd
   step id or a script that wrote nothing, and the job stays green with nothing run.
   `!= 'false'` degrades to the old behaviour (install and run) instead.
3. Prove "needs no install" with a test: copy only the script and what it imports into
   a temp tree, with no `node_modules` in the tree or any ancestor (realpath the tmpdir),
   and run the real script there. An import of an installed package then fails in the
   test, not on CI. Measured 2026-10-02: adding `import "vitest";` to the script made every
   spawn test (all 7) in `scripts/__tests__/mutation-on-diff-select-only.test.ts` fail.
4. Make the select step and the real run share **one** derivation of the selection, so
   the step that decides to skip cannot disagree with the run that would have found work.

## Smell patterns

- `if: steps.select.outputs.run == 'true'` (skips everything when the select step id is
  mis-typed, or when the select script writes no output)
- A setup-node / `npm ci` step that sits before the check and runs unconditionally,
  installing dependencies for a diff the job then finds empty

## Why

- `actionlint` (installed locally; CI does not run it) rejects a typo'd step id and a
  forward reference to a later step, e.g. `property "selct" is not defined in object type
  {select: ...}` (measured 2026-10-02 on a scratch workflow). It catches a wrong id before
  push, but nothing in CI does.
- `.github/workflows/mutation-non-excluded.yml` and `.github/workflows/mutation-goal-safety.yml`
  gate on `== 'true'`. They are safe because their Detect step writes `run=true` or
  `run=false` in both branches and fails loud on a git error; the polarity is a local choice.
  A typo in their `id: changed` would leave both their `== 'false'` self-scope step and the
  `== 'true'` steps skipped, so the job would pass with nothing run.
- Step outputs are strings, and only the empty string is falsy: a bare
  `if: steps.select.outputs.run` is TRUE for the string `'false'`, so always compare
  explicitly.
- A select step that fails (non-zero exit) fails the job and skips the later steps that do
  not use `always()`, so a crash in selection is loud, not a silent skip. A missing list
  file exits the script with status 1 (ENOENT) and writes no `run=` line.

## Examples

```yaml
- id: select
  run: node scripts/ci/mutation-on-diff.mjs --select-only "$RUNNER_TEMP/changed-files.txt"
- name: npm ci
  if: steps.select.outputs.run != 'false'
  run: npm ci
```

```ts
// A tree with only the script and what it imports; no node_modules above it.
// `list` is a changed-files.txt written under `root`.
const root = realpathSync(mkdtempSync(path.join(tmpdir(), "mutation-select-")));
mkdirSync(path.join(root, "scripts", "ci"), { recursive: true });
copyFileSync(SCRIPT, path.join(root, "scripts", "ci", "mutation-on-diff.mjs"));
copyFileSync(REGISTRY, path.join(root, "stryker.targets.mjs"));
const env = { ...process.env, GITHUB_OUTPUT: path.join(root, "out") };
spawnSync("node", [path.join(root, "scripts/ci/mutation-on-diff.mjs"), "--select-only", list], { cwd: root, env });
expect(readFileSync(path.join(root, "out"), "utf8")).toBe("run=false\n");
```

## Exceptions

When skipping is the dangerous direction (a deploy or publish step that must run only on
an explicit go-ahead), gate on `== 'true'` instead.

## Related Files

- `.github/workflows/mutation-on-diff.yml`
- `scripts/ci/mutation-on-diff.mjs`
- `scripts/__tests__/mutation-on-diff-select-only.test.ts`
- `.github/workflows/mutation-non-excluded.yml`

## See Also

- [pass-repo-derived-lists-to-ci-scripts-as-a-file-not-env-2026-10-01.md](pass-repo-derived-lists-to-ci-scripts-as-a-file-not-env-2026-10-01.md): the list stays a file; `run=true|false` is a bounded value and is fine as a step output
- [required-check-name-is-an-api-contract-2026-09-08.md](required-check-name-is-an-api-contract-2026-09-08.md): why the gating is at step level and the job name stays put
- [../code-quality/verification-that-scans-zero-inputs-is-green-and-meaningless-2026-08-07.md](../code-quality/verification-that-scans-zero-inputs-is-green-and-meaningless-2026-08-07.md): assert positive output so a vacuous run cannot pass