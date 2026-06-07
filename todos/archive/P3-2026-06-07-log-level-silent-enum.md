---
title: 'Add "silent" to the LOG_LEVEL env enum'
status: backlog
priority: low
created: 2026-06-07
updated: 2026-06-07
assignee:
labels: [deferred, infrastructure]
github_issue:
---

# Add "silent" to the LOG_LEVEL env enum

## Summary

`server/lib/env.ts` validates `LOG_LEVEL` against the enum `["fatal","error","warn","info","debug","trace"]`, which omits `"silent"` even though pino supports it. An operator setting `LOG_LEVEL=silent` at runtime would crash boot at `validateEnv()`.

## Background

Discovered during the Railway/Cloudflare Phase 1 R2 migration (branch `feat/phase1-railway-cloudflare-r2`, 2026-06-07). `test/setup.ts` already sets `LOG_LEVEL="silent"` globally; the new `server/lib/__tests__/env.test.ts` had to override `LOG_LEVEL: "info"` in its `BASE` fixture specifically because the schema rejects `"silent"`. That workaround documents the latent defect without fixing it. Low severity: nothing sets `LOG_LEVEL=silent` at real runtime today (only the test harness), and the failure is loud (boot throws) rather than silent — but the validation is wrong vs. pino's accepted levels.

## Acceptance Criteria

- [ ] Add `"silent"` to the `LOG_LEVEL` enum in `server/lib/env.ts`.
- [ ] Confirm pino accepts `"silent"` as a level (it does) and the logger initializes correctly with it.
- [ ] Remove the `LOG_LEVEL: "info"` override from the `BASE` fixture in `server/lib/__tests__/env.test.ts` (and its explanatory comment), so the tests run against the real `test/setup.ts` `LOG_LEVEL="silent"` injection without a confound.
- [ ] `npm run test:run` (or the env + a representative server test) stays green.

## Implementation Notes

- File: `server/lib/env.ts` — the `LOG_LEVEL` field is a `z.enum([...]).optional()`.
- File: `server/lib/__tests__/env.test.ts` — drop the `LOG_LEVEL` line from `BASE` once the enum accepts the value `test/setup.ts:52` injects.
- Verify `server/lib/logger.ts` (or wherever pino is configured) doesn't separately re-validate/transform the level in a way that would reject `"silent"`.

## Dependencies

- None.

## Risks

- Trivial change; the only risk is an unrelated place that re-checks `LOG_LEVEL` against the old enum. Grep for `LOG_LEVEL` usage before changing.

## Updates

### 2026-06-07

- Initial creation. Deferred from the Phase 1 R2-migration branch (surfaced by the env-guard code review).
