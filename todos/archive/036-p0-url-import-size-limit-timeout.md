---
title: "P0: Add size limit and timeout to URL import fetch"
status: backlog
priority: critical
created: 2026-02-06
updated: 2026-02-06
assignee:
labels: [security, performance, p0, meal-plan]
---

# P0: Add size limit and timeout to URL import fetch

## Summary

The recipe URL import fetches arbitrary HTML with no response size limit or timeout, enabling denial of service via memory exhaustion or connection hanging.

## Background

`server/services/recipe-import.ts:222` — `await res.text()` buffers the entire response into memory. A malicious URL pointing to a multi-GB file would crash the Node.js process. There is also no `AbortController` timeout, so a slow-drip server could hold the connection indefinitely.

## Acceptance Criteria

- [ ] Add `AbortController` with 10-second timeout on the fetch request
- [ ] Check `Content-Length` header and reject responses over 5MB
- [ ] Stream response body with a size counter, aborting at 5MB even without Content-Length
- [ ] Add tests for timeout and oversized response scenarios
- [ ] No regressions on existing recipe import tests

## Implementation Notes

```typescript
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 10_000);
const res = await fetch(url, { signal: controller.signal, ... });
clearTimeout(timeout);

const contentLength = res.headers.get('content-length');
if (contentLength && parseInt(contentLength) > 5_000_000) {
  return { success: false, error: "FETCH_FAILED" };
}
// Stream with size limit using res.body.getReader()
```

## Dependencies

- None

## Risks

- Some legitimate recipe pages may be large (lots of images/scripts in HTML) — 5MB should be generous enough for HTML content

## Updates

### 2026-02-06

- Created from multi-agent code review of `feat/meal-planning-phase-1`
