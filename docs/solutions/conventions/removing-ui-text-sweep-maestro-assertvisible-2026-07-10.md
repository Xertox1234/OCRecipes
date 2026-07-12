---
title: Removing a UI component requires sweeping Maestro E2E flows for assertions on its visible text
track: knowledge
category: conventions
module: client
tags: [maestro, e2e, ui-removal, assertvisible, testing, regression]
symptoms: ['Maestro E2E flow fails on assertVisible after an unrelated-looking UI cleanup PR merges', 'e2e smoke run red on text that no longer renders anywhere', 'Maestro E2E flow fails on tapOn after a navigation restructure merges — every subsequent step runs on the wrong screen']
applies_to: ['client/**/*.tsx', 'e2e/flows/**', 'client/navigation/**']
created: '2026-07-10'
last_updated: '2026-07-11'
---

# Removing a UI component requires sweeping Maestro E2E flows for assertions on its visible text

## Rule

When removing (or rewording) a UI component, grep the Maestro flows for the component's visible text before merging:

```bash
grep -rn "<removed text>" e2e/
```

Re-anchor any `assertVisible` that referenced the removed text to a stable element that always renders on that screen.

When changing navigation structure (renaming/removing tabs, moving a tab to a floating action button, relocating a screen to a different stack), also grep the same flows for the old tab/screen names in both `tapOn` and `assertVisible` steps:

```bash
grep -rnE "(History|Scan|oldTabName|oldScreenLabel)" e2e/
```

Re-ground every navigation step in the current navigator source (e.g. `MainTabNavigator.tsx`, stack navigators) before relying on a flow in CI. A stale `tapOn` is worse than a stale `assertVisible` because it causes every subsequent step to run on the wrong screen.

## Why

Maestro flows in `e2e/flows/` assert on rendered text (`assertVisible: "…"`) and tap on text labels (`tapOn: "…"`) — not on component identity. The Vitest suite catches broken imports and render errors, but nothing at commit/push time executes Maestro — so a text-anchored E2E assertion or navigation step breaks silently and only surfaces when the (workflow_dispatch-only) smoke run or the nightly E2E Regression is next triggered, far from the PR that caused it.

A navigation restructure is especially insidious because a stale `tapOn` fails at the first navigation step, derailing the entire scenario — and since nothing executes the flows automatically, the staleness surfaces only when someone finally runs them. This was discovered on 2026-07-11: `e2e/flows/home/navigate-tabs.yaml` and `e2e/flows/home/view-item-detail.yaml` still tapped 'History' and 'Scan' TABS from a pre-redesign tab bar; the real tab bar (`client/navigation/MainTabNavigator.tsx`) is Home / Plan / Coach / Profile with Scan as a FAB (accessibilityLabel 'Open scan menu'), and history is reached via Profile -> 'Scan History' (label in `client/components/profile/library-config.ts`). The flows stayed silently stale for weeks because nothing ran Maestro automatically until the nightly E2E Regression workflow was added (`.github/workflows/e2e-regression.yml`).

## Exceptions

Text changes inside a component that keep the asserted string intact need no sweep — the anchor still matches.

For navigation changes, if the old tab/screen name is preserved exactly (e.g. a tab label unchanged but its route changes), a sweep is still required if the `tapOn` step relies on a unique location or accessibility label that changed. When in doubt, run the flow against the current navigation tree.

## Related Files

- `e2e/flows/` — text-anchored flows, grouped per screen
- `e2e/helpers/` — reusable sub-flows invoked with `runFlow`
- `client/navigation/` — navigator source files defining tab labels, screen names, and accessibility labels

## See Also

- Maestro flow-authoring conventions (`${TIMESTAMP}`, `optional: true`, tags) live in the auto-memory `testing-patterns.md` → "Maestro E2E Patterns"
- Nightly E2E Regression workflow: `.github/workflows/e2e-regression.yml`