---
title: A stale-response guard keyed on the request parameter misses a same-key re-fire — key the discard on the effect run
track: bug
category: logic-errors
module: client
severity: medium
tags: [hooks, client-state, testing, race, abortcontroller, useeffect]
symptoms: [An older product's values replace a newer lookup's after a label retake, The last response to ARRIVE wins rather than the last request MADE, A barcode-equality stale check passes a response the effect had already superseded]
applies_to: [client/hooks/**/*.ts, client/hooks/**/*.tsx]
created: '2026-09-28'
---

# A stale-response guard keyed on the request parameter misses a same-key re-fire — key the discard on the effect run

## Problem

`useNutritionLookup`'s effect fetched a product and committed the result with no stale-response guard at all (audit finding L8). The todo that closed it phrased the fix as "discard outcomes whose barcode ≠ current". That guard is incomplete. The effect's deps are `[barcode, imageUri, ocrText]`, so a nutrition-label **retake** re-fires the lookup for the **same barcode** with new OCR text. Both responses carry the same barcode, so a barcode-equality check passes the older one. If it arrives last, it overwrites the newer, label-validated result.

## Symptoms

- After a label retake, the screen shows the pre-retake values, or a stale `labelUsed`/`logGate`.
- The last response to *arrive* wins, not the last request *made*.
- The bug reproduces only when the older request resolves after the newer one, so tests that use `mockResolvedValueOnce` chains never see it: those resolve in call order.

## Root Cause

What made a response stale was the effect *run* being superseded, not the request's parameters changing. Any dep that is not the request key (OCR text, a filter, a locale, a user id) can re-run the effect with an unchanged key.

## Solution

Key the discard on the run. Give each effect run its own `AbortController`, check it at the commit point, and abort it in cleanup. Make the fetch function total, so there is no error path that also needs guarding:

```ts
useEffect(() => {
  if (!barcode) return;
  const controller = new AbortController();
  setLookup(beginLookup);
  void (async () => {
    const outcome = await lookupBarcode(barcode, ocrText, controller.signal); // never rejects
    if (controller.signal.aborted) return; // superseded: new key OR same-key re-fire
    setLookup(lookupStateFromOutcome(outcome));
    setIsLoading(false); // only the CURRENT run clears loading
  })();
  return () => controller.abort();
}, [barcode, imageUri, ocrText]);
```

A plain `let ignore = false … return () => { ignore = true }` works the same way. If you also pass the signal into `fetch`, every catch layer must check `signal.aborted` before it classifies the failure. Otherwise a deliberate abort is reported as an outage, and here that would emit a "couldn't verify allergens" flag for a lookup nobody will see. Discarding only at the commit point avoids that trap.

## Prevention

- Test both a key change (A→B) **and** a same-key re-fire. Use hand-rolled deferreds (`let resolveA!: (r: Response) => void; const pA = new Promise<Response>(r => { resolveA = r; })`), resolve the newer request first and the older one late, and assert the newer result wins and `isLoading` is false. Both tests were RED on the pre-refactor hook.
- Avoid `Promise.withResolvers` in client tests. Node has it, but the Expo tsconfig declares no explicit `lib`, so a hand-rolled deferred is the safe choice.
- The run-scoped guard only detects supersession during the reader's lifetime. That is enough for an effect-scoped fetch, but not for a module-level cache swept by a separate teardown (see the epoch-counter doc below).

## Related Files

- `client/hooks/useNutritionLookup.ts` — the barcode effect: AbortController per run, discard at commit
- `client/hooks/nutrition-lookup-outcome.ts` — `lookupBarcode` (total; the `signal` is accepted but deliberately not threaded into the network calls)
- `client/hooks/__tests__/useNutritionLookup.test.ts` — the "stale-response discard" describe: (i) barcode change mid-flight, (ii) same-barcode OCR retake mid-flight

## See Also

- [abort-on-blur-strands-loading-state](abort-on-blur-strands-loading-state-2026-05-20.md) — the companion rule: the current run must always clear its loading state
- [epoch-counter-alone-misses-sweep-vs-fresh-read-race](epoch-counter-alone-misses-sweep-vs-fresh-read-race-2026-06-25.md) — where a run-scoped counter is NOT enough
- [mutual-exclusion-proven-per-call-site](../conventions/mutual-exclusion-proven-per-call-site-can-co-occur-across-invocations-2026-08-06.md) — the reset-per-lookup invariant this refactor made hold by construction
