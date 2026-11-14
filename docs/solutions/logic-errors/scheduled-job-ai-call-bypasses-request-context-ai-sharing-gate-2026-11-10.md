---
title: A scheduled job's AI call bypasses the request-context AI-sharing gate — background work that sends one user's data must check isAiSharingAllowedFor itself
track: bug
category: logic-errors
module: server
severity: high
tags: [security, ai-prompting, privacy, scheduler]
symptoms: [A cron or background job calls aiChat with a specific user's data and the call succeeds for a user who answered "Not now" to AI sharing, assertAiSharingAllowed returns without checking because getRequestContext() has no userId]
applies_to: ["server/services/**/*.ts", "server/services/notification-scheduler.ts"]
created: 2026-11-10
---

# A scheduled job's AI call bypasses the request-context AI-sharing gate

## Problem

The AI-sharing permission (privacy audit H3) is enforced inside `aiChat` by
`assertAiSharingAllowed()` (`server/lib/ai-sharing-gate.ts`), which reads the user from
the **request context** that `requireAuth` sets. A scheduled job runs outside any
request, so the context has no `userId` and the gate returns without checking. Its own
comment says so: work outside a signed-in request "sends no user's request and is not gated".

That is true for jobs that send no personal data. It is false for a job that builds a
prompt from one user's stored data — the Coach weekly report sends a week of that user's
food totals and recipe titles from the hourly scheduler. Without its own check it would
have made the AI call for a user who declined AI sharing.

## Root Cause

The gate identifies the user from ambient context, not from the data being sent. Any
code path that has a user's data but no request (cron, queue worker, script, a
fire-and-forget continuation after the response) is invisible to it.

## Solution

Check the specific user explicitly before building the prompt, and fall back to the
non-AI path:

```ts
// server/services/weekly-report/generate.ts
const aiAllowed = await isAiSharingAllowedFor(userId);
const { content, source } = await writeWeeklyReport(facts, { aiAllowed }); // false → template, no AI call
```

`server/services/recipe-auto-image.ts` is the earlier precedent for the same check in
background work.

## Prevention

- Any new background or scheduled code that calls `aiChat`, Runware or transcription with
  a user's data must call `isAiSharingAllowedFor(userId)` first and have a no-AI outcome.
- Put the decision in the caller and pass it in (`{ aiAllowed }`), so the AI function's
  tests can assert "no call when not allowed" without mocking the gate.

## Related Files

- `server/lib/ai-sharing-gate.ts` — `assertAiSharingAllowed` (request context) and `isAiSharingAllowedFor` (explicit user)
- `server/services/weekly-report/generate.ts`, `server/services/weekly-report/writer.ts`
- `server/services/recipe-auto-image.ts`

## See Also

- `shared/lib/ai-sharing.ts` — the disclosure version and recipients the permission covers
