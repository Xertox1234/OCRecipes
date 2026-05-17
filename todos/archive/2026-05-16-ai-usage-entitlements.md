---
title: "Add entitlement or quota gates to AI suggestion endpoints"
status: done
priority: high
created: 2026-05-16
updated: 2026-05-16
assignee:
labels: [deferred, security, api, ai-prompting]
github_issue:
---

# Add Entitlement or Quota Gates to AI Suggestion Endpoints

## Summary

Audit finding M1 found OpenAI-backed endpoints that can incur paid calls on cache miss with only per-minute rate limits. Add explicit entitlement, daily quota, or product-approved usage gates before those calls.

## Background

The broad sweep found `/api/food/parse-text`, `/api/items/:id/suggestions`, and `/api/items/:itemId/suggestions/:suggestionIndex/instructions` call AI services after `checkAiConfigured` but without a premium or usage-cap check. The right fix needs a product decision: these may be free-tier features with quota, premium-only features, or hybrid cached/free experiences.

## Acceptance Criteria

- [ ] Decide the entitlement or quota policy for text food parsing, item suggestions, and suggestion instructions.
- [ ] Enforce that policy before cache-miss OpenAI calls.
- [ ] Return project-standard error responses for blocked usage.
- [ ] Add route tests covering allowed, blocked, and cached-hit behavior.

## Implementation Notes

**Product decision (confirmed 2026-05-17): premium-only boolean gate.** All three
endpoints become premium features enforced via `checkPremiumFeature()`. No quota
counter and no schema/migration work — keep the change pure code.

Implementation spec:

1. `shared/types/premium.ts` — add two boolean keys to the `PremiumFeatures`
   interface and to both `free` (`false`) and `premium` (`true`) entries of
   `TIER_FEATURES`:
   - `textFoodParsing` — gates `/api/food/parse-text`
   - `itemSuggestions` — gates `/api/items/:id/suggestions` and
     `/api/items/:itemId/suggestions/:suggestionIndex/instructions`
2. `shared/__tests__/premium.test.ts` — add free-`false` / premium-`true`
   assertions for both new keys.
3. `server/routes/food.ts` — in `/api/food/parse-text`, call
   `checkPremiumFeature(req, res, "textFoodParsing", "Text food parsing")` and
   bail if it returns `null`, before `checkAiConfigured`. Mirror the existing
   `voiceLogging` gate on `/api/food/transcribe` in the same file.
4. `server/routes/suggestions.ts` — in both endpoints, call
   `checkPremiumFeature(req, res, "itemSuggestions", "Item suggestions")` and
   bail on `null`. Place it **before** the `storage.getScannedItem` lookup and
   the cache lookup, so free users get a consistent `403 PREMIUM_REQUIRED`
   without leaking item existence and without being served cached results
   (premium-only means the whole feature is gated, not just cache misses).
5. `server/routes/__tests__/food.test.ts` and
   `server/routes/__tests__/suggestions.test.ts` — add tests covering: free user
   blocked (`403` / `PREMIUM_REQUIRED`), premium user allowed (cache-miss → AI),
   and premium cached-hit. Reuse the `getPremiumFeatures` mock pattern already in
   the repo's route tests.

`checkPremiumFeature` already returns the project-standard `403` /
`ErrorCode.PREMIUM_REQUIRED` response, satisfying the "project-standard error
responses" criterion. Client-side paywall UX for these endpoints is out of scope
for this todo.

## Dependencies

- Product decision on free vs premium vs quota behavior.
- Possible schema/migration plan if a new quota mechanism is needed.

## Risks

- Over-gating could break expected free onboarding flows.
- Under-gating leaves unbounded AI spend on authenticated accounts.

## Updates

### 2026-05-16

- Created from broad-sweep audit finding M1.

### 2026-05-17

- Product decision made: premium-only boolean gate (over hybrid/quota/no-op).
  Implementation Notes updated with the concrete spec; ready for execution.
