---
title: "Settle radio accessibilityState: the rule says selected, Chip sends both"
status: backlog
priority: low
created: 2026-11-21
updated: 2026-11-22
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

- [ ] On an Android device with TalkBack, compare one radio chip sending `checked` only vs `selected` only (e.g. the "Who's it for?" audience choice) and record what each announces
- [ ] Chip and docs/rules/accessibility.md are changed to the variant TalkBack reads correctly (then `npm run build:copilot-instructions`)
- [ ] VoiceOver re-checked for the chosen variant

## Implementation Notes

Files: `client/components/Chip.tsx`, `docs/rules/accessibility.md` (then `npm run build:copilot-instructions`).

## Updates

### 2026-11-21

- Filed from the accessibility audit

### 2026-11-22

- Owner decision: check on TalkBack first, then standardise on whichever reading is correct (Chip stays as is until then). The rule and the component must match afterwards.
