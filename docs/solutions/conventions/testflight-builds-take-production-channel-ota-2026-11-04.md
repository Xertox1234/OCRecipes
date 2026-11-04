---
title: 'A TestFlight build only receives production-channel OTA updates; check the channel before publishing'
track: knowledge
category: conventions
module: client
tags: [tooling, architecture, eas-update, ota, testflight]
applies_to: [eas.json, package.json]
created: '2026-11-04'
---

# A TestFlight build only receives production-channel OTA updates; check the channel before publishing

## Rule

Before publishing an OTA for an on-device check, match **both** of the phone build's settings:

- **Channel.** `eas.json` → `build.<profile>.channel`. TestFlight and App Store builds come from the `production` profile and therefore the `production` channel. Internal installs come from `preview`. Use `npm run update:production` for a TestFlight phone; `update:preview` publishes without error and never arrives.
- **Runtime version.** `app.json` → `expo.runtimeVersion` (5.0.0 as of 2026-11-04) must equal the build's.

The app's Settings screen shows Version, Runtime and Channel. Ask the owner to read it when unsure.

## Why

On 2026-11-04 the owner was asked for a preview OTA and added "I am most likely on a TestFlight build". A preview update would have looked like a successful publish and changed nothing on the phone. The app has no users (owner ruling), so a production OTA reaches nobody else, and it is the right channel for TestFlight checks.

## Examples

- Check after publishing: the EAS output's `Commit` line is the main-checkout HEAD at publish time, not the commit you meant to ship. The OTA bundles the local tree, so another session's merge pulled into the main checkout rides along. A trailing `*` means the tree had changes, untracked files included.

## Related Files

- `eas.json`
- `package.json` (`update:preview`, `update:production`)

## See Also

- [ci-ai-stub-wired-to-a-route-the-code-stopped-taking](../logic-errors/ci-ai-stub-wired-to-a-route-the-code-stopped-taking-2026-11-03.md): another "published, but wired to a path nothing uses" trap
