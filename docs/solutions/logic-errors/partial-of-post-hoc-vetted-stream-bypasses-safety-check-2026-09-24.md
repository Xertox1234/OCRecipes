---
title: "Saving a partial cut from a stream that is safety-checked only at the end persists text that was never vetted"
track: bug
category: logic-errors
module: server
severity: critical
tags: [ai-safety, ai-prompting, api, streaming, sse, persistence]
applies_to: [server/routes/chat.ts, server/services/coach-pro-chat.ts, server/services/nutrition-coach.ts]
symptoms: ['A generator yields deltas to the caller first and runs containsUnsafeCoachAdvice (or any output filter) on the full text only after the stream ends', 'New code persists "what was streamed so far" on an abort, timeout, or error path', 'The safety check sits after the loop, so any early exit skips it']
created: '2026-09-24'
---

# Saving a partial cut from a stream that is safety-checked only at the end persists text that was never vetted

## Problem

The H6 fix (#1060) saves the streamed-so-far text as the assistant reply when an Ask Coach client disconnects mid-answer. On the free tier, `generateCoachResponse` (`server/services/nutrition-coach.ts`) streams each OpenAI delta with `yield delta` **first**. It runs `containsUnsafeCoachAdvice(fullResponse)` only after the loop, and then asks the client to swap in the safety message (`SAFETY_OVERRIDE_SENTINEL`). A disconnect at any point during streaming, which is a wide window and not a race, cut the text before the check ran. The settle path would then have saved raw, unvetted, possibly unsafe dietary or medical advice as the permanent reply. It would also have been fed back into later prompts as history. The server-reviewer caught it in review, and the fix went into the same PR.

## Symptoms

- An output filter runs on the **finished** text, but the text reaches the caller in pieces before that.
- A new abort, timeout, or error path saves or caches whatever was already streamed.
- The two tiers behave differently. Coach Pro (`generateCoachProResponse`) holds each round until `containsUnsafeCoachAdvice` passes, so its partials are safe. The free tier streams live, so its partials are not.

## Root Cause

The end-of-stream check assumes every response is either complete, and so checked, or discarded. Saving a partial breaks that assumption. The check lives after the loop, and the early exit skips it.

## Solution

The code that saves the partial re-runs the same check the finished path uses, and saves the standard safety message in its place when it fails:

```ts
const partialText = containsUnsafeCoachAdvice(strippedText)
  ? STANDARD_SAFETY_MESSAGE // exported from coach-pro-chat.ts for this
  : strippedText;
```

Apply it to both tiers, not only the one that streams live, so the code stays safe if a generator's buffering changes. Pinned by the real-socket cell `never persists an unvetted unsafe free-tier partial` in `server/routes/__tests__/chat.test.ts`: the free-tier generator yields "You likely have diabetes." and the client disconnects. The cell failed before the fix.

## Prevention

- Before saving a streamed prefix, find **where** the response's safety filter runs relative to the yields. If it runs after the yields, the prefix is unvetted.
- Never cache a partial. `setCoachCachedResponse` would serve it to other users.

## Related Files

- `server/routes/chat.ts`: the H6 settle block
- `server/services/nutrition-coach.ts`: `generateCoachResponse` (streams first, checks after), `generateCoachProResponse` (checks, then streams)
- `server/lib/ai-safety.ts`: `containsUnsafeCoachAdvice`

## See Also

- [req.on('close') attached after express.json() never fires](req-close-never-fires-after-body-parser-use-res-close-2026-09-24.md). Fixing disconnect detection is what made this path reachable.
- [Filter LLM memory extraction with safety checks before persistence](../conventions/filter-llm-memory-extraction-safety-checks-2026-05-13.md)
