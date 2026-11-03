---
title: Maestro flows on the physical iPhone — maestro-runner over Wi-Fi, read-only on the live server, and what differs from the simulator
track: knowledge
category: best-practices
module: shared
tags: [testing, harness, maestro, e2e, ios, device, privacy]
applies_to: ["e2e/device/**", "e2e/**/*.yaml"]
created: '2026-11-03'
---

# Maestro flows on the physical iPhone — maestro-runner over Wi-Fi, read-only on the live server, and what differs from the simulator

## When this applies

When you write or run a flow in `e2e/device/` (`npm run e2e:device:ios`, #1710). Those flows run on the owner's iPhone, against the installed build, on the live server and the owner's real account.

## Rule

1. **Read-only by default.** Taps only navigate. No sign-in or sign-out, because the shared CI test account must never touch the live server. No writes and no AI calls, unless the owner names a flow as OK for their account. Start from `e2e/device/helpers/launch-installed.yaml`, which uses `launchApp` with `stopApp` and then waits for the signed-in Home.
2. **Never commit a screenshot.** maestro-runner's `takeScreenshot` writes a copy **beside the flow file** as well as into the report. Six real-account screenshots were staged by accident during #1710. `.gitignore` covers `e2e/device/**/*.png`, so don't remove that rule.
3. **Prove navigation with `id: "BackButton"`.** On the phone, the accessibility tree holds only the top screen, and tab roots have no back button. A pushed screen's title often repeats the row you tapped ("Grocery Lists", "Scan History"), so waiting for the title passes even when the tap did nothing.
4. **Go back by re-tapping the current tab** (`tapOn: {id: "tab-…"}`). React Navigation pops the tab's stack to its root. One `tapOn: {id: "BackButton"}` from Cookbooks left the screen unchanged.
5. **Write `[0-9]`, not `\d`, in text patterns.** `Pantry(, \d+ expiring)?` failed to match a plain "Pantry" row in two runs, and `[0-9]` passed. This was not isolated further.
6. **Assert against the installed build, not `main`.** The phone runs its last build or OTA. One example: a pre-#1705 build showed Pantry's upgrade screen to a paying account while the plan loaded. A body check must accept every state that build can show. When a screen "changes between runs", check which build the phone is on first.

## Why

Official Maestro refuses physical iPhones. `maestro-runner` (DeviceLab) runs the same YAML, but its iOS driver differs from the simulator's in the ways above. The phone is also the live product: anything a flow writes lands in the owner's real data.

## Running it

- **First time on a Mac:** cable the phone once, then Finder → iPhone → General → "Show this iPhone when on Wi-Fi". Proof: `ideviceinfo -q com.apple.mobile.wireless_lockdown` shows `EnableWifiConnections: true`, and `idevice_id -n` lists the phone. `xcrun xctrace list devices` is **not** proof: after a `devicectl` wake it lists a Wi-Fi-only phone under "Devices".
- **Each run:** the U34Bolt drive must be mounted (the runner lives there), and the phone unlocked and on the Mac's Wi-Fi. A phone that locks mid-run fails every later step with "element not found". The first full run failed that way and passed when re-run with the phone kept awake.
- The script turns telemetry off (`MAESTRO_RUNNER_NO_TELEMETRY=1 DO_NOT_TRACK=1`). Reports go to `/Volumes/U34Bolt/OCRecipes/tmp/maestro-runs/device-<timestamp>/`.

## Exceptions

- A flow that writes is allowed once the owner names it as OK for their account. It must undo its own write in the same flow, for example delete the pantry item it added.

## Related Files

- `e2e/device/README.md` — the same rules, kept beside the flows
- `e2e/device/run-ios.sh` — device lookup over usbmux, mount check, report path
- `e2e/device/helpers/launch-installed.yaml` — the device launch helper
- `e2e/helpers/tap-tab.yaml` — tab switch with re-tap, reused unchanged

## See Also

- [maestro-text-matching-is-full-string-regex](../logic-errors/maestro-text-matching-is-full-string-regex-2026-08-30.md) — still true on the device runner
- [maestro-tap-reports-success-but-the-app-never-saw-it](../logic-errors/maestro-tap-reports-success-but-the-app-never-saw-it-2026-10-28.md) — why tab taps go through `tap-tab.yaml`
- [optional-e2e-steps-cannot-fail-dead-selectors-stay-green](../logic-errors/optional-e2e-steps-cannot-fail-dead-selectors-stay-green-2026-08-30.md) — the same "a check that can't fail" trap as rule 3
