---
title: "Brief descriptive title"
status: backlog
priority: medium
created: YYYY-MM-DD
updated: YYYY-MM-DD
assignee:
labels: []
github_issue:
---

# Title

## Summary

A brief 1-2 sentence description of what needs to be done and why.

## Background

Context and motivation for this work. Why is it needed? What problem does it solve?

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Implementation Notes

Technical details, approach suggestions, or constraints to consider.

## Dependencies

- List any blocking dependencies
- External services or APIs needed
- Other todos that must be completed first

## Risks

- Potential issues or challenges
- Areas of uncertainty

## Updates

### YYYY-MM-DD
- Initial creation

## Copilot Delegation

Eligible low/deferred docs, tests, code-quality, simple performance, and simple refactor todos can be delegated to GitHub Copilot after safety checks:

```bash
npm run copilot:delegate:dry-run -- todos/YYYY-MM-DD-slug.md
npm run copilot:delegate -- todos/YYYY-MM-DD-slug.md
```

When delegation succeeds, paste the created GitHub Issue URL into `github_issue`. Copilot must work by pull request only; do not auto-merge or allow direct commits to `main`.

Do not delegate todos involving JWT/auth, IAP receipt validation, secrets, health-data boundaries, goal-safety behavior, schema/migrations, production data handling, or broad architecture without a human-approved plan.

<!--
Add dated entries as work progresses:
### 2024-01-15
- Started implementation
- Discovered issue with X, need to research Y
-->
