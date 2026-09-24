---
title: Re-scanning an accumulated streaming string for a marker on every chunk is quadratic
track: bug
category: performance-issues
module: client
severity: low
tags: [streaming, sse, performance, parsing, quadratic]
symptoms: ['A parser call takes the full accumulated buffer every SSE/stream event and re-runs indexOf/regex from position 0', 'A stream-processing function has a single-argument (buffer) -> result signature with no state carried between calls', 'Perf audit flags a streaming text handler as O(n^2) without profiling data to back it']
applies_to: [client/hooks/use*Stream*.ts, client/components/**/*-utils.ts]
created: '2026-09-24'
---

# Re-scanning an accumulated streaming string for a marker on every chunk is quadratic

## Problem

`useCoachStream.ts` accumulates SSE `content` chunks into `accumulatedRef.current` and, on every
single event, called `stripCoachBlocksFence(accumulatedRef.current)` — a pure function that runs
`accumulated.indexOf("```coach_blocks\n")` (and a second `indexOf` for the close marker) starting
from index 0 every time. For a response streamed in `k` chunks reaching length `n`, that is `k`
full-string scans of a string that keeps growing toward `n`, i.e. O(n²) total scanning work over
the life of one stream — dominant specifically in the common case where the marker never appears
at all (most coach replies have no `coach_blocks` action-card block), since every event still pays
the full-length `indexOf` miss.

## Symptoms

- A streaming parser/stripper function takes the WHOLE accumulated buffer as its only argument and
  is called after every appended chunk.
- The function's `indexOf`/`search`/regex call has no `fromIndex` derived from prior calls — it
  always starts at (or effectively re-scans from) position 0.
- Found in a front-end audit as "runs on the full text each event," not from a profiler — the cost
  is invisible in normal use because typical coach responses are short; it matters for the
  long-tail long response.

## Root Cause

A stateless `(accumulated: string) => result` signature is the natural first implementation for a
"strip a marker out of streamed text" helper, and it is correct — but every caller that re-invokes
it on a monotonically growing string turns an O(n) per-call cost into O(n) × (number of calls),
i.e. O(n²) overall. The fix is not a smarter search algorithm; it's carrying state across calls so
each call only pays for the NEW suffix of the string, not the whole thing again.

## Solution

Add a second, state-carrying function alongside the pure one — do not replace the pure version,
since a stateless call is still correct (and simpler) wherever it is only invoked once (e.g. a
stream's final `done` reconciliation pass):

```typescript
export interface FenceScanState {
  openIdx: number; // -1 while still searching
  openSearchedTo: number; // how far the open-marker search has already covered
  closeIdx: number;
  closeSearchedTo: number;
}

export function createFenceScanState(): FenceScanState {
  return { openIdx: -1, openSearchedTo: 0, closeIdx: -1, closeSearchedTo: 0 };
}

export function stripCoachBlocksFenceIncremental(
  accumulated: string,
  state: FenceScanState,
): string {
  if (state.openIdx === -1) {
    // Only re-scan the unsearched suffix, minus a small constant overlap
    // (marker.length - 1) so a marker split across two chunks isn't missed.
    const from = Math.max(0, state.openSearchedTo - (OPEN_FENCE.length - 1));
    const idx = accumulated.indexOf(OPEN_FENCE, from);
    state.openSearchedTo = accumulated.length;
    if (idx === -1) return accumulated.trim();
    state.openIdx = idx;
    state.closeSearchedTo = idx + OPEN_FENCE.length;
  }
  // ...close-marker search follows the same held-back-overlap rule.
}
```

Callers keep the exact same call shape as the pure version (`stripCoachBlocksFenceIncremental(acc,
state)` vs `stripCoachBlocksFence(acc)`) — the only addition is a `state` object the caller must
own for the lifetime of one accumulation (one `useRef` per active stream), and reset alongside the
accumulated buffer itself.

## Prevention

- When a parser is called repeatedly on an accumulated/growing buffer (SSE, chunked XHR, WebSocket
  frames), check whether its scan starts from 0 every call. If so, and the buffer can grow
  unboundedly across many calls, add a state-carrying variant that remembers how far it has already
  searched.
- The overlap window when resuming a search must be `markerLength - 1` chars, not 0 — otherwise a
  marker split exactly across two chunk boundaries is missed.
- **Reset the state object everywhere the accumulated buffer itself is reset** — a stream restart,
  abort, or content-replacement (e.g. a safety-override branch that clears the buffer) must reset
  BOTH together, or stale offsets from a previous stream corrupt marker detection on the next one.
  Grep every assignment of the accumulated-buffer ref to find all reset sites.
- Prove equivalence with an exhaustive property test: for a couple of representative full strings,
  feed every possible 1-character chunk-boundary split and assert the incremental result matches
  the pure whole-buffer function's result after every chunk. This catches off-by-one overlap bugs
  that a handful of hand-picked split points can miss.
- Keep the original pure whole-buffer function for call sites that only run once per stream (e.g. a
  `done`/completion reconciliation pass) — it is simpler and its O(n) cost there is a single
  one-time charge, not a per-event one.

## Related Files

- `client/components/coach/coach-chat-utils.ts` — `stripCoachBlocksFence` (pure) and
  `stripCoachBlocksFenceIncremental` + `FenceScanState` (incremental)
- `client/hooks/useCoachStream.ts` — `fenceStateRef`, reset in `startStream`, `abortStream`, and
  the `safety_override` branch
- `client/components/coach/__tests__/coach-chat-utils.test.ts` — exhaustive 1-char chunk-boundary
  equivalence tests

## See Also

- [Avoid re-querying after insert](avoid-requery-after-insert-build-history-2026-05-13.md)
