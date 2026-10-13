# PG Lab: Cross-Terminal Session Coordination — Design Spec

- **Date:** 2026-07-10
- **Status:** **Implemented — PRs #571 / #572 / #573 (all merged 2026-07-10).** Previously: Reviewed 2026-07-10 — `/spec-review` verdict **approve-with-edits**; all required edits applied (watch-pid resolution §5.2, `register --kind` §5.1, attribute-drift join tightened §5.1)
- **Superseded in part (2026-09-27):** the warn-only non-goal is reversed. A confirmed live same-file collision with **another session** now asks (siblings in the same session stay warn-only, user decision 2026-09-28). Per-agent records, Bash coverage and a 15-min window also changed. See `2026-09-27-session-coordination-v2-design.md` §5–§6 (shipped #1136, #1137).
- **Implementation amendments (2026-07-10, review-driven — the code is authoritative where this spec differs):**
  1. **Bounded wait = `--wait-secs 570` + one dispatched retry ≈ 19 min**, not a single 15-min wait (Bash tool 600 s ceiling). Dispatched acquires set `WATCH_INTERVAL_SECS=10` so the contended-timeout report (~581 s worst case) and the identity-less fallback (595 s) land inside the ceiling; a Bash tool timeout with no exit code is treated as exit 2.
  2. **"Connection death frees the lock instantly" required arming `client_connection_check_interval = '2s'`** (session-level, the holder's first statement). On stock Postgres (interval 0) a backend inside `pg_sleep` never notices client death — kill −9/orphan release would have waited up to 24 h. Detection is ~2 s, not instant.
  3. **Release is server-side-first**: `pg_terminate_backend` scoped `datname = current_database()` + `application_name LIKE` + **granted-advisory `pg_locks` EXISTS** runs unconditionally as the authoritative path; pidfile-based local kill is hygiene only (gated on a `ps` identity check against pid reuse). The granted predicate matters: a queued waiter carries the same application_name as the holder — §5.2's plain app_name match would have killed waiters at every handoff. In the /todo dispatch, release is conditional: only after exit 0 (never on exit 2/3 — release force-frees whoever holds).
  4. **`coordination_log` shipped as `ts TIMESTAMPTZ` / `id BIGSERIAL`** (the plan's naming), not §4's `at` / `GENERATED ALWAYS AS IDENTITY` — probe queries must use `ts`.
  5. **Portable mtime is `stat -c %Y … || stat -f %m …` (GNU first)** — the reverse order is darwin-only in practice: GNU `stat -f %m` prints a literal `?` and exits 0, poisoning the fallback (SWR + lock-staleness recovery silently disabled on Linux).
  6. **Refresh-lock staleness recovery added** to §5.1's refresh guard: a mkdir lockdir older than 60 s is broken with one atomic retry — a SIGKILL-orphaned lock would otherwise disable that session's refreshes forever.
- **Source todo:** `todos/P3-2026-07-05-pg-session-coordination.md` (spec-first; deliverable is this reviewed spec, NOT implementation)
- **Master plan:** `docs/research/2026-07-05-pg-lab-roadmap.md` (Phase D)
- **Decision recorded (per AC):** **PROCEED** — visibility registry + warnings for all session types, plus ONE advisory lock scoped to the /todo DB-serial case. LISTEN/NOTIFY and per-session daemons are explicitly dropped (see §9).

## 1. Problem

Parallel Claude Code sessions — interactive terminals, /todo executor fleets, overnight /goal runs — cannot see each other. Every existing mitigation is after-the-fact or convention-based:

- `drift-detect.sh` warns only once HEAD has _already_ moved, and cannot attribute the movement ("likely a parallel terminal" — even when it was the session's own commit behind a stale baseline).
- /todo executor overlap maps miss transitive shared-hook deps (see `feedback_todo_parallel_transitive_collision`); collisions surface at PR time as tangled or superseded work.
- "Schema/DDL todos are DB-serial, own batch" (`feedback_todo_parallel_shared_dev_db`) is orchestrator discipline with no enforcement — a second orchestrator run, a manual session, or a discipline slip races the shared `nutricam` dev DB with nothing to stop it.

## 2. Goals / Non-Goals

**Goals**

1. Any session can see, at edit time, that another live session is mid-flight on the same file — attributed by session, branch, and kind (warn-only).
2. Drift-detect warnings gain attribution: _which_ session moved HEAD, or "no other session registered — likely your own manual op."
3. The DB-serial convention becomes an actual mutex for /todo executors: bounded wait, then fail-safe `blocked`, never a silent race.
4. All of it disappears cleanly when Postgres is down (fail-silent rail, doubly binding here).

**Non-Goals**

- Blocking or locking any interactive session's edits — everything outside the executor mutex is warn-only (drift-detect precedent).
- LISTEN/NOTIFY push notifications (requires a persistent listener process; dropped, §9).
- Replacing drift-detect's local-file trigger (it stays zero-dependency; the registry only enriches it).
- Durable state of any kind. The registry is ephemeral, self-healing runtime state; nothing may ever depend on it surviving.

## 3. Decisions made in brainstorm (2026-07-10, user-confirmed)

| #   | Question                          | Decision                                                                                                                                                                                |
| --- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Primary pain                      | **Both, registry-first** — visibility for every session type; locks ONLY for the /todo DB-serial case                                                                                   |
| 2   | Mutex semantics when lock is held | **Bounded wait (15 min), then mark todo `blocked` + ACTION NEEDED** — never proceed into a known live collision. Postgres DOWN is different: fail-open, proceed as today                |
| 3   | Drift-detect relationship         | **Enrich** — keep the local-file trigger; on drift, query the registry for attribution                                                                                                  |
| 4   | Edit-path wiring                  | **Cached pre-edit consult** — local snapshot, ~20–30s TTL, stale-while-revalidate; never a live psql call on the edit hot path                                                          |
| 5   | Core architecture                 | **B: Hybrid** — lease rows for visibility (staleness → stale warning, tolerable), ephemeral background-psql holder for the advisory lock (crash → instant release via connection death) |

The architecture decision resolves the todo's named core problem — hooks have no persistent connection, so a hook cannot _hold_ a session-scoped advisory lock. The hybrid matches the consistency mechanism to the failure cost: visibility tolerates staleness and gets cheap TTL leases; the mutex tolerates neither phantom-holding nor premature release and gets a real `pg_advisory_lock` whose release is enforced by Postgres's own session semantics.

## 4. Data model

File: `scripts/pg-lab/schema/session-coordination.sql` (one schema file per todo, per rail). Schema: `harness`. Database: `ocrecipes_lab` via `LAB_DATABASE_URL` — never `nutricam`.

```sql
CREATE TABLE IF NOT EXISTS harness.session_registry (
  session_id    text PRIMARY KEY,          -- Claude Code session_id from hook JSON
  pid           integer,                   -- best-effort; informational only
  repo_root     text NOT NULL,             -- absolute path of checkout or worktree
  branch        text,
  head_sha      text,
  session_kind  text NOT NULL DEFAULT 'unknown',  -- interactive | todo-executor | goal | unknown
  started_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL       -- last_seen_at + TTL (10 min); lease
);

CREATE TABLE IF NOT EXISTS harness.files_in_flight (
  session_id   text NOT NULL REFERENCES harness.session_registry(session_id) ON DELETE CASCADE,
  abs_path     text NOT NULL,              -- collision detection (same checkout)
  rel_path     text NOT NULL,              -- cross-worktree comparison (repo-relative)
  first_touch  timestamptz NOT NULL DEFAULT now(),
  last_touch   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, abs_path)
);

-- Append-only value-probe ledger (the ONLY durable table; the two above are ephemeral).
CREATE TABLE IF NOT EXISTS harness.coordination_log (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT now(),
  event        text NOT NULL,   -- warn-collision | warn-worktree | drift-attributed |
                                -- drift-unattributed | lock-acquired | lock-waited |
                                -- lock-timeout | lock-released | lock-orphan-released
  session_id   text,
  other_session text,
  detail       jsonb
);
```

**Lifecycle:** heartbeat (`register`/`record`) upserts and pushes `expires_at` forward; every `consult`/`refresh-snapshot` reaps expired registry rows first (reap-on-read — no cron, no daemon). `files_in_flight` rows die with their session row via cascade. A session's file set is additive for its lifetime (v1 does not try to detect "done editing" — a stale file entry only makes a warning slightly over-inclusive).

**Rail compliance:** drop both live tables mid-session and they repopulate within one heartbeat; nothing durable reads them. `coordination_log` is append-only telemetry (same class as `harness.injection_log`).

## 5. Components

### 5.1 `scripts/pg-lab/session-coord.sh` — single CLI, thin hook wrappers

Subcommands (all fail-silent: any psql/parse error → exit 0, no output):

| Subcommand         | Called from                                                                         | Does                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `register`         | SessionStart hook (async `&`); re-run via Bash with `--kind` by executors/goal runs | Upsert registry row: session_id, pid, repo_root (`git rev-parse --show-toplevel`), branch, HEAD, kind. Also writes the pid→session_id bridge file (§5.1a)                                                                                                                                                                                                                   |
| `record <file>`    | PostToolUse Edit/Write/MultiEdit (async `&`)                                        | Upsert the registry row FIRST (recreating it if TTL-reaped — an idle session must self-heal on its next edit), then upsert the files_in_flight row. `rel_path` is computed from the FILE's containing worktree root (`git -C <dir> rev-parse --show-toplevel`), not the session's cwd — subagents edit outside their session's repo_root (`feedback_subagent_worktree_cwd`) |
| `refresh-snapshot` | Spawned by `consult` when snapshot stale (async)                                    | Query other live sessions + their files → write `/tmp/claude-session-coord-<session_id>.json` atomically (tmp + `mv`). Concurrent spawns collapse to one via `flock -n` on a per-session lockfile — losers exit silently (multi-edit bursts at the staleness boundary would otherwise spawn several redundant refreshes)                                                    |
| `consult <file>`   | PreToolUse Edit/Write/MultiEdit                                                     | Read local snapshot (NO psql on hot path); if older than 25s, use it anyway and spawn `refresh-snapshot &`. Emit `additionalContext` warning on match (§6)                                                                                                                                                                                                                  |
| `attribute-drift`  | `drift-detect.sh` (only after drift already detected)                               | Query registry for other sessions with the **same repo_root only** — each worktree owns its own HEAD ref, so a session in a sibling worktree cannot have moved this checkout's HEAD; matching across worktrees would misattribute. Print one attribution line for the warning                                                                                               |
| `deregister`       | SessionEnd hook (best-effort)                                                       | Delete registry row (TTL is the real cleanup)                                                                                                                                                                                                                                                                                                                               |

`session_kind` detection: **explicit CLI re-upsert, not an env-var side channel** (spec-review required edit — Bash `export` does not persist across tool calls in this harness, and subagents get no fresh SessionStart to re-run the hook). The /todo dispatch prompt instructs the executor to run `scripts/pg-lab/session-coord.sh register --kind todo-executor` as its **first action**; /goal dispatch likewise with `--kind goal`. This re-upserts the shared-session_id row — last-writer-wins on `kind`/`repo_root` is accepted because kind is informational, never load-bearing. SessionStart default: `interactive` when stdin is a TTY, else `unknown`.

### 5.1a Session identity for direct CLI invocation (the pid→session_id bridge)

Hooks receive `session_id` on stdin JSON; **direct Bash invocations of `session-coord.sh` and `db-serial-lock.sh` do not** — and no documented env var exposes it (verify `CLAUDE_SESSION_ID` availability during PR 1 as a possible simplification). The bridge: at SessionStart, `register` resolves the long-lived Claude Code process pid via the **documented ps-walk** (§5.2 — walk `ps -o ppid=` from `$$` upward until a process whose command basename/argv matches `claude`; same algorithm, one shared helper) and writes `/tmp/claude-session-coord-pid-<claude-pid>.sid` containing the `session_id`. Any later Bash invocation runs the same walk from its own shell, lands on the same Claude Code pid (subagent shells are children of the same process), and reads its session identity from that file. Bridge file missing (`/tmp` cleaned, register never ran, walk failed): CLI subcommands fail silent per rail; `db-serial-lock.sh` still functions — the lock itself never needs session_id — but logs/`application_name` fall back to pid-based identity and registry attribution of the holder degrades (failure-mode row 15).

### 5.2 `scripts/pg-lab/db-serial-lock.sh` — the one real lock

```
db-serial-lock.sh acquire [<key>]   # default key: db-serial:nutricam
db-serial-lock.sh release [<key>]
db-serial-lock.sh status  [<key>]
```

**Acquire protocol:**

1. If `LAB_DATABASE_URL` unreachable → print `WARN: lock unavailable (Postgres down) — proceeding unlocked` → **exit 0** (fail-open; DB down = today's behavior).
2. Spawn the **holder**: a background process running one psql session with `application_name = 'db-serial-holder-<key-hash>-<session_id>'` that executes `SET lock_timeout = '15min'; SELECT pg_advisory_lock(hashtext('<key>'));` then holds the connection open (sleep loop). Lock lifetime == holder-process lifetime.
3. Parent waits for the holder to report `ACQUIRED` (writes a pidfile `/tmp/claude-db-serial-<key-hash>-<session_id>.pid`) or `TIMEOUT`.
4. On `TIMEOUT` (another holder kept it 15 min): print the holder's identity from the registry + `coordination_log`, **exit 2**. The executor's contract on exit 2: mark the todo `blocked` with an ACTION NEEDED reason naming the holding session — never proceed.

**Release:** `release` kills the holder by pidfile → connection closes → Postgres frees the lock instantly. Fallback when the pidfile is gone (`/tmp` cleaned): terminate the holder server-side by `application_name` — `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'db-serial-holder-<key-hash>-<session_id>'`. Never kill by the registry's session pid — that is the Claude Code process, not the holder.

**Orphan safety (two independent liveness mechanisms — no single failure leaves a phantom lock):**

- The holder loops `kill -0 <watch-pid>` every 30s and exits when that process dies → crashed executor releases within ~30s. **The watch target is the long-lived Claude Code process pid — NOT the transient Bash-tool shell**, which dies the moment the tool call returns and would release the lock immediately. Resolution (spec-review required edit — `drift-detect.sh`'s own header already flags PID identification as unreliable across processes, so this is pinned down): **orchestrator-dispatched `acquire` calls MUST pass `--watch-pid` explicitly**, with the dispatch prompt stating the resolution method (the shared ps-walk helper below). For manual/interactive invocation, `acquire` falls back to the documented auto-walk: from `$$`, follow `ps -o ppid=` upward until a process whose command basename or argv matches `claude`; first match wins. **If the walk reaches init/launchd with no match, `acquire` refuses the lock — WARN + exit 3** ("watch-pid unresolvable — refusing to hold an unwatchable lock") — it never silently watches nothing or a wrong ancestor. The caller's contract on exit 3: proceed unlocked (today's convention-only behavior — same fail-open rationale as Postgres-down, since no other session provably holds the lock).
- Machine crash / holder kill −9 / OOM → the TCP connection drops → Postgres releases the advisory lock immediately. There is NO TTL to tune and no reaper to run.

**Who calls it:** the /todo orchestrator's dispatch prompt for schema/DDL todos instructs the executor: resolve the Claude Code pid via the shared ps-walk helper, then `acquire --watch-pid <pid>` before the first `db:push`/DDL step, `release` on completion (success or failure). The DB-serial batching _convention_ stays as the first line; the lock converts discipline into enforcement for the cases discipline misses (second orchestrator run, manual session, transitive slip).

### 5.3 Hook wiring (deltas to `.claude/settings.json`)

| Event        | Matcher                | Addition                                                                                                                                                                                                                                                                                                                       |
| ------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SessionStart | \*                     | `session-coord.sh register &`                                                                                                                                                                                                                                                                                                  |
| PreToolUse   | Edit\|Write\|MultiEdit | `session-coord.sh consult` (snapshot read — one file stat + read)                                                                                                                                                                                                                                                              |
| PostToolUse  | Edit\|Write\|MultiEdit | `session-coord.sh record &` (zero added latency)                                                                                                                                                                                                                                                                               |
| SessionEnd   | \*                     | `session-coord.sh deregister &` — **first SessionEnd wiring in this repo** (settings.json currently registers only SessionStart/PreToolUse/PostToolUse); its JSON-stdin contract is unverified here. Verify during PR 1; a contract surprise degrades harmlessly to TTL-only cleanup since deregister is best-effort by design |
| —            | —                      | `drift-detect.sh`: ~5-line patch calling `attribute-drift` after drift fires                                                                                                                                                                                                                                                   |

Hot-path budget: the only synchronous addition is `consult`, which is a local file read. Live psql happens only in async spawns and at most once per 25s snapshot window per session. (Context: per-Bash hook overhead is already ~140ms/8 spawns — this design adds one Edit/Write-path spawn and zero Bash-path spawns.)

## 6. Warning semantics (all warn-only)

`consult` compares the target file against the snapshot's _other-session_ entries (own `session_id` always excluded — subagents share the parent's session_id and must not self-trigger):

1. **Same `abs_path`** → collision warning:
   > Session `<id-prefix>` (`<kind>`, branch `<branch>`, last seen `<n>`m ago) is mid-edit on this same file in this same checkout. Coordinate before editing — parallel same-file edits here produced tangled commits before.
2. **Same `rel_path`, different `repo_root`** → cross-worktree note:
   > Session `<id-prefix>` (`<kind>`, branch `<branch>`) is editing the same file in another worktree — expect a merge conflict when both land.

Emitted as `hookSpecificOutput.additionalContext` (identical shape to drift-detect; never `permissionDecision`). Every emission also appends to `coordination_log` (async).

**Stated limitation — same-session suppression:** because /todo executors are Agent-tool subagents, they share the orchestrator's `session_id`; two executors under the SAME orchestrator run therefore never warn about each other (self-suppression). That collision class stays owned by the orchestrator's in-process overlap map (`feedback_todo_parallel_transitive_collision`). What the registry uniquely adds is **cross-session** visibility: a second orchestrator run, an overnight /goal run, or your manual terminal colliding with any of them — the cases no single process can see today.

Drift-detect enrichment replaces the current guess ("Likely cause: parallel-terminal commit…") with one of:

- `Attribution: session <id-prefix> (<kind>, branch <branch>) is registered in this checkout, last seen <n>m ago.`
- `Attribution: no other live session registered here — likely your own manual git op or a stale baseline.`

## 7. Failure-mode table (AC-required)

| #   | Failure                                                                                | Behavior                                                                                                                                                                                                                    | Residual risk                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Postgres down / `LAB_DATABASE_URL` unset                                               | All subcommands exit 0 silently; consult uses last snapshot if present, else silent; drift-detect reverts to today's unattributed warning; mutex fail-open with a visible WARN line                                         | None — exactly today's world                                                                                                                     |
| 2   | Session crashes without SessionEnd                                                     | Registry row expires via TTL (10 min); reap-on-read removes it                                                                                                                                                              | Stale warnings naming a dead session for ≤ 10 min                                                                                                |
| 3   | Two sessions, same checkout                                                            | Level-1 collision warning with attribution                                                                                                                                                                                  | Warning latency ≤ snapshot TTL (~25s)                                                                                                            |
| 4   | Sessions in separate worktrees                                                         | Level-2 rel_path note; abs_paths differ so no false collision                                                                                                                                                               | Cross-branch same-file edits are sometimes legitimate; warn-only keeps this cheap                                                                |
| 5   | Subagents (don't inherit worktree cwd; share parent session_id)                        | Files recorded under parent session; abs_path keeps worktree attribution correct even when a subagent edits outside its intended worktree; self-warnings suppressed by session_id                                           | A subagent editing the main checkout (the known `feedback_subagent_worktree_cwd` failure) now _shows up_ in other sessions' warnings — a feature |
| 6   | Snapshot cache stale/corrupt                                                           | Stale: warnings delayed ≤ 25s. Corrupt/unparseable: consult exits silently, next refresh overwrites atomically                                                                                                              | Missed warning for one window                                                                                                                    |
| 7   | Lock holder orphaned (session killed)                                                  | PPID watch exits ≤ 30s → connection closes → lock freed                                                                                                                                                                     | ≤ 30s of false holding                                                                                                                           |
| 8   | Machine crash while holding lock                                                       | Postgres drops the dead connection → lock freed immediately on detection                                                                                                                                                    | Postgres TCP keepalive window                                                                                                                    |
| 9   | Lock wait exceeds 15 min                                                               | `acquire` exits 2 → executor marks todo `blocked` + ACTION NEEDED naming holder                                                                                                                                             | Serializable work deferred to human — chosen over silent racing                                                                                  |
| 10  | Two sessions race `acquire` simultaneously                                             | Postgres advisory-lock semantics serialize them; loser waits/times out                                                                                                                                                      | None                                                                                                                                             |
| 11  | Clock skew between sessions                                                            | All TTL math uses server-side `now()` — client clocks never compared                                                                                                                                                        | None                                                                                                                                             |
| 12  | `/tmp` cleaned mid-session                                                             | Snapshot/pidfile vanish: consult silent until next refresh; `release` falls back to server-side `pg_terminate_backend` by `application_name`, else holder self-reaps via watch-pid                                          | Lock held ≤ 30s past release attempt                                                                                                             |
| 13  | Same-run executor collision (two executors under ONE orchestrator)                     | NOT caught — executors are subagents sharing the orchestrator's session_id, so their mutual edits are self-suppressed (§6). The in-process overlap map remains the owner of this case                                       | Known limitation, stated by design — the registry's unique value is CROSS-session visibility                                                     |
| 14  | watch-pid unresolvable (ps-walk finds no `claude` ancestor — manual/exotic invocation) | `acquire` refuses: WARN + exit 3, lock NOT taken; caller proceeds unlocked (convention-only, today's behavior). Never watches nothing or a wrong ancestor                                                                   | Mutex coverage lost for that one invocation, visibly                                                                                             |
| 15  | pid→session_id bridge file missing (`/tmp` cleaned, register never ran)                | `session-coord.sh` CLI subcommands fail silent per rail; `db-serial-lock.sh` still locks correctly (lock needs no session_id) with pid-based identity in `application_name`; holder attribution in warnings degrades to pid | Cosmetic — attribution names a pid instead of a session                                                                                          |

## 8. Testing

`.claude/hooks/test-session-coord.sh` fixture suite (existing hook-test convention; hooks → automerge-HELD, individual review, self-tests mandatory per todo Risks):

- Registration lifecycle: register → record → consult round-trip; TTL expiry + reap-on-read; deregister.
- Warning levels: same-abs_path fires level 1; same-rel_path/different-root fires level 2; own-session suppressed.
- Snapshot: stale-while-revalidate (stale snapshot still consulted, refresh spawned); corrupt snapshot → silent; atomic replace.
- Fail-silent: every subcommand with `LAB_DATABASE_URL` pointed at a closed port → exit 0, empty stdout on warn paths, WARN line on `acquire` only.
- Mutex: two real competing holders — second waits; kill first → second acquires; kill −9 the holder → lock observable-free (poll `pg_locks`); orphan watch release; timeout path exits 2; unresolvable watch-pid path exits 3 without taking the lock.
- **Orphan test kills the WATCHED pid, not just the holder** (spec-review validation requirement) — proves the resolved watch-pid is actually the session's process, not a coincidentally-alive ancestor.
- **Live-fire kind check** (spec-review validation requirement): dispatch a real todo-executor subagent and confirm post-hoc that `harness.session_registry.session_kind` reads `todo-executor` — not merely that the code path exists.
- Drift enrichment: drift + registered other session → attributed line; drift + empty registry → "no other live session" line; drift + Postgres down → today's exact message.

## 9. Alternatives considered and dropped

- **LISTEN/NOTIFY push warnings** (in the todo's title): requires a persistent listening process per session. Without the daemon (below), there is nothing to LISTEN with. Dropped from v1; if the value probe shows the 25s pull latency actually misses real collisions, this is the v2 shape to revisit.
- **C: Per-session daemon** holding one connection (instant liveness, true push, natural lock holding): rejected — a background process per session is a new failure class (orphans, restarts, version skew) for a warn-only feature; the executor mutex, the only correctness-critical piece, gets its process-held lock via the ephemeral holder instead, which exists only while a lock is held.
- **A: Lease-row mutex (no advisory locks)**: rejected — mutex correctness would hang on TTL tuning: crashed executor blocks the mutex until expiry; slow-but-alive executor can _lose_ it mid-migration, which is a correctness failure in exactly the scenario the mutex exists for.
- **File-level locks for interactive sessions**: rejected outright — blocking the user in their own repo violates the warn-only rail and the fail-silent spirit.
- **Folding drift-detect into the registry**: rejected — the drift safety net must keep working with Postgres down; enrichment adds attribution without adding the dependency.

## 10. Value probe (rail-required)

- **Probe date:** ~60 days post-merge (align with the injection-telemetry probe cadence).
- **Questions, answered from `coordination_log`:**
  1. Did collision/worktree warnings fire, and were they true positives (another session genuinely live there)?
  2. Did the mutex ever actually serialize two executors (`lock-waited` events), or time out (`lock-timeout`)?
  3. Did drift attribution change any outcome vs. the old unattributed warning (proxy: `drift-attributed` vs `drift-unattributed` ratio)?
- **Prune rule:** zero true-positive warnings AND zero `lock-waited` events by probe date → simplify to drift-attribution-only or drop, same as any PG Lab feature.

## 11. Implementation sizing (for the eventual plan — NOT this todo)

Three PRs, individually reviewed (hooks → automerge-HELD):

1. Schema + `session-coord.sh` + registry hooks + tests (no consumer-visible warnings yet — soak the write path).
2. `consult` warnings + drift-detect enrichment + tests.
3. `db-serial-lock.sh` + /todo orchestrator dispatch-prompt update + tests.
