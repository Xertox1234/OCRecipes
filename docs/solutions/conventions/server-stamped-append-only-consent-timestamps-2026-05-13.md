---
title: "Server-stamped, append-only consent/audit timestamps"
track: knowledge
category: conventions
tags: [security, consent, audit, legal, gdpr, ccpa, timestamps]
module: server
applies_to:
  ["server/routes/profile.ts", "server/storage/users.ts", "shared/schema.ts"]
created: 2026-05-13
---

# Server-stamped, append-only consent/audit timestamps

## Rule

Legally significant timestamps (CCPA/PIPEDA consent acceptance, terms agreement, age verification) must be stamped server-side and never overwritten. Clients send a boolean **intent flag**, not a timestamp.

## Rules detail

1. **Schema:** Add a nullable `timestamp` column (e.g., `healthDataConsentAt`). Never default it server-side — null is the explicit "not yet consented" state.
2. **Input schema:** `.omit({ healthDataConsentAt: true })` from `insertUserProfileSchema` and add a transient boolean flag (`healthDataConsent: z.boolean().optional()`). Any client-supplied timestamp is silently dropped at the boundary.
3. **Route:** Only when the flag is `true`, set `healthDataConsentAt: new Date()` server-side. Omit the field when the flag is absent or `false` so the storage layer preserves the previous value.
4. **Storage append-only enforcement:** In partial-update paths use SQL `COALESCE(existing, incoming)` so a re-stamp can never overwrite the original record. In transactional upsert paths (where you already read the existing row), reapply the existing value when it is non-null.

## Examples

```typescript
// server/routes/profile.ts — POST upsert
const profileData = {
  ...rest,
  ...(validated.healthDataConsent === true
    ? { healthDataConsentAt: new Date() }
    : {}),
};

// server/storage/users.ts — partial update
const setClause: Record<string, unknown> = { ...rest, updatedAt: new Date() };
if (incomingConsent) {
  setClause.healthDataConsentAt = sql`COALESCE(${userProfiles.healthDataConsentAt}, ${incomingConsent})`;
}

// server/storage/users.ts — transactional upsert
const safeData = existing.healthDataConsentAt
  ? rest // preserve existing record
  : {
      ...rest,
      ...(incomingConsent ? { healthDataConsentAt: incomingConsent } : {}),
    };
```

## Why both layers

The route is the first line of defense (clients cannot supply the column), but the storage layer is the durable enforcement point for any future internal caller that bypasses the route.

## Test coverage required

1. Flag `true` stamps a `Date` whose value is between request start and end.
2. Flag `false` or absent does not pass the column to storage.
3. Client-supplied `healthDataConsentAt` is silently dropped by the schema.
4. Re-stamping with flag `true` preserves the original timestamp at the storage layer (`COALESCE` / existence guard).

## Related Files

- `server/routes/profile.ts`, `server/storage/users.ts` (`updateUserProfile`, `upsertProfileWithOnboarding`)
- `server/routes/__tests__/profile.test.ts`
- `docs/rules/security.md` — "Consent / audit timestamps must be stamped server-side from `new Date()`" / "must be append-only at the storage layer"
- Origin: 2026-05-10 health-data consent implementation; kimi-review surfaced backdate + overwrite attack surface.
