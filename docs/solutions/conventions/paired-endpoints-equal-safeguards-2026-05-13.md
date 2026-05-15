---
title: "Paired Endpoints Get the Same Safeguards"
track: knowledge
category: conventions
tags:
  [api, validation, rate-limiting, audit-trail, subscription, restore, security]
module: server
applies_to: ["server/routes/**/*.ts"]
created: 2026-05-13
---

# Paired Endpoints Get the Same Safeguards

## Rule

When two endpoints handle paired operations (purchase/restore,
create/delete, subscribe/unsubscribe, save/restore), apply the same Zod
validation, rate limiting, and transaction/audit logging to both — even if
one "feels less important."

## Smell patterns

- Purchase endpoint uses `Schema.safeParse()`, restore endpoint uses
  hand-rolled `if (typeof req.body.x !== "string")`.
- Rate limiter applied to one half of the pair only.
- `createTransaction()` audit row written on purchase, no equivalent for
  restore.
- "We don't charge them on restore so it doesn't need protection" reasoning
  in a PR description or comment.

## Why

Restore feels less important than purchase because it doesn't charge the
user. That creates a false sense that it needs less protection. In practice,
the unprotected sibling becomes the easier target:

- **Malformed data without Zod.** A restore endpoint accepting arbitrary
  shapes can produce downstream errors that look like server faults but
  originated in unvalidated input.
- **Audit-trail gap without transaction logging.** Compliance, fraud
  investigation, and support all rely on the audit log. A gap on the restore
  path means support can't reconstruct what happened.
- **Abuse without rate limiting.** Restore endpoints can be hammered to
  probe for valid receipts, enumerate users, or harvest entitlement state.

Attackers profile the unprotected endpoint precisely because the team
underweighted it.

## Examples

### Mismatched safeguards — the bug

```typescript
// Purchase: full safeguards
router.post(
  "/subscription/upgrade",
  subscriptionRateLimit,
  async (req, res) => {
    const parsed = UpgradeRequestSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "Invalid request");
    // ... upgrade logic ...
    await storage.createTransaction({
      /* audit row */
    });
    res.json({
      /* ... */
    });
  },
);

// Restore: hand-rolled and unlogged
router.post("/subscription/restore", async (req, res) => {
  if (typeof req.body.receipt !== "string") {
    return res.status(400).json({ error: "Missing receipt" });
  }
  // ... restore logic, no audit row ...
  res.json({
    /* ... */
  });
});
```

### Matched safeguards — the fix

```typescript
router.post(
  "/subscription/restore",
  subscriptionRateLimit,
  async (req, res) => {
    const parsed = RestoreRequestSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "Invalid request");
    // ... restore logic ...
    await storage.createTransaction({
      /* audit row */
    });
    res.json({
      /* ... */
    });
  },
);
```

Three changes: validate with the dedicated `RestoreRequestSchema`, apply the
same `subscriptionRateLimit`, write the same audit row via
`createTransaction()`.

### Review checklist for paired endpoints

When you spot a pair (`foo` + `restoreFoo`, `subscribe` + `unsubscribe`,
`createX` + `deleteX`), run through:

1. Does each have a matching Zod schema?
2. Does each apply the same rate limiter?
3. Does each write the same audit row?
4. Does each enforce the same ownership / IDOR check?

If any answer is "no without justification," fix the unprotected sibling.

## Exceptions

- **Genuinely asymmetric flows.** Read endpoints obviously differ from
  write endpoints. The rule applies to _paired writes_, not to read/write
  asymmetry.
- **Documented threat-model decisions.** A team may explicitly downgrade
  rate limiting on a restore endpoint because of UX needs. Document the
  decision in the PR and in a comment at the call site.

## Related Files

- `server/routes/subscription.ts` — `/subscription/upgrade` and
  `/subscription/restore` endpoints.
- `shared/schemas/subscription.ts` — `UpgradeRequestSchema` and
  `RestoreRequestSchema`.

## See Also

- [stub-service-production-safety-gate](stub-service-production-safety-gate-2026-05-13.md) —
  the broader subscription-rollout learnings include the stub safety gate.
- [match-existing-api-response-conventions](match-existing-api-response-conventions-2026-05-13.md) —
  another subscription-rollout instinct (don't drift between similar code
  paths).
- [tier-limits-single-source-of-truth](tier-limits-single-source-of-truth-2026-05-13.md) —
  the third subscription-rollout convention.
