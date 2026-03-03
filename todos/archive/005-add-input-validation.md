---
title: "Add Zod input validation to all API endpoints"
status: complete
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

- [x] Validate registration inputs (username format, password strength)
- [x] Validate dietary profile inputs using existing schema
- [x] Validate scanned item inputs using existing schema
- [x] Validate daily log inputs using existing schema
- [x] Add meaningful error messages for validation failures
- [x] Validate numeric ID parameters (check for NaN)

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

### 2026-01-30
- Implementation complete:
  - Added Zod validation to registration endpoint (username: 3-30 chars, alphanumeric + underscore; password: min 8 chars)
  - Added validation to profile update endpoint (displayName, dailyCalorieGoal 500-10000, onboardingCompleted)
  - Added validation to dietary profile endpoints using extended insertUserProfileSchema with allergySchema
  - Added validation to scanned items POST endpoint with numeric field coercion
  - Added parseIdParam helper for numeric ID validation (returns 400 for NaN or non-positive)
  - Added formatZodError helper for consistent, meaningful error responses
  - All endpoints return 400 with { error: string, details: ZodIssue[] } on validation failure
