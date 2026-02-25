---
title: "Hoist Zod schema to module scope in scanned-items POST"
status: pending
priority: p2
created: 2026-02-25
updated: 2026-02-25
assignee:
labels: [code-review, performance]
---

# Hoist Zod schema to module scope in scanned-items POST

## Summary

The `scannedItemInputSchema` Zod schema in `POST /api/scanned-items` is rebuilt on every request. Move it to module scope to eliminate per-request allocation.

## Background

Found by: performance-oracle (OPT-6)

**File:** `server/routes/nutrition.ts`, lines 158-203

The schema with transforms creates closures, chains transforms, etc. on every POST request. Under load (100 req/s), this creates ~100 intermediate Zod objects per second.

## Acceptance Criteria

- [ ] `nullishString` and `scannedItemInputSchema` moved to module scope
- [ ] Handler only calls `.parse()` — no schema construction

## Updates

### 2026-02-25
- Created from code review (7-agent parallel review)
