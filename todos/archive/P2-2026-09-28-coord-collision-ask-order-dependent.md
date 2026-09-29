---
title: "Session coordination: whether a collision ask fires depends on snapshot row order"
status: done
priority: medium
created: 2026-09-28
updated: 2026-09-28
assignee:
labels: [deferred, harness]
github_issue:
human_led: true
---

# Session coordination: whether a collision ask fires depends on snapshot row order

## Summary

When a file has more than one holder in the snapshot, `consult` judges only the FIRST collision match. If that match is a holder that doesn't qualify for an ask (stale, a sibling agent, already approved, or not confirmed live), a live, qualifying holder in another session listed after it gets a warning instead of the ask. The snapshot has no defined row order, so which holder comes first moves between runs, and the ask appears to fire at random. The user asked to look at this before any fix (hence `human_led`).

## Background

The PR-level review of #1137 (session coordination v2, PR 3, "collision ask") found this. The review ended "No blocking findings.", so per Review Policy the fix was deferred to a follow-up rather than made on the reviewed branch. The controller reproduced it independently on a throwaway DB (bash 5.3.15):

```
CONTROL (only LIVE holder, 60s):          decision=ask   (must be ask)
LIVE first, STALE(1200s>900) second:      decision=ask
STALE(1200s>900) first, LIVE second:      decision=none   (live holder present -> expected ask)
agentB: LIVE other first, sibling second: decision=ask   (must be ask)
agentB: sibling first, LIVE other second: decision=none   (live other-session holder present -> expected ask)
```

**Why the order is effectively random: heap order leaking into behaviour.** The snapshot is built by `do_refresh_snapshot` in `scripts/pg-lab/session-coord.sh` with `json_agg(...)` and no `ORDER BY`. Postgres then returns rows in physical storage (heap) order. That order shifts whenever a row is rewritten, and the registry heartbeat `UPDATE`s rows constantly. So in live use the "first" holder changes from one refresh to the next.

Three things combine:

1. **No `ORDER BY`** in the snapshot's `json_agg` (around `session-coord.sh:195-201`), so session order is heap order.
2. **`consult_match` keeps only `.[0]`** of the collision matches (`… | .[0] // empty`). The first match decides, whether or not it's own-session, stale, suppressed, or unconfirmed.
3. **`do_consult` stops at the first colliding file** in a multi-file Bash target list (`break` on the first `collision`).

**The fix isn't to sort; it's to stop letting the first match decide.** Sorting other-session and fresh holders first isn't enough. Whether a holder _qualifies_ for an ask is judged per holder, at decision time:

- fresh (touch within `WINDOW_SECS`);
- not suppressed by an approved marker for that exact holder;
- confirmed live by `live_confirm`, a DB query per holder.

Two holders can sort identically and still differ on suppression or liveness. So the code has to look at every collision candidate, ask on the first that qualifies, and fall back to the warning only when none does.

Impact while unfixed: fail-open. The worst case is a warning instead of an ask, which is the pre-PR-3 behaviour. Nothing is ever wrongly blocked, and no data is lost. But the documented promise in `docs/rules/harness.md` ("Editing a file another live session touched in the last 15 min asks the user…") is false whenever a non-qualifying holder happens to come first.

## Acceptance Criteria

- [ ] `consult_match` returns ALL collision records for a file, not just `.[0]`. Worktree-tier records can stay single, since they never ask.
- [ ] `decide_and_emit` (or a new loop around it) walks the collision records and asks on the first one that qualifies: another session (`own = 0`), fresh, not `ask_suppressed`, and `live_confirm` = yes (or the pg-down, fresh-snapshot rule). It warns on the first record only when none qualifies. Keep at most one `live_confirm` query per candidate, and consider a small cap on candidates to bound hook latency.
- [ ] `do_consult` considers every target file of a Bash command the same way, instead of breaking on the first colliding file.
- [ ] Tests in `.claude/hooks/test-session-coord-v2.sh` pin the stale-first and sibling-first orderings (both must `ask`), with the live-first orderings as controls. Also add a multi-file Bash case where the first file's holder doesn't qualify and the second's does.
- [ ] A mutant that restores "first match decides" is killed.
- [ ] Decide whether the snapshot should also get a deterministic `ORDER BY` (e.g. by `last_seen_at DESC, session_id`) for stable output and debugging. It is not the fix itself.

## Implementation Notes

- Files: `scripts/pg-lab/session-coord.sh` (`consult_match`, `decide_and_emit`, `do_consult`, optionally the `do_refresh_snapshot` SQL); `.claude/hooks/test-session-coord-v2.sh`.
- Keep consult fail-open and silent. It runs synchronously on every Edit/Write/MultiEdit/Bash PreToolUse, where a fresh-snapshot consult currently costs ~30–50 ms. Each extra `live_confirm` is a psql round trip, so only confirm candidates that already pass the cheap checks (other-session, fresh, not suppressed).
- `live_confirm` is per holder (`session_id`, `agent_id`, `abs_path`). The ask-once marker is keyed on (file, current agent) and records the holder, so asking on the second holder must write that holder into the pending marker.
- Also fold in the same review's SUGGESTION: add `ask-approved` to the `event` value comment in `scripts/pg-lab/schema/session-coordination.sql` (`do_promote` emits it).

Reproduction (run from a checkout that has PR 3, i.e. #1137 merged; it uses a throwaway DB and never touches `ocrecipes_lab`):

```bash
#!/usr/bin/env bash
set -uo pipefail
echo "interpreter: bash ${BASH_VERSION}"
W=$(git rev-parse --show-toplevel)
SCRIPT="$W/scripts/pg-lab/session-coord.sh"
DB="pg_probe_shadow_$$"; export LAB_DATABASE_URL="postgresql://localhost/$DB"
ME="prme-$$"; LIVE="prlive-$$"; STALE="prstale-$$"
SNAPF="/tmp/claude-session-coord-${ME}.json"
T=$(cd "$(mktemp -d /tmp/probe-sh-XXXX)" && pwd -P); mkdir -p "$T/r"; git -C "$T/r" init -q; R="$T/r"
trap 'psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)" >/dev/null 2>&1; rm -rf "$T" "$SNAPF" "/tmp/claude-session-coord-${ME}.asks"' EXIT
bash "$W/scripts/pg-lab/init.sh" >/dev/null 2>&1
psql -X -q -v ON_ERROR_STOP=1 -d "$LAB_DATABASE_URL" -f "$W/scripts/pg-lab/schema/session-coordination.sql" >/dev/null 2>&1 || { echo "schema failed"; exit 1; }
q() { psql -X -qtA -d "$LAB_DATABASE_URL" -c "$1"; }
for s in "$ME" "$LIVE" "$STALE"; do q "INSERT INTO harness.session_registry (session_id, repo_root) VALUES ('$s','$R')" >/dev/null; done
NOW=$(date +%s)
q "INSERT INTO harness.files_in_flight (session_id, agent_id, abs_path, rel_path, last_touch) VALUES ('$LIVE','', '$R/x.ts','x.ts', now() - interval '60 seconds')" >/dev/null
q "INSERT INTO harness.files_in_flight (session_id, agent_id, abs_path, rel_path, last_touch) VALUES ('$STALE','', '$R/x.ts','x.ts', now() - interval '1200 seconds')" >/dev/null
ses() { printf '{"session_id":"%s","session_kind":"interactive","branch":"b","repo_root":"%s","last_seen_at":"t","files":[{"abs_path":"%s","rel_path":"x.ts","agent_id":"","last_touch":%s}]}' "$1" "$R" "$R/x.ts" "$((NOW - $2))"; }
consult() { jq -n --arg s "$ME" --arg f "$R/x.ts" '{session_id:$s, tool_name:"Edit", tool_input:{file_path:$f}}' | bash "$SCRIPT" consult --stdin-json | jq -r '.hookSpecificOutput.permissionDecision // "none"'; rm -rf "/tmp/claude-session-coord-${ME}.asks"; }
printf '{"sessions":[%s]}\n' "$(ses "$LIVE" 60)" > "$SNAPF"
echo "CONTROL (only LIVE holder, 60s):          decision=$(consult)   (must be ask)"
printf '{"sessions":[%s,%s]}\n' "$(ses "$LIVE" 60)" "$(ses "$STALE" 1200)" > "$SNAPF"
echo "LIVE first, STALE(1200s>900) second:      decision=$(consult)"
printf '{"sessions":[%s,%s]}\n' "$(ses "$STALE" 1200)" "$(ses "$LIVE" 60)" > "$SNAPF"
echo "STALE(1200s>900) first, LIVE second:      decision=$(consult)   (expected ask)"
q "INSERT INTO harness.files_in_flight (session_id, agent_id, abs_path, rel_path, last_touch) VALUES ('$ME','agentA', '$R/x.ts','x.ts', now() - interval '30 seconds')" >/dev/null
sib='{"session_id":"'"$ME"'","session_kind":"interactive","branch":"b","repo_root":"'"$R"'","last_seen_at":"t","files":[{"abs_path":"'"$R/x.ts"'","rel_path":"x.ts","agent_id":"agentA","last_touch":'"$((NOW-30))"'}]}'
consultB() { jq -n --arg s "$ME" --arg f "$R/x.ts" '{session_id:$s, agent_id:"agentB", tool_name:"Edit", tool_input:{file_path:$f}}' | bash "$SCRIPT" consult --stdin-json | jq -r '.hookSpecificOutput.permissionDecision // "none"'; rm -rf "/tmp/claude-session-coord-${ME}.asks"; }
printf '{"sessions":[%s,%s]}\n' "$(ses "$LIVE" 60)" "$sib" > "$SNAPF"
echo "agentB: LIVE other first, sibling second: decision=$(consultB)   (must be ask)"
printf '{"sessions":[%s,%s]}\n' "$sib" "$(ses "$LIVE" 60)" > "$SNAPF"
echo "agentB: sibling first, LIVE other second: decision=$(consultB)   (expected ask)"
```

## Resolution (2026-09-28)

The "ask" became a block in #1155 before this was fixed; the order bug carried over unchanged. Fix approach reviewed by the user first; they chose to name the most recent editor.

- `consult_match` returns every match with a sort key; `do_consult` sorts all matches of all target files (other-session collisions first, most recent touch first) and `decide_and_emit` judges each holder until one qualifies. The warning is the fallback only when none does.
- Caps: 5 holders judged, 3 `live_confirm` queries per consult (new downgrade reason `confirm-cap`), pinned by a test and a "live-check cap dropped" mutant.
- The told marker keeps one line per holder, so two live holders give two blocks and then the edit goes through (a single-slot marker would bounce between them forever).
- Snapshot `json_agg` now has `ORDER BY` (sessions by `last_seen_at DESC`, files by `last_touch DESC`) — for stable output, not the fix.
- The `ask-approved` schema-comment suggestion is moot (#1155 removed the event).
- Tests: the reproduction's orderings, an unconfirmed fresher holder, two live holders, a multi-file Bash case; mutants "first match decides", "candidates not sorted", "told marker keeps only the last holder" are killed.
