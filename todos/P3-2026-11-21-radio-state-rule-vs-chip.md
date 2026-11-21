---
title: "Settle radio accessibilityState: the rule says selected, Chip sends both"
status: backlog
priority: low
created: 2026-11-21
updated: 2026-11-21
assignee:
labels: [deferred, accessibility, client, product-decision]
github_issue:
---

# Settle radio accessibilityState: the rule says selected, Chip sends both

## Summary

Accessibility audit 2026-11-21 finding, deferred at triage by the owner (or a part of a fixed finding that needs a design call). Source: `docs/audits/2026-11-21-accessibility.md` (local manifest).

## Background

`client/components/Chip.tsx` (~:196-205) sends `{ selected, checked: selected }` for role radio, with a comment saying radios report checked. `docs/rules/accessibility.md` says radios use `selected` not `checked` ("checked is checkbox semantics on TalkBack"). The docs check found RN's docs treat `checked` as a radio's state and nothing saying `checked` makes it a checkbox. The rule or the component has to change — owner call, ideally after a TalkBack device check.

## Acceptance Criteria

- [ ] Owner decides selected vs checked for radios, after a TalkBack check
- [ ] Chip and docs/rules/accessibility.md agree

## Implementation Notes

Files: `client/components/Chip.tsx`, `docs/rules/accessibility.md` (then `npm run build:copilot-instructions`).

## Updates

### 2026-11-21

- Filed from the accessibility audit
