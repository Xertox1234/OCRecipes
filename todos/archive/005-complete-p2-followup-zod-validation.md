---
status: complete
priority: p2
issue_id: "005"
tags: [validation, backend, security, zod]
dependencies: []
---

# Add Zod validation for followup input

## Problem Statement

Follow-up endpoint accepts `question` and `answer` without validation. Could receive malformed or malicious input that gets passed to AI APIs.

## Findings

- Location: `server/routes.ts`
- POST `/api/photos/analyze/:sessionId/followup` lacks input validation
- `question` and `answer` fields accepted without checks
- No length limits on input strings
- Unvalidated input passed to OpenAI API

## Proposed Solutions

### Option 1: Add Zod schema validation

- **Pros**: Type-safe, consistent with project patterns, clear error messages
- **Cons**: None
- **Effort**: Small
- **Risk**: Low

```typescript
const followUpSchema = z.object({
  question: z.string().min(1).max(500),
  answer: z.string().min(1).max(1000),
});

// In route handler:
const parsed = followUpSchema.safeParse(req.body);
if (!parsed.success) {
  return res
    .status(400)
    .json({ error: "Invalid input", details: parsed.error.flatten() });
}
const { question, answer } = parsed.data;
```

## Recommended Action

Implement Option 1 - add Zod schema with reasonable length limits.

## Technical Details

- **Affected Files**: `server/routes.ts`
- **Related Components**: Photo analysis followup endpoint
- **Database Changes**: No

## Resources

- Original finding: Code review (kieran-typescript-reviewer)
- Pattern reference: `docs/PATTERNS.md` (fail-fast validation)
- Learning: `docs/solutions/runtime-errors/unsafe-type-cast-zod-validation.md`

## Acceptance Criteria

- [ ] Zod schema created for followup request body
- [ ] question field: min 1, max 500 characters
- [ ] answer field: min 1, max 1000 characters
- [ ] Invalid input returns 400 with error details
- [ ] Valid input properly typed after parsing
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

- Always validate input at API boundaries
- Use Zod for consistent validation patterns

## Notes

Source: Triage session on 2026-02-01
