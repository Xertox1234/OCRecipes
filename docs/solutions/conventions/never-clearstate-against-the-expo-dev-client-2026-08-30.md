---
title: Never use launchApp/clearState against the Expo dev client — reach logged-out state through the app's own Sign Out
track: knowledge
category: conventions
tags: [testing, react-native, maestro, e2e]
module: client
applies_to: ["e2e/**"]
created: 2026-08-30
---

# Never use launchApp/clearState against the Expo dev client — reach logged-out state through the app's own Sign Out

## Rule

Maestro flows in this suite must not call `launchApp` at all (with or without
`clearState`). Launch is `openLink` to the dev-client URL (appId-agnostic);
logged-out state comes from `e2e/helpers/ensure-logged-out.yaml`, which drives
Profile → Settings → Sign Out through the app's own `tokenStorage.clear()`.

## Why

Three independent failures, all artifact-proven:

1. **Android:** `pm clear` wipes the DEV CLIENT'S own storage too — the
   relaunch strands on the dev-client launcher screen ("DEVELOPMENT
   SERVERS…") and the `openLink` reconnect does not reliably recover.
2. **iOS:** the app ids are SPLIT per platform (iOS
   `com.williamtower.ocrecipes`, Android `com.ocrecipes.app`) while a flow
   declares exactly one `appId:` — `launchApp` against the wrong id errors
   outright (`Failed to get app binary directory`). With openLink-only
   launches, `appId:` is load-bearing only for Maestro's schema.
3. A whole session of overlay-dismissal theories (welcome banner, dev menu,
   back-gestures) were downstream artifacts of clearState-induced cold states
   — removing clearState removed the class.

The UI-logout route has a bonus: the suite now genuinely covers logout.

## Exceptions

None currently. If a future flow truly needs wiped app storage (not just a
logged-out session), that is a reinstall-the-app problem for the workflow
level, not a `clearState` call — and the per-platform appId split must be
solved first.

## Smell patterns

- A flow adds `launchApp` "just to reset" — replace with
  `runFlow: ../../helpers/ensure-logged-out.yaml`.
- A helper edit re-introduces waits for dev-client chrome ("Continue",
  "Connected to:", the launcher) anywhere except `launch-app.yaml`'s gate.

## Related Files

- `e2e/helpers/ensure-logged-out.yaml` — logout + kill-drill-verified wizard-escape
- `e2e/helpers/launch-app.yaml` — the openLink launch + readiness gate

## See Also

- [ios-system-dialogs-replace-the-a11y-hierarchy](../logic-errors/ios-system-dialogs-replace-the-a11y-hierarchy-2026-08-30.md) — the alert-confirm mechanics inside the logout walk
