---
title: Vitest mock factories throw lazily on missing exports — masked by SUT catch blocks
track: bug
category: runtime-errors
module: server
severity: low
tags: [vitest, vi.mock, mock-factory, testing, misleading-errors]
symptoms: [Tests fail inside the SUT catch block with its user-facing message, Nothing in the failure output mentions the mock or the missing export]
created: '2026-06-10'
source: '2026-06-10 full audit (L18 fix fallout, receipt-analysis tests)'
---

## Problem

Adding a new named export to a module (`OPENAI_TIMEOUT_HEAVY_MS` in
`server/lib/openai.ts`) and consuming it in a service broke that service's
tests with the service's OWN friendly error ("Failed to analyze receipt
photo") — not a module error.

## Symptoms

- Tests fail inside the SUT's `catch` block with its user-facing message.
- The real cause is invisible: nothing mentions the mock or the export.

## Root Cause

`vi.mock(path, factory)` replaces the module with a lazy proxy. Accessing an
export the factory does not define throws AT ACCESS TIME ("No X export is
defined on the mock"), not at import time. When the first access happens inside
the SUT's `try`, the catch swallows it and rethrows the generic error.

## Solution

Add the new export to every `vi.mock` factory of that module:

```ts
vi.mock("../../lib/openai", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
  MODEL_HEAVY: "gpt-4o",
  OPENAI_TIMEOUT_HEAVY_MS: 60_000, // ← required once the SUT reads it
}));
```

## Prevention

When adding a named export consumed by an existing module, grep for
`vi.mock(".*<module>"` and update each factory. If a test starts failing with
the SUT's catch-block message right after such a change, suspect the mock
factory before debugging the SUT.

## Related Files

- `server/services/__tests__/receipt-analysis.test.ts:10-21`

## See Also

- docs/rules/testing.md
