# Silent Failure Prevention: ESLint Rules + Review Checklist

**Date:** 2026-06-03
**Status:** Revised — ready for implementation planning after drift corrections
**Scope:** Two new ESLint rules in `eslint-plugin-ocrecipes`, one client-scoped config block in `eslint.config.js`, one focused review-check addition in `docs/rules/client-state.md`, and rule tests in `eslint-plugin-ocrecipes/__tests__/rules.test.ts`
**Motivation:** The 2026-05-28 silent failures audit found 46 live findings across 5 root-cause clusters. All 46 are now fixed, but the codebase still lacks write-time enforcement for the two statically detectable recurrence patterns. This spec adds mechanical enforcement (ESLint) for those two patterns and only documents the remaining reviewer-only checks that static analysis still cannot reach.

---

## Architecture

Four files change:

| File                                              | Change                                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `eslint-plugin-ocrecipes/index.js`                | Two new rules: `no-error-message-in-ui`, `no-dead-apiRequest-guard`                                                       |
| `eslint.config.js`                                | One new client-only config block: both rules at `"error"` level, inserted after the existing type-aware TypeScript blocks |
| `docs/rules/client-state.md`                      | Append only the two reviewer-only checks not already covered by existing client-state rules                               |
| `eslint-plugin-ocrecipes/__tests__/rules.test.ts` | RuleTester coverage for both custom rules                                                                                 |

The existing server block (`server/routes/**/*.ts`) is untouched. The two new rules are client-only: `apiRequest` is a client utility, server error shape is already enforced by `no-bare-error-response`, and the repo already carries a global type-aware TypeScript block in `eslint.config.js`. The new client rule block therefore lands after the existing type-aware blocks so the final config order is explicit against the live repo shape, not an older snapshot.

**Pre-flight:** Before the rules can land, any existing violations in `client/` must be fixed in the same PR. Known candidates from the audit period:

- `client/screens/meal-plan/ReceiptMealPlanScreen.tsx:245` — `{generateMutation.error.message}` in JSX
- `client/components/RecipeGenerationModal.tsx:105,456` — `error.message` used as UI copy
- `client/screens/meal-plan/RecipeImportScreen.tsx:81` — `error.message` in catch
- `client/hooks/useFastingTimer.ts:241,270,295` — `toast.error(err.message)` calls

A full violation sweep (`npx eslint client/ --rule '{"ocrecipes/no-error-message-in-ui":"error"}'`) runs as part of implementation to catch any sites not in the list above.

---

## Rule 1: `no-error-message-in-ui`

### What it detects

`.message` property access on error-named bindings used in user-visible contexts.

### Three sub-patterns

**1. JSX expression child**

```tsx
// ❌ flagged
<Text>{error.message}</Text>
<Text>{err.message}</Text>
<View>{uploadError.message}</View>
```

AST: `MemberExpression` with `.message` that is the expression of a `JSXExpressionContainer`.

**2. State setter argument**

```tsx
// ❌ flagged
setError(err.message);
setErrorText(error.message);
```

AST: `CallExpression` where the callee is an `Identifier` whose name starts with `set` AND the first argument is a `MemberExpression` with `.message`.

**3. Toast / announce argument**

```tsx
// ❌ flagged
toast.error(err.message);
toast.warning(uploadError.message);
AccessibilityInfo.announceForAccessibility(error.message);
```

AST: `CallExpression` where the callee matches `toast.error`, `toast.warning`, or `AccessibilityInfo.announceForAccessibility`, AND the first argument is a `MemberExpression` with `.message`.

### Binding name heuristic

The object of `.message` must be named `error`, `err`, or any identifier ending in `Error` (e.g. `uploadError`, `mutationError`). `e` is excluded — it is the conventional name for synthetic event parameters in RN, so `e.message` would false-positive on event handlers. Catch bindings in this codebase uniformly use `error` or `err`.

### Valid patterns (not flagged)

```tsx
// ✅ static copy
toast.error("Something went wrong. Please try again.");
setError("Upload failed");

// ✅ .code branch (not .message)
{
  error.code === "CONFLICT" ? "Already saved." : "Failed to add.";
}

// ✅ unrelated .message
<Text>{notification.message}</Text>;
```

### Error message

> `"Do not render error.message in the UI — show static copy and branch on error.code instead. See docs/rules/client-state.md."`

---

## Rule 2: `no-dead-apiRequest-guard`

### What it detects

An `if (!x.ok)` or `if (x.ok === false)` test on a variable that was assigned from `await apiRequest(...)`. Since `apiRequest` calls `throwIfResNotOk` before returning, the response is always ok — the guard is unreachable dead code.

### AST walk

At each `IfStatement` whose test is:

- `UnaryExpression { operator: "!", argument: MemberExpression { property: "ok" } }`, or
- `BinaryExpression { operator: "===", left: MemberExpression { property: "ok" }, right: Literal(false) }`

Resolve the identifier used in the `.ok` check back to its current binding in scope. Flag when the binding's current value is an awaited `apiRequest(...)` result, including the common same-block cases below:

- direct declaration: `const res = await apiRequest(...)`
- later assignment: `let res; res = await apiRequest(...)`
- one-hop aliasing within the same scope: `const response = res; if (!response.ok) ...`

Do not stop at a naive backward scan of sibling statements. The implementation must be scope-aware enough to follow the checked identifier to the relevant binding/assignment in the enclosing function or block and avoid false negatives from simple reassignment or aliasing.

### Flagged example

```ts
// ❌ flagged
const res = await apiRequest("POST", "/api/cookbooks/add", { recipeId });
if (!res.ok) {
  // ← flagged: always false, apiRequest already threw
  if (res.status === 409) throw new Error("Already in cookbook");
}
```

### Valid patterns (not flagged)

```ts
// ✅ raw fetch — res.ok is meaningful
const res = await fetch(url);
if (!res.ok) { ... }

// ✅ different condition on apiRequest result
const res = await apiRequest("GET", "/api/items");
if (res.items.length === 0) { ... }
```

### Error message

> `"Dead guard — apiRequest always throws on non-ok, so this if(!x.ok) block is unreachable. Delete it and branch on error.code in onError instead. See docs/rules/client-state.md."`

---

## ESLint Config Block

```js
// eslint.config.js — new block added after the existing type-aware TS blocks
{
  files: ["client/**/*.{ts,tsx}"],
  plugins: {
    ocrecipes: ocrecipesPlugin,
  },
  rules: {
    "ocrecipes/no-error-message-in-ui": "error",
    "ocrecipes/no-dead-apiRequest-guard": "error",
  },
},
```

The `ocrecipes` plugin key is already declared in the server block. In flat config, plugins are per-config-object, so the key must be declared again here — but it references the same imported `ocrecipesPlugin` object. The block must be inserted relative to the live config layout: after the existing `typescript-eslint` blocks and before the closing `defineConfig([...])`, not merely "after the server block."

---

## Checklist Addition (`docs/rules/client-state.md`)

`docs/rules/client-state.md` already contains binding bullets for:

- checking `isError` before empty-state rendering
- never rendering `error.message` directly in client UI
- never writing `if (!res.ok)` after `await apiRequest(...)`

This spec must not duplicate those existing rules. The doc change is limited to the two reviewer-only checks that are still not statically enforceable and are not already present:

```markdown
## MUST CHECK — reviewing any new screen or data hook

1. **Every mutation has an `onError` handler that shows visible copy.**
   Haptics-only and iOS-VoiceOver-only handlers leave Android users with a silent
   no-op. `onSuccess`-only hooks are a red flag. Check that a failed save/delete/log
   produces a user-visible message (InlineError, toast, or inline state).

2. **`await mutateAsync(...)` calls are wrapped in try/catch.**
   Unlike `mutate()`, `mutateAsync` rejects on failure — an unwrapped call is an
   unhandled rejection. The hook's `onError` does not suppress this.

3. **Wrapping hooks expose `isError` and `error` when consumers need them.**
   A hook that strips these from its return value makes the query error-surfacing
   pattern structurally impossible for consumers. Check that custom hooks don't
   silently omit error state when consumers render data-dependent UI.
```

If implementation finds these two additions better expressed as standalone bullets rather than a formal `## MUST CHECK` section, prefer whichever shape avoids duplicating existing rules in the same file.

---

## Testing

Uses ESLint's built-in `RuleTester` (ESLint v9 flat-config API). The `.ts` extension is required — `vitest.config.ts` includes `**/*.test.ts` but not `**/*.test.js`, so a `.js` file would be silently skipped by the test runner.

**`RuleTester` setup for ESLint v9 with JSX:**

```ts
import { RuleTester } from "eslint";
import * as tsParser from "@typescript-eslint/parser";

const tester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});
```

`@typescript-eslint/parser` is already a project dependency (used by `eslint.config.js`). The v9 `RuleTester` uses `languageOptions.parser` rather than the legacy top-level `parser` option.

### `no-error-message-in-ui` — 7 test cases

| #   | Code                                  | Expect                       |
| --- | ------------------------------------- | ---------------------------- |
| 1   | `<Text>{error.message}</Text>`        | ❌ error                     |
| 2   | `<Text>{err.message}</Text>`          | ❌ error                     |
| 3   | `<View>{uploadError.message}</View>`  | ❌ error                     |
| 4   | `setError(err.message)`               | ❌ error                     |
| 5   | `toast.error(err.message)`            | ❌ error                     |
| 6   | `<Text>{error.code}</Text>`           | ✅ valid                     |
| 7   | `<Text>{notification.message}</Text>` | ✅ valid (non-error binding) |

### `no-dead-apiRequest-guard` — 4 test cases

| #   | Code                                                                    | Expect                         |
| --- | ----------------------------------------------------------------------- | ------------------------------ |
| 1   | `const res = await apiRequest(...); if (!res.ok) { ... }`               | ❌ error                       |
| 2   | `const res = await apiRequest(...); if (res.ok === false) { ... }`      | ❌ error                       |
| 3   | `const res = await fetch(...); if (!res.ok) { ... }`                    | ✅ valid (raw fetch)           |
| 4   | `const res = await apiRequest(...); if (res.data.length === 0) { ... }` | ✅ valid (different condition) |

Add scope-aware cases to prove the implementation meets the required bar rather than only the trivial sibling-scan case:

| 5 | `let res; res = await apiRequest(...); if (!res.ok) { ... }` | ❌ error |
| 6 | `const res = await apiRequest(...); const response = res; if (!response.ok) { ... }` | ❌ error |
| 7 | `const res = await fetch(...); const response = res; if (!response.ok) { ... }` | ✅ valid |

---

## What This Does Not Cover

- **Missing `isError` on query consumers** — already covered by an existing binding rule in `docs/rules/client-state.md`; this spec does not duplicate it in a second checklist section.
- **`onSuccess`-only mutations** — requires knowing which hooks are mutations; not detectable from destructuring alone. Covered by the reviewer-only checklist addition instead.
- **`error.message` in non-client code** — `server/` uses `sendError()`, already enforced by `no-bare-error-response`. The new rules are client-only.
- **`error.message` assigned to an intermediate variable then rendered** — `const msg = err.message; setError(msg)` is not detected. The direct-assignment case covers the vast majority of real violations.
