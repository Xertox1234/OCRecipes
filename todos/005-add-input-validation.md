---
title: "Add Zod input validation to all API endpoints"
status: ready
priority: high
created: 2026-01-30
updated: 2026-01-30
assignee:
labels: [security, api, data-integrity, code-review]
---

# Add Zod Input Validation to API Endpoints

## Summary

Zod validation schemas exist in `shared/schema.ts` but are never used in the API routes. All endpoints accept `req.body` directly without validation.

## Background

The codebase already defines Zod schemas (`insertUserSchema`, `insertScannedItemSchema`, `insertUserProfileSchema`, `insertDailyLogSchema`) but they're never called in routes.ts. This allows malformed data to enter the database.

**Examples of unvalidated data:**
- `allergies` should be `{name, severity}[]` but any JSON accepted
- `householdSize` could be negative
- `dailyCalorieGoal` could be unrealistic values
- Registration has no password strength requirements

## Acceptance Criteria

- [ ] Validate registration inputs (username format, password strength)
- [ ] Validate dietary profile inputs using existing schema
- [ ] Validate scanned item inputs using existing schema
- [ ] Validate daily log inputs using existing schema
- [ ] Add meaningful error messages for validation failures
- [ ] Validate numeric ID parameters (check for NaN)

## Implementation Notes

```typescript
import { insertUserProfileSchema } from "@shared/schema";
import { ZodError } from "zod";

// Registration validation
const registerSchema = z.object({
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8),
});

// In route handlers:
app.post("/api/user/dietary-profile", requireAuth, async (req, res) => {
  try {
    const validated = insertUserProfileSchema.parse({
      ...req.body,
      userId: req.userId,
    });
    // Use validated data...
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: err.errors });
    }
    throw err;
  }
});
```

## Dependencies

- None (Zod already installed)

## Risks

- May reject previously accepted (but invalid) data
- Need to handle existing invalid data in database

## Updates

### 2026-01-30
- Initial creation from code review
