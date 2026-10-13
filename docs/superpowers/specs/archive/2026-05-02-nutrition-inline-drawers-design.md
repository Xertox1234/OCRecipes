# Nutrition & Health Inline Drawers — Fasting Timer & Weight Log

**Date:** 2026-05-02
**Status:** Approved

## Overview

Replace the `fasting-timer` and `log-weight` action rows in the Nutrition & Health section with inline collapsible drawers, following the same `renderInline: true` pattern used by Quick Log. Remove the `ai-coach` action row (the Coach tab is always accessible in the bottom navigation).

After this change, the Nutrition & Health section contains exactly three entries, all inline:

1. Quick Log (existing)
2. Fasting Timer (new inline drawer)
3. Log Weight (new inline drawer)

---

## Action Config Changes (`action-config.ts`)

- Add `renderInline: true` to `fasting-timer`
- Add `renderInline: true` to `log-weight`
- Remove the `ai-coach` entry from `HOME_ACTIONS`
- Remove the `ai-coach` case from `navigateAction`

---

## HomeScreen Rendering

Currently `HomeScreen.tsx` has a single branch for inline actions:

```tsx
action.renderInline
  ? <QuickLogDrawer key={action.id} action={action} />
  : <ActionRow ... />
```

This must become a per-id dispatch so each inline action renders its own component. A small helper inside `HomeScreen.tsx` keeps the JSX clean:

```tsx
function renderInlineAction(action: HomeAction) {
  switch (action.id) {
    case "quick-log":
      return <QuickLogDrawer key={action.id} action={action} />;
    case "fasting-timer":
      return <FastingDrawer key={action.id} action={action} />;
    case "log-weight":
      return <WeightLogDrawer key={action.id} action={action} />;
    default:
      return null;
  }
}
```

The three drawer components are always-mounted (like `QuickLogDrawer`) so their collapse animations are preserved.

---

## FastingDrawer (`client/components/home/FastingDrawer.tsx`)

### Header row (collapsed)

| State                     | Subtitle                                  |
| ------------------------- | ----------------------------------------- |
| Active fast               | `● 8h 14m · 51%` in `theme.success` green |
| Not fasting, schedule set | Protocol + hours e.g. `16:8 scheduled`    |
| Not fasting, no schedule  | `Start your first fast`                   |

### Expanded body — active fast

```
┌─────────────────────────────────────────┐
│  [64px ring]  🔥 Metabolic switching    │
│   8:14 / 51%  Your body is burning fat… │
│               4h 54m to goal.           │
├───────────┬──────────────┬──────────────┤
│ 4h 54m    │     3        │   10:05      │
│ to goal   │  day streak  │   started    │
├───────────┴──────────────┴──────────────┤
│          [ ■  End Fast  ]               │
│    [ 📊 History, stats & settings ]     │
└─────────────────────────────────────────┘
```

- **Mini ring:** 64px SVG circle, same stroke geometry as `FastingTimer.tsx`. Progress arc uses `theme.success` when complete, `theme.link` otherwise. No animation — static snapshot (avoids per-second re-renders in the list).
- **Phase name + description:** from `useFastingTimer().currentPhase`. Hidden if `currentPhase` is null.
- **Stat chips:**
  - _Time to goal:_ `targetHours * 60 - elapsedMinutes` formatted as `Xh Xm`. Shows `Goal reached!` when `progress >= 1`.
  - _Day streak:_ `stats?.currentStreak ?? 0`.
  - _Started:_ `currentFast.startedAt` formatted as `h:mm AM/PM`.
- **End Fast button:** calls `handleEndFast()` (which triggers the existing confirmation modal from `useFastingTimer`). Shows "Ending…" + `busy` while pending.
- **Tap-through:** `navigation.navigate("Fasting")`.
- **After ending:** drawer stays open; state transitions to idle view.

### Expanded body — not fasting

```
┌─────────────────────────────────────────┐
│  [64px ring]  Ready to fast?            │
│    🌙 (dim)   16:8 · 16h fast,          │
│               8h eating window.         │
├───────────┬──────────────┬──────────────┤
│     5     │   15h 42m    │    83%       │
│day streak │   last fast  │ completion   │
├───────────┴──────────────┴──────────────┤
│          [ ▶  Start Fast  ]             │
│    [ 📊 History, stats & settings ]     │
└─────────────────────────────────────────┘
```

- **Mini ring:** empty track only, moon emoji centred (dimmed to 35% opacity).
- **Title/description:** "Ready to fast?" + schedule description. If no schedule: "Set up a schedule or start a 16h fast".
- **Stat chips:**
  - _Day streak:_ `stats?.currentStreak ?? 0`.
  - _Last fast:_ `logs[0]?.actualDurationMinutes` formatted as `Xh Xm`. Shows `—` if no history.
  - _Completion rate:_ `Math.round((stats?.completionRate ?? 0) * 100)%`. Shows `—` if no history.
- **Start Fast button:** calls `handleStartFast()`. Shows "Starting…" + `busy` while pending.
- **After starting:** stays open; transitions to active-fast view.

### Data

Consumes `useFastingTimer()` (already exists, used by `FastingScreen`). The hook returns `ConfirmationModal` — render it inside the component: `<ConfirmationModal />`.

---

## WeightLogDrawer (`client/components/home/WeightLogDrawer.tsx`)

### Header row (collapsed)

| State                       | Subtitle                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| Has entries                 | `78.4 kg · ▼ 1.2 kg/wk` (delta uses `theme.success` if negative, `theme.error` if positive) |
| No entries yet              | `Log your first weight`                                                                     |
| Just logged (transient, 3s) | `✓ Logged 78.2 kg` in `theme.success`                                                       |

### Expanded body

```
┌───────────┬──────────────┬──────────────┐
│   78.4    │    ▼ 1.2     │    75.0      │
│ last (kg) │  this week   │  goal (kg)   │
├───────────┴──────────────┴──────────────┤
│ ████████░░░░░░░░░░░░░░  3.4 kg to goal  │
├─────────────────────────┬───────────────┤
│   [  78.5  (large)    ] │     kg        │
├─────────────────────────┴───────────────┤
│          [  Log Weight  ]               │
│       Full chart & history →            │
└─────────────────────────────────────────┘
```

- **Stat chips:**
  - _Last weight:_ `logs[0]?.weight` in kg (1 decimal). Shows `—` if no entries.
  - _This week:_ weekly delta from `useWeightTrend`. Format: `▼ 1.2` (green) or `▲ 0.5` (red). Shows `—` if insufficient data.
  - _Goal:_ `trend?.goalWeight` in kg. Shows `—` if not set.
- **Goal progress bar + label:** only rendered when `trend?.goalWeight` is defined. Bar fill = `(currentWeight - goalWeight) / (startWeight - goalWeight)` clamped 0–100%. Label: `X.X kg to goal`. Hidden entirely if goal not set.
- **Weight input:** large numeric keypad input (same pattern as `WeightTrackingScreen`). Validates: numeric, > 0, ≤ 999. Shows inline error on invalid submit.
- **Log Weight button:** calls `useLogWeight().mutate({ weight })`. Disabled while pending.
- **On success:**
  - Input clears.
  - Stat chips update in place (query invalidation for `"/api/weight"` and `"/api/weight/trend"` already handled inside `useLogWeight`'s `onSuccess` — no extra invalidation needed in the drawer).
  - Collapsed subtitle shows "✓ Logged X.X kg" for 3 seconds, then reverts to normal.
  - Drawer stays open.
- **Tap-through:** `navigation.navigate("WeightTracking")`.

### Data

Consumes `useWeightLogs`, `useWeightTrend`, `useLogWeight` (all from `client/hooks/useWeightLogs.ts`).

---

## Empty / First-Time States

| Drawer          | No data condition  | Behaviour                                                            |
| --------------- | ------------------ | -------------------------------------------------------------------- |
| FastingDrawer   | No fasting history | Stat chips show `0` / `—` / `—`. Start Fast button still functional. |
| WeightLogDrawer | No weight entries  | All stat chips show `—`. Goal bar hidden. Input still functional.    |
| WeightLogDrawer | No goal weight set | Goal chip shows `—`. Goal bar hidden.                                |

---

## Animation & Interaction

Both new drawers use the same always-mounted pattern as `QuickLogDrawer`:

- `useCollapsibleHeight(isOpen, reducedMotion)` for animated height expansion.
- `useSharedValue` + `withTiming` for chevron rotation (0° → 90°).
- `cancelAnimation` called before snapping when `reducedMotion` toggles (per `animation.md` pattern).
- Drawer body rendered at zero height when collapsed (not conditionally unmounted), preserving animation.

---

## Accessibility

- Header Pressable: `accessibilityRole="button"`, `accessibilityLabel="[Label], [status subtitle]"`, `accessibilityState={{ expanded: isOpen }}`.
- Error states: `InlineError` component + `AccessibilityInfo.announceForAccessibility` on iOS.
- End Fast / Start Fast: `accessibilityState={{ busy: isPending, disabled: isPending }}`.
- Log Weight button: `accessibilityState={{ busy: isPending, disabled: isPending }}`.
- Tap-through links: `accessibilityRole="link"`.
- Mini ring SVG: `accessible={false}` (decorative; state announced via header label).

---

## File Structure

```
client/
  components/home/
    FastingDrawer.tsx          (new)
    WeightLogDrawer.tsx        (new)
    action-config.ts           (modified: renderInline flags, remove ai-coach)
  screens/
    HomeScreen.tsx             (modified: renderInlineAction helper)
```

No new routes, no schema changes, no server changes.

---

## Testing

- `client/components/home/__tests__/FastingDrawer.test.tsx` — extract pure formatting helpers to `fasting-drawer-utils.ts` and test: stat chip values (active/idle), subtitle string, phase display when null.
- `client/components/home/__tests__/WeightLogDrawer.test.tsx` — extract to `weight-log-drawer-utils.ts` and test: stat chip values (with/without data), goal bar visibility, delta colour logic, post-log subtitle transient state.

---

## Out of Scope

- No changes to `FastingScreen` or `WeightTrackingScreen` (full screens remain available via tap-through).
- The mini ring in `FastingDrawer` is a static SVG snapshot, not a live animated timer — the real-time tick stays on the full `FastingScreen` only.
- No changes to any other Home sections (Scanning, Recipes, Planning).
