---
title: Never execute a shell fragment that execs an outward-facing CLI — a PATH stub protects only if its name matches exactly
track: knowledge
category: conventions
tags: [harness, agents, testing, security, dual-use-cli, path-resolution]
module: shared
applies_to: [".claude/agents/**", ".claude/skills/**", "scripts/__tests__/**"]
created: 2026-08-16
---

# Never execute a shell fragment that execs an outward-facing CLI — a PATH stub protects only if its name matches exactly

## Rule

An agent — including a "read-only" reviewer whose tool list has Bash — must
never execute a shell fragment (or command) whose exec target is an
outward-facing, PATH-resolved CLI: `eas`, `gh` (mutating subcommands),
`railway`, `npm publish`, `psql` against a remote. Reason about the fragment
from its text. If execution is genuinely required, stub the binary under its
EXACT real name, prepend the stub dir to `PATH`, and verify resolution before
running:

```bash
command -v eas   # MUST print the stub's path, not the real install
```

Dispatch prompts that hand an agent such a fragment must state this
prohibition explicitly — "never invoke the real binary" in a PR body or plan
does not reach a subagent's context.

## Why

2026-08-16 incident: while reviewing the EAS publish-guard tests (PR #824), a
`code-reviewer` subagent probed a quoting hypothesis by running the
`package.json` `sh -c` fragment with a stub it named `fake-eas`. PATH
resolution skipped the stub (wrong name) and fell through to the real `eas`
CLI on the machine — publishing a real OTA to the live `preview` channel,
built from an unrelated branch without the env inlining. Three properties
combined: a "read-only" agent designation does not constrain Bash; the
machine was authenticated; and a stub is only a stub when its NAME matches
what the fragment resolves. One typo separated "probe" from "production
mutation", and the classifier that blocks such actions in the main loop does
not always fire inside subagents.

## Examples

Correct stub shape (the guard suite's own harness — name is exactly `eas`,
and the assertion pins the stub answered):

```ts
const bin = path.join(dir, "eas"); // EXACT real name
fs.writeFileSync(bin, '#!/usr/bin/env bash\nprintf "EAS_CALLED:"...');
fs.chmodSync(bin, 0o755);
spawnSync("sh", ["-c", fragment, "--", ...args], {
  env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
});
expect(r.stdout).toContain("EAS_CALLED:"); // proves the STUB ran
```

The `EAS_CALLED` sentinel doubles as resolution proof: if the real binary had
answered, the assertion fails instead of the channel mutating silently.

## Exceptions

- Hermetic, inward-facing CLIs (`node`, `tsc`, `vitest`, `git` against the
  local repo) — executing these is normal agent work.
- The committed test suite itself running under vitest — its stub uses the
  exact name and asserts the sentinel; that is the sanctioned way to execute
  such fragments.

## Related Files

- `scripts/__tests__/eas-update-guard.test.ts` — the sanctioned harness shape.
- `.claude/agents/code-reviewer.md` — carries the review-time prohibition
  (single-write owner).

## See Also

- [Stub service with production safety gate](../design-patterns/stub-service-production-safety-gate-2026-05-13.md) — the in-app cousin: stubs need structural guards, not naming conventions.
- [A gate test must be two-sided](gate-test-needs-two-sided-negative-control-2026-07-25.md) — the sentinel-assertion habit that makes stub resolution observable.
