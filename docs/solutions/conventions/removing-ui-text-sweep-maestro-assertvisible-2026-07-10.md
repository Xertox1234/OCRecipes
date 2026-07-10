---
title: Removing a UI component requires sweeping Maestro E2E flows for assertions on its visible text
track: knowledge
category: conventions
module: client
tags: [maestro, e2e, ui-removal, assertvisible, testing, regression]
symptoms: ['Maestro E2E flow fails on assertVisible after an unrelated-looking UI cleanup PR merges', 'e2e smoke run red on text that no longer renders anywhere']
applies_to: ['client/**/*.tsx', 'e2e/flows/**']
created: '2026-07-10'
---

# Removing a UI component requires sweeping Maestro E2E flows for assertions on its visible text

## Rule

When removing (or rewording) a UI component, grep the Maestro flows for the component's visible text before merging:

```bash
grep -rn "<removed text>" e2e/
```

Re-anchor any `assertVisible` that referenced the removed text to a stable element that always renders on that screen.

## Why

Maestro flows in `e2e/flows/` assert on rendered text (`assertVisible: "…"`), not on component identity. The Vitest suite catches broken imports and render errors, but nothing at commit/push time executes Maestro — so a text-anchored E2E assertion breaks silently and only surfaces when the (workflow_dispatch-only) smoke run is next triggered, far from the PR that caused it.

## Exceptions

Text changes inside a component that keep the asserted string intact need no sweep — the anchor still matches.

## Related Files

- `e2e/flows/` — text-anchored flows, grouped per screen
- `e2e/helpers/` — reusable sub-flows invoked with `runFlow`

## See Also

- Maestro flow-authoring conventions (`${TIMESTAMP}`, `optional: true`, tags) live in the auto-memory `testing-patterns.md` → "Maestro E2E Patterns"
