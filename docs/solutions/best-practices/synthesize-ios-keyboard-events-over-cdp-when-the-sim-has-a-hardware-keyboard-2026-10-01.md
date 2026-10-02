---
title: "Verify keyboard-dependent layout on the iOS Simulator when a hardware keyboard blocks the soft keyboard — synthesize the keyboard notifications over CDP"
track: knowledge
category: best-practices
tags: [react-native, tooling, ios-simulator, keyboard, cdp, metro, verification]
module: client
applies_to: [".claude/skills/verify-ui/**"]
created: 2026-10-01
---

# Verify keyboard-dependent layout on the iOS Simulator when a hardware keyboard blocks the soft keyboard — synthesize the keyboard notifications over CDP

## When this applies

An automated session must verify a keyboard-dependent layout or scroll behavior on the iOS Simulator
(an input inside a scroll view, a drawer, a sheet) and tapping the input shows a caret but **no
keyboard**. A todo's acceptance criterion such as "keeps the input above the keyboard (simulator
screenshot as evidence)" lands here.

## Smell patterns

- Screenshots show a focused input with a caret and no keyboard, and RN's `Keyboard.isVisible()`
  stays `false` after the tap — no `keyboardWillShow` ever fired.
- `Simulator.app` is running with its **Connect Hardware Keyboard** preference on
  (`defaults read com.apple.iphonesimulator ConnectHardwareKeyboard` prints `1`).
- With zero Simulator windows open (`System Events` listed none), the I/O > Keyboard menu items,
  including Toggle Software Keyboard (⌘K), all report **disabled**, and clicking File > Open Simulator
  through accessibility scripting did not produce a window. Presumably no device window is active, so
  the usual toggle is unreachable.

## Why

A hardware keyboard attached through Simulator.app suppresses the software keyboard for the devices
it manages. The usual fixes are not available to an unattended session, and should not be:
`Simulator.app` here was a user's long-running session, and other sessions' Maestro drivers were
attached to the same device, so quitting or reconfiguring it would take their work down. The layout
logic under test does not care where a keyboard notification comes from, so feed it the same
notification a real keyboard would produce.

## Examples

**1. Serve the worktree's JS.** Metro can run from a nested `/todo` worktree and the symlinked
`node_modules` resolves (the bundle returned 200 in about 2s once the cache was warm):

```bash
npx expo start --dev-client --port 8091 --localhost
xcrun simctl openurl booted "ocrecipes://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8091"
```

Use a port other than 8081 so a user's own Metro is never contended. Stop it when done.

**2. Talk to the app's Hermes over CDP.** `curl localhost:8091/json/list` lists the debuggable
targets; the one described `React Native Bridgeless` has a `webSocketDebuggerUrl`. Node 22+ has a
global `WebSocket`, so a ten-line script can send `Runtime.evaluate`. Hermes' eval rejects
`async` functions — use `.then` chains.

**3. Emit the notification on `RCTDeviceEventEmitter`.** On iOS `Keyboard.addListener` and
`KeyboardAvoidingView` subscribe through it. Find the module with Metro's registry rather than
guessing ids:

```js
var mods = __r.getModules();
var find = function (re) { var out = null;
  mods.forEach(function (v, k) { if (out === null && v && v.verboseName && re.test(v.verboseName)) out = k; });
  return out; };
var Emitter = __r(find(/Libraries\/EventEmitter\/RCTDeviceEventEmitter\.js$/)).default;
var h = __r(find(/Libraries\/Utilities\/Dimensions\.js$/)).default.get('window').height;
var K = 336; // an estimate of an iPhone keyboard height — say so in the report
var p = { startCoordinates: { screenX: 0, screenY: h, width: 402, height: K },
          endCoordinates:   { screenX: 0, screenY: h - K, width: 402, height: K },
          duration: 250, easing: 'keyboard', isEventFromThisApp: true };
Emitter.emit('keyboardWillShow', p);   // and 'keyboardDidShow' ~duration later
```

Read the window height inside the app rather than hard-coding it. To observe motion, stretch
`duration` (for example 3000) and capture screenshots a fraction of a second apart
(`xcrun simctl io booted screenshot`), then compare `md5` of the frames.

**4. Report it for what it is.** The artifact shows the layout reacting to a keyboard, not a keyboard
(a blank band where it would be). Say that, give the keyboard height you assumed, and recommend one
real-keyboard pass before shipping.

## Exceptions

- Synthesized notifications cannot show the keyboard's own rendering (autofill bar, key labels) or
  its real height on other devices; only a real keyboard can.
- Android has no simulator in this setup and its events differ (`keyboardDidShow` only).
- The module regex depends on RN's file layout (`Libraries/...`); if RN restructures, re-derive it
  from `__r.getModules()` rather than trusting a stale path.

## Related Files

- `.claude/skills/verify-ui/SKILL.md` — the verify-ui procedure this complements
- `client/screens/HomeScreen.tsx` — the consumer verified this way

## See Also

- [A frozen iOS Simulator is usually a torn-down RN surface, not a hang](frozen-simulator-is-a-torn-down-rn-surface-2026-08-13.md) — the stuck-launch-image signature, and the counter-case where the surface is alive behind the native splash
- [A scroll inset that follows the iOS keyboard snaps the page back in one frame when the keyboard hides](../logic-errors/scroll-inset-that-follows-the-ios-keyboard-snaps-the-page-back-on-hide-2026-10-01.md) — what this technique measured
