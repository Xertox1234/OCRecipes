---
status: complete
priority: p1
issue_id: "003"
tags: [security, backend, rate-limiting, cost-protection]
dependencies: []
---

# Add rate limiting to photo endpoints

## Problem Statement

Photo analysis endpoints call external APIs (OpenAI, CalorieNinjas) without rate limiting. Vulnerable to abuse and cost explosion from malicious or accidental overuse.

## Findings

- Location: `server/routes.ts`
- POST `/api/photos/analyze` triggers OpenAI GPT-4o Vision (expensive)
- POST `/api/photos/analyze/:sessionId/followup` triggers additional API calls
- No rate limiting middleware applied
- Unlimited requests = unlimited costs

## Proposed Solutions

### Option 1: Add express-rate-limit middleware

- **Pros**: Simple, well-tested solution, per-user limiting
- **Cons**: None
- **Effort**: Small
- **Risk**: Low

```typescript
import rateLimit from 'express-rate-limit';

const photoRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: { error: 'Too many photo uploads. Please wait.' },
  keyGenerator: (req) => req.user?.id?.toString() || req.ip,
});

app.post('/api/photos/analyze', requireAuth, photoRateLimit, upload.single('photo'), ...);
app.post('/api/photos/analyze/:sessionId/followup', requireAuth, photoRateLimit, ...);
```

## Recommended Action

Implement Option 1 - add express-rate-limit to all photo analysis endpoints.

## Technical Details

- **Affected Files**: `server/routes.ts`
- **Related Components**: Photo analysis endpoints
- **Database Changes**: No
- **Dependencies**: May need to install `express-rate-limit` package

## Resources

- Original finding: Code review (security-sentinel)
- express-rate-limit docs: https://www.npmjs.com/package/express-rate-limit

## Acceptance Criteria

- [ ] express-rate-limit package installed (if not already)
- [ ] Rate limiter configured (10 req/min suggested)
- [ ] Applied to POST `/api/photos/analyze`
- [ ] Applied to POST `/api/photos/analyze/:sessionId/followup`
- [ ] Rate limit key uses user ID (not just IP)
- [ ] Appropriate error message returned when limit exceeded
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

- Always rate limit endpoints that call external paid APIs
- Use user ID as rate limit key for authenticated endpoints

## Notes

Source: Triage session on 2026-02-01
