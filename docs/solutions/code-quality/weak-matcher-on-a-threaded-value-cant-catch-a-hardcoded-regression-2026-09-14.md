---
title: "A weak matcher (expect.any(String)) on a value threaded from a fallible source cannot catch a regression to a hardcoded constant"
track: bug
category: code-quality
tags: [testing, typescript, api, timezone, silent-failure]
module: client
applies_to: [client/**/__tests__/*.test.ts, client/**/__tests__/*.test.tsx, server/**/__tests__/*.test.ts]
symptoms: ["A regression test for 'header X reaches the wire' stays green even when the value is hardcoded instead of computed", "A test asserts shape/type (expect.any(String), expect.any(Number)) on a value that is supposed to vary per caller/environment", "Reverting the fix that threads a real value through a call chain does not turn the new assertion red", "A PR #901-class defect (a signal the server parses but the client never actually sends, or sends a constant) survives its own regression test"]
created: '2026-09-14'
severity: medium
---

# A weak matcher on a threaded value cannot catch a regression to a hardcoded constant

## Problem

A test written to guard "the client sends the caller's real timezone" asserted:

```ts
expect(mockApiRequest).toHaveBeenCalledWith(
  "POST",
  "/api/batch/save",
  { items: [validItem], destination: "daily_log", groceryListId: undefined, mealType: "lunch" },
  { headers: expect.objectContaining({ "X-Timezone": expect.any(String) }) },
);
```

This passes for the correct implementation (`getDeviceTimezone()`, which returns an
IANA string). It **also passes** if the implementation is changed to
`{ headers: { "X-Timezone": "UTC" } }` — a hardcoded constant is still a `String`.
Verified by mutation: hardcoding the header in `useBatchConfirm.ts` and re-running the
suite left all 5 tests green, including this one.

The test's job was to catch exactly the defect class this codebase has already shipped
once (PR #901: a route parsed `X-Timezone` while no client ever sent it — see
`docs/solutions/logic-errors/a-date-cannot-express-a-calendar-day-2026-08-31.md`,
"Check that a header the server now depends on is actually sent"). A matcher that only
checks *shape* cannot detect a regression from "computed from the real source" to "a
plausible-looking constant" — which is precisely how that defect class re-enters
silently.

## Symptoms

- The test name or comment claims "sends the real timezone" / "threads X" / "reaches the
  wire", but the assertion only checks the value's type, not its provenance.
- Reverting the collaborator call (swap `getDeviceTimezone()` for a literal) does not
  fail the test — the sibling failure mode to
  [a test named for a property but asserting a literal snapshot](test-named-for-a-property-must-assert-the-property-not-a-literal-2026-08-31.md),
  except here the assertion is too **loose** instead of too **rigid**.
- A code reviewer (or the author) has to actually mutate the implementation to notice
  the gap — it is invisible from reading the assertion in isolation.

## Root Cause

`expect.any(Type)` (and `objectContaining` wrapping one) answers "is this the right
*kind* of value", which is the right question for a value whose content is
legitimately unpredictable (a UUID, a timestamp). It is the wrong question for a value
that is supposed to be **deterministically derived from a specific collaborator** —
there the whole point of the regression test is that the collaborator was actually
called, not merely that its return type matches.

## Solution

Mock the collaborator to a fixed, recognizable value and assert that literal — the same
pattern the sibling route test (`server/routes/__tests__/batch-scan.test.ts`, "threads
the X-Timezone header to batchCreateGroceryItems") already used correctly by pinning
`"America/Los_Angeles"` rather than `expect.any(String)`:

```ts
vi.mock("@/lib/timezone", () => ({
  getDeviceTimezone: () => "America/Los_Angeles",
}));

// ...

expect(mockApiRequest).toHaveBeenCalledWith(
  "POST",
  "/api/batch/save",
  { items: [validItem], destination: "daily_log", groceryListId: undefined, mealType: "lunch" },
  { headers: { "X-Timezone": "America/Los_Angeles" } },
);
```

Mutating `useBatchConfirm.ts` to hardcode the header now fails this test immediately,
because the mocked collaborator's distinctive return value is what the assertion
checks for — a hardcoded `"UTC"` (or any other literal) no longer satisfies it.

## Prevention

**Ask what the test would still pass under.** For any assertion using `expect.any(...)`
or a bare shape matcher on a value threaded from a named collaborator (a device-info
helper, a config read, a per-request header), ask: "would this test still pass if the
collaborator were deleted and replaced with a hardcoded value of the right type?" If
yes, mock the collaborator and assert its literal output instead.

**This is the loose-matcher mirror of the over-rigid-snapshot trap.** See
[A test named for a property but asserting a literal snapshot pins the bug it claims to
prevent](test-named-for-a-property-must-assert-the-property-not-a-literal-2026-08-31.md)
for the opposite failure (too rigid, freezes a bug as the expected value). Both traps
share one root: the assertion answers a different, easier question than the one the
test's name or purpose promises.

**Header-threading tests are a recurring instance of this.** Any test written to guard
the PR #901 defect class ("the server depends on a header/value that nothing actually
sends, or sends a fixed placeholder for") must mock the sending side's data source and
assert the specific value, never just its type.

## Related Files

- `client/hooks/__tests__/useBatchConfirm.test.ts` — the fixed test, now mocking
  `@/lib/timezone` and asserting the literal `"America/Los_Angeles"`
- `client/hooks/useBatchConfirm.ts` — the code under test (`getDeviceTimezone()` threaded
  into the `X-Timezone` header)
- `server/routes/__tests__/batch-scan.test.ts` — the sibling test that already used the
  correct pattern (pins a literal zone, not `expect.any(String)`)

## See Also

- [A test named for a property but asserting a literal snapshot pins the bug it claims to prevent](test-named-for-a-property-must-assert-the-property-not-a-literal-2026-08-31.md) — the mirror-image failure mode
- [A Date cannot express a calendar day](../logic-errors/a-date-cannot-express-a-calendar-day-2026-08-31.md) — "Check that a header the server now depends on is actually sent", the defect class this test guards against
- [describe.each tables evaluate before hooks](../logic-errors/each-tables-evaluate-before-hooks-so-pinned-env-misses-fixtures-2026-08-31.md) — another harness trap in the same timezone-testing family
