---
title: A pre-auth screen that shows one-time codes must hold the new session until they are saved — signing in swaps the navigator, which no leave guard can stop
track: knowledge
category: design-patterns
tags: [react-native, navigation, auth, mfa, recovery-codes, hooks]
module: client
applies_to: ["client/screens/PasswordUpgradeScreen.tsx", "client/components/TotpEnrollmentSteps.tsx", "client/hooks/useAuth.ts", "client/navigation/RootStackNavigator.tsx", "client/screens/TwoStepCodeScreen.tsx"]
created: 2026-10-10
---

# A pre-auth screen that shows one-time codes must hold the new session until they are saved — signing in swaps the navigator, which no leave guard can stop

## Rule

When a screen in the **signed-out** stack finishes with both a session **and** something the person must save before leaving (recovery codes, a replacement recovery code), the hook call that gets the session must **return it without signing in**. The screen keeps it in state, shows the codes, and calls `finishSignIn(user, token)` only once the codes are confirmed saved:

```ts
// useAuth — returns the session; does NOT call establishSession
const upgradeConfirmTwoStep = async (pass, code) => {
  const { recoveryCodes, ...session } = await (await upgradeRequest(...)).json();
  return { session, recoveryCodes };
};

// PasswordUpgradeScreen
const confirm = async (code) => {
  const r = await auth.upgradeConfirmTwoStep(pass, code);
  setSession(r.session);           // held
  return r.recoveryCodes;          // shown by the save-codes step
};
const onCodesSaved = () => {
  if (session) void auth.finishSignIn(session.user, session.token);
};
```

Report the leave guard (`usePreventRemove`) from the **same event handlers** that change the step or the "I've saved these" tick, never from a `useEffect`.

## Why

- `RootStackNavigator` renders the signed-out and signed-in stacks conditionally on `isAuthenticated`. `establishSession` flips that flag, so the whole pre-auth stack unmounts on the next render. That is a re-render, not a navigation action: no `beforeRemove` fires, so `usePreventRemove` cannot intercept it. Signing in at confirm time unmounts the screen with the codes on it, and they are never shown again.
- A signed-in screen (`TwoStepSetupScreen`) can call `establishSession` at confirm safely, because the flag is already true and nothing swaps. The same API shape is wrong one stack over.
- `usePreventRemove` reads the guard from the last **committed** render. A guard reported from an effect is one render late, so there is a frame where codes are on screen and leaving is unguarded. It is also why Done must not clear the guard in its own handler: the tick clears it in an earlier event.

## Examples

- `PasswordUpgradeScreen` (password policy part 2): `/upgrade/totp/confirm` returns a session plus 10 recovery codes. The test pins that `finishSignIn` is not called until the codes are ticked saved and Done is pressed, and then exactly once.
- `TwoStepCodeScreen` already followed this for a spent recovery code's replacement: `verifySecondFactor` keeps the trust key but does not sign in, and the screen calls `finishSignIn` after showing the replacement.

## Exceptions

- Signed-in hosts may sign in (refresh the session) at confirm, as `confirmTwoStep` does, because no stack swap happens.

## Related Files

- `client/screens/PasswordUpgradeScreen.tsx`
- `client/components/TotpEnrollmentSteps.tsx`
- `client/hooks/useAuth.ts`
- `client/navigation/RootStackNavigator.tsx`
- `client/screens/TwoStepCodeScreen.tsx`

## See Also

- `docs/solutions/logic-errors/spent-single-use-credential-replacement-lost-on-error-paths-2026-10-10.md`
- `docs/solutions/logic-errors/beforeremove-preventdefault-desyncs-native-stack-2026-07-07.md`
