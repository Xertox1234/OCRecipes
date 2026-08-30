---
title: Maestro text selectors are FULL-STRING regexes — a substring never matches, and aggregated a11y labels are the real haystack
track: bug
category: logic-errors
tags: [testing, react-native, maestro, e2e]
module: client
applies_to: ["e2e/**", "client/navigation/**"]
symptoms: ["assertVisible fails while the hierarchy dump shows the text WITH a prefix/suffix (Hello vs Hello testuser)", "Element not found for a visibly-labeled tab", "substring-style selectors fail identically on both platforms"]
created: 2026-08-30
severity: high
---

# Maestro text selectors are FULL-STRING regexes — a substring never matches, and aggregated a11y labels are the real haystack

## Problem

Six of the eight E2E regression flows failed on their first post-login step with
`Element not found` / `Assertion is false` for strings that were plainly on
screen ("Hello", "Plan", "Profile", "Scan"). The flows were written as if
`tapOn`/`assertVisible` did substring matching.

## Symptoms

See frontmatter. The killer signature: the failure hierarchy dump contains the
asserted text **with a prefix or suffix** (`Hello testuser`, `, Plan`,
`Scan History: 0 items`).

## Root Cause

Two stacked facts (both proven from run-33292071278 artifacts):

1. Maestro compiles a bare string selector to a regex matched against the
   **entire** node text (`String.matches()` semantics). `"Hello"` cannot match
   `Hello testuser`; `"Scan History"` cannot match `Scan History: 0 items`.
2. The haystack is the **accessibility tree**, not the JSX. A clickable parent
   aggregates its children, so a tab button whose visible `<Text>` says "Plan"
   exposed only the aggregated label `", Plan"` (icon contributed an empty
   label + separator) — the plain `<Text>` node is not separately matchable.
   In this app the aggregation happened because `MainTabNavigator`'s custom
   `tabBarLabel` render **function** suppresses bottom-tabs' derived
   `accessibilityLabel` (`BottomTabBar.tsx` only synthesizes one from *string*
   labels).

## Solution

- Assert rendered-with-suffix strings via a regex tail: `"Hello.*"`,
  `"Scan History.*"`.
- Tap composite controls by **testID**, not text: the four tabs now carry
  `tabBarButtonTestID` (`tab-home` … `tab-profile`) and explicit
  `tabBarAccessibilityLabel` (also fixes the real ", Plan" TalkBack defect).
  Text-tapping "Home" is additionally unsafe because Android's system nav bar
  exposes its own `Home` a11y node — a full-match double-hit.
- Where the a11y label intentionally differs from the visible text, assert the
  label (`"Open scan menu"` for the icon-only Scan FAB, `"Browse Recipes"` for
  the Plan action row).

## Prevention

When authoring or reviewing a Maestro selector, ask: *what exact node text does
the accessibility tree export here?* — answer with a hierarchy dump
(`--debug-output`, or `maestro hierarchy` locally), never with the JSX. If the
expected value has ANY dynamic prefix/suffix, use `.*`. Remember `?` and other
regex metacharacters in literal strings (assert `"…sign out.*"`, not
`"…sign out?"` — the `?` makes the preceding char optional and the literal `?`
then never matches).

## Related Files

- `e2e/flows/**` — all selectors rewritten under these rules
- `client/navigation/MainTabNavigator.tsx` — explicit tab labels + testIDs

## See Also

- [removing-ui-text-sweep-maestro-assertvisible](../conventions/removing-ui-text-sweep-maestro-assertvisible-2026-07-10.md) — changing visible copy requires sweeping flows; this doc is why near-matches still fail
- [diagnose-e2e-from-debug-output-artifacts-first](../best-practices/diagnose-e2e-from-debug-output-artifacts-first-2026-08-30.md) — how these mismatches were proven without CI spend
