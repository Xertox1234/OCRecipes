---
title: "Vertex direct (on-demand) sometimes answers 429 or takes over 15–30 s — retry a 429 once, give the backup leg its own timeout, never retry a timeout"
track: bug
category: logic-errors
module: server
tags: [ai-prompting, vertex, gemini, retries, timeouts]
applies_to: [server/lib/ai-client.ts, server/lib/vertex-client.ts, server/services/**/*.ts]
symptoms: ["RateLimitError: 429 status code (no body) from the Vertex client on a single call", "APIConnectionTimeoutError on a Vertex call that normally answers in 1-3 s", "A backup-route gate run fails a few percent of samples at random, different rows each run"]
created: '2026-11-03'
severity: medium
---

# Vertex direct: occasional 429s and slow answers

## Problem

Across the PR #1711 gate runs (~250 Vertex calls, Gemini 3.8 Flash, `traffic_type:
ON_DEMAND`), a few percent failed for capacity reasons unrelated to the request: bare 429s
and answers slower than the caller's timeout (6 s, 15 s, even 30 s on a coach stream), while
the typical call took 1–3 s. The Vertex client has `maxRetries: 0`, so each was a failure.

## Symptoms

- `429 status code (no body)` on one call; the next identical call succeeds.
- `Request timed out.` on short-deadline callers (finder classify-turn 6 s, 15 s "fast"
  services) and occasionally on 30 s streams.
- Different rows fail on each run; no `length`, no 400.

## Root Cause

On-demand Gemini on Vertex draws from Google's shared capacity (no provisioned throughput),
which sheds load with 429 and has a long latency tail. Callers' deadlines were sized for
OpenRouter → Azure.

## Solution (owner rulings 2026-11-03)

- `retryOnceWhenBusy` in `callVertexBackup`: one retry after `VERTEX_BUSY_RETRY_MS` (1 s) on
  a 429 only (also on stream open); never after a timeout — that would double the user's wait.
- `AiChatOptions.backupTimeout`: the Vertex leg's own timeout, stripped before the SDK sees
  the options. Every `OPENAI_TIMEOUT_FAST_MS` (15 s) caller gets
  `VERTEX_BACKUP_TIMEOUT_FAST_MS` (30 s) on the backup by default; classify-turn passes 12 s.
- Residual accepted: ~2/84 samples still exceed 30 s; the backup only runs during an
  OpenRouter outage and every service has a safe default.

## Prevention

A live gate on the Vertex route will show a few random capacity failures; classify them
(429 / timeout vs 400 / length / schema) before treating a run as a code regression.

## Related Files

- `server/lib/ai-client.ts` (`retryOnceWhenBusy`, `backupTimeout`), `server/lib/openai.ts`
- `server/lib/__tests__/ai-client.test.ts`

## See Also

- [no-timeout SDK needs app-side 429-aware retry](../design-patterns/no-timeout-sdk-needs-promise-race-and-app-side-retry-2026-06-20.md) — the same retry shape for another provider
- [reasoning tokens count against the cap](vertex-gemini-reasoning-tokens-count-against-completion-cap-2026-11-03.md) — the other Vertex-only failure the gate found
