---
title: A masked read failure becomes a phantom baseline that corrupts the next write
track: bug
category: logic-errors
module: client
severity: medium
tags: [react-native, client-state, tanstack-query, data-integrity, error-handling]
symptoms: [Toggles/switches all render their default (e.g. ON) after a failed fetch instead of the user's saved state, A user's saved preferences silently appear reset when the backend read errors, Toggling a control after a failed read persists the wrong value because the write was computed against a default-filled baseline]
applies_to: [client/screens/**/*.tsx, client/components/**/*.tsx]
created: '2026-05-28'
---

# A masked read failure becomes a phantom baseline that corrupts the next write

## Problem

A screen reads server state, fills missing fields with a default
(`data?.x ?? {}`), and renders interactive controls whose values derive from
that state. When the read **fails**, `?? {}` masks the error: every control
renders its default, and because the control is still interactive, the user's
next interaction computes and persists a write against a baseline that was never
loaded. The defaulted UI looks like real data, so the user has no signal that
anything is wrong — and the write silently overwrites their real saved value.

This is the read-side mirror of "render the user's data confidently when the
fetch actually failed." It is a data-integrity bug, not a cosmetic one: the
masked read produces an incorrect *write*.

## Symptoms

- After a transient/5xx read failure, switches/toggles snap to their default
  (e.g. all ON) rather than the saved state — looks like the user's settings
  reset themselves.
- Interacting with a control in that state issues a PATCH/POST whose payload is
  derived from the default baseline, overwriting the real value on the server.
- No error or retry affordance appears, because `?? {}` (or `?? []`, `?? 0`)
  swallowed the `isError` signal.

## Root Cause

`const mutes = data?.reminderMutes ?? {}` collapses three distinct states —
loading, loaded-empty, and **failed** — into one "nothing here" value. The
component reads only `{ data, isLoading }`, never `isError`, so a failed read is
indistinguishable from a genuinely empty result. The controls' `disabled` prop
only covered `isLoading`/mutation-pending, so they stayed interactive on error.

## Solution

1. **Read `isError` (and `refetch`)** from the query, not just `data`/`isLoading`.
2. **Swap the whole interactive subtree on error.** Render an error/retry UI
   *instead of* the controls when `isError` — not merely alongside, and not just
   disabled. If no control is rendered, no write can fire against the phantom
   baseline, which satisfies the "block the write" requirement structurally
   rather than relying on a `disabled` flag.
3. **Suppress the global toast for this query** with `meta: { silentError: true }`
   (see the global `QueryCache.onError` net) so the inline error UI and the
   backstop toast don't double-report the same failure.
4. **Surface mutation failures locally.** The global net is query-only — a
   failed toggle write needs its own `onError` (e.g. `toast.error(...)`) so a
   failed PATCH doesn't leave the UI showing a state the server never accepted.

```tsx
const { data, isLoading, isError, refetch } = useReminderMutes();
// ...
{isError ? (
  <View style={styles.errorContainer}>
    <ThemedText accessibilityLiveRegion="assertive">
      {"Couldn't load your reminder settings."}
    </ThemedText>
    <Pressable onPress={() => void refetch()} accessibilityRole="button">
      <ThemedText>Retry</ThemedText>
    </Pressable>
  </View>
) : (
  <View>{/* the toggle list — only mounted when the read succeeded */}</View>
)}
```

## Prevention

- When a control's value derives from a fetched baseline **and** a user action
  writes that baseline back, a failed read MUST block the write path. Gating only
  on `isLoading` is insufficient — `isError` is a separate state.
- Treat `data?.x ?? default` as a smell whenever `x` later seeds a mutation
  payload: the default is fine for rendering, dangerous as a write baseline.
- Pair the inline error UI's Android `accessibilityLiveRegion` with an
  iOS-gated `AccessibilityInfo.announceForAccessibility` on the `isError`
  transition so the failure is not silent for VoiceOver (see the
  live-region accessibility rule; gate to `Platform.OS === "ios"` to avoid an
  Android double-announce).

## Related Files

- `client/screens/CoachRemindersScreen.tsx` — the fix: `isError` swap, `meta.silentError`, mutation `onError`, iOS announce
- `client/lib/query-client.ts` — `shouldSurfaceQueryError` / `meta.silentError` opt-out for the global query-error net
- `shared/types/reminders.ts` — `ReminderMutes` (the partial-record type that `?? {}` defaulted)

## See Also

- `docs/solutions/design-patterns/query-error-retry-pattern-2026-05-13.md` — the accessible Retry-button shape used here
- `docs/solutions/design-patterns/module-level-emitter-bridge-out-of-tree-to-toast-2026-05-28.md` — the global `QueryCache.onError` net and the `meta: { silentError: true }` opt-out convention
- `docs/solutions/conventions/per-field-fallback-partial-data-2026-05-13.md` — `??` per-field fallback is correct for *rendering* partial data; this entry is the counter-case where `??` masks a *failure*
