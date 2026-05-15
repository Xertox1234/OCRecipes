---
title: "P3: Reduce JSON body parser limit from 50MB"
status: backlog
priority: low
created: 2026-02-06
updated: 2026-02-06
assignee:
labels: [security, p3]
---

# P3: Reduce JSON body parser limit from 50MB

## Summary

The Express JSON body parser is configured with a 50MB limit, far too generous for a nutrition tracking API. Enables memory exhaustion via large request payloads.

## Background

`server/index.ts:56-64` — `express.json({ limit: "50mb" })`. Most API requests should be well under 1MB. Photo uploads use multer with a separate 1MB limit.

## Acceptance Criteria

- [ ] Reduce default JSON body limit to 2MB
- [ ] Verify no legitimate endpoint needs more than 2MB
- [ ] No regressions

## Dependencies

- None

## Updates

### 2026-02-06

- Created from multi-agent code review of `feat/meal-planning-phase-1`
