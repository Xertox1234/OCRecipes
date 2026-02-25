---
title: "Extract rate limiter factory to reduce boilerplate"
status: backlog
priority: low
created: 2026-02-24
updated: 2026-02-24
assignee:
labels: [refactor, code-review, dry]
---

# Rate Limiter Factory

## Summary

19 rate limiter instances exist (14 in _helpers.ts + 5 scattered in route files), all following identical boilerplate. A factory function would eliminate ~100 lines.

## Acceptance Criteria

- [ ] `createRateLimit(max, windowMs, message)` factory in _helpers.ts
- [ ] All 5 route-local rate limiters consolidated into _helpers.ts
- [ ] ~100 lines of boilerplate eliminated

## Updates

### 2026-02-24
- Found by pattern-recognition and simplicity agents
