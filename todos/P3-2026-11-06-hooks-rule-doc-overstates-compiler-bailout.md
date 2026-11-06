---
title: "docs/rules/hooks.md says any react-hooks eslint-disable skips React Compiler"
status: backlog
priority: low
created: 2026-11-06
updated: 2026-11-06
assignee:
labels: [deferred, docs, react-native]
github_issue:
---

# docs/rules/hooks.md overstates which eslint-disables make React Compiler skip a component

## Summary

`docs/rules/hooks.md` says an eslint-disable of any react-hooks rule stops the compiler from compiling the component. The installed `babel-plugin-react-compiler` only does that for `exhaustive-deps` and `rules-of-hooks` (its `DEFAULT_ESLINT_SUPPRESSIONS`).

## Background

Found by the react-hooks/set-state-in-effect batch B (PR #1770, 2026-11-06). The overstated rule pushes authors away from justified `set-state-in-effect` disables that cost no compiler coverage. Not verified on the orchestrator side yet: confirm against the installed plugin before editing.

## Acceptance Criteria

- [ ] The claim is checked against `node_modules/babel-plugin-react-compiler` (DEFAULT_ESLINT_SUPPRESSIONS) and `babel-preset-expo`'s compiler options.
- [ ] `docs/rules/hooks.md` states the accurate list, and `npm run build:copilot-instructions` is run and committed.

## Implementation Notes

- Files: `docs/rules/hooks.md`, the generated copilot-instructions output.
- `docs/rules/*.md` is size-capped (scripts/check-rules-file-size.js).

## Scope Contract

- **Files in scope:** `docs/rules/hooks.md` and the files `npm run build:copilot-instructions` regenerates.
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-11-06

- Filed from the set-state-in-effect batch B report.
