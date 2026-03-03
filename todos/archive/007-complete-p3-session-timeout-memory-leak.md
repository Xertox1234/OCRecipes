---
status: complete
priority: p3
issue_id: "007"
tags: [memory-management, backend, bug]
dependencies: []
---

# Fix memory leak in session timeout management

## Problem Statement

Session timeouts are created but never tracked. If server restarts or session is manually deleted, timeout continues running and may reference stale data.

## Findings

- Location: `server/routes.ts`
- setTimeout created for session cleanup
- Timeout reference not stored anywhere
- No way to cancel timeout when session deleted early
- Potential memory leak from orphaned timeouts

## Proposed Solutions

### Option 1: Track timeout references in Map

- **Pros**: Proper cleanup, prevents memory leaks
- **Cons**: Slightly more code
- **Effort**: Small
- **Risk**: Low

```typescript
const sessionTimeouts = new Map<string, NodeJS.Timeout>();

// When creating session:
const timeoutId = setTimeout(() => {
  analysisSessions.delete(sessionId);
  sessionTimeouts.delete(sessionId);
}, SESSION_TIMEOUT);
sessionTimeouts.set(sessionId, timeoutId);

// When session is accessed/deleted:
const existingTimeout = sessionTimeouts.get(sessionId);
if (existingTimeout) {
  clearTimeout(existingTimeout);
  sessionTimeouts.delete(sessionId);
}
```

## Recommended Action

Implement Option 1 - track timeouts in Map and clear on session access/deletion.

## Technical Details

- **Affected Files**: `server/routes.ts`
- **Related Components**: Photo analysis session management
- **Database Changes**: No

## Resources

- Original finding: Code review (code-simplicity-reviewer)
- Learning: `docs/solutions/logic-errors/useeffect-cleanup-memory-leak.md` (similar pattern)

## Acceptance Criteria

- [ ] sessionTimeouts Map created to track timeout references
- [ ] Timeout ID stored when session created
- [ ] Timeout cleared when session accessed (confirm endpoint)
- [ ] Timeout cleared when session deleted
- [ ] Both Maps cleaned up together
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

- Always track async cleanup references
- Clean up timers when resources are released early

## Notes

Source: Triage session on 2026-02-01
