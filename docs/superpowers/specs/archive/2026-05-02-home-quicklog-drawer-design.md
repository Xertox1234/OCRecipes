# Home Tab — Inline Quick Log Drawer

**Date:** 2026-05-02
**Status:** Approved for implementation

## Overview

Replace the Quick Log navigation action on the Home tab with an inline expandable drawer. When tapped, a panel slides out beneath the Quick Log row and exposes a condensed logging interface — text input, mic, camera, and frequent-item chips — without leaving the Home screen. Voice Log is removed as a standalone entry in the Nutrition & Health section; voice input is now accessible via the mic button inside the drawer.

A companion improvement to the scan flow adds a progress bar + confirm card on the Scan screen, so users who tap the camera button in the drawer can complete a full scan-to-log cycle and return to Home automatically.

## Goals

- Reduce navigation depth for the most common logging action
- Unify text, voice, and scan entry into one surface
- Remove the redundant Voice Log row from Nutrition & Health
- Make the scan-to-log flow return users to Home without manual back-navigation

## Out of Scope

- Changes to other Nutrition & Health actions (Fasting Timer, Log Weight, AI Coach)
- Any changes to the full QuickLog modal screen (it remains reachable via deep link)
- Redesign of the Scan screen beyond the progress bar and confirm card additions

---

## Component Architecture

### New files

**`client/hooks/useQuickLogSession.ts`**
Extracted from `QuickLogScreen`. Owns all quick-log logic:

- Text input state
- Voice recognition via `useSpeechToText`
- Food parsing via `POST /api/food-nlp`
- Item submission via `POST /api/scanned-items`
- Frequent items query via `GET /api/scanned-items/frequent` (TanStack Query, fetched on first open)

Returns:

```ts
{
  inputText, setInputText,
  isListening, volume,
  parsedItems, removeItem,
  frequentItems,
  submitLog,       // logs all parsedItems, resolves with logged item ids
  startListening, stopListening,
  parseError, submitError,
}
```

**`client/components/home/QuickLogDrawer.tsx`**
Self-contained expandable panel rendered directly in `HomeScreen`. Consumes `useQuickLogSession`. Manages its own open/closed boolean and a Reanimated dynamic-height animation (layout animations on each parsed item row handle the growing content area).

### Modified files

| File                                      | Change                                                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `client/screens/QuickLogScreen.tsx`       | Refactored to use `useQuickLogSession`; behaviour unchanged                                                                     |
| `client/components/home/action-config.ts` | Quick Log action gains `renderInline: true`; Voice Log entry removed                                                            |
| `client/screens/HomeScreen.tsx`           | Renders `QuickLogDrawer` in place of the Quick Log `ActionRow`                                                                  |
| `client/screens/ScanScreen.tsx`           | Add `returnAfterLog?: boolean` route param; when true, show progress bar + confirm card and navigate back to Home after logging |

### Unchanged

`CollapsibleSection`, `ActionRow`, all other home actions, the existing `QuickLog` modal route (deep links continue to work).

---

## Drawer States

### ① Collapsed

Quick Log row displays with a right-pointing chevron, identical to other action rows. No drawer visible.

### ② Expanded (idle)

Tapping the Quick Log row opens the drawer beneath it with a Reanimated height animation. The row chevron rotates to point down. The drawer contains:

- Text input (`placeholder="What did you eat?"`) with mic (🎤) and camera (📷) icons on the right
- Frequent-item chips below the input (fetched from `/api/scanned-items/frequent`, max 5 shown)

Tapping the Quick Log row again collapses the drawer.

### ③ Parsed Results

After the user types or speaks and parsing completes, the drawer expands further to show:

- Each parsed item on its own row: name on the left, calorie estimate + ✕ dismiss on the right
- A footer row: total calories on the left, "Log All" button on the right

Tapping ✕ on an item removes it from the list. The drawer height animates with each addition/removal.

Tapping "Log All" submits all items, closes the drawer, and shows the Home toast.

### ④ Dismiss & Auto-Close

- **Toggle close:** tapping the Quick Log row while expanded collapses it (input is cleared)
- **Auto-close:** after a successful "Log All" the drawer closes automatically

---

## Scan Flow (from drawer camera button)

1. Tap 📷 in drawer → navigates to Scan screen with `returnAfterLog: true`
2. User scans → AI processes → progress bar animates along the bottom of the viewfinder
3. On AI result: confirm card appears over the scan screen:
   - Food name + calorie estimate
   - "Dismiss" (secondary) and "✓ Log It" (primary) buttons
4. Tap "Log It" → item logged → navigates back to Home tab → Home screen shows toast
5. If AI returns no result: "Couldn't identify food — Try again" replaces the confirm card; user stays on Scan screen

---

## Toast (Home screen)

Appears after either the "Log All" (drawer) or "Log It" (scan) path:

```
✅  Logged!
    <food name> · <calories> cal
```

Uses the existing toast infrastructure already in the app. Auto-dismisses after 3 seconds.

---

## Data Flow

```
User input (text / voice / chip tap)
  → useQuickLogSession.parse()
  → POST /api/food-nlp
  → parsedItems[]

User taps "Log All"
  → useQuickLogSession.submitLog()
  → POST /api/scanned-items (one per item)
  → drawer closes, toast shown
  → TanStack Query cache invalidated for daily log
```

Frequent items are fetched once when the drawer first opens and cached by TanStack Query with the standard stale time. No additional network call on subsequent opens within the same session.

---

## Error Handling

| Scenario                      | Behaviour                                                          |
| ----------------------------- | ------------------------------------------------------------------ |
| Parse fails                   | Inline error below text input; drawer stays open                   |
| Log fails                     | Inline error with retry button; drawer stays open                  |
| Voice recognition error       | Inline error (same pattern as current `QuickLogScreen`)            |
| Scan: no AI result            | "Couldn't identify food — Try again" inline message on Scan screen |
| Scan: log fails after confirm | Toast error on Home screen; item not logged                        |

---

## Testing

**`useQuickLogSession`** — unit tested with Vitest against mocked fetch. Cases:

- Parse success → `parsedItems` populated
- Parse failure → `parseError` set, `parsedItems` unchanged
- Submit success → resolves, items cleared
- Submit failure → `submitError` set
- `removeItem` removes correct item by index

**`QuickLogDrawer`** — render tests (three snapshots): collapsed, expanded-idle, expanded-with-items.

**Scan confirm flow** — covered by existing route-level tests in `server/routes/__tests__/`; no new server-side logic.

**`QuickLogScreen` regression** — existing tests continue to pass after hook extraction; no behaviour change.
