---
title: Never execute a shell fragment that execs an outward-facing CLI — a PATH stub protects only if its name matches exactly
track: knowledge
category: conventions
tags: [harness, agents, testing, security, dual-use-cli, path-resolution]
module: shared
applies_to: [".claude/agents/**", ".claude/skills/**", "scripts/__tests__/**", ".claude/hooks/**"]
created: 2026-08-16
last_updated: 2026-08-16
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

## Structural layer (2026-08-16, hardening)

This rule started as prose only (the `code-reviewer.md` contract rule below,
plus this doc) — filed from PR #827's review as a gap: prose can be skipped
by a dispatch prompt that omits it, or an agent that doesn't attend to it,
and the main-loop classifier that would otherwise catch such an action "does
not always fire inside subagents."

`.claude/hooks/guard-outward-cli.sh` (a PreToolUse Bash hook) now backstops
the prose structurally: it DENIES command-position `eas update/publish/
submit` (plus the mutating `eas update:*` colon subcommands — `update:delete`,
`update:edit`, `update:republish`, `update:revert-update-rollout`,
`update:roll-back-to-embedded`, `update:rollback`), mutating `railway` verbs
(`up`/`deploy`/`redeploy`/`restart`/`down`/`delete`/`remove`/`rm`, plus
`variable`/`vars`/`var set|delete` and `service`/`environment delete`),
`npm publish`, mutating `gh pr`/`release`/`repo` subcommands, and `gh api`
with a mutating HTTP method (`-X`/`--method POST|PUT|PATCH|DELETE` — `gh api`
can reach the identical PR-merge action via a different subcommand), with an
`ALLOW_OUTWARD_CLI=1` env escape for the rare legitimate case. Read-only forms
(`eas update:list`, `gh pr view/checks`, `railway status/logs`, plain
`gh api` GET, …) stay allowed. `gh pr merge --auto ...` is a deliberate
carve-out (see the hook's own header comment) — it arms GitHub's native
auto-merge rather than mutating anything synchronously, and this repo's
`/todo` automerge pipeline depends on it — UNLESS `--admin` is also present,
which contradicts that premise and denies regardless.

**This backstop is Bash-only — it does NOT close the gap it hardens.** The
hook matches on the Bash tool's `tool_input.command` string exclusively. Any
equivalent MCP tool (`mcp__github__merge_pull_request`, and — where wired —
`mcp__claude_ai_Railway__redeploy` / `create-deployment` / `set-variables`,
etc.) bypasses it entirely; the prose rule above remains the *only* control
for those paths. Do not cite this hook as covering the MCP surface, and
re-read this caveat before claiming "structural coverage" is complete — see
[a stated invariant is not an enforced one](a-stated-invariant-is-not-an-enforced-one-2026-08-06.md).

## Every review dispatch needs the prohibition stated, not just the obviously risky one (2026-08-16, recurrence)

While implementing the structural hardening above (this very todo), the
`todo-executor` dispatched two review subagents in parallel and stated the
"never execute a real outward-facing CLI" prohibition explicitly to
`security-auditor` only — reasoning that a security review was the "risky"
one. It was not restated for `code-reviewer`. That subagent verified its
findings by running `eas update --help`, `railway --help`, and
`gh pr merge --help` against the real, locally-installed binaries — no
mutating flag, no network write, nothing published or merged. The findings
those calls produced were real and correct (three CRITICAL coverage gaps in
the new hook). But the CLI names were still invoked without the prohibition
ever reaching that subagent's context, exactly the failure mode this doc's
`## Rule` describes for dispatch prompts, and exactly the tool-choice a
code-reviewer reaches for by default when it wants to verify a claim rather
than take the diff's word for it.

The lesson is not "downgrade the rule because `--help` is harmless." It is:
**a human (or an executor) picking which subagent "looks risky enough" to
receive the prohibition is the same single point of failure the rule already
warns about at the dispatch-prompt level — one layer up.** State the
prohibition in *every* review dispatch for code that touches an
outward-facing CLI, not only the reviewer whose name suggests danger. A
general-purpose reviewer's default verification instinct — "let me check
what this flag actually does" — is reasonable engineering practice in every
other context and only becomes the incident precursor here.

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
- `.claude/hooks/guard-outward-cli.sh` — the structural PreToolUse deny hook
  (Bash-only; see "Structural layer" above for what it does and does not
  cover).
- `.claude/hooks/test-guard-outward-cli.sh` — its two-sided self-tests.

## See Also

- [Stub service with production safety gate](../design-patterns/stub-service-production-safety-gate-2026-05-13.md) — the in-app cousin: stubs need structural guards, not naming conventions.
- [A gate test must be two-sided](gate-test-needs-two-sided-negative-control-2026-07-25.md) — the sentinel-assertion habit that makes stub resolution observable.
