---
title: 'A two-phase approval marker (PreToolUse writes pending, PostToolUse promotes) turns a DENIED ask into a silent approval unless the next PreToolUse purges the stale pending marker'
track: bug
category: logic-errors
module: shared
severity: medium
tags: [harness, hooks, pg-lab, ask, approval, state-machine]
symptoms: ['After the user DENIES a PreToolUse ask, a later edit of the same file runs without an ask and its PostToolUse promotes the old pending marker to approved', 'A real collision with the same holder is then silently downgraded to a warning for the whole approval window, though the user never approved it', 'Every scenario tested in isolation (ask, approve, deny) passes; only the deny → downgraded run → real collision sequence shows it']
applies_to: [scripts/pg-lab/session-coord.sh, .claude/hooks/session-coord-hook.sh]
created: '2026-09-28'
---

# A two-phase approval marker turns a DENIED ask into a silent approval unless the next PreToolUse purges it

> **Superseded in session coordination (2026-09-28).** The collision ask was replaced by a
> block-once deny, because the ask prompt never showed its reason to the user. There is no
> `pending`/`promote` step left in `session-coord.sh`. The lesson still holds for any consent
> inferred from a later hook event.

## Problem

Session coordination's ask-once (#1137) infers approval from the hook lifecycle:

1. PreToolUse `consult` asks, and writes `pending <holder> <ts>` keyed on (file, current agent).
2. If the user approves, the tool runs, and PostToolUse `record` → `promote` flips the marker
   to `approved <holder> <now>`.
3. For the next 15 min, `ask_suppressed` downgrades asks for that (file, agent, holder).

A **denied** ask produces no PostToolUse, so the marker stays `pending`, indefinitely.

## Symptoms

Traced by the #1137 task review, then pinned as a test and reproduced against the pre-fix code:

1. The ask on F against holder H is denied, and the marker stays `pending H`.
2. Later the same (F, agent) is edited **without** an ask. The collision was downgraded (stale
   touch, `SKIP_COLLISION_ASK=1`, Postgres down with a stale snapshot), or H's row went away.
3. That run's PostToolUse `promote` finds `pending H` and writes `approved H now`.
4. H goes live on F again, and `ask_suppressed` matches, so the user gets a warning, not the ask
   they never waived.

Pre-fix run of the pinned test: `stale pending marker is never silently approved — expected
[absent], got [approved]`; `a real collision still asks after the downgrade — expected [ask],
got [none]`.

## Root Cause

"PostToolUse fired, therefore the user approved" holds only for the PostToolUse that follows
**the PreToolUse that asked**. `promote` had no way to tell that run from any later run of the
same (file, agent), because nothing ever invalidated a `pending` marker. The marker's lifetime
was bounded by the promotion event, and a denial is the one outcome that never produces that
event.

## Solution

A `pending` marker that survives to the **next PreToolUse** for the same (file, agent) can only
mean the earlier ask was denied or abandoned. A genuine approval would already have been
promoted at the PostToolUse in between. So `do_consult` purges it before judging, and a fresh
ask re-creates it:

```bash
ask_d=$(ask_dir "$sid")
if [ -d "$ask_d" ]; then
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    pm="$ask_d/$(ask_key "$f" "$agent")"
    [ -f "$pm" ] || continue
    read -r st _ _ < "$pm" 2>/dev/null || continue
    [ "$st" = pending ] && rm -f "$pm"      # approved markers are left alone
  done <<<"$files"
fi
```

Test the full sequence: ask → no record (the deny) → a downgraded consult → the shim's `record`
→ the marker is **not** `approved` → a plain consult **asks** again. Add a mutant that disables
the purge, and check it is killed.

## Prevention

- For any "infer consent from a later lifecycle event" marker, enumerate the outcome that
  **never fires** that event (deny, cancel, crash) and give the marker an invalidation point on
  the **next** event of the opening kind. A timestamp bound alone is not enough, since a
  downgraded run inside the window still promotes.
- Test the sequence, not the states. Ask, approve and deny each pass alone. The defect only
  appears across deny → unprompted run → real collision.

## Related Files

- `scripts/pg-lab/session-coord.sh` (`do_consult` purge, `ask_mark_pending`, `ask_suppressed`, `do_promote`)
- `.claude/hooks/session-coord-hook.sh` (synchronous `promote` before the backgrounded `record`)
- `.claude/hooks/test-session-coord-v2.sh` (the `deny:` rows and the purge mutant)

## See Also

- [verification runbook scenarios must not share state](../best-practices/verification-runbook-scenarios-must-not-share-state-2026-09-28.md): the same marker made a runbook false-fail
