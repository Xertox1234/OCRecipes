---
title: "Replace raw server error strings with ApiError.code-driven static copy"
status: done
priority: low
created: 2026-05-31
updated: 2026-05-31
assignee:
labels: [deferred, code-quality, react-native]
github_issue:
---

# Replace raw server error strings with ApiError.code-driven static copy

## Summary

Several UI components render `mutation.error.message` or `err.message` directly to the user or into VoiceOver announcements. These should use `ApiError.code` discrimination with static user-safe copy, matching the pattern already established in the majority of the codebase.

## Background

Surfaced by `/audit code-quality` on 2026-05-31. Four sites pass raw server-originated strings to the user:

- **M1** `MealSuggestionsModal.tsx:283` — `mutation.error.message` announced via `AccessibilityInfo.announceForAccessibility` for non-limit errors (no static fallback)
- **M1** `MealSuggestionsModal.tsx:368` — `mutation.error.message` rendered inside `<ThemedText>` with no code check
- **M2** `FrontLabelConfirmScreen.tsx:89` — `.catch((err: Error) => { setUploadError(err.message || ...) }` — no `instanceof ApiError` check
- **M2** `FrontLabelConfirmScreen.tsx:114` — `onError: (err: Error) => { setConfirmError(err.message || ...) }` — same
- **M3** `GroceryListScreen.tsx:211` — detects 404 by `error.message === "404"` string comparison; `useGroceryList.ts:26` throws `new Error(\`${res.status}\`)` — fragile contract
- **L2** `RecipeAIGenerateScreen.tsx:179–181` — `generateMutation.error instanceof Error ? generateMutation.error.message : "..."` — still renders raw message on the `instanceof` branch

Research confirmed M1 and M2 as project-convention violations (TanStack Query v5 types `error` as `Error | null`; `ApiError.code`-driven copy is the project pattern). L2 is weaker — TanStack docs show `.error.message` as idiomatic, so static copy there is a nice-to-have. M3 (fragile 404 string) is an internal contract issue that should be fixed when refactoring the query hooks.

## Acceptance Criteria

- [ ] `MealSuggestionsModal.tsx:283` — `announceForAccessibility` uses a static string ("Something went wrong. Please try again.") for the non-`DAILY_LIMIT_REACHED` branch
- [ ] `MealSuggestionsModal.tsx:368` — rendered error text uses static copy, not `mutation.error.message`; `ApiError.code` check drives any code-specific messages
- [ ] `FrontLabelConfirmScreen.tsx:89` — `.catch` handler checks `instanceof ApiError` and discriminates by `.code`; falls back to static string for unknown errors
- [ ] `FrontLabelConfirmScreen.tsx:114` — `onError` callback does the same
- [ ] `useGroceryList.ts:26` — queryFn throws `new ApiError("Not found", "NOT_FOUND")` (or equivalent) instead of `new Error(\`${res.status}\`)`; `GroceryListScreen.tsx:211`matches on`apiError.code === "NOT_FOUND"` not a string literal
- [ ] `RecipeAIGenerateScreen.tsx:179–181` — (nice-to-have) replace the `instanceof Error ? .message` branch with a static fallback

## Implementation Notes

The `ApiError` class is at `client/lib/api-error.ts`. Pattern:

```ts
import { ApiError } from "@/lib/api-error";
const isLimit = err instanceof ApiError && err.code === "DAILY_LIMIT_REACHED";
const message = isLimit
  ? "Daily limit reached"
  : "Something went wrong. Please try again.";
```

For M3, check `useMealPlanRecipes.ts` too — it uses the same `throw new Error(\`${res.status}\`)` pattern in 4 places. Fix them together.

Do NOT surface internal quota details, model names, or stack traces in any user-visible string.

## Dependencies

- None

## Risks

- The `ApiError` code list may not cover all server error codes thrown in these paths; verify which codes are returned by the relevant routes before writing `if/else` branches
- Test mocks for these mutations may need updating after the error-type change

## Updates

### 2026-05-31

- Created from `/audit code-quality` 2026-05-31 findings M1, M2, M3, L2
