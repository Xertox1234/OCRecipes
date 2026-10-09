---
title: vi.clearAllMocks() leaks the mockResolvedValueOnce queue across tests
track: knowledge
category: conventions
module: server
severity: medium
tags: [testing, typescript]
applies_to: [server/**/__tests__/*.test.ts]
created: '2026-05-16'
last_updated: '2026-10-09'
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

## Also seen: `retry: 2` hid it (#1336, 2026-10-09)

`server/services/recipe-finder/__tests__/find-community.test.ts` had one test that queued two
mocked search pages and used only one. The leftover page leaked into the next test, so 5 tests
failed **on every run, even with the file run alone**. They never showed in CI or locally,
because `vitest.config.mts` retries each failure twice (`retry: 2`): the first attempt
failed, consumed the leaked page, and the retry passed on a clean queue. A deterministic order
bug looked like a green suite.

- **Run `--retry=0` when you touch a test file that queues `mock*Once` values,** and whenever a
  failure is reported as "flaky". `NODE_ENV=test npx vitest run --retry=0 <paths>` is cheap. A
  failure on every run with retries off is a bug, not a flake.
- A sweep with retries off over the 9 suites the coach recipe offer touched (3 runs, 858 tests)
  found no other failure of this kind. That bounds this one area, not the repo.

The fix there was to reset that mock before each test, the same shape as the Rule above.

## Related Files

- `server/services/__tests__/notification-scheduler.test.ts` — paged
  reminder loops; uses `vi.resetAllMocks()` + cron mock re-seed.
- `server/services/recipe-finder/__tests__/find-community.test.ts` — the leak that `retry: 2` hid
  (#1336)
- `server/services/notification-scheduler.ts` — `forEachUserPaged` cursor
  loop that breaks early when a page is shorter than `PAGE_SIZE`.

## See Also

- `docs/solutions/design-patterns/vi-resetmodules-for-env-dependent-testing-2026-05-13.md`
  — `vi.resetModules` + dynamic import for env-dependent module testing.
