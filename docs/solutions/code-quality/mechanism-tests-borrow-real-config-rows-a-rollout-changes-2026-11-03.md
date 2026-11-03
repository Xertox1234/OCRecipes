---
title: "Tests of a shared mechanism (fallback, breaker, stream peek) borrowed a real AI_FEATURES row as their fixture — when a rollout changed that row, 23 tests broke; give mechanism tests synthetic rows in the module mock"
track: bug
category: code-quality
module: server
tags: [testing, typescript, ai-prompting]
applies_to: [server/lib/__tests__/**/*.ts, scripts/__tests__/**/*.ts]
symptoms: ["A config-only PR (one row's model or backup kind) fails tens of unrelated mechanism tests", "Tests named for a mechanism (\"402 raises the balance alert\", \"an open breaker skips OpenRouter\") call a real feature name such as \"photo-classify\"", "The failure surfaces at pre-push or in CI, not in the tests the PR touched"]
created: '2026-11-03'
severity: low
---

# Mechanism tests borrowed a real config row

## Problem

`server/lib/__tests__/ai-client.test.ts` (22 tests) and
`scripts/__tests__/ai-smoke.test.ts` (1) exercised the OpenAI-direct fallback
mechanism through the **real** `photo-classify` and `receipt-scan` rows. They tested
circuit breaker, alert throttling, stream peeking and warn-log shape. #1714 moved
those rows to the Vertex backup, a pure config change, and all 23 failed at
pre-push. The PR author had claimed those tests "build their own rows". The file
already had synthetic rows in its `vi.mock("../ai-models")` (`test-vertex-row`,
`test-backup-row`), but the fallback tests predated them.

## Symptoms

- A one-row config change breaks many tests about something else.
- Mechanism tests reference a production feature name.

## Root Cause

The fixture was coupled to production data whose values a rollout is *meant* to
change. The tests asserted the mechanism; the row only carried it.

## Solution

Add synthetic rows to the existing module mock with the shape the mechanism needs:
`test-fallback-row` in #1714, then `test-row` / `test-row-2` with `vertexBackup`
once the fallback route was removed (#1715). Point the tests at a constant
(`const F = "test-row" as unknown as AiFeature`). With the mechanism itself
removed, the type made the leftovers compile errors: `AiFeatureConfig` became a
union, pinned with `@ts-expect-error` rows.

Watch the bulk rename. A string replace of `"photo-classify"` → `F` also turned an
object **key** `"photo-classify": {…}` into a literal `F:` key. Use `[F]:`. Three
override tests caught it.

## Prevention

A test whose name is about a mechanism uses a synthetic row from the mock. A real
row is right only when the test is about that row's config (`ai-models.test.ts`).

## Related Files

- `server/lib/__tests__/ai-client.test.ts`, `scripts/__tests__/ai-smoke.test.ts`, `server/lib/__tests__/ai-models.test.ts`

## See Also

- [CI AI stub wired to a route the code stopped taking](../logic-errors/ci-ai-stub-wired-to-a-route-the-code-stopped-taking-2026-11-03.md) — the same rollout's other hidden coupling
