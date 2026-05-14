---
title: "Testing real `express-rate-limit` behavior (bypass the passthrough mock)"
track: knowledge
category: design-patterns
tags: [testing, vitest, express-rate-limit, mocks, routes]
module: server
applies_to: ["server/routes/**/__tests__/**/*.ts"]
created: 2026-05-13
---

# Testing real `express-rate-limit` behavior (bypass the passthrough mock)

## When this applies

`__mocks__/express-rate-limit.ts` at the project root replaces the real limiter with a passthrough whenever any test calls `vi.mock("express-rate-limit")`. Most route tests want that — they assert quota-based 429s by faking the storage counter, not by exercising the middleware. But when the endpoint's rate limit is the ONLY 429 trigger (e.g., a data-export endpoint where the AC requires `429 when rate limit exceeded`), the passthrough mock makes the test impossible.

## Why

The fix: scope the unmock to a single test, then dynamically re-import the route module so it binds to the real `rateLimit` factory. `vi.doUnmock` only affects modules imported AFTER the call. The route module was already imported at the top of the file (with the passthrough mock active), so its `exportRateLimit` is bound to the passthrough. The dynamic `await import("../export")` after `doUnmock` triggers a fresh evaluation that picks up the real factory.

Dropping the passthrough also drops the existing storage mock from the route's module graph — you must restate it on the fresh graph with `vi.doMock`.

## Examples

```typescript
it("returns 429 after the configured rate limit is exceeded", async () => {
  // Use the real express-rate-limit so the limiter actually counts requests.
  vi.doUnmock("express-rate-limit");

  // Re-mock storage on the fresh module graph — the previous mock is dropped
  // along with the cached express-rate-limit when resetModules runs implicitly.
  vi.doMock("../../storage", () => ({
    storage: { getUserDataExport: vi.fn().mockResolvedValue(buildExport()) },
  }));

  const { register: registerReal } = await import("../export");
  const app = express();
  app.use(express.json());
  registerReal(app);

  // The route is configured at 2 requests/hour. The first two succeed; the
  // third returns 429 from the real express-rate-limit middleware.
  const a = await request(app)
    .get("/api/users/me/export")
    .set("Authorization", "Bearer t");
  const b = await request(app)
    .get("/api/users/me/export")
    .set("Authorization", "Bearer t");
  const c = await request(app)
    .get("/api/users/me/export")
    .set("Authorization", "Bearer t");

  expect(a.status).toBe(200);
  expect(b.status).toBe(200);
  expect(c.status).toBe(429);
});
```

## Caveat

The limiter's in-memory store persists for the lifetime of the test process. If a second test in the same file needs the real limiter again, the counter may already be exhausted. Keep "real limiter" tests in their own describe block at the bottom of the file, or instantiate a fresh app with a separately-imported limiter inside each test.

## Related Files

- `server/routes/__tests__/export.test.ts`

## See Also

- [`vi.resetModules` + dynamic import for env-dependent module testing](vi-resetmodules-for-env-dependent-testing-2026-05-13.md)
- [Rate limiting on auth endpoints](rate-limiting-auth-endpoints-2026-05-13.md)
