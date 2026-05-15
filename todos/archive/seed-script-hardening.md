---
title: "Seed Recipes Script — Prod Guard + Perf"
status: in-progress
priority: medium
created: 2026-04-17
updated: 2026-04-17
assignee:
labels: [security, scripts, performance, audit-followup]
---

# Seed-Recipes Script Hardening

## Summary

`server/scripts/seed-recipes.ts` (PR #40's seed overhaul) creates a demo user
with a hardcoded password and serializes 25 recipe generations with a 15-second
sleep between each (~6 minutes pure sleep). Both should be addressed.

## Background

Audit 2026-04-17 M3 (hardcoded demo/demo123 creatable in prod) and M26
(15s × 25 sequential sleep).

## Acceptance Criteria

- [ ] **M3** Gate `ensureDemoUser()` on `NODE_ENV !== "production"`; OR
      require `--allow-prod-seed` + explicit confirmation prompt. Rotate the
      default password to something non-trivial and log it on first creation
      so the dev running the script knows what it is
- [ ] **M26** Batch content generation in parallel chunks of 3-4 (respect
      OpenAI rate limit), only rate-limit the image-generation stage
      (Runware/DALL-E). Expected reduction: ~6 min → ~1.5 min for 25 recipes
- [ ] Document the new flags + timing in CLAUDE.md under "Database" commands

## Implementation Notes

- For M26, `p-limit` or a hand-rolled chunked `Promise.all` both work.
  Image generation retries already have their own 5s sleep — keep that path
  serial-per-recipe but allow 3-4 recipes to be in-flight concurrently.
- The 15s sleep was probably a crude rate-limit protection; OpenAI's actual
  RPM limits are much higher for a dev account — check current quota before
  sizing the batch.

## Related Audit Findings

M3, M26 (audit 2026-04-17)

## Updates

### 2026-04-17

- Created from audit #11 deferred Medium/Low items
