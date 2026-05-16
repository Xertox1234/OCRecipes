---
title: "Premium-Gate Parity Missed the Read Endpoints"
track: bug
category: logic-errors
tags: [premium-gate, quota, spoonacular, paid-api, security]
module: server
applies_to: ["server/routes/recipe-catalog.ts", "server/routes/**/*.ts"]
symptoms:
  - "POST endpoints are premium-gated but sibling GET endpoints that hit the same paid API are not"
  - "Free-tier user drains a paid external-API quota by browsing"
  - "PR title and review focus on writes; the matching reads were not even opened"
created: 2026-04-18
severity: high
---

# Premium-Gate Parity Missed the Read Endpoints

## Problem

A commit titled "fix: gate recipe catalog save + URL import behind premium" added `checkPremiumFeature()` to the POST endpoints that hit Spoonacular. Sibling GET endpoints (`/catalog/search`, `/catalog/:id`) that proxy Spoonacular responses were untouched. A free-tier user could drain the paid Spoonacular quota by typing in the recipe browser without ever needing to save a result.

## Symptoms

- Spoonacular quota burn rate exceeds the user count of paying subscribers
- Premium check is present in the route file but only on the POST handler
- Free user accounts can hit `/catalog/search` thousands of times without quota error

## Root Cause

The mental model "premium gates writes, reads are free" leaks from standard REST auth patterns. For endpoints that hit **external paid APIs**, every request costs money — reads are not free. The sibling POST was the tell; the matching GET was not opened during review.

## Solution

Add `checkPremiumFeature()` to every endpoint in the same route file that hits the same external client. For this fix, both `GET /catalog/search` and `GET /catalog/:id` now require premium.

## Prevention

- When adding a premium gate, list every endpoint in the same route file that calls the same external client, not just the endpoint on the ticket. If it hits Spoonacular / Runware / paid-USDA / OpenAI, it needs a gate.
- Audit by external-client call site, not by HTTP method. The cost is on egress, not on side effect.
- Maintain a checklist of paid external clients and grep for their usage during every premium-gate PR.

## Related Files

- `server/routes/recipe-catalog.ts:66-147` — GET /search + GET /:id fixed
- `docs/legacy-patterns/security.md` — "Premium-Gate Parity" pattern updated with reads

## See Also

- [Premium-gate parity expensive AI paths](../conventions/premium-gate-parity-expensive-ai-paths-2026-05-13.md)
- [Check premium feature helper](../design-patterns/check-premium-feature-helper-2026-05-13.md)
