---
title: "Put the outward-facing CLIs behind a PATH wrapper, so the guard stops being the only thing between an agent and a real publish"
status: backlog
priority: high
created: 2026-09-07
updated: 2026-09-07
assignee:
labels: [security, harness]
github_issue:
---

# A PATH wrapper for the outward-facing CLIs

## Summary

Put `eas`, `railway`, `npm`, `pnpm`, `yarn` and `gh` behind a wrapper directory earlier on the
agent's `PATH` that refuses to exec the real binary unless an env token is set. This attacks
the **resolution** step rather than the command **text**, so it closes the incident class
regardless of how the command is spelled — including spellings nobody has found.

Filed at the owner's request alongside the **Model A** ruling (see Background).

## Background

### The ruling this implements

`todos/archive/P1-2026-09-07-outward-cli-guard-threat-model-decision.md` put three adversary
models to the owner. **The ruling is Model A: the guard is accountable for an agent MISFIRING,
not for defeating a deliberate evader.**

That ruling is what makes this todo the right shape. A text-matching guard cannot win against
an adversary — `guard-outward-cli.sh`'s own header says so ("guardrail, not a sandbox — a
determined bypass is always possible"). A wrapper does not need to: it never reads the command
text, so obfuscation is irrelevant to it.

### Why this is the structural answer to the actual incident

`project_ota_accidental_publish_2026_08_16`, restated because it is the whole justification: a
review subagent named its PATH stub **`fake-eas`** instead of `eas`; resolution fell through to
the **real** CLI and published a real OTA to `preview`. The command was a plain `eas update`.

**The failure was in PATH resolution, and the guard is a text matcher.** A wrapper would have
caught it by construction — the stub name is irrelevant when the real binary is not reachable
without a token.

### What it closes that the guard cannot

Measured 2026-09-07 over this project's own history (3,883 unique Bash commands): the guard's
span layer — the source of every P0 filed against it — has synthesised a gated needle **zero**
times in 1,555 opportunities. The plain-text layer is exercised on 25.5% of commands. A wrapper
covers **both**, plus the three currently-open bypass classes and any future spelling, because
none of them changes what `execve` resolves.

## Acceptance Criteria

- [ ] A wrapper directory is prepended to the agent's `PATH` containing one shim per gated
      binary (`eas`, `railway`, `npm`, `pnpm`, `yarn`, `gh`). Each shim refuses with a non-zero
      exit and a clear message unless the sanctioned env token is set, and otherwise `exec`s the
      real binary found by scanning `PATH` **past its own directory**.
- [ ] **Read-only invocations keep working without the token**, or the wrapper is unusable in
      practice — `gh pr view`, `gh api` with no method flag, `eas update:list`, `npm run <script>`,
      `npm ci`, `git`-adjacent flows. Decide and DOCUMENT whether the shim distinguishes
      subcommands itself or delegates that judgement to the existing guard; **prefer delegating**,
      since a second, divergent copy of the mutating-subcommand list is exactly the failure this
      repo has paid for repeatedly.
- [ ] The escape hatch is deliberate and discoverable: one env token, named consistently with
      the existing `SKIP_*` / `ALLOW_OUTWARD_CLI` convention, documented in `CLAUDE.md` beside
      them, and usable by the **operator** for a real release without editing files.
- [ ] **Proven by execution, not by inspection**: with the wrapper active and no token, a
      PATH-stubbed harness confirms the real binary is never reached for a mutating invocation —
      and confirms it IS reached for the sanctioned read-only forms. Both directions, or the
      test is one-sided.
- [ ] **The `fake-eas` incident is replayed as a regression test.** A shim whose name does not
      match the binary must NOT allow fall-through to the real CLI. That construction is the
      reason this exists.
- [ ] False-positive population measured by execution over harvested command history, not
      estimated — the same harness used for PR #929 (`fp-harvest`, 1,658 decision-relevant
      commands). Validate the harness on a known flip before trusting a zero.
- [ ] Interaction with `guard-outward-cli.sh` is stated explicitly: does the wrapper REPLACE the
      guard, sit BESIDE it, or gate only what the guard cannot see? **Do not silently weaken the
      guard** on the assumption the wrapper covers it — that is a substitution, and this repo has
      a solution doc about substituting where it should union
      (`docs/solutions/logic-errors/new-helper-re-derived-the-grammar-the-same-change-was-fixing-2026-09-06.md`).
- [ ] `docs/solutions/` entry via `/codify` if the mechanism generalises.

## Implementation Notes

- **The shim must not find itself.** Resolving the real binary with a naive `command -v` inside
  a shim that is earlier on `PATH` is an infinite exec loop. Scan `PATH` past the wrapper
  directory explicitly, and pin that with a test.
- **Never execute an outward-facing CLI while testing this**, including `--help`/`--version`.
  Shadow with argv-printing stubs; a stub must write to a SENTINEL FILE rather than stdout,
  because any construction containing a redirect swallows stdout and the probe then reports
  "not invoked" for something that really did invoke (this cost a round during PR #929).
- The Bash tool runs under **zsh** here, not bash — verify `PATH` prepending behaves under the
  shell that actually executes tool calls, not the one the hooks are written in.
- Consider whether the wrapper belongs in the repo (committed, versioned, reviewable) or in the
  operator's environment. Committed is auditable; environment-only means a fresh clone is
  unprotected. State the choice and its consequence.

## Scope Contract

- **Files in scope:** a new wrapper directory and its shims, the `PATH` wiring, `CLAUDE.md`
  (documenting the token), and a new self-test under `.claude/hooks/`.
- **Do NOT weaken `guard-outward-cli.sh` in this change.** Any narrowing of the guard on the
  strength of the wrapper is a separate, separately-reviewed decision.
- No new mechanisms beyond those listed.

## Risks

- **Breaking the operator's own workflow is the main risk**, not under-blocking. A wrapper that
  makes a real release awkward will be disabled, and a disabled control is worse than none.
  The read-only-still-works criterion is the deliverable as much as the refusal is.
- A second copy of the mutating-subcommand list will drift from the guard's. Delegate rather
  than duplicate.

## Related

- `todos/archive/P1-2026-09-07-outward-cli-guard-threat-model-decision.md` — the Model A ruling
  this implements, with the measured evidence behind it.
- `todos/archive/P2-2026-08-16-outward-cli-pretooluse-deny-hook.md` — where this option was
  first raised and left awaiting a call; that todo produced `guard-outward-cli.sh` itself.
- `todos/P0-2026-09-06-outward-cli-guard-interior-redirect-defeats-every-family.md` — the one
  open guard defect that survives the Model A ruling, because it is reachable by accident.
