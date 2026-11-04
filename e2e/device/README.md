# Device flows (physical iPhone)

Read-only Maestro flows that run on the owner's **physical iPhone**, against the
build installed there and the **live server**, signed in to the owner's own account.

CI never runs these. `e2e/config.yaml` only discovers `flows/**`, and these live
outside it.

## Rules

- **Read-only.** Taps only navigate and look: nothing is created, edited or deleted, and
  nothing calls AI. A flow that would write data or spend money does not belong here
  until the owner names it as OK for their account.
- **Never sign in or out.** Device flows start from the session already on the phone
  (`helpers/launch-installed.yaml`). The shared CI test account must never be used on
  the live server, so if the phone is signed out the flow fails at launch. Sign in by
  hand and re-run.
- **Expect the installed build, not `main`.** The phone runs whatever build or OTA it
  last received, so a screen can differ from the current code. One example: builds from
  before #1705 briefly show Pantry's upgrade screen to a paying account while the plan
  check loads.

## Running

```bash
npm run e2e:device:ios                                 # every flow in e2e/device/flows
bash e2e/device/run-ios.sh e2e/device/flows/open-recipe.yaml   # one flow
```

Needs:

- the U34Bolt drive mounted, because `maestro-runner` is installed in
  `/Volumes/U34Bolt/OCRecipes/tools/maestro-runner`;
- the iPhone **unlocked** for the whole run, on the same Wi-Fi as the Mac (or cabled). A
  phone that locks mid-run fails every following step with "element not found";
- the app installed on the phone and signed in.

The script finds the iPhone over usbmux, so no device ID is committed. `IOS_DEVICE`
overrides that. Reports and screenshots go to
`/Volumes/U34Bolt/OCRecipes/tmp/maestro-runs/device-<timestamp>/`.

First time on a Mac: cable the iPhone once, then in Finder → iPhone → General tick
**"Show this iPhone when on Wi-Fi"** → Apply. To confirm it took, check that
`ideviceinfo -q com.apple.mobile.wireless_lockdown` shows `EnableWifiConnections: true`,
and that `idevice_id -n` lists the phone.

## Why maestro-runner, not Maestro

Official Maestro does not support physical iPhones (2.11 and later refuse on purpose).
`maestro-runner` (DeviceLab) runs the same flow files on a device. Telemetry is on by
default, so `run-ios.sh` turns it off.

## Writing a device flow

What the first runs on the phone taught (2026-11-03):

- **Back:** re-tap the current tab (`tapOn: {id: "tab-…"}`). React Navigation pops that
  tab's stack to its root. Don't tap `id: BackButton` to go back: from Cookbooks it never
  left the screen.
- **Did a tap open a screen?** Wait for `id: "BackButton"` to be visible. Tab roots have
  no back button, and the tree holds only the top screen. A pushed screen's title often
  repeats the row you tapped, so waiting for the title proves nothing.
- **Digits in a regex:** write `[0-9]`, not `\d`. A pattern using `\d` failed to match
  here.
- Tab switches reuse `e2e/helpers/tap-tab.yaml` (tap, confirm `selected: true`, re-tap if
  lost).
