# Silent Failure Prevention: ESLint Rules + Review Checklist

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two client-side ESLint rules that block commits when `error.message` leaks to the UI or a dead `if (!res.ok)` guard follows `apiRequest`, plus a reviewer checklist for the semantic patterns static analysis can't reach.

**Architecture:** Two new rules in `eslint-plugin-ocrecipes/index.js`, tested via ESLint's `RuleTester` in a new `.test.ts` file picked up by Vitest. The rules are activated by a new `client/**/*.{ts,tsx}` config block in `eslint.config.js`. Existing violations in the client are fixed before the block is added so CI stays green.

**Tech Stack:** ESLint v9 flat config, `@typescript-eslint/parser`, Vitest (existing runner), CommonJS plugin module.

---

## File Map

| File                                                 | Action | What changes                                                 |
| ---------------------------------------------------- | ------ | ------------------------------------------------------------ |
| `eslint-plugin-ocrecipes/__tests__/rules.test.ts`    | Create | RuleTester coverage for both rules                           |
| `eslint-plugin-ocrecipes/index.js`                   | Modify | Two new rules appended                                       |
| `eslint.config.js`                                   | Modify | Client config block added at end                             |
| `client/screens/meal-plan/ReceiptMealPlanScreen.tsx` | Modify | Remove raw `.error.message` from JSX                         |
| `client/components/RecipeGenerationModal.tsx`        | Modify | Remove raw `.error.message` from JSX and a11y call           |
| `client/screens/meal-plan/RecipeImportScreen.tsx`    | Modify | Replace `error.message` string-matching with `ApiError.code` |
| `client/hooks/useFastingTimer.ts`                    | Modify | Replace `err.message \|\| "fallback"` with static copy       |
| `docs/rules/client-state.md`                         | Modify | Append MUST CHECK section                                    |

---

## Task 1: Create test file scaffold and stub both rules

**Files:**

- Create: `eslint-plugin-ocrecipes/__tests__/rules.test.ts`
- Modify: `eslint-plugin-ocrecipes/index.js`

- [ ] **Step 1.1: Add stub rules to the plugin**

Open `eslint-plugin-ocrecipes/index.js`. At the end of the file, before the `module.exports` block, add the two stub rules. Then add them to the exports.

```js
// ─── no-error-message-in-ui (stub) ──────────────────────────────────────────
const noErrorMessageInUi = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow rendering error.message in the UI — use static copy and error.code instead",
    },
    messages: {
      noErrorMessageInUi:
        "Do not render error.message in the UI — show static copy and branch on error.code instead. See docs/rules/client-state.md.",
    },
    schema: [],
  },
  create(_context) {
    return {};
  },
};

// ─── no-dead-apiRequest-guard (stub) ────────────────────────────────────────
const noDeadApiRequestGuard = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow if(!res.ok) guards after await apiRequest() — the guard is always false",
    },
    messages: {
      noDeadGuard:
        "Dead guard — apiRequest always throws on non-ok, so this if(!x.ok) block is unreachable. Delete it and branch on error.code in onError instead. See docs/rules/client-state.md.",
    },
    schema: [],
  },
  create(_context) {
    return {};
  },
};
```

Replace the existing `module.exports` at the bottom of `index.js` with:

```js
module.exports = {
  rules: {
    "no-bare-error-response": noBareErrorResponse,
    "no-parseint-req": noParseIntReq,
    "no-as-string-req": noAsStringReq,
    "no-error-message-in-ui": noErrorMessageInUi,
    "no-dead-apiRequest-guard": noDeadApiRequestGuard,
  },
};
```

- [ ] **Step 1.2: Create the test file scaffold**

Create `eslint-plugin-ocrecipes/__tests__/rules.test.ts`:

```ts
import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import * as tsParser from "@typescript-eslint/parser";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const plugin = require("../index.js") as {
  rules: Record<string, import("eslint").Rule.RuleModule>;
};

const tester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

// Rule test suites follow in Tasks 2 and 4.
export {};
```

- [ ] **Step 1.3: Verify Vitest picks up the file**

```bash
npx vitest run eslint-plugin-ocrecipes/__tests__/rules.test.ts
```

Expected: "0 tests" or a pass with no failures — the file is found and imports cleanly.

---

## Task 2: Write failing tests for `no-error-message-in-ui`

**Files:**

- Modify: `eslint-plugin-ocrecipes/__tests__/rules.test.ts`

- [ ] **Step 2.1: Add the test suite**

Append the following to `eslint-plugin-ocrecipes/__tests__/rules.test.ts` (before the `export {}`). The `tester.run()` call must be inside an `it()` so Vitest reports failures as named test failures rather than a module-level crash:

```ts
describe("no-error-message-in-ui", () => {
  it("flags error.message in UI contexts and ignores safe patterns", () => {
    tester.run(
      "no-error-message-in-ui",
      plugin.rules["no-error-message-in-ui"],
      {
        valid: [
          // Static string in toast — fine
          { code: `toast.error("Something went wrong. Please try again.")` },
          // Static string in setter — fine
          { code: `setError("Upload failed")` },
          // .code is not .message — fine
          { code: `const x = <Text>{error.code}</Text>` },
          // Unrelated binding name — fine
          { code: `const x = <Text>{notification.message}</Text>` },
          // .ok is not .message — fine
          { code: `const x = <Text>{response.ok ? "yes" : "no"}</Text>` },
        ],
        invalid: [
          // Direct identifier: error.message in JSX
          {
            code: `const x = <Text>{error.message}</Text>`,
            errors: [{ messageId: "noErrorMessageInUi" }],
          },
          // Direct identifier: err.message in JSX
          {
            code: `const x = <Text>{err.message}</Text>`,
            errors: [{ messageId: "noErrorMessageInUi" }],
          },
          // Suffixed identifier: uploadError.message in JSX
          {
            code: `const x = <View>{uploadError.message}</View>`,
            errors: [{ messageId: "noErrorMessageInUi" }],
          },
          // Two-hop chain: generateMutation.error.message in JSX
          {
            code: `const x = <Text>{generateMutation.error.message}</Text>`,
            errors: [{ messageId: "noErrorMessageInUi" }],
          },
          // State setter: setError(err.message)
          {
            code: `setError(err.message)`,
            errors: [{ messageId: "noErrorMessageInUi" }],
          },
          // Toast with direct .message
          {
            code: `toast.error(err.message)`,
            errors: [{ messageId: "noErrorMessageInUi" }],
          },
          // Toast with || fallback — left side is still error.message
          {
            code: `toast.error(err.message || "Failed to start fast")`,
            errors: [{ messageId: "noErrorMessageInUi" }],
          },
        ],
      },
    );
  });
});
```

- [ ] **Step 2.2: Run tests and verify they FAIL**

```bash
npx vitest run eslint-plugin-ocrecipes/__tests__/rules.test.ts
```

Expected: test failures — the stub rule reports no errors so all `invalid` cases fail ("Expected 1 error but got 0").

---

## Task 3: Implement `no-error-message-in-ui` and make tests pass

**Files:**

- Modify: `eslint-plugin-ocrecipes/index.js`

- [ ] **Step 3.1: Replace the stub with the full implementation**

In `eslint-plugin-ocrecipes/index.js`, replace the `noErrorMessageInUi` stub's `create(_context)` body with:

```js
  create(context) {
    /**
     * True when `node` is:
     *   error.message / err.message / fooError.message   (Identifier object)
     *   generateMutation.error.message                   (MemberExpression with .error)
     */
    function isErrorMessage(node) {
      if (
        node.type !== "MemberExpression" ||
        node.property.type !== "Identifier" ||
        node.property.name !== "message"
      ) {
        return false;
      }
      const obj = node.object;
      // Direct: error / err / *Error
      if (obj.type === "Identifier") {
        return (
          obj.name === "error" ||
          obj.name === "err" ||
          obj.name.endsWith("Error")
        );
      }
      // Two-hop: <anything>.error.message
      if (
        obj.type === "MemberExpression" &&
        obj.property.type === "Identifier" &&
        obj.property.name === "error"
      ) {
        return true;
      }
      return false;
    }

    /** True when node is error.message or error.message || "fallback" */
    function containsErrorMessage(node) {
      if (isErrorMessage(node)) return true;
      if (
        node.type === "LogicalExpression" &&
        node.operator === "||" &&
        isErrorMessage(node.left)
      ) {
        return true;
      }
      return false;
    }

    return {
      // Pattern 1: {error.message} in JSX
      JSXExpressionContainer(node) {
        if (isErrorMessage(node.expression)) {
          context.report({ node, messageId: "noErrorMessageInUi" });
        }
      },

      CallExpression(node) {
        const firstArg = node.arguments[0];
        if (!firstArg) return;

        // Pattern 2: setXxx(err.message)
        if (
          node.callee.type === "Identifier" &&
          node.callee.name.startsWith("set") &&
          containsErrorMessage(firstArg)
        ) {
          context.report({ node: firstArg, messageId: "noErrorMessageInUi" });
          return;
        }

        // Pattern 3a: toast.error / toast.warning
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.object.type === "Identifier" &&
          node.callee.object.name === "toast" &&
          node.callee.property.type === "Identifier" &&
          (node.callee.property.name === "error" ||
            node.callee.property.name === "warning") &&
          containsErrorMessage(firstArg)
        ) {
          context.report({ node: firstArg, messageId: "noErrorMessageInUi" });
          return;
        }

        // Pattern 3b: AccessibilityInfo.announceForAccessibility(error.message)
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.object.type === "Identifier" &&
          node.callee.object.name === "AccessibilityInfo" &&
          node.callee.property.type === "Identifier" &&
          node.callee.property.name === "announceForAccessibility" &&
          containsErrorMessage(firstArg)
        ) {
          context.report({ node: firstArg, messageId: "noErrorMessageInUi" });
        }
      },
    };
  },
```

- [ ] **Step 3.2: Run tests and verify they PASS**

```bash
npx vitest run eslint-plugin-ocrecipes/__tests__/rules.test.ts
```

Expected: all `no-error-message-in-ui` cases pass. (The `no-dead-apiRequest-guard` suite hasn't been added yet — only the scaffold export runs.)

- [ ] **Step 3.3: Commit**

```bash
git add eslint-plugin-ocrecipes/index.js eslint-plugin-ocrecipes/__tests__/rules.test.ts
git commit -m "feat(eslint): add no-error-message-in-ui rule with tests"
```

---

## Task 4: Write failing tests for `no-dead-apiRequest-guard`

**Files:**

- Modify: `eslint-plugin-ocrecipes/__tests__/rules.test.ts`

- [ ] **Step 4.1: Add the test suite**

Append the following to `eslint-plugin-ocrecipes/__tests__/rules.test.ts` (before `export {}`):

```ts
describe("no-dead-apiRequest-guard", () => {
  it("flags if(!res.ok) after apiRequest and ignores fetch or other conditions", () => {
    tester.run(
      "no-dead-apiRequest-guard",
      plugin.rules["no-dead-apiRequest-guard"],
      {
        valid: [
          // Raw fetch — res.ok is meaningful
          {
            code: `async function f() {
  const res = await fetch(url);
  if (!res.ok) { doSomething(); }
}`,
          },
          // Different condition on apiRequest result
          {
            code: `async function f() {
  const res = await apiRequest("GET", "/api");
  if (res.data.length === 0) { doSomething(); }
}`,
          },
          // Raw fetch alias — still valid (fetch, not apiRequest)
          {
            code: `async function f() {
  const res = await fetch(url);
  const response = res;
  if (!response.ok) { doSomething(); }
}`,
          },
        ],
        invalid: [
          // Direct declaration
          {
            code: `async function f() {
  const res = await apiRequest("POST", "/api");
  if (!res.ok) { doSomething(); }
}`,
            errors: [{ messageId: "noDeadGuard" }],
          },
          // ok === false variant
          {
            code: `async function f() {
  const res = await apiRequest("POST", "/api");
  if (res.ok === false) { doSomething(); }
}`,
            errors: [{ messageId: "noDeadGuard" }],
          },
          // let + later assignment
          {
            code: `async function f() {
  let res;
  res = await apiRequest("POST", "/api");
  if (!res.ok) { doSomething(); }
}`,
            errors: [{ messageId: "noDeadGuard" }],
          },
          // One-hop alias: const response = res
          {
            code: `async function f() {
  const res = await apiRequest("POST", "/api");
  const response = res;
  if (!response.ok) { doSomething(); }
}`,
            errors: [{ messageId: "noDeadGuard" }],
          },
        ],
      },
    );
  });
});
```

- [ ] **Step 4.2: Run tests and verify they FAIL**

```bash
npx vitest run eslint-plugin-ocrecipes/__tests__/rules.test.ts
```

Expected: the 4 new `invalid` cases all fail ("Expected 1 error but got 0" — stub reports nothing).

---

## Task 5: Implement `no-dead-apiRequest-guard` and make tests pass

**Files:**

- Modify: `eslint-plugin-ocrecipes/index.js`

- [ ] **Step 5.1: Replace the stub with the full implementation**

In `eslint-plugin-ocrecipes/index.js`, replace the `noDeadApiRequestGuard` stub's `create(_context)` body with:

```js
  create(context) {
    /** Extract the identifier name being checked in `!x.ok` or `x.ok === false`. Returns null if pattern doesn't match. */
    function getOkCheckIdentifier(test) {
      // !x.ok
      if (
        test.type === "UnaryExpression" &&
        test.operator === "!" &&
        test.argument.type === "MemberExpression" &&
        test.argument.property.type === "Identifier" &&
        test.argument.property.name === "ok" &&
        test.argument.object.type === "Identifier"
      ) {
        return test.argument.object.name;
      }
      // x.ok === false
      if (
        test.type === "BinaryExpression" &&
        test.operator === "===" &&
        test.left.type === "MemberExpression" &&
        test.left.property.type === "Identifier" &&
        test.left.property.name === "ok" &&
        test.left.object.type === "Identifier" &&
        test.right.type === "Literal" &&
        test.right.value === false
      ) {
        return test.left.object.name;
      }
      return null;
    }

    /** True when `node` is `await apiRequest(...)` */
    function isAwaitApiRequest(node) {
      return (
        node.type === "AwaitExpression" &&
        node.argument.type === "CallExpression" &&
        node.argument.callee.type === "Identifier" &&
        node.argument.callee.name === "apiRequest"
      );
    }

    /**
     * Walk the scope chain from `scope` looking for variable `name`.
     * Returns true if the variable's init or most recent write expression is
     * `await apiRequest(...)`, following one hop of Identifier aliasing.
     */
    function resolveToAwaitApiRequest(name, scope) {
      let current = scope;
      while (current) {
        const variable = current.variables.find((v) => v.name === name);
        if (variable) {
          // Check VariableDeclarator init (const/let x = ...)
          for (const def of variable.defs) {
            if (def.type === "Variable" && def.node.init) {
              if (isAwaitApiRequest(def.node.init)) return true;
              // One-hop alias: const response = res
              if (def.node.init.type === "Identifier") {
                return resolveToAwaitApiRequest(def.node.init.name, scope);
              }
            }
          }
          // Check write references (let res; res = await apiRequest(...))
          for (const ref of variable.references) {
            if (ref.isWrite() && ref.writeExpr) {
              if (isAwaitApiRequest(ref.writeExpr)) return true;
              if (ref.writeExpr.type === "Identifier") {
                return resolveToAwaitApiRequest(ref.writeExpr.name, scope);
              }
            }
          }
          return false;
        }
        current = current.upper;
      }
      return false;
    }

    return {
      IfStatement(node) {
        const identName = getOkCheckIdentifier(node.test);
        if (!identName) return;

        const scope = context.sourceCode.getScope(node);
        if (resolveToAwaitApiRequest(identName, scope)) {
          context.report({ node, messageId: "noDeadGuard" });
        }
      },
    };
  },
```

- [ ] **Step 5.2: Run ALL tests and verify they PASS**

```bash
npx vitest run eslint-plugin-ocrecipes/__tests__/rules.test.ts
```

Expected: all 11 cases pass (5 valid + 7 invalid for `no-error-message-in-ui`; 3 valid + 4 invalid for `no-dead-apiRequest-guard`).

- [ ] **Step 5.3: Commit**

```bash
git add eslint-plugin-ocrecipes/index.js eslint-plugin-ocrecipes/__tests__/rules.test.ts
git commit -m "feat(eslint): add no-dead-apiRequest-guard rule with scope-aware tests"
```

---

## Task 6: Fix existing violations

These are the known sites that will be flagged once the client config block is active. Fix them now so the config block lands on a clean codebase.

**Files:**

- Modify: `client/screens/meal-plan/ReceiptMealPlanScreen.tsx`
- Modify: `client/components/RecipeGenerationModal.tsx`
- Modify: `client/screens/meal-plan/RecipeImportScreen.tsx`
- Modify: `client/hooks/useFastingTimer.ts`

- [ ] **Step 6.1: Fix `ReceiptMealPlanScreen.tsx:245`**

At line 245, `{generateMutation.error.message}` is rendered directly in JSX. Replace it with static copy:

```tsx
// Before (line 244–246):
<ThemedText style={[styles.errorText, { color: theme.error }]}>
  {generateMutation.error.message}
</ThemedText>

// After:
<ThemedText style={[styles.errorText, { color: theme.error }]}>
  {"Something went wrong. Please try again."}
</ThemedText>
```

- [ ] **Step 6.2: Fix `RecipeGenerationModal.tsx:456`**

At line 455–457, `generateMutation.error.message` is used in a ternary inside JSX. Replace the entire ternary with the static fallback it already provides:

```tsx
// Before (lines 455–457):
{
  generateMutation.error instanceof Error
    ? generateMutation.error.message
    : "Failed to generate recipe. Please try again.";
}

// After:
{
  ("Failed to generate recipe. Please try again.");
}
```

- [ ] **Step 6.3: Fix `RecipeGenerationModal.tsx:104–106`**

At lines 104–106, `error.message` is passed (via an intermediate variable) to `AccessibilityInfo.announceForAccessibility`. The rule won't catch this (intermediate variable), but it's the same violation class. Replace the message derivation with static copy:

```ts
// Before (lines 104–106):
const msg = error instanceof Error ? error.message : "Recipe generation failed";
AccessibilityInfo.announceForAccessibility(msg);

// After:
AccessibilityInfo.announceForAccessibility("Recipe generation failed.");
```

- [ ] **Step 6.4: Fix `RecipeImportScreen.tsx:80–85`**

At lines 80–85, `error.message` is extracted to `msg` and then `msg.includes("422")` etc. are used to branch on error type. The correct fix is to branch on `ApiError.code`. First verify the import path for `ApiError`:

```bash
grep -n "ApiError\|api-error" client/screens/meal-plan/RecipeImportScreen.tsx | head -5
```

Then replace the message-based branching:

```ts
// Before (lines 77–89, approximate):
} catch (error) {
  setState("error");
  haptics.notification(NotificationFeedbackType.Error);
  const msg =
    error instanceof Error ? error.message : "Failed to import recipe";
  if (msg.includes("422") || msg.includes("NO_RECIPE_DATA")) {
    setErrorMessage("No recipe data found on this page.");
  } else if (msg.includes("FETCH_FAILED")) {
    setErrorMessage(
      "Could not reach that page. Check the URL and try again.",
    );
  } else {
    setErrorMessage("Failed to import recipe. Please try again.");
  }
}

// After — import ApiError from "@/lib/api-error" and ErrorCode from "@shared/constants/error-codes" if not already imported, then:
} catch (error) {
  setState("error");
  haptics.notification(NotificationFeedbackType.Error);
  if (error instanceof ApiError && error.code === "NO_RECIPE_DATA") {
    setErrorMessage("No recipe data found on this page.");
  } else if (error instanceof ApiError && error.code === "FETCH_FAILED") {
    setErrorMessage(
      "Could not reach that page. Check the URL and try again.",
    );
  } else {
    setErrorMessage("Failed to import recipe. Please try again.");
  }
}
```

Note: verify `ErrorCode.NO_RECIPE_DATA` and `ErrorCode.FETCH_FAILED` exist in `shared/constants/error-codes.ts` — if the server sends these as the `code` field, use them; if the route sends them only embedded in the message body, this fix changes behaviour and the safest fallback is keeping the generic message for all cases.

- [ ] **Step 6.5: Fix `useFastingTimer.ts:241,270,295`**

Three `toast.error(err.message || "fallback")` calls. The `err.message` here is always the raw `ApiError("STATUS: body")` string — `apiRequest` throws `ApiError` so `.message` is never empty, meaning the `||` fallback never fires. Remove the leak:

```ts
// Line 241 — before:
toast.error(err.message || "Failed to start fast");
// After:
toast.error("Failed to start fast.");

// Line 270 — before:
toast.error(err.message || "Failed to end fast");
// After:
toast.error("Failed to end fast.");

// Line 295 — before:
toast.error(err.message || "Failed to save schedule");
// After:
toast.error("Failed to save schedule.");
```

- [ ] **Step 6.6: Sweep for any remaining violations**

The ESLint v9 CLI doesn't support `--no-eslintrc` or `--ext` (those are v8 flags). The sweep runs by temporarily adding the client config block to `eslint.config.js`, linting, reverting if violations are found. In practice: proceed to Task 7 Step 7.1 (add the config block), then run `npm run lint`, fix any new violations that appear, and only then continue with Step 7.2. If no violations appear beyond the known four sites fixed above, the sweep is complete.

- [ ] **Step 6.7: Commit all violation fixes**

```bash
git add \
  client/screens/meal-plan/ReceiptMealPlanScreen.tsx \
  client/components/RecipeGenerationModal.tsx \
  client/screens/meal-plan/RecipeImportScreen.tsx \
  client/hooks/useFastingTimer.ts
git commit -m "fix(client): replace raw error.message UI leaks with static copy (pre-flight for ESLint rule)"
```

---

## Task 7: Add client config block to `eslint.config.js`

**Files:**

- Modify: `eslint.config.js`

- [ ] **Step 7.1: Insert the client block**

In `eslint.config.js`, the config array currently ends with two conditional spreads for the type-aware TypeScript rules. Add the client block **after** both spreads, as the last element before `]);`:

```js
// Current end of defineConfig([...]):
  ...(process.env.ESLINT_NO_TYPE_AWARE
    ? []
    : [
        {
          files: ["**/*.test.{ts,tsx}"],
          rules: { "@typescript-eslint/require-await": "off" },
        },
      ]),
  // ↓ ADD THIS BLOCK ↓
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
]);
```

- [ ] **Step 7.2: Run lint to verify zero client violations**

```bash
ESLINT_NO_TYPE_AWARE=1 npx eslint client/ --ext .ts,.tsx
```

Expected: exit code 0, no errors from the new rules. If any violations appear, they were missed in Task 6 — fix them before continuing.

- [ ] **Step 7.3: Commit**

```bash
git add eslint.config.js
git commit -m "feat(eslint): activate no-error-message-in-ui + no-dead-apiRequest-guard for client/"
```

---

## Task 8: Add MUST CHECK section to `docs/rules/client-state.md`

**Files:**

- Modify: `docs/rules/client-state.md`

- [ ] **Step 8.1: Verify what is already present**

Before editing, skim `docs/rules/client-state.md` to confirm these three topics are NOT already present as standalone bullets:

1. `onError` missing on mutations
2. `await mutateAsync` without try/catch
3. Hook stripping `isError` from return value

The file already has bullets about `isError` before empty-state rendering, `error.message` rendering, and `if (!res.ok)` after `apiRequest`. Do not duplicate those.

- [ ] **Step 8.2: Append the MUST CHECK section**

Add the following at the very end of `docs/rules/client-state.md`:

```markdown
## MUST CHECK — reviewing any new screen or data hook

1. **Every mutation has an `onError` handler that shows visible copy.**
   Haptics-only and iOS-VoiceOver-only handlers leave Android users with a silent
   no-op. An `onSuccess`-only hook is a red flag. Check that a failed save/delete/log
   produces a user-visible message (InlineError, toast, or inline state).

2. **`await mutateAsync(...)` calls are wrapped in try/catch.**
   Unlike `mutate()`, `mutateAsync` rejects on failure — an unwrapped call is an
   unhandled rejection that the hook's `onError` does NOT suppress.

3. **Wrapping hooks expose `isError` and `error` when consumers need them.**
   A hook that strips these from its return value makes the query error-surfacing
   pattern structurally impossible for consumers. Check that custom hooks don't
   silently omit error state when consumers render data-dependent UI.
```

- [ ] **Step 8.3: Commit**

```bash
git add docs/rules/client-state.md
git commit -m "docs(rules): add MUST CHECK reviewer checklist for mutation + hook error patterns"
```

---

## Task 9: Final verification

- [ ] **Step 9.1: Run the full test suite**

```bash
npm run test:run
```

Expected: all tests pass. The new `rules.test.ts` file is included via the `**/*.test.ts` Vitest glob.

- [ ] **Step 9.2: Run the full lint check**

```bash
npm run lint
```

Expected: exit code 0.

- [ ] **Step 9.3: Push and open PR**

```bash
git push -u origin feat/silent-failure-eslint-rules
```

Then open a PR with the following description:

**Title:** `feat(eslint): silent failure prevention — 2 client-side rules + reviewer checklist`

**Body:**

```
## Summary
- `no-error-message-in-ui`: blocks rendering `error.message` / `err.message` in JSX, state setters, and toast/announce calls. Detects direct bindings, `*Error`-suffixed bindings, and two-hop chains (`mutation.error.message`), plus the `err.message || "fallback"` logical-OR pattern.
- `no-dead-apiRequest-guard`: blocks `if (!res.ok)` guards after `await apiRequest(...)` using scope-aware binding resolution (direct declarations, `let`+later assignment, one-hop aliases).
- Pre-flight: fixes 4 existing `error.message` violation sites in client code.
- `docs/rules/client-state.md`: adds MUST CHECK section for the two semantic patterns static analysis can't reach (missing `onError`, unguarded `mutateAsync`).

Motivated by the 2026-05-28 silent failures audit (46 findings, all fixed) — these rules prevent recurrence at write time.

## Test plan
- [ ] `npm run test:run` passes (new `rules.test.ts` covers 11 RuleTester cases per rule)
- [ ] `npm run lint` exits 0
- [ ] CI green (Lint·Types·Patterns + Tests 1-3/3)
```
