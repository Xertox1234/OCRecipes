---
status: complete
priority: p1
issue_id: "002"
tags: [security, backend, authorization]
dependencies: []
---

# Fix session ID security issues

## Problem Statement

Session IDs are predictable (timestamp + random) and lack ownership verification. Any authenticated user could potentially access another user's analysis session by guessing or enumerating session IDs.

## Findings

- Location: `server/routes.ts`
- Session IDs use predictable pattern (timestamp + random)
- No userId stored in session object
- No ownership check on followup/confirm endpoints

## Proposed Solutions

### Option 1: Use crypto.randomUUID() + ownership verification

- **Pros**: Cryptographically secure IDs, prevents unauthorized access
- **Cons**: None
- **Effort**: Small
- **Risk**: Low

```typescript
import crypto from "crypto";

interface AnalysisSession {
  userId: number; // ADD THIS
  result: AnalysisResult;
  nutritionData: Map<string, NutritionData | null>;
  createdAt: Date;
}

// When creating session:
const sessionId = crypto.randomUUID();

// On followup/confirm endpoints:
if (session.userId !== req.user!.id) {
  return res.status(403).json({ error: "Not authorized" });
}
```

## Recommended Action

Implement Option 1 - use crypto.randomUUID() for session IDs and add ownership verification on all session-accessing endpoints.

## Technical Details

- **Affected Files**: `server/routes.ts`
- **Related Components**: Photo analysis session management
- **Database Changes**: No

## Resources

- Original finding: Code review (security-sentinel)

## Acceptance Criteria

- [ ] Session IDs use crypto.randomUUID()
- [ ] AnalysisSession interface includes userId field
- [ ] Session creation stores req.user.id
- [ ] Followup endpoint verifies session.userId === req.user.id
- [ ] Confirm endpoint verifies session.userId === req.user.id
- [ ] Unauthorized access returns 403
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

- Always verify resource ownership, not just authentication
- Use cryptographically secure random values for session identifiers

## Notes

Source: Triage session on 2026-02-01
