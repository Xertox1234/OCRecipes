---
title: "Gemini on Vertex counts reasoning tokens inside max_completion_tokens — a small cap returns an empty reply with finish \"length\""
track: bug
category: logic-errors
module: server
tags: [ai-prompting, testing, vertex, gemini, token-budget]
applies_to: [scripts/ai-smoke.ts, scripts/ai-backup-gate.ts, server/lib/ai-models.ts, server/services/**/*.ts]
symptoms: ["A Vertex (Gemini) call returns an empty string while the same request on OpenRouter answers", "finish_reason is \"length\" and usage.completion_tokens equals the cap, with almost all of it in completion_tokens_details.reasoning_tokens", "A smoke or probe with a tiny cap (e.g. 20) passes on text rows and fails only on the image row"]
created: '2026-11-03'
severity: medium
---

# Gemini on Vertex counts reasoning tokens inside max_completion_tokens — a small cap returns an empty reply

## Problem

On Vertex AI direct (OpenAI-compatible endpoint), `google/gemini-3.8-flash` with
`reasoning_effort: "low"` spends part of `max_completion_tokens` on reasoning **before** it
writes any visible text. With a small cap, the whole budget can go to reasoning and the reply
is empty.

`npm run ai:smoke -- --backup` (PR #1706) sent every row at a 20-token cap. The text rows
answered; photo-analyze came back empty. A probe (2026-11-03) showed `finish_reason: "length"`,
`completion_tokens: 20`, of which `reasoning_tokens: 17`, so there were 3 tokens left for an
answer to an image prompt. At 200 the same call answered.

## Symptoms

- Empty reply text from a Vertex call that succeeded (no error, provider `vertex`).
- `finish_reason === "length"`, `usage.completion_tokens` at the cap, most of it in
  `completion_tokens_details.reasoning_tokens`.
- Image prompts fail first: they reason longer than short text prompts.

## Root Cause

Unlike OpenAI non-reasoning models, a Gemini thinking model counts reasoning tokens in
the same budget as its output, and the endpoint reports that in `usage`. "Low" effort lowers
reasoning but does not turn it off, and the amount varies with the input.

## Solution

- Smoke cap raised from 20 to 200 (`scripts/ai-smoke.ts`), pinned by a test that asserts the
  cap is between 200 and 256 with a comment giving the reason.
- The backup gate (`scripts/ai-backup-gate.ts`) fails any sample with a `length` finish, so a
  production row whose cap is too tight for reasoning shows up before it ships.
- `AiCallRecord` carries `finishReason` and `usage`, so the cause is visible in the record
  instead of only as an empty string.

## Prevention

- Before moving a row to a Gemini model (primary or `vertexBackup`), run its real service on
  the longest realistic input and read `finish_reason` and `reasoning_tokens` against the row's
  cap. Mocked tests cannot show this.
- Never size a probe or smoke cap for the visible answer alone on a reasoning model.

## Related Files

- `scripts/ai-smoke.ts`, `scripts/__tests__/ai-smoke.test.ts`
- `scripts/ai-backup-gate.ts` (`gateProblems`: `length finish`)
- `server/lib/ai-call-context.ts` (`AiCallUsage`, `finishReason`)
- `server/lib/ai-models.ts` (`VERTEX_BACKUP`)

## See Also

- [json-mode answer truncated at token cap](../runtime-errors/json-mode-answer-truncated-at-token-cap-fails-whole-parse-2026-09-27.md) — the same cap failing a JSON parse on OpenAI models
- [live AI check must read call records](live-ai-check-passes-on-reply-text-when-service-swallows-errors-2026-11-03.md) — the gate that catches this
