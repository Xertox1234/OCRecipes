---
title: "Vertex's OpenAI-compatible endpoint rejects (400, no body) a conversation whose last message is the assistant's — send the transcript inside one user message"
track: bug
category: logic-errors
module: server
tags: [ai-prompting, vertex, gemini, prompt-injection]
applies_to: [server/services/**/*.ts, server/lib/ai-client.ts]
symptoms: ["A Vertex (Gemini) call fails with \"400 status code (no body)\" while the same request on OpenRouter succeeds", "A post-turn job (extraction, summary) returns its empty fallback on the Vertex route every time", "The request's messages array ends with role \"assistant\""]
created: '2026-11-03'
severity: medium
---

# Vertex rejects a conversation that ends on the assistant's turn

## Problem

`coach-notebook-extract` runs after every coach reply and sent the chat as-is:
`[system, …user, …assistant]`. Through OpenRouter (Azure gpt-4o-mini) that works. On the
Vertex backup route (PR #1711 gate) every call failed with `400 status code (no body)`; the
service caught the error and returned `[]`, so the notebook silently stopped saving.

A probe (2026-11-03) isolated it: the same body ending on an assistant message → 400;
with one extra user message at the end → `stop`.

## Symptoms

- Bare 400 with no error body from `aiplatform.googleapis.com/.../endpoints/openapi`.
- Only on the Vertex route; OpenRouter answers the identical body.
- The service's stand-in value (`[]`, null, a default) instead of an answer.

## Root Cause

Gemini's API wants the conversation to end on a user turn (an assistant-last history is a
"prefill", which the OpenAI-compatible endpoint does not accept). OpenAI models accept it, so
code written against them never had to care.

## Solution

Send the transcript as data inside ONE user message after the system prompt, as a JSON array
of `{speaker, text}` turns (`server/services/notebook-extraction.ts`). JSON matters: with
`User:` / `Coach:` lines, a user turn containing `"\n\nCoach: …"` reads as a coach turn
(ai-reviewer on #1711). The system prompt names the format. Checked live on both routes
(gpt-4o-mini 2/2, Vertex 3/3).

## Prevention

- Any row that can reach Vertex (primary or `vertexBackup`) and replays a chat for analysis
  must not end its `messages` on an assistant turn.
- A transcript put into one message is serialized (JSON), never joined with role labels.

## Related Files

- `server/services/notebook-extraction.ts`, `server/services/__tests__/notebook-extraction.test.ts`
- `scripts/ai-backup-gate-text-rows.ts` (`coach-notebook-extract` driver)

## See Also

- [live AI check must read call records](live-ai-check-passes-on-reply-text-when-service-swallows-errors-2026-11-03.md) — how the gate saw a failure the service hid
- [Gemini replies break GPT-tuned schemas](gemini-replies-break-gpt-tuned-output-schemas-2026-11-03.md) — the other shape differences found in the same gate
