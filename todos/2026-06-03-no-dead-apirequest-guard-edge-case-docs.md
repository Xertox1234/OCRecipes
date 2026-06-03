---
title: "Document and test no-dead-apiRequest-guard coverage gaps (destructured + renamed imports)"
status: backlog
priority: low
created: 2026-06-03
updated: 2026-06-03
assignee:
labels: [deferred, code-quality]
github_issue:
---

# Document and test no-dead-apiRequest-guard coverage gaps (destructured + renamed imports)

## Summary

`no-dead-apiRequest-guard` is silent on destructured response patterns (`const { headers } = await apiRequest(...)`) and renamed imports (`apiRequest as makeRequest`). The coverage boundary is undocumented and untested.

## Background

Deferred from 2026-06-03 full audit (L19). File: `eslint-plugin-ocrecipes/index.js:501-558`. These patterns bypass the rule but may contain real dead guards.

## Acceptance Criteria

- [ ] Rule test cases added for destructured (`const { data } = await apiRequest(...)`) and renamed (`apiRequest as fetch`) patterns
- [ ] Either: rule detects these patterns (enhancement), OR a comment in the rule documents the known limitations
- [ ] CI doesn't regress on existing test cases

## Implementation Notes

For rule tests, use `RuleTester` (already used in the plugin's test suite — check `eslint-plugin-ocrecipes/__tests__/`). Adding `invalid` test cases that currently pass as `valid` documents the known gap without requiring a fix.

## Dependencies

- None

## Risks

- Low — test-only or documentation change

## Updates

### 2026-06-03

- Initial creation (deferred from full audit L19)
