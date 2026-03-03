---
title: "Add authentication to GET /api/scanned-items/:id endpoint"
status: complete
priority: critical
created: 2026-01-30
updated: 2026-01-30
assignee:
labels: [security, api, code-review]
---

# Add Authentication to Scanned Items Endpoint

## Summary

The `GET /api/scanned-items/:id` endpoint lacks authentication middleware, allowing any unauthenticated user to access any scanned item by ID enumeration (IDOR vulnerability).

## Background

All other data access endpoints require `requireAuth` middleware, but this single-item endpoint was missed. This creates an information disclosure vulnerability where attackers can iterate through item IDs to harvest nutrition data and user dietary information.

**Location:** `server/routes.ts:256-271`

```typescript
app.get("/api/scanned-items/:id", async (req: Request, res: Response) => {
  // Missing requireAuth middleware!
  // No ownership check!
```

## Acceptance Criteria

- [ ] Add `requireAuth` middleware to the endpoint
- [ ] Add ownership verification (item.userId === req.userId)
- [ ] Return 404 for items that don't belong to the authenticated user
- [ ] Add test coverage for unauthorized access attempts

## Implementation Notes

```typescript
app.get("/api/scanned-items/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid ID" });
  }

  const item = await storage.getScannedItem(id);
  if (!item || item.userId !== req.userId) {
    return res.status(404).json({ error: "Item not found" });
  }

  res.json(item);
});
```

## Dependencies

- None

## Risks

- Breaking change if any unauthenticated clients depend on this endpoint (unlikely given app architecture)

## Updates

### 2026-01-30
- Initial creation from code review
- Identified by security-sentinel agent
- **Triage approved** - Status: backlog → ready
