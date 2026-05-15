---
title: "Create generic session store factory to replace triplicated pattern"
status: complete
priority: medium
created: 2026-03-27
updated: 2026-03-27
assignee:
labels: [architecture, audit-2026-03-27-full]
audit_id: M8
---

# Create generic session store factory to replace triplicated pattern

## Summary

Three independent in-memory session store implementations exist with identical patterns (Map + timeout Map + user count Map + cleanup): `server/storage/sessions.ts`, `server/routes/cooking.ts:86-120`, `server/routes/verification.ts:75-93`.

## Acceptance Criteria

- [ ] Generic session store factory created in `server/storage/sessions.ts`
- [ ] Cooking and verification routes use the factory
- [ ] No session management logic in route files
- [ ] Existing tests pass

## Implementation Notes

- Factory signature: `createSessionStore<T>(options: { maxPerUser: number, timeoutMs: number, maxGlobal: number })`
- Returns `{ get, set, delete, clearForUser, cleanup }` methods

## Dependencies

- None

## Risks

- None

## Updates

### 2026-03-27

- Created from full audit finding M8

### 2026-04-02

- Resolved by full audit finding M12: cooking and front-label session stores moved from route files into server/storage/sessions.ts
