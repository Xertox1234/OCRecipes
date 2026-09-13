---
title: "Put the outward-facing CLIs behind a PATH wrapper, so the guard stops being the only thing between an agent and a real publish"
status: backlog
priority: high
created: 2026-09-07
updated: 2026-09-13
assignee:
labels: [security, harness]
github_issue:
---

# A PATH wrapper for the outward-facing CLIs

## Summary

> **Scope narrowed by ruling 4 (2026-09-13): `eas`, `railway`, `gh` only.** The original
> six-binary list below is kept as filed rather than overwritten; `npm`/`pnpm`/`yarn` are out.

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
covers **both**, plus the then-open bypass classes and any future spelling, because none of them
changes what `execve` resolves.

> **The count "three currently-open bypass classes" was true on 2026-09-07 and is NOT re-verified
> here (2026-09-13).** At least one of that era's classes has since closed. Treat the number as a
> dated measurement, not a present-tense fact — and do not cite it as evidence without re-deriving
> it from the guard's current DOCUMENTED RESIDUALS. The wrapper's justification does not rest on
> the count: it rests on `execve` resolution being independent of spelling.

## Ruling — 2026-09-13

Made with the owner in an interactive session. This resolves every open design question the
todo carried and is binding on the implementation. Two of the six rulings **overturn** text
written elsewhere in this file — noted inline, not silently edited away.

### 1. The wrapper sits BESIDE the guard — union, not substitution

Neither layer subsumes the other, measured in both directions:

- The **guard** denies BEFORE execution. The wrapper refuses AT execution, so in
  `rm -rf build && eas update` the `rm` has already run by the time the shim refuses.
- The **wrapper** covers every `execve` — subagents, npm scripts, `node child_process` —
  which the guard never sees, because it only reads `tool_input.command` from the Bash tool.
  **This coverage claim is CONTINGENT on ruling 5 and is not yet measured**: it follows only
  if the prepended `PATH` actually reaches Bash tool calls _and is inherited by their child
  processes_. If ruling 5's first task disproves that, this bullet does not hold and ruling 1
  must be re-decided — the wrapper would then cover strictly less than stated here, and the
  union argument would need re-checking rather than assuming.

Confirms the existing Scope Contract ("Do NOT weaken `guard-outward-cli.sh`"). Any later
narrowing of the guard on the strength of the wrapper stays a separate, separately-reviewed
decision.

### 2. The shim judges from its own argv — it does NOT delegate to the guard

**This REVERSES the "prefer delegating" preference in the Acceptance Criteria below.** That
preference was written to avoid a second copy of the mutating-subcommand list, before anyone
read the guard's interface. Measured in `.claude/hooks/guard-outward-cli.sh`:

- It reads a **PreToolUse JSON envelope** on stdin and requires `.tool_name == "Bash"` plus
  `.tool_input.command` (`:1400-1408`).
- `deny()` prints `permissionDecision: deny` as JSON and then **`exit 0`** (`:1389-1392`).
  Every path exits 0. There is no exit status a shim could read a verdict from.

A delegating shim would therefore re-serialize argv into a command string, wrap it in a
synthetic envelope, and parse JSON back — re-introducing text matching into the one component
whose entire value is that it never reads command text. **Delegation would couple the backstop
to the text matcher's blind spots, present and future**: whatever spelling the text layer fails
to recognise, a delegating wrapper waves through too. The backstop would fail exactly where the
layer it backs up fails — the one property a backstop may not have.

**Correction, recorded rather than overwritten (2026-09-13).** An earlier draft of this ruling
argued that point with two CONCRETE examples — `eas 2>/dev/null update` and
`gh api repos/o/r -X $'\x50\x4f\x53\x54'` — and called both live bypasses. **Both are CLOSED.**
The interior-redirect class was fixed 2026-09-07
(`todos/archive/P0-2026-09-06-outward-cli-guard-interior-redirect-defeats-every-family.md`,
`status: done`), and the ANSI-C method residual is retracted **inside the very comment block
that was cited**: `:358-372` quotes its "UNHANDLED GAP, CONFIRMED LIVE" half and stops nine
lines short of `:381`'s "CLOSED — and this entry said otherwise for a day." Do not re-open
either as an argument here. **The ruling does not depend on them** — it rests on the exit-0
interface and the absent shared table, neither of which requires any bypass to be live.

Argv is also stronger as a matter of **mechanism**, independent of any gap: the shell completes
expansion before `execve`, so a shim receives `-X $'\x50\x4f\x53\x54'` as the literal string
`POST`. A text matcher must model that rendering; a shim never sees it. That is a claim about
where each layer sits, not about what either currently misses.

There is no shared table to borrow: `_OUT_GATED_VERB` (`:2152`) is a coarse union across all
six binaries — it includes `run` and `api` — with `GH_MUTATING_RE` (`:2597`) and the eas
colon-subcommand logic as separate precision layers. The shim rule is new code either way.
Keep it per-binary and small.

### 3. Deny by default — an ALLOWLIST of read-only subcommands, for all three binaries

Under the Model A ruling (an agent MISFIRING, not a deliberate evader) fail-closed is the
correct shape, and it is the only one robust to subcommands nobody has enumerated — which is
this todo's entire justification. An unknown or newly-added subcommand refuses; the **operator**
meets that friction, not an attacker.

**`gh`'s read/write split is not a verb-level property.** `gh api` is a single verb spanning
both directions: `gh api repos/o/r` reads, `gh api ... -X POST` writes. The `gh` shim must
inspect flags, not just `$1`, and must treat any field flag that implies a non-GET default
method as a write. **Confirm `gh`'s actual default-method rule from its published
documentation — do NOT run `gh --help` to find out.** Executing an outward-facing CLI,
`--help`/`--version` included, is forbidden by this todo's own Implementation Notes and by
`docs/solutions/conventions/never-execute-an-outward-facing-cli-fragment-in-review-2026-08-16.md`.

### 4. Scope is `eas`, `railway`, `gh` — `npm`/`pnpm`/`yarn` are OUT

**This REVISES the six-binary list in the first Acceptance Criterion below.**
`npm run update:preview` ends in `exec eas update --branch preview --platform all "$@"`
(`package.json:50`), and a child process inherits `PATH` — so the **`eas` shim already closes
the OTA incident class through the npm path**. Shimming `npm`/`pnpm`/`yarn` would put a refusal
in front of husky, lint-staged and `preflight:fast` for no added coverage of this class, and the
Risks section already names breaking the operator's workflow as the primary risk. The guard
continues to cover `npm run update:*` at its text layer — union, not substitution.

**Provisional on ruling 5, exactly as ruling 1 is — and more consequentially.** This scope-out
REMOVES coverage rather than describing it, so it is the costlier of the two to get wrong. It
holds only if the prepended `PATH` is inherited by npm's child processes. **If ruling 5's first
task disproves that, re-decide this ruling before implementing** — `npm`/`pnpm`/`yarn` come back
into scope. (Checked 2026-09-13: no `eas-cli` dependency in `package.json` and no
`node_modules/.bin/eas`, so no local-bin shadow independently defeats the premise.)

### 5. Committed to the repo, not the operator's environment

`.claude/settings.json` and `.claude/hooks/` are both tracked. An environment-only wrapper
leaves a fresh clone unprotected and is not reviewable or CI-testable.

**One empirical unknown gates the whole todo and must be proven FIRST.**
`.claude/settings.json` has no `env` key today, so `PATH` prepending there is new wiring.
Prove by execution that the prepended directory actually reaches **Bash tool calls**
before building any shim. If it does not, the wiring mechanism changes and every shim is
inert. This is the one claim in the design a reader cannot check by inspection — so it is
the first task, not a late verification step.

### 6. A SEPARATE token: `ALLOW_OUTWARD_EXEC=1`

Not a reuse of `ALLOW_OUTWARD_CLI`. **Two independent layers must not share one disarm.**
`ALLOW_OUTWARD_CLI=1` is already documented as a routine prefix (`docs/DEV_SETUP.md:185`), so
reusing it would mean the agent's habitual guard bypass silently disarms the backstop too —
recreating the very misfire class the wrapper exists to close. A genuine operator publish
therefore carries both tokens. That is deliberate: it makes an irreversible action a conscious
two-key operation instead of a one-token habit. The name follows the existing `ALLOW_*`/`SKIP_*`
convention.

### Consequences for the criteria below

| Criterion            | Change                                                                      |
| -------------------- | --------------------------------------------------------------------------- |
| Binary list          | six → **three** (`eas`, `railway`, `gh`) — ruling 4                         |
| "prefer delegating"  | **reversed** — the shim owns its rule — ruling 2                            |
| Escape hatch         | token is `ALLOW_OUTWARD_EXEC`, separate from `ALLOW_OUTWARD_CLI` — ruling 6 |
| New, blocking, first | prove `settings.json` `env.PATH` reaches Bash tool calls — ruling 5         |

## Acceptance Criteria

- [ ] **FIRST, and blocking (ruling 5):** proven by execution that a directory prepended to
      `PATH` via `.claude/settings.json`'s `env` key actually reaches **Bash tool calls**. If it
      does not, stop and re-decide the wiring — every criterion below is inert without this.
- [ ] A wrapper directory is prepended to the agent's `PATH` containing one shim per gated
      binary (`eas`, `railway`, `gh` — **three, per ruling 4**; `npm`/`pnpm`/`yarn` are out of
      scope). Each shim refuses with a non-zero exit and a clear message unless
      `ALLOW_OUTWARD_EXEC=1` is set, and otherwise `exec`s the real binary found by scanning
      `PATH` **past its own directory**.
- [ ] **Read-only invocations keep working without the token**, or the wrapper is unusable in
      practice — `gh pr view`, `gh pr list`, `gh run view`, `gh api` with no method flag,
      `eas update:list`. (`npm run <script>` and `npm ci` are no longer wrapper concerns —
      ruling 4.) The shim distinguishes subcommands **itself, from its own argv** — it does NOT
      delegate to `guard-outward-cli.sh`, whose interface makes delegation both lossy and
      bypass-inheriting (**ruling 2 reverses this criterion's original "prefer delegating"**).
- [ ] The rule is an **ALLOWLIST**: only enumerated read-only subcommands exec without the
      token; everything else refuses, including subcommands nobody has enumerated (ruling 3).
- [ ] The `gh` shim inspects **flags, not just `$1`** — `gh api` spans read and write on one
      verb. Any `-X`/`--method` other than GET, and any field flag implying a non-GET default,
      is a write (ruling 3). Confirm `gh`'s default-method rule from published documentation;
      **never** run `gh --help` to determine it.
- [ ] The escape hatch is `ALLOW_OUTWARD_EXEC=1` — **separate from `ALLOW_OUTWARD_CLI`, never a
      reuse of it** (ruling 6). Documented in `CLAUDE.md` beside the existing tokens, and usable
      by the **operator** for a real release without editing files. A genuine publish carries
      both tokens; that friction is the point.
- [ ] `docs/DEV_SETUP.md:185`'s documented `railway run` flow is updated to carry both tokens,
      or it silently breaks the moment the wrapper lands.
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
- [ ] Interaction with `guard-outward-cli.sh` is **BESIDE it — union, not substitution**
      (ruling 1, which answers this criterion's question). **Do not silently weaken the guard**
      on the assumption the wrapper covers it — this repo has a solution doc about substituting
      where it should union
      (`docs/solutions/logic-errors/new-helper-re-derived-the-grammar-the-same-change-was-fixing-2026-09-06.md`).
      Verify no guard detector was narrowed in the same diff.
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

- **Files in scope:** a new wrapper directory and its shims (`eas`, `railway`, `gh`), the
  `PATH` wiring in `.claude/settings.json` (a new `env` key — ruling 5), `CLAUDE.md`
  (documenting `ALLOW_OUTWARD_EXEC`), `docs/DEV_SETUP.md` (the two-token `railway run` flow),
  and a new self-test under `.claude/hooks/`.
- **Committed, not environment-only** (ruling 5) — a fresh clone must be protected.
- **Do NOT weaken `guard-outward-cli.sh` in this change.** Any narrowing of the guard on the
  strength of the wrapper is a separate, separately-reviewed decision.
- No new mechanisms beyond those listed.

## Risks

- **Breaking the operator's own workflow is the main risk**, not under-blocking. A wrapper that
  makes a real release awkward will be disabled, and a disabled control is worse than none.
  The read-only-still-works criterion is the deliverable as much as the refusal is.
- ~~A second copy of the mutating-subcommand list will drift from the guard's. Delegate rather
  than duplicate.~~ **Superseded by ruling 2.** The risk is real but delegation is not the
  remedy: the guard has no shareable table (`_OUT_GATED_VERB` is a coarse cross-binary union),
  and delegating would make the wrapper inherit every guard bypass. Ruling 3 answers the drift
  risk instead — an ALLOWLIST cannot drift _open_, because an unenumerated subcommand refuses.
  The residual risk inverts to over-refusal, which is visible to the operator rather than
  silent.

## Related

- `todos/archive/P1-2026-09-07-outward-cli-guard-threat-model-decision.md` — the Model A ruling
  this implements, with the measured evidence behind it.
- `todos/archive/P2-2026-08-16-outward-cli-pretooluse-deny-hook.md` — where this option was
  first raised and left awaiting a call; that todo produced `guard-outward-cli.sh` itself.
- `todos/archive/P0-2026-09-06-outward-cli-guard-interior-redirect-defeats-every-family.md` —
  **CLOSED 2026-09-07** (`status: done`). This bullet previously called it "the one open guard
  defect that survives the Model A ruling"; that was stale and is corrected here 2026-09-13.
  Nothing in this todo should be read as depending on it being open.
