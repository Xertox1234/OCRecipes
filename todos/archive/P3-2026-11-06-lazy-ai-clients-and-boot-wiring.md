---
title: "Lazy AI client construction; boot entry stops importing routes/_rate-limiters"
status: done
priority: low
created: 2026-11-06
updated: 2026-11-06
assignee:
labels: [deferred, architecture]
github_issue:
---

# Lazy AI clients and boot wiring

## Summary

This covers two boot-time coupling findings from the 2026-11-06 architecture audit: L5 and L10.

## Background

- **L5:** three modules construct AI clients at import time, each with different laziness:
  - `server/lib/openai.ts:14-30` reads env, builds `new OpenAI` with a placeholder key, and exports a frozen `isAiConfigured`. Context7 research confirmed that openai 6.39.0 throws on an empty key, which is why the placeholder exists.
  - `server/lib/ai-client.ts:894-909` builds `aiChat` at import.
  - `server/lib/vertex-client.ts:42` builds its client at import.
  - Only `voice-transcription.ts` uses the `openai` instance. Every other module imports only constants or `isAiConfigured`.
  - Consequence: importing a service constructs clients and reads env, so tests have to set env before import.
- **L10:** `server/index.ts:42` imports `ipKeyGenerator` from `./routes/_rate-limiters`, which ties the boot entry to route internals.

## Acceptance Criteria

- [x] The OpenAI client is built lazily (getter on first use, gated on `isAiConfigured`), with no placeholder key; timeout constants move to a config module that constructs nothing
- [x] `aiChat` builds its dependencies on first call; importing `ai-client.ts` constructs no client
- [x] `ipKeyGenerator` lives in `server/lib/` and is imported from there by both `index.ts` and `_rate-limiters.ts`
- [x] AI-route tests and the eval runner still work; `/api/health` limiter is unchanged

## Implementation Notes

- Mind the CI stub wiring: `docs/solutions/logic-errors/ci-ai-stub-wired-to-a-route-the-code-stopped-taking-2026-11-03.md`. Lazy construction must still read `OPENROUTER_BASE_URL` at first use.
- The `/api/health` limiter stays inline, because CodeQL is required (owner 2026-11-06).
