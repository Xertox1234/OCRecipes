---
title: A Maestro tap can report COMPLETED while the app never received it — check the exact resulting state and re-tap a bounded number of times
track: bug
category: logic-errors
tags: [testing, maestro, e2e, ios, ci]
module: client
applies_to: ["e2e/**"]
symptoms: ["a tapOn is COMPLETED in commands.json, and 10-17s later the failure hierarchy still shows the screen from before the tap", "a flow fails on the wait right after a tab or FAB tap on the iOS CI runner and passes on its per-flow retry", "the tapped tab still reads selected:false in the failure dump"]
created: 2026-10-28
severity: medium
---

# A Maestro tap can report COMPLETED while the app never received it — check the exact resulting state and re-tap a bounded number of times

## Problem

On the iOS macos-26 CI runner (3 CPUs, load average 150–290 with the
simulator up), some taps were lost. Maestro found the element, tapped it and
logged COMPLETED, but the app never reacted:

- Bottom tabs: run 40583018319 — 15-17s after the tap, the dump still shows
  `tab-home selected:true` and the tapped tab `selected:false`.
- Scan FAB: run 40614765446 — `tapOn "Open scan menu"` COMPLETED in 2.6s;
  10.5s later the dump still shows Home with the menu closed.

A longer wait cannot fix a tap that never arrived.

## Root Cause

Maestro does not re-tap on its own here: on CI's Maestro 2.9.0 every logged
`tapOn` carries `retryIfNoChange: false`. (The 2026-08-30 doc
`maestro-auto-retap-untoggles-toggle-controls` describes a re-tapping
default. Don't rely on either behaviour — read the logged command.)

## Solution

Wrap the tap in a helper that checks the **exact** state the tap should
produce, then re-taps a bounded number of times and finally fails loudly:

```yaml
- tapOn: <target>
- repeat:
    times: 2
    while:
      notVisible: <exact resulting state>
    commands:
      - extendedWaitUntil:
          visible: <exact resulting state>
          timeout: 5000
          optional: true
      - runFlow:
          when:
            notVisible: <exact resulting state>
          commands:
            - tapOn: <target>   # optional: true if the target can vanish
- extendedWaitUntil:
    visible: <exact resulting state>
    timeout: 5000
```

Instances: `e2e/helpers/tap-tab.yaml` (state = `id: ${TAB}, selected: true`)
and `e2e/helpers/open-scan-menu.yaml` (state = the menu action the flow taps
next). Count re-taps from `commands.json`: a `repeatCommand` SKIPPED means
the first tap landed, COMPLETED means a re-tap happened.

## Prevention

- The state must be one only a successful tap produces. "Something changed"
  is not enough; it must be absent before the tap (check a pre-tap dump).
- Guard each re-tap with `when notVisible`, so a tap that landed late is not
  repeated. If the target's label changes once the tap lands (the FAB becomes
  "Close scan menu"), mark the re-tap `optional: true`, because the target
  can disappear between the check and the tap.
- Never re-tap a toggle this way without making sure a second tap can't undo
  the first.
