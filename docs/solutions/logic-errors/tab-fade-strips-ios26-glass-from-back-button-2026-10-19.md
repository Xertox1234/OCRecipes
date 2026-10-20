---
title: "On iOS 26 the bottom-tab cross-fade strips the Liquid Glass pill from native-stack back buttons — the style depends on the tab animation, not on the screen"
track: bug
category: logic-errors
module: client
severity: low
tags: [react-native, react-navigation, native-stack, bottom-tabs, navigation, ios, liquid-glass]
applies_to: ["client/navigation/MainTabNavigator.tsx", "client/hooks/useScreenOptions.ts", "client/navigation/*StackNavigator.tsx"]
symptoms: ["Some pushed screens show the back button as a glass pill, others as plain '‹ Back' text, with identical screen options", "The same screen shows a pill in one session and plain text in another", "A QA pass reports a per-screen back-button style difference that never reproduces after a cold relaunch"]
created: '2026-10-19'
---

# The bottom-tab cross-fade strips the iOS 26 glass pill from back buttons

## Problem

QA sweep #66 reported that some pushed screens (Settings, Favourites, Pantry) drew the back
button as a Liquid Glass pill while others (Browse Recipes, Sign-in methods) drew plain
"‹ Back" text. Every screen gets the same `useScreenOptions()`, and per-screen code
(`setOptions({ headerBackVisible })`) differed in ways that did not line up with the
difference.

## Root cause

`MainTabNavigator` sets `animation: reducedMotion ? "none" : "fade"`. On iOS 26.1+ UIKit
does not apply Liquid Glass to bar-button backgrounds when an ancestor view's opacity
animates in from 0, which is what the tab cross-fade does to the tab scene. So the back
button's style depends on the TAB ANIMATION, not on the screen. The react-native-screens
maintainers reproduced it without the library and filed it with Apple
(software-mansion/react-native-screens#3453, closed `type:native-bug`).

The "per-screen" pattern QA saw was an artefact: the pills appeared only in the first
visits of a long-running session, and after a JS reload or a cold relaunch every screen
was plain.

## Evidence (iOS 26.5 simulator, dark mode, cold relaunch per row)

| Change | Settings (Profile) | Browse Recipes (Plan) | Pantry (Profile) |
| --- | --- | --- | --- |
| None (fade on) | plain | plain | plain |
| `headerBlurEffect` dropped on liquid-glass | plain | — | — |
| `headerTransparent: false` | white bar, back button invisible | — | — |
| Tab `animation: "none"` | **pill** | **pill** | **pill** (after several tab switches) |
| Custom `sceneStyleInterpolator` from 0.001 opacity (the issue's workaround) | — | plain | — |

## Decision

The owner chose to keep the tab cross-fade (2026-10-19), so back buttons stay plain until
Apple fixes the regression. The comment next to `animation` in `MainTabNavigator.tsx`
records the trade-off.

## Prevention

- Do not chase a per-screen fix for back-button glass, and do not draw a custom
  `headerLeft` pill: the cause is the tab animation, and a custom button loses the
  system back menu and VoiceOver behaviour.
- To re-check after an iOS update: cold-relaunch, open Profile → Settings, and
  compare with tab `animation: "none"` temporarily set.
- When judging a native-chrome difference in the simulator, compare screens only after
  a cold relaunch. A long-running dev session (and Metro reloads triggered by edits in
  `.claude/worktrees/`, which Metro also watches) can leave UIKit in a state that no
  user sees.
