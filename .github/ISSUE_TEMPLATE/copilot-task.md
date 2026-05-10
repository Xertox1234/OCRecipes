---
name: Copilot task
about: Bounded task delegated to GitHub Copilot
title: "[Copilot] "
labels: [copilot, delegated]
assignees: [copilot]
---

## Source

Local todo: <!-- todos/YYYY-MM-DD-slug.md -->

## Summary

<!-- Briefly describe the bounded task. -->

## Acceptance Criteria

- [ ] <!-- Copy from the local todo. -->

## Files In Scope

- <!-- path/to/file.ts -->

## Safety And Review Requirements

- Copilot must open a pull request. Do not commit directly to `main`.
- Do not auto-merge. A human must review the PR.
- Stay within the files and acceptance criteria listed above.
- Do not touch JWT/auth, IAP receipt validation, secrets, health-data boundaries, goal-safety behavior, schema/migrations, production data handling, or broad architecture without a human-approved plan.
