# Session Coordination v2 — Checkpoints, Same-Run Visibility, Bash Coverage, Collision Ask — Design Spec

- **Date:** 2026-09-27
- **Status:** Approved 2026-09-27 (user); advisor-reviewed (10 findings applied); §9.0 probe PASSED 2026-09-27 — §5.3 agent_id amendment approved 2026-09-27
- **Shipped 2026-09-28:** #1132 (mutants runner), #1134 (checkpoints), #1136 (per-agent + Bash; live lab DB migrated), #1137 (collision ask), #1139/#1142 (§9.5 runbook at `docs/verification/session-coordination-two-session.md`).
- **Deviations from this spec (code is authoritative):**
  1. **Siblings warn, never ask** (user decision 2026-09-28). §6's sibling ask is dropped, because there is no finished-subagent signal. A SubagentStop probe is needed before revisiting.
  2. A pending ask marker that survives to the next consult is purged, so a denied ask can never be promoted into an approval.
  3. `git-safety.sh` probes the write-target lib in a subshell before sourcing it, so a present-but-broken lib still fails closed.
  4. **Open:** the ask is order-dependent: the first collision match decides, and the snapshot is unordered. See `todos/P2-2026-09-28-coord-collision-ask-order-dependent.md` (human-led).
- **Builds on:** `docs/superpowers/specs/2026-07-10-pg-session-coordination-design.md` (PRs #571/#572/#573 — the pg-lab registry, `record`/`consult`, snapshot SWR). That spec's mechanisms are reused, not replaced.
- **Harness freeze:** the 2026-09-22 guard-hardening freeze is **lifted by the user for this work** (2026-09-27, "we will bypass the harness block for this as it is important"). The same ruling's _one review pass per PR_ rule still governs.
- **Follow-up spec (NOT in scope here):** explicit claims — `session-coord.sh claim --todo <id> [--files …]`, a `harness.claims` table with 15-min heartbeat, `/todo` triage skip + PR-create duplicate check.

## 1. Problem

The user asked for a multi-agent coordination layer: leases, a blocking edit guard, WIP checkpoints, LEARNINGS fragments, and duplicate-work checks. Exploration (2026-09-27) found most of the substrate already exists, and measured where it falls short:

| Finding                                                                                                                                                                                           | Evidence                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A cross-session registry already exists (pg-lab `harness.session_registry` + `files_in_flight`, 10-min TTL) with a warn-only PreToolUse `consult`                                                 | `scripts/pg-lab/session-coord.sh`; `.claude/settings.json` consult on Edit/Write/MultiEdit                                                                                             |
| The warn path works end-to-end                                                                                                                                                                    | Positive control 2026-09-27: synthetic snapshot → `consult` emitted the warning AND wrote a `warn-collision` row (then deleted)                                                        |
| Zero `warn-collision` / `warn-worktree` events in 30 days across 723 sessions — but only within its coverage                                                                                      | `harness.coordination_log`, 30-day query. The detector is fed (snapshots carry other sessions' `files[]`)                                                                              |
| **Coverage gap 1 — same-run blindness.** Subagents share the parent's `session_id`; `consult` excludes own-session rows, so two `/todo` executors in one run never see each other                 | Session `d398476e` recorded files across 5 `agent-*` worktrees; 2026-07-10 spec §"Stated limitation"                                                                                   |
| **Coverage gap 2 — Bash writes invisible.** `record`/`consult` read only `tool_input.file_path`                                                                                                   | `session-coord.sh` `do_record`/`do_consult`                                                                                                                                            |
| **The one documented loss** was a dispatched reviewer's `git checkout --` destroying 5 uncommitted repairs (#956) — no test run was involved, so a test-triggered checkpoint would not have fired | `feedback_commit_before_dispatching_reviewers` memory                                                                                                                                  |
| LEARNINGS.md cannot merge-conflict: gitignored since 2026-05-21, frozen archive, `docs/solutions/` (944 files) is already one-file-per-finding                                                    | `.gitignore:107`; `/codify` SKILL.md:179 — requirement (4) **dropped**                                                                                                                 |
| PostToolUse Bash results carry **no exit-code field** in recorded transcripts                                                                                                                     | Transcript `toolUseResult` keys 2026-09-27: `stdout, stderr, interrupted, isImage, noOutputExpected, returnCodeInterpretation, …` — "checkpoint after successful test run" **dropped** |

## 2. Goals / Non-Goals

**Goals**

1. **Checkpoint before risk** — uncommitted work in every dirty worktree is captured to a local ref before any Agent dispatch or work-discarding git command.
2. **Same-run visibility** — sibling subagents of one session warn each other when editing the same repo-relative path in different worktrees.
3. **Bash-write coverage** — Bash write targets (`>`, `>>`, `N>`, `&>`, `tee`, `rm`, `cp`/`mv` dest, `sed -i`) are recorded and consulted exactly like Edit/Write targets.
4. **Collision ask** — a confirmed live cross-session hold on the exact same absolute path escalates from warn to a `permissionDecision: "ask"` prompt naming the holder.

**Non-Goals**

- Hard deny on collision (user chose `ask`, 2026-09-27).
- Explicit claims / todo-level duplicate detection (follow-up spec).
- Checkpoints on test success (no exit-code signal — §1).
- Pushing checkpoints to origin; protecting against machine loss.
- ~~Distinguishing two subagents of the same session~~ — **moved into scope by §5.3** after the §9.0 probe found `agent_id` in hook input.
- LEARNINGS.md changes of any kind.

## 3. Decisions (brainstorm 2026-09-27, user-confirmed)

| #   | Question                                                  | Decision                                                                                                                                        |
| --- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | New JSON-lease system vs improve existing pg-lab registry | **Improve existing**                                                                                                                            |
| 2   | Scope of this spec                                        | Improvements 1–4 (checkpoints, same-run visibility, Bash coverage, collision ask)                                                               |
| 3   | Collision response                                        | **`ask`** (not deny, not kind-split). User carries Remote Control on phone for active sessions, so an unattended executor's prompt reaches them |
| 4   | Checkpoint scope / retention                              | **All dirty worktrees** of the repo; **14-day** retention                                                                                       |
| 5   | Liveness window                                           | **15 minutes** everywhere (registry TTL raised from 10)                                                                                         |
| 6   | Relative Bash targets                                     | Resolved against hook `cwd` **only when the command contains no `cd`/`pushd`**                                                                  |

## 4. Component 1 — Checkpoints

### 4.1 Files

- `.claude/hooks/checkpoint.sh` — PreToolUse hook.
- `.claude/hooks/lib/cmd-detect.sh` — add `cmd_is_git_work_discarder` (sibling of `cmd_is_git_head_mover`, same `cmd_words_deep` + positional `git <globals> <VERBS>` shape) with verb set `checkout|restore|reset|stash|clean|switch`.
- `scripts/checkpoint.sh` — `list` subcommand (human recovery aid) and `reap` subcommand.
- `.claude/settings.json` — PreToolUse matchers `Agent` and `Bash` → `checkpoint.sh`; SessionStart → `scripts/checkpoint.sh reap` (backgrounded).

### 4.2 Trigger

- `tool_name` is `Agent` (also match `Task`, the legacy name): always.
- `tool_name` is `Bash`: only when `cmd_is_git_work_discarder` matches `tool_input.command`.
- Anything else: exit 0 immediately, no output.

The hook **never** emits a permission decision and never prints to stdout. It is a side-effect-only hook.

### 4.3 Capture

For each worktree in `/usr/bin/git worktree list --porcelain` (resolved from the hook `cwd`'s repo):

1. `git --no-optional-locks -C <wt> status --porcelain --untracked-files=normal` — empty → skip. (`--no-optional-locks` is required: plain `status` opportunistically rewrites the real index with refreshed stat info, violating the invariant below.)
2. `tmpidx=$(mktemp -d)/index`; `cp "$(git -C <wt> rev-parse --git-path index)" "$tmpidx"` (copying the real index carries its stat cache, so `add -A` hashes only changed/untracked files — a fresh `read-tree HEAD` index would re-hash every tracked file and blow the §4.4 budget; `mktemp`'s 0-byte file is also not a valid index); `GIT_INDEX_FILE=$tmpidx git -C <wt> add -A` (respects `.gitignore`; captures untracked); `tree=$(GIT_INDEX_FILE=$tmpidx git -C <wt> write-tree)`; remove the temp dir.
3. `ref=refs/checkpoints/<session_id[0:8]>/<wt-key>` where `<wt-key>` is the worktree's gitdir name (`basename "$(git -C <wt> rev-parse --git-dir)"`; `main` for the main checkout) — unique per repo, unlike a directory basename, which can collide across parent dirs. `prev=$(git rev-parse -q --verify "$ref")`.
4. If `prev` exists and `prev^{tree} == tree` → skip (no empty chain entries).
5. `commit=$(git commit-tree "$tree" ${prev:+-p "$prev"} -p HEAD -m "checkpoint: <trigger> <iso-ts> session=<sid8> wt=<wt-key>")`. `<trigger>` is a fixed short token (`agent`, `git-checkout`, `git-restore`, `git-reset`, `git-stash`, `git-clean`, `git-switch`), never the raw command text.
6. CAS update: `git update-ref "$ref" "$commit" "$prev"` when `prev` exists; `git update-ref "$ref" "$commit" ""` (quoted empty = "must not exist yet") when it does not. An unquoted empty old-value would silently drop the argument and make the first write unconditional. A lost race is harmless — the next trigger re-captures.

**Invariants:** HEAD, the worktree's real index, and the working tree are never modified; no git hooks run (`commit-tree`/`update-ref` don't invoke them). All git calls use `/usr/bin/git` (RTK proxy — `reference_rtk_worktree_guard_blocks_git`). `session_id` passes the same charset guard as `session-coord-hook.sh` (`''|.|..|*[!A-Za-z0-9._-]*` → skip).

### 4.4 Fail direction and budget

Fail-open and silent: any error → skip that worktree, exit 0. Whole-hook wall-clock budget 5 s (`timeout` if available, else a background watchdog); on budget exhaustion remaining worktrees are skipped. `jq` missing → exit 0.

### 4.5 Retention

`scripts/checkpoint.sh reap` deletes every `refs/checkpoints/*` ref whose tip committer date is older than 14 days (`git for-each-ref --format='%(refname) %(committerdate:unix)'`). Objects become GC-eligible; no explicit `gc`. Runs backgrounded at SessionStart.

### 4.6 Recovery (documented, not wrapped)

- `bash scripts/checkpoint.sh list` → ref, tip date, trigger line, changed-file count vs HEAD.
- Restore: `git restore --source=<ref> -- <path>` (itself a trigger — the state it overwrites is checkpointed first).
- Documented in `docs/rules/` harness section and the hook header.

## 5. Component 2 — Same-run visibility and Bash coverage

### 5.1 Same-run visibility

**Snapshot (`do_refresh_snapshot`):** remove `r.session_id <> :'sid'`; add `"own": (r.session_id = :'sid')` to each session object; add `last_touch` to each file object (consumed by §6.2).

**Worktree root of a snapshot file entry:** `abs_path` with the suffix `/rel_path` removed (both are recorded per file by `do_record`; no schema change).

**Target root:** as today — walk up to an existing dir, `git rev-parse --show-toplevel`.

**Match table (`do_consult`):**

| Entry from    | Same `abs_path`                      | Same `rel_path`, different root                                              |
| ------------- | ------------------------------------ | ---------------------------------------------------------------------------- |
| other session | `collision` (§6 decides ask vs warn) | `worktree` warn                                                              |
| own session   | **no match** (residual §8)           | **`worktree` warn — new**, only if the entry's `last_touch` is within 15 min |

The own-session cell is gated on `last_touch` because one session that moves between worktrees would otherwise warn against its own history (observed: session `33998fd7` alone spanned `quicklog-impl` and `quicklog-ux`). Cross-session `worktree` warns keep whole-session history (existing behavior).

Own-session `worktree` warnings log `warn-worktree-sibling` (distinct from `warn-worktree`) so the new signal is countable separately.

**TTL:** `TTL='15 minutes'` in `session-coord.sh`; schema default on `expires_at` updated to match.

### 5.2 Bash coverage

- **Extraction:** move `emit_write_targets` (currently `.claude/hooks/git-safety.sh:84`+) **verbatim** into `.claude/hooks/lib/write-targets.sh`; `git-safety.sh` sources it. `test-git-safety.sh` must pass with zero edits (proof the move is behavior-preserving).
- **Relative targets:** new wrapper `emit_write_targets_resolved <cwd>` — calls `emit_write_targets` for absolute targets; additionally emits relative targets joined to `cwd` **iff** the command's words (via `cmd_words_deep`) contain no `cd`/`pushd`. This requires the extractor to also report relative targets, via a new opt-in mode flag whose default (off) keeps `emit_write_targets`' output byte-identical. **Two commits:** (1) the verbatim move, with `test-git-safety.sh` green and unedited; (2) the opt-in relative mode, with `test-git-safety.sh` still green and unedited.
- **Pre-filter:** `grep -qE '>|(^|[^[:alnum:]_])(tee|rm|cp|mv)([^[:alnum:]_]|$)|sed[^|;]*-i'` on the raw command; no match → exit 0 before any parsing.
- **`record` (PostToolUse Bash, backgrounded):** for each resolved target inside a git worktree, the same upsert as the Edit path. Deleted paths are recorded (a delete is a touch).
- **`consult` (PreToolUse Bash, synchronous):** consult each resolved target in order; first `ask` wins, else first warn, else nothing.
- **Wiring:** add `Bash` to the PreToolUse `session-coord-hook.sh consult` matchers and to the PostToolUse `session-coord-hook.sh record` matcher. `session-coord-hook.sh` passes `tool_name` through; `session-coord.sh` branches on it.
- **Fail direction:** unchanged (Postgres down / no jq / parse error → silent allow).

### 5.3 Amendment (post-probe, §9.0.1) — per-agent identity

- **Actor key:** `(session_id, agent_id)`, where `agent_id` is the hook input's `agent_id` or `''` for the main agent.
- **Schema:** `harness.files_in_flight` gains `agent_id text NOT NULL DEFAULT ''`; its unique key becomes `(session_id, agent_id, abs_path)` (schema file `scripts/pg-lab/schema/session-coordination.sql`, idempotent `ALTER … ADD COLUMN IF NOT EXISTS` + key swap). Snapshot file objects carry `agent_id`.
- **Match table replaces §5.1's two rows by actor:**

| Entry from                            | Same `abs_path`            | Same `rel_path`, different root                  |
| ------------------------------------- | -------------------------- | ------------------------------------------------ |
| other session                         | `collision` (§6)           | `worktree` warn                                  |
| own session, **different `agent_id`** | **`collision` (§6) — new** | `worktree` warn (15-min `last_touch` gate, §5.1) |
| own session, **same `agent_id`**      | no match                   | no match                                         |

§6.1 "holds" is restated per actor: H is any actor ≠ the current actor. For own-session actors the registry-row liveness check is the session's own row (always live); `last_touch` ≤ 15 min is the operative condition. Own-session collisions log `ask-collision-sibling`.

- **Record-side verification — DONE 2026-09-27:** a `claude -p --settings` run with a scratch PostToolUse Write hook logged `agent_id`/`agent_type` for the subagent's Write and neither key for the main agent's Write. `record` reads `agent_id` from PostToolUse input directly; no fallback needed.

## 6. Component 3 — Collision ask

### 6.1 Definition of "holds"

Session H **holds** absolute path P iff: H ≠ current session, H's registry row has `expires_at > now()`, and H has a `files_in_flight` row for P with `last_touch > now() - 15 min`.

A `collision` match (same `abs_path`, other session) that does **not** satisfy the `last_touch` condition stays the existing warn.

### 6.2 Decision flow

0. **Snapshot freshness (changes existing `consult` behavior for all tiers):** today `consult` uses a stale snapshot as-is and refreshes only in the background, so the first edit after any idle period is judged against arbitrarily old data — and §6.2's live confirm only runs on a snapshot _hit_, so a stale snapshot silently misses new holders. New rule: if the snapshot is older than 25 s, refresh **synchronously** with a hard 1 s cap; on timeout or error, fall back to the stale copy. Cost: at most one bounded round-trip per 25 s per session.
1. Snapshot shows no other-session `abs_path` match → silent allow (hot path; local file only).
2. Snapshot shows a match whose snapshot `last_touch` is within 15 min (snapshot gains `last_touch` per file) → **live confirm**: one `psql` query (existing `PGCONNECT_TIMEOUT=2`) evaluating §6.1 for (P, H).
   - confirmed → **ask**
   - not confirmed → warn (existing text)
   - psql unreachable/error → **ask** if snapshot age < 60 s, else warn
3. Ask-once suppression (§6.4) checked before emitting ask; suppressed → warn.
4. `SKIP_COLLISION_ASK=1` in the hook's environment → any ask becomes warn.

### 6.3 Output

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "ask",
    "permissionDecisionReason": "Session d398476e (todo-executor, branch todo/foo, worktree agent-a9ea…) last touched client/foo.ts 3 min ago. Approve to edit anyway.",
    "additionalContext": "<same fact, for the model>"
  }
}
```

`additionalContext` alongside `permissionDecision` is gated on the pre-plan probe (§9.0); if unsupported, `additionalContext` is dropped and only the reason is emitted.

### 6.4 Ask-once suppression

- On emitting ask: write `/tmp/claude-session-coord-<sid>.asks/<sha1(abs_path)>` containing `pending <holder_sid> <epoch>`.
- `record` (PostToolUse — fires only if the tool ran, i.e. the user approved): if a `pending` marker exists for the path, rewrite it `approved <holder_sid> <epoch>`. The promotion is a local file write done **synchronously in `session-coord-hook.sh` before it backgrounds the psql part** — otherwise the model's next Edit can reach PreToolUse before the backgrounded `record` flips the marker, producing a second prompt.
- `consult`: an `approved` marker for the same (path, holder) younger than 15 min → warn instead of ask.
- The markers directory is removed at SessionEnd by `session-coord-hook.sh deregister` (same charset-guarded `SESSION_ID`).

### 6.5 Telemetry

`coordination_log` events: `ask-collision` (detail: file, holder), `ask-approved` (on marker promotion), `ask-downgraded` (detail: reason ∈ {`stale-touch`, `live-unconfirmed`, `pg-down-stale-snapshot`, `suppressed`, `bypass`}).

## 7. Testing

All tests follow `.claude/hooks/test-*.sh` precedent: hermetic temp git repos and fake snapshots under `mktemp -d`; live pg-lab cases use unique `probe-<pid>-<n>` session ids and delete their rows on exit (EXIT trap). A live case skipped because pg-lab is unreachable is **counted**: every suite ends with `ran N / skipped M / failed F`, and a suite whose live cases were all skipped says so on its last line.

### 7.1 `test-checkpoint.sh`

- **#956 regression:** dirty tracked edit + new untracked test file → run hook (Agent input) → `git checkout -- . && git clean -fd` → `git restore --source=<ref> -- .` + untracked recovery → byte-identical.
- **Non-mutation:** HEAD sha, checksum of `$(git rev-parse --git-path index)` (not `.git/index` — in a linked worktree `.git` is a file), and `git --no-optional-locks status --porcelain` identical before/after. Run in both the main checkout and a linked worktree.
- **Performance:** a repo with ≥2,000 tracked files and one modified file checkpoints well inside the 5 s budget (asserts the copied-index stat cache is used).
- **Triggers:** each of `checkout -- x`, `restore x`, `reset --hard`, `stash`, `clean -fd`, `switch -f b` fires; `git status`, `git log`, `git diff`, `echo checkout` do not; `Agent` and `Task` fire; `Edit` does not.
- **Chain:** two triggers with a change between → second commit's first parent = first; two triggers with no change → one commit.
- **Multi-worktree:** two dirty worktrees + one clean → two refs, clean skipped.
- **Reaper:** refs with committer date 15 d / 13 d old (via `GIT_COMMITTER_DATE`) → 15 d removed, 13 d kept.
- **Fail-open:** non-repo cwd, unreadable worktree, missing jq → exit 0, no stdout.
- **Charset guard:** `session_id` of `..`, `a/b` → no ref written.

### 7.2 `test-session-coord.sh` (extended)

- Every cell of the §5.1 match table, both sides.
- Bash targets: absolute `>`/`>>`/`tee`/`rm`/`cp`/`mv`/`sed -i`; relative with no `cd` (recorded/consulted); relative after `cd` (skipped); non-writing command (pre-filter exits, no parse).
- §6.1 boundary: `last_touch` at 14:59 → ask; 15:01 → warn.
- §6.2 each branch: confirmed, live-unconfirmed, pg-down fresh snapshot (ask), pg-down stale snapshot (warn).
- §6.4 pending → approved via record → next consult warns; approved marker 16 min old → ask again; different holder → ask.
- `SKIP_COLLISION_ASK=1` → warn.
- TTL is 15 minutes (registry row `expires_at - last_seen_at`).

### 7.3 `test-git-safety.sh`

Unmodified; must pass after the `write-targets.sh` extraction.

### 7.4 Mutation checks

New `.claude/hooks/lib/mutants.sh` runner. Each test file may declare:

```bash
MUTANTS=(
  "<target-file>|<sed-expression>|<label>"
  ...
)
```

For each mutant the runner: copies `.claude/hooks/` **and** `scripts/pg-lab/` + `scripts/checkpoint.sh` into a temp root **preserving relative paths** (hooks derive `ROOT` from `BASH_SOURCE`, and `session-coord-hook.sh` reaches `$ROOT/scripts/pg-lab/session-coord.sh` — copying only the hooks dir would silently test the real, unmutated script), points the suite at it through a `HOOKS_ROOT` seam that every new/extended test honours, applies the sed to the target copy, **asserts the diff is non-empty** (unapplied mutant = runner failure, not a survivor), runs the suite with the hook path pointed at the mutated copy, and records killed/survived. Any survivor or unapplied mutant fails the run. Final line: `mutants: killed K / applied A / declared D`.

Required mutants (minimum):

| Target             | Mutation                                                        | Must be killed by                                      |
| ------------------ | --------------------------------------------------------------- | ------------------------------------------------------ |
| `checkpoint.sh`    | drop `GIT_INDEX_FILE=$tmpidx` from `add -A`                     | non-mutation test                                      |
| `checkpoint.sh`    | drop `${prev:+-p $prev}`                                        | chain test                                             |
| `checkpoint.sh`    | remove the unchanged-tree skip                                  | chain (no-change) test                                 |
| `checkpoint.sh`    | `status --porcelain` → `true` (never skip clean)                | multi-worktree test                                    |
| `cmd-detect.sh`    | remove `restore` from work-discarder verbs                      | trigger test                                           |
| `session-coord.sh` | reinstate `r.session_id <> :'sid'`                              | own-session worktree cell                              |
| `session-coord.sh` | own-session abs_path match → collision regardless of `agent_id` | own-session same-agent cell (must stay silent)         |
| `session-coord.sh` | ignore `agent_id` (treat all own-session rows as self)          | own-session different-agent abs_path cell (must ask)   |
| `session-coord.sh` | 15-min touch window → 150 min                                   | 15:01 boundary                                         |
| `session-coord.sh` | `"ask"` → `"allow"`                                             | confirmed-ask test                                     |
| `session-coord.sh` | skip live confirm (trust snapshot)                              | live-unconfirmed test                                  |
| `session-coord.sh` | revert to background-only refresh of a stale snapshot           | stale-snapshot new-holder test                         |
| `session-coord.sh` | drop the own-session `last_touch` gate                          | own-session 16-min-old sibling cell                    |
| `checkpoint.sh`    | drop `--no-optional-locks`                                      | non-mutation test                                      |
| `checkpoint.sh`    | unquote the empty CAS old-value                                 | first-write-CAS test (pre-existing ref → no overwrite) |
| `session-coord.sh` | ignore approved markers                                         | suppression test                                       |
| `session-coord.sh` | drop the `cd`/`pushd` guard                                     | relative-after-cd test                                 |

Runner self-test: one deliberately inert mutant (pattern that matches nothing) must make the runner fail with "unapplied".

## 8. Residuals (documented, accepted)

1. **Concurrent-start race:** two sessions whose _first_ touches of the same file land inside one 25 s refresh interval (each before the other's `record` reaches the snapshot) do not see each other. With §6.2 step 0, stale-snapshot misses after idle periods are closed; only genuinely concurrent starts remain. Closing this requires a live query per edit (rejected: hot-path latency).
2. **Same-actor re-entry only** (narrowed by §5.3): sibling subagents are now distinguishable via `agent_id`; what remains invisible is one actor colliding with itself, which is not a collision. **#956 is still not caught by §6** — the reviewer's `git checkout -- <path>` is not a write target the §5.2 parser reports (it is a git command, not a redirect/`rm`/`cp`/`mv`/`tee`/`sed -i`). **Checkpoints (§4) remain #956's remedy.**
3. **Bash after `cd`:** relative write targets in a command containing `cd`/`pushd` are not consulted — inherited from `git-safety.sh`'s documented residual; interpreter writes (`node -e`, `python -c`) likewise invisible.
4. **Inherited parser residuals:** `emit_write_targets`'s existing gaps (incl. #957 shapes) are inherited unchanged by design.
5. **Checkpoint budget:** worktrees beyond the 5 s budget are skipped on that trigger.
6. **Local-only checkpoints:** a lost machine loses them.

Per CLAUDE.md, future findings against these hooks go to `docs/harness-residuals.md`.

## 9. Rollout

### 9.0 Pre-plan gate — `ask` probe (runs BEFORE the implementation plan is written)

It gates decision #3, is independent of every line of code, and is cheap. Install a probe PreToolUse hook returning `ask` with both `permissionDecisionReason` and `additionalContext`, via a scratch settings file passed with `claude --settings <scratch-file>` if the CLI supports it (verify first), so `.claude/settings.json` is not edited. Observe in: (a) default mode, (b) auto mode, (c) a foreground subagent, (d) a background subagent, (e) **a subagent's prompt while the user is on Remote Control (phone)**. Record per cell: prompt shown? where? reason shown? `additionalContext` delivered to the model? Requires the user at the keyboard/phone. **If (b) resolves a hook `ask` without prompting, or (e) does not reach the phone, return to the user and re-decide #3 before planning.** Results are appended to this spec as §9.0.1.

#### 9.0.1 Probe results (2026-09-27) — GATE PASSED

Probe: scratch `PreToolUse` Write hook via `claude --settings` (the flag loads _additional_ settings; project hooks still ran). Evidence: probe log (hook input per call), per-cell hook-to-write delay (the hook runs inside the tool call — a multi-second gap is a human approval; silent approval would be sub-second), transcript attachments, user observation.

| Cell | Mode / context                                      | Prompted                           | Hook→write | `additionalContext` reached model                  | Reason reached model         |
| ---- | --------------------------------------------------- | ---------------------------------- | ---------- | -------------------------------------------------- | ---------------------------- |
| a    | default (`manual`), main                            | yes                                | 3 s        | yes (`hook_additional_context` attachment; quoted) | no — hook-output record only |
| b    | **auto**, main                                      | **yes** (user-confirmed)           | 4 s        | yes                                                | no                           |
| c    | auto, foreground subagent                           | yes                                | 6 s        | yes (subagent transcript)                          | no                           |
| d    | auto, background subagent                           | yes                                | 5 s        | yes (subagent transcript)                          | no                           |
| e    | auto, background subagent, **Remote Control phone** | **yes, on phone** (user-confirmed) | 20 s       | not checked                                        | not checked                  |

**Unplanned finding — subagent identity exists.** PreToolUse input for a subagent carries `agent_id` and `agent_type` (cells c/d/e: distinct `agent_id`s under the parent's `session_id`; main-agent calls carry neither key). The 2026-07-10 spec's "subagents share session_id" is true but was over-read as "subagents have no identity". This closes most of residual §8.2 — see amendment §5.3.

PRs, one review pass each:

### 9.1 PR 0 — `lib/mutants.sh` runner + its self-test

Small, standalone; removes the only cross-PR dependency (avoids a stacked PR — `feedback_stacked_pr_retarget_before_delete_branch`).

### 9.2 PR 1 — Checkpoints (§4, §7.1, mutants for §4)

Depends on PR 0.

### 9.3 PR 2 — Visibility + Bash coverage (§5, §6.2 step 0, §7.2 visibility/Bash cases, §7.3)

Depends on PR 0; independent of PR 1.

### 9.4 PR 3 — Collision ask (§6, remaining §7.2 cases)

Depends on PR 2 and on the §9.0 probe result.

### 9.5 Verification prompt (after PR 3 merges)

`docs/verification/session-coordination-two-session.md` — a prompt the user runs. Setup: two throwaway worktrees on `probe/coord-a`, `probe/coord-b`; synthetic 3-item mini-backlog of scratch files under `scratch/coord-probe/` in each; nothing pushed, no PRs. Sessions A and B launched concurrently with scripted overlaps:

| #   | Scenario                                                                                                                       | Expected                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| 1   | A touches a file in its worktree; B **idles ≥ 60 s** (so its snapshot is stale), then edits that file **by A's absolute path** | ask on B, naming A — delivered via Remote Control (exercises §6.2 step 0) |
| 2   | B edits the same `rel_path` in its own worktree                                                                                | warn                                                                      |
| 3   | B `rm`s A's file by absolute path                                                                                              | ask                                                                       |
| 4   | A dispatches a subagent that edits B's file                                                                                    | ask surfaces in A's main session / Remote Control, naming the subagent    |
| 5   | A dispatches an Agent, then runs `git checkout -- .`                                                                           | checkpoint ref exists; recovery restores bytes                            |
| 6   | **Negative control:** A and B edit disjoint files                                                                              | **zero** ask/warn events                                                  |

Pass/fail from `coordination_log` event counts **against the number of overlaps attempted** (printed as `observed/attempted` per scenario) plus `git for-each-ref refs/checkpoints`. Ends with cleanup (worktree removal, probe branch deletion, `coordination_log` probe-row deletion). Proves **file-level** non-collision only; todo-level duplicate detection belongs to the claims follow-up.

## 10. Documentation

- Hook headers for `checkpoint.sh`, `lib/write-targets.sh`, `lib/mutants.sh`.
- Amend the 2026-07-10 spec's Status block with a pointer to this spec and the reversal of its warn-only non-goal (collision tier now asks).
- `docs/rules/` harness rule: checkpoint recovery commands; `SKIP_COLLISION_ASK`.
- `.github/copilot-instructions.md` regenerated if `docs/rules/*.md` changes.
