---
title: "Migrate railway.json to Railway Infrastructure as Code before 2026-12-01"
status: backlog
priority: low
created: 2026-10-05
updated: 2026-10-05
assignee:
labels: [deferred, infra]
github_issue:
---

# Migrate railway.json to Railway Infrastructure as Code before 2026-12-01

## Summary

`railway up` (2026-10-05) warned that Config as Code (`railway.json` / `railway.toml`) is deprecated in favour of Infrastructure as Code (`.railway/railway.ts`). Railway says existing files keep working until **2026-12-01**.

## Background

This was seen while deploying from the CLI. That deploy was needed because GitHub-triggered builds were failing with `failed to fetch snapshot` on every Railway builder. The warning does not block anything yet. After 2026-12-01, the deploy settings in `railway.json` may stop being applied.

## Acceptance Criteria

- [ ] `railway.json` settings are moved to `.railway/railway.ts`, using `railway config migrate` or by hand.
- [ ] One production deploy succeeds with the new config, and its build and start settings match the old ones.
- [ ] `railway.json` is removed once nothing reads it.

## Implementation Notes

- Read the current `railway.json` (371 bytes, repo root) before migrating.
- Docs: https://docs.railway.com/infrastructure-as-code#migrating-from-config-as-code
- Deploy changes are outward-facing. The owner triggers or approves the deploy.
