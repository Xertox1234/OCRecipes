---
status: complete
priority: p3
issue_id: "006"
tags: [configuration, backend, best-practices]
dependencies: []
---

# Move USDA API key to environment variable

## Problem Statement

USDA `DEMO_KEY` is hardcoded in the nutrition lookup service. Should use environment variable for production key.

## Findings

- Location: `server/services/nutrition-lookup.ts:198`
- Hardcoded `DEMO_KEY` string in API call
- DEMO_KEY has severe rate limits (30 requests/hour)
- Production deployment would require code change

## Proposed Solutions

### Option 1: Use environment variable with fallback

- **Pros**: Simple, maintains dev convenience, production-ready
- **Cons**: None
- **Effort**: Small
- **Risk**: Low

```typescript
const usdaApiKey = process.env.USDA_API_KEY || "DEMO_KEY";
const response = await fetch(
  `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(query)}&pageSize=1&api_key=${usdaApiKey}`,
);
```

## Recommended Action

Implement Option 1 - use env var with DEMO_KEY fallback for local dev.

## Technical Details

- **Affected Files**: `server/services/nutrition-lookup.ts`
- **Related Components**: Nutrition lookup service
- **Database Changes**: No
- **Env Changes**: Add optional `USDA_API_KEY` to `.env.example`

## Resources

- Original finding: Code review (code-simplicity-reviewer)

## Acceptance Criteria

- [ ] USDA API key read from `process.env.USDA_API_KEY`
- [ ] Falls back to 'DEMO_KEY' if env var not set
- [ ] `.env.example` updated with `USDA_API_KEY` entry
- [ ] Tests pass
- [ ] Code reviewed

## Work Log

### 2026-02-01 - Approved for Work

**By:** Claude Triage System
**Actions:**

- Issue approved during triage session
- Status: ready
- Ready to be picked up and worked on

**Learnings:**

- API keys should come from environment, even public demo keys

## Notes

Source: Triage session on 2026-02-01
