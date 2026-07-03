---
title: Input validation with Zod (parse before access)
track: knowledge
category: conventions
module: server
tags: [security, zod, validation, request-body, express]
applies_to: [server/routes/**/*.ts]
created: '2026-05-13'
---

# Input validation with Zod (parse before access)

## Rule

Validate ALL user input with Zod schemas before processing. Never access `req.body.x` without first running the body through a Zod schema parse.

## Examples

```typescript
import { z, ZodError } from "zod";

// Define schema
const registerSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(30, "Username must be at most 30 characters")
    .regex(
      /^[a-zA-Z0-9_]+$/,
      "Username can only contain letters, numbers, and underscores",
    ),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

// Validation helper
function formatZodError(error: ZodError): string {
  return error.errors
    .map((e) =>
      e.path.length ? `${e.path.join(".")}: ${e.message}` : e.message,
    )
    .join("; ");
}

// Usage in route
app.post("/api/auth/register", async (req, res) => {
  try {
    const validated = registerSchema.parse(req.body);
    // Use validated data...
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({ error: formatZodError(error) });
    }
    res.status(500).json({ error: "Internal error" });
  }
});
```

## Why

Prevents injection attacks, ensures data integrity, provides clear error messages. Combined with TypeScript's `z.infer<typeof schema>`, the validated shape is also the type used downstream — no manual sync between schema and type.

## Related Files

- `docs/rules/security.md` — "All route request bodies must be Zod-validated before any field access"

## See Also

- [Mass-assignment protection: whitelist updatable fields](mass-assignment-protection-whitelist-fields-2026-05-13.md)
- [Defense-in-depth: client-to-DB numeric validation pipeline](../design-patterns/defense-in-depth-numeric-validation-pipeline-2026-05-13.md)
