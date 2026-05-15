---
status: complete
priority: p3
issue_id: "009"
tags: [type-safety, backend, validation, zod]
dependencies: []
---

# Fix `any` cast for allergies parameter

## Problem Statement

Allergies array uses `any` cast which bypasses type safety in the goals endpoint.

## Findings

- Location: `server/routes.ts` (goals endpoint)
- Allergies parameter cast to `any`
- No validation that it's actually a string array
- Type safety bypassed

## Proposed Solutions

### Option 1: Add Zod schema for goals request body

- **Pros**: Type-safe, validates structure, consistent with other endpoints
- **Cons**: None
- **Effort**: Small
- **Risk**: Low

```typescript
const goalsRequestSchema = z.object({
  // ... other fields
  allergies: z.array(z.string()).optional().default([]),
});

// In route handler:
const parsed = goalsRequestSchema.safeParse(req.body);
if (!parsed.success) {
  return res
    .status(400)
    .json({ error: "Invalid input", details: parsed.error.flatten() });
}
```

## Recommended Action

Implement Option 1 - add Zod schema for goals endpoint request body.

## Technical Details

- **Affected Files**: `server/routes.ts`
- **Related Components**: Goals calculation endpoint
- **Database Changes**: No

## Resources

- Original finding: Code review (kieran-typescript-reviewer)
- Pattern reference: `docs/PATTERNS.md` (fail-fast validation)

## Acceptance Criteria

- [ ] Zod schema created for goals request body
- [ ] allergies field: `z.array(z.string())` with optional/default
- [ ] Remove `any` cast
- [ ] Invalid input returns 400
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

- Never use `any` cast - use Zod validation instead
- Consistent validation patterns across all endpoints

## Notes

Source: Triage session on 2026-02-01
