---
title: "symbol-graph.sh's inline node -p expression relies on an implicit `path` global"
status: done
priority: low
created: 2026-07-12
updated: 2026-07-12
assignee:
labels: [deferred, pg-lab]
github_issue:
---

# symbol-graph.sh's inline node -p expression relies on an implicit `path` global

## Summary

`scripts/pg-lab/symbol-graph.sh`'s dead-exports `node -p` expression uses `path.normalize`
without an explicit `require("path")`, relying on Node's REPL lazy-loaded built-in globals.
Verified safe today (Node 24.9.0, matching `package.json`'s `engines.node: "24.x"` pin,
fails closed via the existing refusal path if it ever broke) but is a non-obvious implicit
dependency worth making explicit.

## Background

Surfaced during code review of PR #591 (symbol-graph.sh/`.ts` `path.normalize` parity fix).
Both findings were SUGGESTION-tier (non-blocking); bundled into one low-severity todo.

## Acceptance Criteria

- [ ] `scripts/pg-lab/symbol-graph.sh`'s `node -p` expression explicitly
      `const path = require('path');` instead of relying on the REPL lazy-global.
- [ ] `.claude/hooks/test-pg-lab-symbol-graph.sh`'s `PKGFIX` fixture gets a one-line comment
      (or explicit recreation between sub-cases) noting that the control /
      normalization-proof / missing-main sub-cases share the same `package.json` in place —
      intentional today, but would silently share state if a future case needed isolation.

## Implementation Notes

- `scripts/pg-lab/symbol-graph.sh:127`
- `.claude/hooks/test-pg-lab-symbol-graph.sh` — `PKGFIX` fixture setup

## Dependencies

None.

## Risks

None — both items are defensive/explicitness cleanups with no behavioral change.

## Updates

### 2026-07-12

- Filed from code review of PR #591 during the "review, fix, codify, close all open PRs" session.
