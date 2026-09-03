---
title: 'Token guard must bump at every acquire-eligible transition'
track: bug
category: logic-errors
tags: [react-native, client-state, double-submit, generation-counter]
module: client
applies_to: [client/components/**/*.tsx]
symptoms: ["Sheet dismissed mid-save, reopened for a different target, abandoned flow's completion closes the new sheet before the user confirms", "Token guard passes a stale completion check because the token was not bumped on reset", "User loses an unsaved selection in a newly opened sheet due to a stale async completion"]
severity: medium
created: '2026-09-01'
---

## Problem

The token-guard refactoring that introduced `planSaveTokenRef` to prevent an abandoned async flow's completion from clearing a later flow's guard missed a critical reset boundary. When the user dismissed the sheet mid-save (flow A still in flight, `saveToken=1`), reopened for a different target (reset effect fires, setting `isSavingPlanRef.current = false` but NOT bumping the token), and before confirming flow B, flow A's abandoned request resolved — its completion check `planSaveTokenRef.current === savingToken` returned true (`1 === 1`) because the token had never been touched since flow A acquired it. That completion call `setPlanTarget(null)`, closing flow B's freshly-reopened sheet out from under the user mid-selection.

This is the same general bug class as the existing solution `epoch-counter-alone-misses-sweep-vs-fresh-read-race-2026-06-25.md` (a generation counter that is only bumped at one of the two boundaries that matter misses the race at the other boundary), but in a completely different domain: a React UI double-submit guard racing against sheet dismiss/reopen, not an AsyncStorage teardown-sweep-vs-reader race.

## Symptoms

- Sheet closed unexpectedly while user was selecting a new time slot
- No user action triggered the sudden dismissal
- Console logs show abandoned flow's `finally` calling `setPlanTarget(null)` after token guard passed
- Reproduction: Dismiss sheet mid-save → reopen immediately for different target → wait <500ms → sheet closes on its own before user taps Confirm

## Root Cause

The token guard `planSaveTokenRef` is bumped only at **acquire time** (inside `handleConfirmPlanSlot`, line `const savingToken = ++planSaveTokenRef.current`). The `reset` `useEffect`, which fires when `planTarget` transitions from `null` to a new value (i.e. the sheet reopens for a new flow), resets `isSavingPlanRef.current = false` but does **not** bump `planSaveTokenRef.current`.

This means:
1. Flow A acquires token=1, starts save
2. User dismisses sheet — flow A still in flight, token still 1
3. User reopens for target B — reset effect fires: `isSavingPlanRef = false`, token **still 1**
4. Flow A's request resolves — check `planSaveTokenRef.current === 1` → TRUE
5. Flow A's success path closes the newly opened sheet

The token counter only protects **between two acquires** (A's token vs B's token). It does not protect **between an acquire and a reset** (A's token vs A's token checked during B's pre-confirm window).

## Solution

Bump `planSaveTokenRef.current` inside the reset `useEffect` **alongside** `isSavingPlanRef.current = false`:

```ts
useEffect(() => {
  if (planTarget) {
    isSavingPlanRef.current = false;
    planSaveTokenRef.current += 1;  // <-- bump token at every acquire-eligible transition
  }
}, [planTarget]);
```

This closes the window the instant a new flow becomes **acquirable** (on reopen), not only once one is actually **acquired** (on confirm). Now any abandoned flow's stale token can never match again, even during the gap between reopening and re-confirming — because the token has already advanced past the old value.

## Prevention

When a boolean guard is paired with a generation/token counter to protect a **release-side race** (stale completion clearing a later flow's guard), enumerate **every** code path that resets the boolean guard to let a new flow acquire it, and bump the token at **each** of those paths — not only the "happy path" acquire call itself.

The generation counter closes a race only at the exact points it is written. Therefore:
- List all writes to the boolean guard (`isSavingPlanRef.current = false`)
- For each write, verify the token is also bumped
- If not, that write is now a race window

This bug was found via **construct-and-run interleaving verification** (not just re-reading the diff) and was pinned afterward with two regression tests plus mutation-testing:
- **Success-path A-then-B** — normal sequential saves both succeed
- **Reopened-but-not-yet-confirmed** — A abandoned, B reopened, A resolves before B confirms
- **Terminal-failure A-then-B** — A fails after B has started

Each test temporarily inverts or removes each guard branch and confirms its own test goes red before restoring.

## Related Files

- `client/components/coach/CoachChat.tsx` — contains `planSaveTokenRef`, the reset `useEffect`, and `handleConfirmPlanSlot`
- `client/components/coach/__tests__/CoachChat.branches.test.tsx` — contains the three interleaving tests: success-path A-then-B, reopened-but-not-yet-confirmed, terminal-failure A-then-B

## See Also

- [A generation/epoch counter alone can't close a teardown-sweep vs fresh-read race](epoch-counter-alone-misses-sweep-vs-fresh-read-race-2026-06-25.md) — same general bug class (generation counter bumped at only one of two needed boundaries) but in a different domain (AsyncStorage teardown-sweep-vs-reader race)