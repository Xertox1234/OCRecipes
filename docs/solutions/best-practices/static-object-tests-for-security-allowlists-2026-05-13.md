---
title: 'Static-object tests for security allowlists (column projections, public fields)'
track: knowledge
category: best-practices
module: server
tags: [testing, security, allowlists, column-projections, pii, vitest]
applies_to: [server/storage/**/__tests__/**/*.test.ts]
created: '2026-05-13'
---

# Static-object tests for security allowlists (column projections, public fields)

## When this applies

When a feature's load-bearing security control is a plain-object allowlist (e.g., a column projection like `exportUserColumns`), test the allowlist **directly** as a static assertion — not through the HTTP boundary, not through a mocked storage call.

## Why

The property you care about is "key X is not in this object," which is a property of the object literal, not of any runtime behavior. A static `Object.keys(x).not.toContain("password")` test:

- Runs in ~1ms (no DB, no Express setup, no async)
- Has no mocks (so it can't drift from reality)
- Fails immediately on any regression (someone adds `password` to the allowlist → CI red on the next push)

A route-level test that mocks the storage layer cannot catch this — it asserts what the route does with the storage response, not what the storage actually returns.

## Examples

```typescript
// server/storage/__tests__/export.test.ts
import { exportUserColumns } from "../export";

describe("exportUserColumns", () => {
  const forbiddenKeys = ["password", "tokenVersion"] as const;

  for (const key of forbiddenKeys) {
    it(`does not include sensitive column "${key}"`, () => {
      expect(Object.keys(exportUserColumns)).not.toContain(key);
    });
  }
});
```

## When to use

Any time the security boundary is "this list of fields is the safe export / public projection / accepted-input whitelist."

## Exceptions

When the property is dynamic (depends on user role, feature flag, runtime config). Those need full integration tests.

## Related Files

- `server/storage/__tests__/export.test.ts` — guards the CCPA/PIPEDA data-export `users` projection

## See Also

- [Exclude sensitive columns from default queries](../conventions/exclude-sensitive-columns-default-queries-2026-05-13.md)
- [PII stripping in API response serialization](../design-patterns/pii-stripping-api-response-serialization-2026-05-13.md)
