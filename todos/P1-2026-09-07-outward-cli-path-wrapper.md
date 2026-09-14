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
covers **both**, plus the then-open bypass classes and any future spelling **that still resolves
the bare name through the inherited `PATH`**.

> **NAMED RESIDUALS — two spellings the wrapper as scoped does not cover (measured 2026-09-13).**
> (An earlier header said "defeat a PATH wrapper BY CONSTRUCTION"; that is true only of residual
> 2 — see the correction below.)
> An earlier revision of this sentence claimed "any future spelling", which is false and is the
> kind of completeness claim this repo has been burned by. A wrapper only sees what `execve`
> resolves **through the `PATH` it controls**:
>
> 1. **Launcher family — `npx`, `npx -y`, `npx --yes`, `npm exec`, `npm exec --`, `bunx`,
>    `bun x`, `bun run`, `pnpm dlx`, `pnpm exec`, `yarn dlx`, `yarn exec`** (the measured set, not
>    a sample). These can prepend their own cache bin directory, so the wrapper directory need not
>    be the resolution source.
> 2. **Absolute-path invocation** — `/opt/homebrew/bin/eas update` skips `PATH` resolution
>    entirely.
>
> Both are ALLOW **at `guard-outward-cli.sh`** — measured, with controls that held in both
> directions: bare `eas update` → DENY, `$(which eas) update` → DENY, `ls -la` → ALLOW.
>
> **"the only live control" would be wrong for `gh`.** `merge-review-guard.sh` is a second live
> control on `gh pr merge`, and it splits the two residuals rather than missing both:
> `npx gh pr merge 42 --squash` → **DENY** there (the launcher residual IS caught), while
> `/opt/homebrew/bin/gh pr merge 42 --squash` → ALLOW (the absolute-path residual slips it too,
> matching this repo's known path-qualified extractor gap). Scope any "only control" claim to the
> specific hook. The guard's own header already concedes the launcher half at
> `guard-outward-cli.sh:147-149`, and `_OUT_POS_PREFIX` (`:1606`) anchors on a
> shell-metacharacter class that contains no path-separator branch, which is the absolute-path
> half.
>
> 🛑 **CORRECTION 2026-09-13 — "no shim can close them" was FALSE, and this list was
> under-named. Ruling 4 was re-ruled by the owner on the corrected evidence; see ruling 4.**
>
> - **Only residual 2 (absolute path) is genuinely shim-immune.** `npx` and `npm` are ordinary
>   PATH-resolved binaries (verified: both `/opt/homebrew/bin/`), so a shim named `npx` or `npm`
>   intercepts them **before** the launcher's own cache-bin logic runs. The launcher family is
>   out of scope **by choice**, not by impossibility — and that choice is reversible.
>   **Both residuals are assigned to the GUARD-TEXT layer** by the re-ruling, via the companion
>   todo in Related. They are out of the wrapper's scope, not out of scope.
> - **A live, unguarded OTA path is missing from the four spellings named above.**
>   `npm exec eas update --branch preview` is **ALLOW** at the guard — re-measured directly, with
>   both controls holding (`eas update --branch preview` → DENY; `ls -la` → ALLOW; bash 5.3.15).
>   An earlier revision named only four launcher spellings (`npx`, `npx --yes`, `bunx`, `bun x`)
>   and OMITTED the one that is both live on this host and reachable: `npm exec`. Of those four,
>   **two** (`bunx`, `bun x`) are not installed here at all, while `npx`/`npx --yes` resolve
>   (`/opt/homebrew/bin/npx`); `pnpm` and `yarn` are likewise absent. The list above is now the
>   measured set. **No count is quoted here on purpose** — an earlier revision quoted "ten" with
>   no denominator, repeating the very defect this block withdraws a figure for. Re-derive it per
>   the companion todo's corpus criterion, with its dimensions and its denominator.
> - **The "3 launcher forms × 3 binaries = 9 rows" figure does not reconcile** with its own five
>   quoted examples (which span four binary spellings and include the absolute-path row, which is
>   residual 2, not a launcher form). Treat the figure as withdrawn.
> - **The corpus cites the wrong proposition.** A guard-verdict corpus is evidence that _the guard
>   allows this text_ — not that _the spelling bypasses PATH resolution_. Those are two claims.
>
> This block replaced an "any future spelling" overclaim with a differently-shaped completeness
> claim. Recorded rather than quietly rewritten, because that is the repeat defect.

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
  must be re-decided. **The consequence depends on WHICH level fails, and the two are not the
  same** — ruling 5's criterion tests three independently: if level **(a)** fails (the `PATH`
  never reaches a Bash tool call at all), the shims are **inert — coverage zero**; if only
  **(b)** or **(c)** fails, an agent's own directly-typed `eas update` is still shimmed and
  coverage is **narrower, not zero**. An earlier revision said "coverage is zero" for any
  failure, which contradicted ruling 4's own treatment of a (b)-only failure as a scope
  ADDITION.
- Even once ruling 5 is proven, "covers every `execve`" is **not** the same proposition as
  "closes the incident class" — see the NAMED RESIDUALS block in the Summary. `npx`/`bunx` and
  absolute-path invocation never resolve through the wrapper's `PATH` at all.

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
that was cited**: the block beginning at `:356` ("UNHANDLED GAP, CONFIRMED LIVE") was quoted
only through `:372`, stopping nine lines short of `:381`'s "CLOSED — and this entry said
otherwise for a day." (The earlier draft cited the range as `:358-372`; the label itself sits at
`:356`, so even the cited span was off by two.) Do not re-open
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

### 4. Scope is `eas`, `railway`, `gh` — `npm`/`pnpm`/`yarn` are OUT (RE-RULED 2026-09-13)

> **RE-RULED by the owner after the original premise was falsified.** The first ruling said
> `npm`/`pnpm`/`yarn` add "no added coverage of this class". That is **false**, measured:
> `npm exec eas update --branch preview` is **ALLOW** at the guard (controls held — bare
> `eas update` → DENY, `ls -la` → ALLOW) and is not closed by the `eas` shim, while `npm` is
> PATH-resolved (`/opt/homebrew/bin/npm`) so an `npm` shim **would** intercept it.
>
> **The scope-out STANDS, on a corrected and honest reason:** the added shim coverage is not
> worth putting a refusal in front of husky, lint-staged and `preflight:fast`. The Risks section
> already names breaking the operator's workflow as the primary risk, and a disabled control is
> worse than none.
>
> **The coverage is recovered at the GUARD-TEXT layer instead, not abandoned** — the launcher
> family becomes text rules in `guard-outward-cli.sh` via a companion todo (see Related). That is
> union, not substitution: the shim layer stays at three binaries and the text layer grows.

**This REVISES the six-binary list in the first Acceptance Criterion below.**
`npm run update:preview` ends in `exec eas update --branch preview --platform all "$@"`
(`package.json:50`), and a child process inherits `PATH` — so the `eas` shim closes the OTA class
**through the `npm run` path specifically**. ~~so the `eas` shim already closes the OTA incident
class through the npm path~~ and ~~for no added coverage of this class~~ — **both struck: falsified
premise, see the RE-RULED block above.** `npm exec eas update` is a separate, still-open path.
Shimming `npm`/`pnpm`/`yarn` would put a refusal in front of husky, lint-staged and
`preflight:fast`, and the Risks section already names breaking the operator's workflow as the
primary risk — **that** is the reason the scope-out stands. The guard continues to cover
`npm run update:*` at its text layer — union, not substitution.

**Provisional on ruling 5, exactly as ruling 1 is — and more consequentially.** This scope-out
REMOVES coverage rather than describing it, so it is the costlier of the two to get wrong. It
holds only if the prepended `PATH` is inherited by npm's child processes. **If ruling 5's first
task disproves that, re-decide this ruling before implementing** — `npm`/`pnpm`/`yarn` come back
into scope. (Checked 2026-09-13: no `eas-cli` dependency in `package.json` and no
`node_modules/.bin/eas`, so no local-bin shadow independently defeats the premise.)

**Narrower than it first reads.** The `eas` shim closes the OTA class _through the `npm run`
path specifically_. It does **not** close `npx eas update` or `/opt/homebrew/bin/eas update` —
neither resolves through the wrapper's `PATH` (Summary → NAMED RESIDUALS). Those are guard-text
work, not shim work; do not read ruling 4 as "the OTA class is closed".

### 5. Committed to the repo, not the operator's environment

`.claude/settings.json` and `.claude/hooks/` are both tracked. An environment-only wrapper
leaves a fresh clone unprotected and is not reviewable or CI-testable.

**One empirical unknown gates the whole todo and must be proven FIRST.**
`.claude/settings.json` has no `env` key today, so `PATH` prepending there is new wiring.
Prove by execution that the prepended directory actually reaches **Bash tool calls**
before building any shim. If it does not, the wiring mechanism changes and every shim is
inert. This is the one claim in the design a reader cannot check by inspection — so it is
the first task, not a late verification step.

### 6. A SEPARATE **one-shot token**: `ALLOW_OUTWARD_EXEC` (never a bare `=1` env var)

Not a reuse of `ALLOW_OUTWARD_CLI`. **Two independent layers must not share one disarm.**
`ALLOW_OUTWARD_CLI=1` is already documented as a routine prefix (`docs/DEV_SETUP.md:185`), so
reusing it would mean the agent's habitual guard bypass silently disarms the backstop too —
recreating the very misfire class the wrapper exists to close. A genuine operator publish
therefore carries both tokens. That is deliberate: it makes an irreversible action a conscious
two-key operation instead of a one-token habit. The name follows the existing `ALLOW_*`/`SKIP_*`
convention.

**The two tokens have DIFFERENT SCOPES for the same typed text — state this in the
implementation, it is not cosmetic.** The guard honours the inline form by matching the literal
prefix in the command **string** (`guard-outward-cli.sh:1426`), precisely because — as
`:1419-1422` explains — a `VAR=val cmd` assignment never reaches that hook's environment. So
inline `ALLOW_OUTWARD_CLI=1` is genuinely scoped to one tool call. A shim, by contrast, runs
**inside** the gated command's process tree, so an inline `ALLOW_OUTWARD_EXEC=1` is a real
environment assignment **inherited by every descendant**.

Consequences, both binding:

- **Do NOT publish the two tokens as one copy-pasteable line.** `docs/DEV_SETUP.md:185` is
  `ALLOW_OUTWARD_CLI=1 railway run --service Postgres -- sh -c '…npx tsx …'` — an
  arbitrary-command-against-production subtree. Prefixing both tokens there would disarm the exec
  backstop for `railway`, the `sh -c`, `npx`, `tsx`, and anything that script execs. Document
  them as two deliberate steps, or the "two-key" rationale collapses into one token with a longer
  name.
- **The disarm is a ONE-SHOT TOKEN FILE, not an environment variable.** Pick one shape and
  propagate it; an env var cannot express a scoped disarm at all. `export ALLOW_OUTWARD_EXEC=1`
  disarms the operator's **entire shell session** and every later command in it;
  `env ALLOW_OUTWARD_EXEC=1 railway run …` is still one pasteable line whose value is inherited
  by the whole subtree. Neither is "two deliberate steps" in any meaningful sense.

  **The mechanism:** `scripts/arm-outward-exec.sh <binary> <target>` writes a single-use token
  file; the shim **consumes and unlinks it** before `exec`, and refuses if it is absent, stale
  (older than a short TTL), or names a different binary/target than the argv it is looking at.
  That makes the two steps real, bounds the disarm to one invocation rather than a subtree or a
  session, and needs no environment inheritance. `ALLOW_OUTWARD_EXEC` survives only as the
  **name** of the mechanism, never as a bare `=1` an agent can prefix by habit.

### Consequences for the criteria below

| Criterion            | Change                                                                      |
| -------------------- | --------------------------------------------------------------------------- |
| Binary list          | six → **three** (`eas`, `railway`, `gh`) — ruling 4                         |
| "prefer delegating"  | **reversed** — the shim owns its rule — ruling 2                            |
| Escape hatch         | token is `ALLOW_OUTWARD_EXEC`, separate from `ALLOW_OUTWARD_CLI` — ruling 6 |
| New, blocking, first | prove `settings.json` `env.PATH` reaches Bash tool calls — ruling 5         |

## Acceptance Criteria

- [ ] **FIRST, and blocking (ruling 5):** proven by execution that a directory prepended to
      `PATH` via `.claude/settings.json`'s `env` key is observed at **all three levels**, using
      the argv-printing sentinel-file stub the Implementation Notes mandate:
      **(a)** a Bash tool call; **(b)** a **grandchild** of one, via a **scratch script that
      reproduces `package.json:50`'s shape** (`sh -c '… exec ocr-path-probe …'`) and execs a
      harmless sentinel binary; **(c)** a **subagent's** Bash tool call.

      > 🛑 **`update:preview` / `update:production` must NEVER be the probe vehicle.** An earlier
      > revision of this criterion named the `eas` resolution point inside `npm run update:preview`
      > as level (b). That is the `fake-eas` construction this todo was filed about, written into
      > its own acceptance criteria. Reaching that resolution point means running the real publish:
      > `package.json:50` requires `--message` and then `exec eas update --branch preview
      > --platform all` with `CI=1` and the production domain baked in; it is DENY at the guard, so
      > the tester must first add `ALLOW_OUTWARD_CLI=1` to run it at all — at which point **the only
      > barrier between the probe and a live OTA to real `preview` users is the stub resolution the
      > probe exists to test.** `/opt/homebrew/bin/eas` is the real CLI on this machine (verified
      > 2026-09-13). A sentinel stub does not save it, because the failure mode under test IS stub
      > non-resolution.
      Level (b) is not optional padding: ruling 4 REMOVES `npm`/`pnpm`/`yarn` from scope on the
      strength of grandchild inheritance, so a criterion proving only (a) can pass green while
      the premise a coverage-removal rests on stays unmeasured — and ruling 4's own escape clause
      would then never fire. If any level fails, stop and re-decide the wiring — every criterion
      below is inert without this.

- [ ] A wrapper directory is prepended to the agent's `PATH` containing one shim per gated
      binary (`eas`, `railway`, `gh` — **three, per ruling 4**; `npm`/`pnpm`/`yarn` are out of
      scope). Each shim refuses with a non-zero exit and a clear message **unless a valid
      one-shot token file is present — armed by `scripts/arm-outward-exec.sh <binary> <target>`,
      naming this binary and target, unexpired, and consumed and unlinked by the shim before
      `exec`** — and otherwise `exec`s the real binary found by scanning `PATH` **past its own
      directory**. **Never gate on a bare `ALLOW_OUTWARD_EXEC=1` environment variable** (ruling
      6): an env var is inherited by the whole subtree and cannot express a scoped disarm.
- [ ] **Read-only invocations keep working without the token**, or the wrapper is unusable in
      practice — `gh pr view`, `gh pr list`, `gh run view`, `gh api` with no method flag,
      `eas update:list`. (`npm run <script>` and `npm ci` are no longer wrapper concerns —
      ruling 4.) The shim distinguishes subcommands **itself, from its own argv** — it does NOT
      delegate to `guard-outward-cli.sh`, whose interface makes delegation both lossy and
      bypass-inheriting (**ruling 2 reverses this criterion's original "prefer delegating"**).
- [ ] The rule is an **ALLOWLIST**: only enumerated read-only subcommands exec without the
      token; everything else refuses, including subcommands nobody has enumerated (ruling 3).
- [ ] The allowlist matches on the **EXACT, FULL subcommand path** — `update:list`, never
      `update:*`; `run view`, never `run`. **Prefix or verb granularity makes an allowlist drift
      open exactly like a denylist.** Two concrete traps, both measured 2026-09-13:
      `eas update:list` is allowlisted and shares its `update:` prefix with
      `update:delete|edit|republish|revert-update-rollout|roll-back-to-embedded|rollback`, which
      the guard enumerates as mutating (`guard-outward-cli.sh:1994`; probed `eas update:republish`
      → DENY, control `eas update:list` → ALLOW) — a shim matching `update:*` grants all six.
      `gh run view` is allowlisted and shares its `run` verb with `gh run rerun|cancel|delete`,
      which `GH_MUTATING_RE` (`:2597`) does not cover at all.
- [ ] The `gh` shim inspects **flags, not just `$1`** — `gh api` spans read and write on one
      verb. **Do not enumerate flag families; transcribe `gh`'s published default-method rule
      verbatim into the shim's comments with a doc citation, and treat anything not provably GET
      as a write.** An enumeration of `-X`/`--method` plus "field flags" already misses `--input`
      (body from a file or stdin), which is neither, and `gh api graphql`, which is a different
      shape. Confirm from published documentation; **never** run `gh --help` to determine it.
- [ ] The escape hatch is the **one-shot token file** named `ALLOW_OUTWARD_EXEC` — **separate
      from `ALLOW_OUTWARD_CLI`, never a reuse of it, and never a bare env `=1`** (ruling 6).
      Armed by `scripts/arm-outward-exec.sh <binary> <target>`, consumed and unlinked by the
      shim, refused when absent, stale, or naming a different binary/target than the argv.
      Documented in `CLAUDE.md` beside the existing tokens, and usable by the **operator** for a
      real release without editing files. A genuine publish is two deliberate steps; that
      friction is the point.
- [ ] `docs/DEV_SETUP.md:185`'s documented `railway run` flow is updated to the **two-step arm
      form** — `scripts/arm-outward-exec.sh railway <target>` on one line, the existing
      `ALLOW_OUTWARD_CLI=1 railway run …` on the next. **NOT one copy-pasteable two-token line,
      and NOT an `export`** (ruling 6: that line runs an arbitrary subtree against production, so
      an inherited exec token would disarm the backstop for `railway`, the `sh -c`, `npx`, `tsx`
      and anything they exec; an `export` would disarm the whole session). It silently breaks the
      moment the wrapper lands if left untouched.
- [ ] **Proven by execution, not by inspection**: with the wrapper active and no token, a
      PATH-stubbed harness confirms the real binary is never reached for a mutating invocation —
      and confirms it IS reached for the sanctioned read-only forms. Both directions, or the
      test is one-sided.
- [ ] **The `fake-eas` incident is replayed as a regression test.** A shim whose name does not
      match the binary must NOT allow fall-through to the real CLI. That construction is the
      reason this exists.

      > 🛑 **Run this replay with the real binary UNREACHABLE.** A meaningful replay needs a
      > *mutating* argv (a read-only one would be allowlisted and exec'd anyway), so the failure
      > mode under test is literally "the real `eas` runs `update`". Set
      > `PATH=<wrapper-dir>:<sentinel-dir>` and nothing else, the sentinel being an argv-printing
      > stub standing in for "the real CLI", so fall-through lands on the sentinel and never on
      > `/opt/homebrew/bin/eas` (measured present on this host). Same reasoning as the level-(b)
      > bar above: a sentinel does not help if the real binary is still resolvable.

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
  `PATH` wiring in `.claude/settings.json` (a new `env` key — ruling 5),
  `scripts/arm-outward-exec.sh` (the one-shot token arm — ruling 6), `CLAUDE.md` (documenting
  `ALLOW_OUTWARD_EXEC`), `docs/DEV_SETUP.md` (the **two-step arm** `railway run` flow), and a new
  self-test under `.claude/hooks/`.
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
  risk instead — an ALLOWLIST cannot drift _open_ **under exact full-subcommand matching, and
  for verbs whose direction is flag-determined, on the full argv predicate**, because an
  unenumerated subcommand refuses. Both qualifiers are load-bearing: under prefix or verb
  granularity an allowlist drifts open exactly like a denylist (see the exact-match criterion
  above), and `gh api` is allowlisted **conditionally on its flags**, not as a subcommand path —
  so exact-subcommand matching alone does not protect it. The residual risk then inverts to
  over-refusal, which is visible to the operator rather than silent.
- **Residuals the wrapper does NOT cover — named, so this list is not read as complete:**
  (a) the launcher family (`npx`, `npx --yes`, `bunx`, `bun x`) and absolute-path invocation,
  which never resolve through the wrapper's `PATH` — see the Summary's NAMED RESIDUALS block;
  (b) a `node`/`tsx` script that talks to the Expo/EAS API directly with a token and never execs
  a CLI; (c) the `mcp__railway__*` / `mcp__github__*` tool paths, which `CLAUDE.md` actively
  PREFERS over `gh` and which no `PATH` shim and no Bash-tool hook observes. (b) and (c) are
  declared **out of scope** here — neither can ship an OTA — but they are why "covers every
  `execve`" must not be read as "closes the incident class".

## Related

- `todos/P1-2026-09-13-launcher-family-and-absolute-path-defeat-the-outward-cli-guard.md` — **the
  companion todo ruling 4 assigns the launcher/absolute-path coverage to.** Union, not
  substitution: the wrapper closes bare-name `PATH` resolution; that todo closes the two
  spellings which never resolve that way. `npm exec eas update` is ALLOW until it lands.
- `todos/archive/P1-2026-09-07-outward-cli-guard-threat-model-decision.md` — the Model A ruling
  this implements, with the measured evidence behind it.
- `todos/archive/P2-2026-08-16-outward-cli-pretooluse-deny-hook.md` — where this option was
  first raised and left awaiting a call; that todo produced `guard-outward-cli.sh` itself.
- `todos/archive/P0-2026-09-06-outward-cli-guard-interior-redirect-defeats-every-family.md` —
  **CLOSED 2026-09-07** (`status: done`). This bullet previously called it "the one open guard
  defect that survives the Model A ruling"; that was stale and is corrected here 2026-09-13.
  Nothing in this todo should be read as depending on it being open.
