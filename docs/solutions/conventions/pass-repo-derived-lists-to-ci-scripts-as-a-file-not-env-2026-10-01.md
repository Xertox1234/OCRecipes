---
title: "Pass a repo-derived list (changed files, corpus paths) to a CI script as a FILE, never an env var or step output — Linux caps each env string at 128 KiB (E2BIG)"
track: knowledge
category: conventions
module: shared
tags: [harness, architecture, testing, ci, github-actions, e2big]
applies_to: [".github/workflows/**/*.yml", "scripts/ci/**", "scripts/**/*.mjs"]
created: 2026-10-01
---

# Pass a repo-derived list to a CI script as a file, never an env var

## Rule

When a workflow or test hands a list that grows with the repo to a script, such as a PR's
changed files or every file under `docs/solutions/`, write it to a file (`$RUNNER_TEMP/…` in
Actions, a temp dir in tests) and pass the **path**. Do not use an env var, a `$GITHUB_OUTPUT`
value that gets re-exported as env, or a single argv string.

```yaml
- run: git diff --name-only "$BASE...$HEAD" > "$RUNNER_TEMP/changed-files.txt"
- run: node scripts/ci/mutation-on-diff.mjs "$RUNNER_TEMP/changed-files.txt"
```

## Why

Linux limits **each** `envp`/`argv` string to `MAX_ARG_STRLEN` = 131072 bytes. macOS has no
per-string cap, so an oversized value works on every Mac and fails only on Linux CI. It fails
deterministically on every retry, so it reads as a real test failure.

The failure lands on whichever child process is started next. Every process a script spawns
inherits `process.env`, so one large variable breaks every `spawnSync`/`exec` after it,
however small that call's own arguments are. Lane F's orchestrator spawns
`npm → stryker → vitest workers` per module. With `CHANGED_FILES` in the env, as its plan
specified, a large PR would have broken every one of those spawns.

Measured 2026-09-20 (PR #1003): a test passed `files.join("\n")` over `docs/solutions/` and
`todos/` as an env var. It came to 131104 bytes on the merge ref, 32 over the limit. `main`
was 79 bytes under, so it was about to break CI for everyone.

## Smell patterns

- `env: { LIST: files.join("\n") }`, or `CHANGED_FILES: ${{ steps.x.outputs.files }}`
- `spawnSync` returns `status === null` on CI and passes locally: execve failed, so suspect
  E2BIG first.

## Exceptions

A value that is bounded by construction, such as a fixed fixture or a single SHA, is fine.
A value derived from `git ls-files` or `git diff --name-only` is not.

## Examples

- `.github/workflows/mutation-on-diff.yml` with `scripts/ci/mutation-on-diff.mjs`, which reads
  `process.argv[2]` and exits 2 with a usage line when it is missing.

## Related Files

- `.github/workflows/mutation-on-diff.yml`
- `scripts/ci/mutation-on-diff.mjs`

## See Also

- [../best-practices/stryker-vitest4-mutation-testing-harness-2026-06-05.md](../best-practices/stryker-vitest4-mutation-testing-harness-2026-06-05.md): the harness the Lane F script drives
