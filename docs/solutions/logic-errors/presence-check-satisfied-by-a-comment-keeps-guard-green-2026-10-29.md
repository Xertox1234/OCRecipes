---
title: A text-presence check is satisfied by a comment that names the call — when the call moves into a wrapper, teach the check the wrapper and pin the wrapper's real call with a test
track: bug
category: logic-errors
module: scripts
severity: low
tags: [harness, lint, pre-commit, grep, comments, false-negative, refactor, bottom-sheet, testing]
symptoms: ["A refactor moves a required call (e.g. useSheetBackHandler) into a new hook and the file-level pre-commit check starts failing", "The quick fix is a comment in the host file that contains the call text, e.g. `// useSheetBackHandler(...) is called inside that hook`", "The check passes, and would keep passing after the real call is deleted"]
applies_to: ["scripts/check-*.js", "scripts/__tests__/check-*.test.ts", "client/hooks/**/*.ts", "client/hooks/**/*.tsx"]
created: 2026-10-29
last_updated: 2026-10-29
---

# A text-presence check is satisfied by a comment that names the call

## Problem

`scripts/check-bottomsheet-backhandler.js` (lint-staged) flags a `.tsx` file that renders
`<BottomSheetModal>` without a `useSheetBackHandler(` call in the same file. It is a plain
regex over the file text, comments included.

PR #1605 moved `MealPlanHomeScreen`'s sheet state machine — including the
`useSheetBackHandler(...)` call — into a new `useMealPlanSheets` hook. The screen still
renders the `<BottomSheetModal>`s, so the commit was refused. The executor made it pass by
adding a comment to the screen:

```ts
// The Android back handler (useSheetBackHandler(activeSheetRef, isOpen)) is
// also called inside that hook;
```

That comment satisfies the regex forever. Delete the real call from the hook and the
check stays green while Android's hardware back pops the screen under an open sheet —
the exact regression the check exists to catch.

## Fix

Teach the check the wrapper by name, and pin that the wrapper really makes the call:

```js
const HOOK_CALL_PATTERN = /\b(useSheetBackHandler|useMealPlanSheets)\(/;
```

```ts
it("useMealPlanSheets really calls useSheetBackHandler", () => {
  const hookSource = fs.readFileSync(".../client/hooks/useMealPlanSheets.tsx", "utf8");
  expect(hookSource).toMatch(/=\s*useSheetBackHandler\(/); // the call, not the import or a comment
});
```

and reword the host comment so it no longer imitates a call (`useSheetBackHandler`, no `(`).
The pin's regex keys on the assignment (`} = useSheetBackHandler(`), which neither the import
line nor a prose mention matches.

## Rule

- Never make a text-presence check pass by writing the matched text into a comment. If a
  refactor legitimately moves the required call, extend the check to accept the new
  carrier **and** add a test that the carrier still makes the call.
- The mirror image (an absence check failed by a comment) is
  `assert-command-absent-grep-matches-doc-comment-strip-first-2026-07-05.md`. Both come from
  the same root: a grep guard reads comments as code.
