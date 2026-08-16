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
`update:roll-back-to-embedded`, `update:rollback` — the mutating
`eas channel:`/`branch:` verbs `create|edit|delete|rename`, and
`eas build --auto-submit[-with-profile]`), mutating `railway` verbs
(`up`/`deploy`/`redeploy`/`restart`/`down`/`delete`/`remove`/`rm`/`run` —
`railway run` executes an arbitrary command with the LIVE service env,
including the production `DATABASE_URL` — plus `variable`/`vars`/`var
set|delete` and `service`/`environment delete`), `npm publish`, mutating
`gh pr`/`release`/`repo` subcommands, `gh api` with a mutating HTTP method
(`-X`/`--method POST|PUT|PATCH|DELETE` — `gh api` can reach the identical
PR-merge action via a different subcommand), and any `gh pr
merge|create|comment` carrying `--repo`/`-R` (which retargets the write at an
arbitrary repository with the user's PAT). Matching is case-INSENSITIVE for
command words, since macOS APFS resolves `EAS update` to the real binary.
There is an `ALLOW_OUTWARD_CLI=1` env escape for the rare legitimate case.
Read-only forms (`eas update:list`, `eas channel:list`, plain `eas build`,
`gh pr view/checks`, `gh pr create/comment` without `--repo`,
`railway status/logs`, plain `gh api` GET, …) stay allowed.
`gh pr merge --auto ...` is a deliberate carve-out (see the hook's own header
comment) — it does not merge until required checks pass, on a branch-protected
target (NOT "nothing happens synchronously": on a PR whose checks have already
passed, GitHub merges within seconds), and this repo's `/todo` automerge
pipeline depends on it — UNLESS `--admin` or `--repo`/`-R` is also present,
either of which contradicts that premise and denies regardless.

**This repo's own OTA scripts ARE covered.** `npm run update:preview` and
`npm run update:production` exec `eas update --branch preview|production
--platform all` against `https://api.ocrecipes.com` — a real OTA to real
users, i.e. exactly this incident class, reached through a command word that
neither the `npm publish` nor the `eas update` pattern sees. The hook's first
version ALLOWED both *and asserted in its own deny message that they were
safe*, with a self-test pinning that wrong claim as an `assert_allow`; a
round-3 review caught it. Both are now DENIED, along with the
`npm run-script`, `pnpm run`, `yarn run` and bare `yarn`/`pnpm
update:preview` spellings. The sanctioned publish flow is now:

```bash
ALLOW_OUTWARD_CLI=1 npm run update:preview -- --message "…"
```

**A "defined" function is not a working one.** Three of the round-3 findings
were degraded-environment fail-OPENs, not craftable bypasses: a jq
*extraction* failure (malformed envelope, renamed field) allowed everything
while the no-jq path failed closed on the same input; a shell line-continuation
split the verb from its subcommand and defeated every fallback path (the raw
JSON's `\n` escape ends in the LETTER `n`, and grep is line-oriented on the
decoded string); and — the sharpest one — with `awk` merely absent from `PATH`,
`lib/cmd-detect.sh` still sourced cleanly and `declare -F cmd_bare` still
succeeded, so the broken-install branch was skipped, `cmd_bare` returned
nothing, every `grep` on the blanked string found nothing, and a plain
`eas update --branch preview --platform all` was ALLOWED with zero crafting.
`declare -F` answers "is it defined?", never "does it work?" — check the
primitive's OUTPUT (empty result from non-empty input ⇒ degrade to the
fallback), and give every degraded path its own two-sided test.

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

**It recurred again on the very next review round of the very same PR** — a
reviewer once more exec'd the real `eas`/`gh` binaries to confirm flag
behavior. Two rounds in a row, on the hook written to prevent exactly this.
So: the prohibition belongs in the dispatch prompt of *every* round, restated
each time (a prior round's prompt is not in the next round's context), and it
must say `--help`/`--version` are covered too — a reviewer reads "never run a
mutating command" as permitting the read-only ones. The working method needs
naming, not just the ban: pipe the command STRING as JSON to the hook on
stdin and read its decision. Every finding in round 3 was found and verified
that way, with no CLI executed.

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
