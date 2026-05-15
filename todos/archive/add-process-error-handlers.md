---
title: "Add process-level unhandled error handlers to server"
status: backlog
priority: medium
created: 2026-03-25
updated: 2026-03-25
assignee:
labels: [backend, observability, launch-readiness]
---

# Add process-level unhandled error handlers to server

## Summary

Add `process.on('unhandledRejection')` and `process.on('uncaughtException')` handlers in `server/index.ts` to log and gracefully handle fatal errors that bypass Express middleware.

## Background

The backend has excellent per-route error handling and a global Express error middleware, but lacks process-level event handlers. In production, an unhandled promise rejection or uncaught exception would crash the process without logging — making failures invisible to monitoring.

## Acceptance Criteria

- [ ] `process.on('uncaughtException')` handler logs error to stderr and exits with code 1
- [ ] `process.on('unhandledRejection')` handler logs rejection reason to stderr
- [ ] Handlers are registered near the top of `server/index.ts` (after imports, before app setup)
- [ ] No restart logic — just logging and clean exit
- [ ] Tests still pass

## Implementation Notes

```typescript
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});
```

Keep it simple. The process manager (PM2, Docker, etc.) handles restarts — the handler's job is just to ensure the error is logged.

## Dependencies

- None

## Risks

- Minimal — additive change with no impact on existing behavior

## Updates

### 2026-03-25

- Initial creation from launch readiness audit
