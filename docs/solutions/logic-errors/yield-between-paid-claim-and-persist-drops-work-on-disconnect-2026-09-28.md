---
title: "A yield between a paid claim and its persist lets a client disconnect drop the paid work — a finish-and-save generator must not yield until it has persisted"
track: bug
category: logic-errors
tags: [architecture, api, testing, async, generators, sse, quota]
module: server
applies_to: ["server/services/recipe-finder/**/*.ts", "server/services/coach-pro-chat.ts", "server/routes/chat.ts"]
symptoms: ["A Coach finder turn claims a recipe generation (the daily count goes up) but no recipe row is ever saved", "A docblock says the generator 'always finishes and persists' because it never checks isAborted, yet a disconnect still loses the work"]
created: 2026-09-28
severity: medium
---

# A yield between a paid claim and its persist lets a client disconnect drop the paid work

## Problem

`runCoachFinderTurn` (`server/services/recipe-finder/coach-turn.ts`) deliberately never checked for a disconnect. Its steps spend a paid claim, so the policy was finish-and-save. But when a round-1 search found nothing and fell through to Generate, it did this:

```ts
const turn = await executeFinderStep(step, ctx);   // claims the generation inside
generation = turn.messages;
yield { type: "status", label: "Creating your recipe…" };  // ← post-claim yield
// … generate, then persistAssistant(…)
```

The route consumes the generator with `for await` and does `if (aborted) break` once the client leaves. Breaking a `for await` calls the generator's `return()`, which completes it **at the yield it is suspended on**. Nothing after that yield runs: no generation, no persist. The guarded refund correctly kept the claimed row, so this was not a quota bypass. The user simply lost a slot and got no recipe.

## Symptoms

- A claimed generation has no assistant row.
- The docblock's "always finishes" was false. Not checking `isAborted` is not enough when the **caller** can stop iteration at any `yield`.

## Root Cause

With an async generator, the **consumer** decides when to stop, and it can only stop at a `yield`. A generator that "never checks for abort" still gives its caller an exit at every yield. So finish-and-save is a property of **where the yields are**, not of whether the generator reads an abort flag.

## Solution

Remove the post-claim status yield (#1152), and state the invariant in the docblock: every post-claim yield comes after `persistAssistant`. The status before `executeFinderStep` stays, because a disconnect there happens before any claim, and the guarded refund deletes the unclaimed user row.

The test models the worst-case consumer: iterate manually and `return()` the generator at the first yield after the claim mock has been called. Then assert the assistant row was persisted. It failed against the old code at exactly the removed yield:

```ts
for (let r = await gen.next(); !r.done; r = await gen.next()) {
  if (vi.mocked(storage.claimRecipeGeneration).mock.calls.length > 0) {
    await gen.return(undefined);
    break;
  }
}
expect(storage.createChatMessage).toHaveBeenCalledWith(/* … assistant recipe … */);
```

## Prevention

- In any generator that spends a paid claim, list the yields between the claim and its persist. There must be none.
- For each claim path, test with a consumer that `return()`s at the first post-claim yield. A test that drains the generator fully cannot see this defect.
- The same check applies on the route side: the RecipeChef path sets `aborted` only from the SSE timeout or the byte cap, never on disconnect (`isCoachPath` is false), so its loop does not have this defect.

## Related Files

- `server/services/recipe-finder/coach-turn.ts` — `runCoachFinderTurn`
- `server/routes/chat.ts` — Coach `for await` with `if (aborted) break`
- `server/services/__tests__/coach-pro-chat.test.ts` — "a round-1 fall-through Generate is never abandoned between its claim and its persist"

## See Also

- [generator callback side-channel delays to the next yield](../design-patterns/generator-callback-side-channel-delays-to-next-yield-2026-09-25.md) — the other half of "a generator only interacts with its consumer at yields"
- [req close never fires after body-parser — use res close](req-close-never-fires-after-body-parser-use-res-close-2026-09-24.md) — how the route detects the disconnect that triggers the `return()`
