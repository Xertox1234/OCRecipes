---
title: "Add entitlement or quota gates to AI suggestion endpoints"
status: backlog
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

Relevant files:

- `server/routes/food.ts`
- `server/routes/suggestions.ts`
- `server/routes/__tests__/food.test.ts` or equivalent
- `server/routes/__tests__/suggestions.test.ts` or equivalent

Do not add a silent premium gate without product confirmation. If introducing a new quota counter or persisted state, treat schema/migration work as requiring a human-approved plan.

## Dependencies

- Product decision on free vs premium vs quota behavior.
- Possible schema/migration plan if a new quota mechanism is needed.

## Risks

- Over-gating could break expected free onboarding flows.
- Under-gating leaves unbounded AI spend on authenticated accounts.

## Updates

### 2026-05-16

- Created from broad-sweep audit finding M1.
