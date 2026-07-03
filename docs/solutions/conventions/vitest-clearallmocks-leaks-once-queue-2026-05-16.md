---
title: vi.clearAllMocks() leaks the mockResolvedValueOnce queue across tests
track: knowledge
category: conventions
module: server
severity: medium
tags: [testing, typescript]
applies_to: [server/**/__tests__/*.test.ts]
created: '2026-05-16'
---

## Rule

In a test file that mocks an **early-breaking paged/cursor loop** with a
`mockResolvedValueOnce(...)` chain, use `vi.resetAllMocks()` in `beforeEach`
— not `vi.clearAllMocks()` — so the once-queue is fully drained between
tests.

Caveat: `vi.resetAllMocks()` also wipes implementations set inside a
`vi.mock(...)` factory block (e.g. `node-cron`'s
`schedule: vi.fn().mockReturnValue({ stop: vi.fn() })`). Any such
factory-set return value must be **re-established in `beforeEach`** after
`resetAllMocks()`. Every test must also set its own per-test mock
implementations for `resetAllMocks()` to be safe.

## Why

`vi.clearAllMocks()` resets mock **call history** (`mock.calls`,
`mock.results`) but does **not** drain the queue of `mockResolvedValueOnce`
/ `mockRejectedValueOnce` values.

A cursor loop typically stops once a page is shorter than `PAGE_SIZE`:

```ts
while (true) {
  const page = await storage.getUserIdPage(cursor, PAGE_SIZE);
  if (page.length === 0) break;
  await processPage(page);
  cursor = page[page.length - 1];
  if (page.length < PAGE_SIZE) break; // ← early break
}
```

A test mocks two pages — the real page and a trailing empty page:

```ts
vi.mocked(storage.getUserIdPage)
  .mockResolvedValueOnce(["user-1"]) // page 1 (length 1 < 500)
  .mockResolvedValueOnce([]); // page 2 — NEVER CONSUMED
```

Because page 1 has fewer than `PAGE_SIZE` entries, the loop breaks after
page 1 and never calls `getUserIdPage` a second time. The queued `[]`
survives `clearAllMocks()` and is returned by the **first**
`getUserIdPage` call of a _later_ test — silently feeding it the wrong
user IDs. The later test fails with a confusing mismatch (e.g. it created
a reminder for `user-1` instead of the user it set up itself), and only
fails when run as part of the full file, not in isolation.

## Examples

Bug — leftover `[]` page leaks forward:

```ts
beforeEach(() => {
  vi.clearAllMocks(); // ← does NOT drain the once-queue
});

it("test A", async () => {
  vi.mocked(storage.getUserIdPage)
    .mockResolvedValueOnce(["user-1"])
    .mockResolvedValueOnce([]); // unconsumed — loop broke early
  await sendDailyCheckinReminders();
});

it("test B", async () => {
  vi.mocked(storage.getUserIdPage)
    .mockResolvedValueOnce(["needs-user"])
    .mockResolvedValueOnce([]);
  await sendDailyCheckinReminders();
  // FAILS: first getUserIdPage call returns the leaked [] (or a stale
  // ["user-1"]) from test A, so "needs-user" is never processed.
});
```

Fix — `resetAllMocks()` drains the queue; re-seed factory mocks:

```ts
import cron from "node-cron";

vi.mock("node-cron", () => ({
  default: { schedule: vi.fn().mockReturnValue({ stop: vi.fn() }) },
}));

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) so leftover mockResolvedValueOnce
  // queue entries cannot leak forward.
  vi.resetAllMocks();
  // resetAllMocks wipes the cron.schedule return value set in vi.mock
  // above — re-establish it so callers get a stoppable task.
  vi.mocked(cron.schedule).mockReturnValue({
    stop: vi.fn(),
  } as unknown as ReturnType<typeof cron.schedule>);
});
```

## Related Files

- `server/services/__tests__/notification-scheduler.test.ts` — paged
  reminder loops; uses `vi.resetAllMocks()` + cron mock re-seed.
- `server/services/notification-scheduler.ts` — `forEachUserPaged` cursor
  loop that breaks early when a page is shorter than `PAGE_SIZE`.

## See Also

- `docs/solutions/design-patterns/vi-resetmodules-for-env-dependent-testing-2026-05-13.md`
  — `vi.resetModules` + dynamic import for env-dependent module testing.
