---
title: An always-armed usePreventRemove callback's early-return branches must reapply the same redirect condition
track: bug
category: logic-errors
module: client
severity: high
tags: [react-navigation, hooks, navigation, code-review]
symptoms: [A conditional navigation redirect works for the plain back-button case but silently reverts to default behavior after a successful save/submit, One exit path out of a multi-branch beforeRemove handler forgets to check the same guard condition as the others]
created: '2026-07-07'
---

# An always-armed usePreventRemove callback's early-return branches must reapply the same redirect condition

## Problem

A screen combined two independent concerns in one `usePreventRemove(true, callback)`
interceptor: an existing "discard unsaved changes?" confirm guard, and a new
"redirect to a different tab if this screen was reached via a special entry
point" (`fromHome`) redirect. The callback had an early-return fast path for
"a save just completed" (`isSavingRef.current`) that predated the `fromHome`
feature:

```ts
usePreventRemove(true, (e) => {
  if (isSavingRef.current) {
    navigation.dispatch(e.data.action); // unconditional — bug
    return;
  }
  // ... dirty-check branch and the "clean" fallthrough BOTH correctly check
  // isBackFromHome before deciding whether to redirect or dispatch
});
```

The `isSavingRef.current` branch dispatched the raw action unconditionally,
without checking the same `fromHome`/redirect condition the other two branches
applied. Every code review of the redirect logic looked correct in isolation —
the bug was that one of three exit paths simply didn't call it.

## Symptoms

- A conditional back-redirect works correctly for the "user taps back with no
  changes" and "user taps back with unsaved changes, confirms discard" cases,
  but not for the "user successfully saves/submits" case — the save-success
  navigation silently falls back to default behavior instead of the intended
  redirect.
- The bug is easy to miss in review because the *other* branches are correct —
  reading top-to-bottom, only the first (earliest) branch is wrong, and it's
  easy to assume "the pattern established below must apply here too."

## Root Cause

When a `usePreventRemove(true, ...)` (or an unconditional `beforeRemove`
listener) has to interleave *multiple* concerns — here, an unsaved-changes
guard plus a redirect for a specific entry point — every one of its early-return
branches is a **separate, independent exit path** that must independently
re-derive and apply the shared decision (redirect vs. proceed normally). Because
`usePreventRemove` calls `preventDefault()` unconditionally, there is no
"default" behavior to fall back on if a branch forgets — a forgotten check
doesn't degrade gracefully, it silently reverts to raw-dispatching the original
action, which is indistinguishable from "the redirect feature doesn't apply
here" to anyone testing only the common paths.

## Solution

Compute the shared decision **once**, as a single function, and call that same
function from every exit branch instead of re-deriving (or forgetting to
re-derive) it per branch:

```ts
usePreventRemove(true, (e) => {
  const proceed = () => {
    if (fromHome && BACK_ACTION_TYPES.has(e.data.action.type)) {
      redirectToHomeTab(navigation);
    } else {
      navigation.dispatch(e.data.action);
    }
  };

  if (isSavingRef.current) {
    proceed();
    return;
  }

  if (isDirtyRef.current) {
    Alert.alert("Discard changes?", "...", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: proceed },
    ]);
    return;
  }

  proceed();
});
```

This makes it structurally impossible for one exit path to omit the check —
there's only one place the redirect condition is evaluated, and every branch
calls it.

## Prevention

- When a `beforeRemove`/`usePreventRemove` callback has more than one
  early-return branch, treat "does every branch apply the same shared
  decision?" as a specific review question, not just "is each branch correct
  in isolation?" — an omission in one branch is invisible unless that
  *specific* branch's trigger condition (e.g. a successful save) is exercised.
- Prefer factoring the shared decision into one function called from every
  branch over duplicating (or letting a pre-existing early branch skip) the
  same conditional logic — this both fixes and prevents the bug, since a
  missing call is easy to spot but a missing check inside a correct-looking
  branch is not.
- Cover this in tests/manual verification by exercising **every** exit path
  independently (clean back, discard-confirm back, and save-success), not just
  the two most obviously related to the new feature — a save/submit success
  path is easy to overlook when the feature being added is framed as "back
  button" work.

## Related Files

- `client/screens/meal-plan/RecipeCreateScreen.tsx`
- `client/hooks/useFromHomeBackRedirect.ts`
