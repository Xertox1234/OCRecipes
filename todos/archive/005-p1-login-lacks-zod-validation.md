---
title: "Login endpoint lacks Zod validation"
status: backlog
priority: critical
created: 2026-02-24
updated: 2026-02-24
assignee:
labels: [security, code-review, validation]
---

# Login Endpoint Lacks Zod Validation

## Summary

`server/routes/auth.ts` (line 66) uses raw `req.body` destructuring for login with only basic truthiness checks, unlike the registration endpoint which uses Zod validation.

## Background

An attacker could send oversized strings or objects as username/password. While Drizzle parameterizes queries, the lack of type/length validation at the entry point is a defense-in-depth gap. Registration uses `registerSchema.parse(req.body)` properly but login does not.

## Acceptance Criteria

- [ ] Zod schema validates login input (username: string min 1 max 30, password: string min 1 max 200)
- [ ] Invalid input returns 400 with formatted Zod error
- [ ] Consistent with registration validation pattern

## Implementation Notes

- Add `loginSchema` similar to `registerSchema` in `_helpers.ts`
- Apply at the top of the login handler

## Updates

### 2026-02-24

- Found during code review by security-sentinel agent
