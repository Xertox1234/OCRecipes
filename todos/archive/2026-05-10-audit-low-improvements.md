---
title: "Batch low-severity audit improvements (L1–L8)"
status: done
priority: low
created: 2026-05-10
updated: 2026-05-11
assignee:
labels: [code-quality, performance, accessibility, react-native]
github_issue:
---

# Batch low-severity audit improvements (L1–L8)

## Summary

Eight low-severity findings from audit 2026-05-10 grouped into a single todo for efficiency. None is a correctness issue or security risk.

## Findings

### L1 — `getToolDefinitions()` per-request (performance)

**File:** `server/services/nutrition-coach.ts:385`
Make the static tool definitions array a module-level constant: `const TOOL_DEFINITIONS = getToolDefinitions();` and reference `TOOL_DEFINITIONS` in `generateCoachProResponse`.

### L2 — `dietType` param: no `.max()` or `.enum()` (validation)

**File:** `server/routes/taste-picks.ts:18`
Change `z.string().optional()` to `z.string().max(50).optional()`. Optionally add `.refine(v => DIET_TYPES.includes(v), "Invalid diet type")` for stricter validation.

### L3 — `setTastePicks` silent cuisine skip when no profile row (data)

**File:** `server/storage/taste-picks.ts:89-94`
Either upsert the profile row if it doesn't exist, or add `log.warn` + explicit handling so the gap is visible in logs.

### L4 — `onConflictDoNothing()` after DELETE is dead code (data)

**File:** `server/storage/taste-picks.ts:56-61`
Remove `.onConflictDoNothing()` from the insert after DELETE. If duplicate IDs in input need handling, deduplicate with `[...new Set(publicIds)]` before the insert values.

### L5 — Camera capture screens hold raw `CameraRef` (maintainability)

**Files:** `ScanScreen.tsx`, `CookSessionCaptureScreen.tsx`, `ReceiptCaptureScreen.tsx`
Consider adopting `useCamera()` hook for the `takePicture()` call so lifecycle changes propagate automatically. Not urgent — works correctly today.

### L6 — API response shape used without Zod validation (type safety)

**Files:** `client/screens/onboarding/TastePicksScreen.tsx:52-54`, `client/screens/TasteProfileScreen.tsx:37, 59-61`
Add Zod `safeParse` on `res.json()` results before using as `TastePickCandidate[]` / `{ recipeId: number }[]`.

### L7 — `TastePicksGrid` card label omits `cuisineOrigin` (accessibility)

**File:** `client/components/TastePicksGrid.tsx:29`
Change `accessibilityLabel={item.title}` to ``accessibilityLabel={`${item.title}${item.cuisineOrigin ? `, ${item.cuisineOrigin} cuisine` : ''}`}``

### L8 — `SuggestionList` uses `accessibilityRole="text"` (accessibility)

**File:** `client/components/coach/blocks/SuggestionList.tsx:31`
Change `accessibilityRole="text"` to `accessibilityRole="none"` (or remove entirely) for static display items.

## Updates

### 2026-05-10

- Deferred from audit 2026-05-10 (L1–L8)

### 2026-05-11

- Implemented L1, L2, L3, L4, L6, L7, L8.
- L5 (Camera capture screens hold raw `CameraRef`): not implemented — audit text says "Consider … Not urgent — works correctly today." Migrating three production camera screens to `useCamera()` is broader than this low-severity batch and is best handled as a separate refactor.
