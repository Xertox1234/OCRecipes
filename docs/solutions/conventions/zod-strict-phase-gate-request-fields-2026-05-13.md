---
title: Use Zod .strict() to phase-gate future request fields
track: knowledge
category: conventions
module: server
tags: [api, zod, validation, schema, phase-gating]
applies_to: [server/routes/**/*.ts]
created: '2026-05-13'
---

# Use Zod .strict() to phase-gate future request fields

## Rule

When a PATCH schema shares a namespace with fields that are planned but not yet implemented (Phase 2+), use `.strict()` to reject unknown keys with a 400 instead of silently ignoring them. This turns an accidental future-phase field into an explicit error rather than a silent no-op.

## Why

Without `.strict()`, a client sending `{ "user-set": true }` would silently succeed. The server would attempt to store a field that has no column backing it (or persist it to a JSONB column where it has no effect), giving the client false confidence that Phase 2 is already wired up. `.strict()` makes the phase boundary explicit at the API contract level.

`.strict()` is also useful for any endpoint that must reject extra keys for security reasons (prevents field-stuffing attacks on profile update endpoints).

## Examples

```typescript
// server/routes/reminders.ts
const mutesSchema = z
  .object({
    "meal-log": z.boolean().optional(),
    commitment: z.boolean().optional(),
    "daily-checkin": z.boolean().optional(),
    // "user-set" intentionally absent — Phase 2 field; must not be accepted yet
  })
  .strict(); // ← rejects any key not in the object above with a 400

app.patch("/api/reminders/mutes", requireAuth, async (req, res) => {
  const parsed = mutesSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, "Invalid mute keys", ErrorCode.VALIDATION_ERROR);
  }
  // ...
});
```

## Exceptions

Routes that intentionally accept open-ended data (e.g., AI context payloads, user-authored content). `.strict()` is for structured schemas with a known, fixed field set.

## Related Files

- `server/routes/reminders.ts` — `mutesSchema.strict()` gates `"user-set"` out of Phase 1 mutes PATCH

## See Also

- [Input validation with Zod](input-validation-with-zod-2026-05-13.md)
- [Mass-assignment protection: whitelist updatable fields](mass-assignment-protection-whitelist-fields-2026-05-13.md)
