---
title: "An async generator's callback side-channel is delayed until the next unrelated yield — yield a discriminated chunk directly instead"
track: knowledge
category: design-patterns
tags: [architecture, typescript, async, generators, streaming, sse]
module: server
applies_to: [server/services/**/*.ts]
created: '2026-09-25'
---

# An async generator's callback side-channel is delayed until the next unrelated yield — yield a discriminated chunk directly instead

## Rule

When an `async function*` needs to signal an event to its consumer's `for await` loop at a
precise point mid-execution (e.g. "right before I run this side effect"), **yield a discriminated
union chunk directly from the generator body** — never pass the consumer a callback parameter
(`onSomething?: (arg) => void`) and have the generator invoke it synchronously.

A callback can run at exactly the right *logical* moment, but it cannot itself suspend the
generator or push a value out through `.next()`. Its effect (e.g. pushing into an array the
consumer owns) is only observable the next time the consumer's `for await` loop actually resumes
— which is whenever the generator's *next* `yield` fires, however unrelated that yield is to the
event. If the generator does real async work (an API call, `Promise.all(...)`) between the
callback invocation and its next yield, the consumer is blocked waiting on `.next()` for that
entire duration and cannot forward the signal (e.g. write it to an SSE stream) until the unrelated
work finishes.

## Why

`for await (const chunk of gen)` only resumes the loop body when `gen.next()` resolves. A plain
callback invoked inside the generator's body does not resolve `.next()` — it just runs synchronous
code inside whatever `.next()` call happens to be in flight when the generator reaches that line.
If the generator's next line after the callback is an `await` (executing tools, calling an API), the
consumer stays parked inside that same `.next()` call, unable to observe anything until it resolves.

Yielding a chunk, by contrast, *is* what resolves `.next()` — the consumer's loop body runs
immediately, so whatever it does with that chunk (write it to a client, push it into a queue)
happens now, not after the generator's subsequent unrelated work completes.

## Examples

**Before (delayed side channel):**

```ts
// generator
async function* generateResponse(onToolCalls?: (names: string[]) => void) {
  // ...stream some content...
  onToolCalls?.(["search_recipes"]); // fires now, but nothing yields yet
  await Promise.all(toolCalls.map(execute)); // consumer is blocked here, unaware
  yield nextRoundContent; // onToolCalls's effect only becomes visible HERE
}

// consumer
const pending: string[] = [];
for await (const chunk of generateResponse((names) => pending.push(...names))) {
  for (const name of pending.splice(0)) yield { type: "status", label: name }; // too late
  yield { type: "content", content: chunk };
}
```

**After (direct yield):**

```ts
type Chunk = { type: "content"; content: string } | { type: "tool_calls"; toolNames: string[] };

async function* generateResponse(): AsyncGenerator<Chunk> {
  // ...stream some content...
  yield { type: "tool_calls", toolNames: ["search_recipes"] }; // resumes consumer NOW
  await Promise.all(toolCalls.map(execute));
  yield { type: "content", content: nextRoundContent };
}

for await (const chunk of generateResponse()) {
  if (chunk.type === "tool_calls") {
    for (const name of chunk.toolNames) yield { type: "status", label: name };
    continue;
  }
  yield { type: "content", content: chunk.content };
}
```

This project's `generateRecipeChatResponse` (`server/services/recipe-chat.ts`) already used the
direct-yield shape independently. `generateCoachProResponse`
(`server/services/nutrition-coach.ts`) instead used the callback shape for its tool-call
notification, and the consumer (`handleCoachChat` in `server/services/coach-pro-chat.ts`) could
only flush the resulting status label once the *next* content chunk arrived — silencing the SSE
wire for an entire tool-execution round plus the following OpenAI streaming call. Fixed by
changing `generateCoachProResponse`'s return type from `AsyncGenerator<string>` to
`AsyncGenerator<CoachProChunk>` and yielding the `tool_calls` chunk immediately, before the tools
run.

## Exceptions

A callback parameter is still the right shape when the generator's consumer genuinely doesn't need
to *react* to the event during iteration — e.g. a pure logging/metrics hook that fires
fire-and-forget and never needs to reach the wire before the generator's next yield. The tell for
"you need a yield, not a callback" is: does anything downstream of the consumer's loop body need to
observe this event before the generator's own subsequent `await`s resolve?

## Related Files

- `server/services/nutrition-coach.ts`: `CoachProChunk`, `generateCoachProResponse`
- `server/services/coach-pro-chat.ts`: `handleCoachChat`'s Coach Pro branch
- `server/services/recipe-chat.ts`: `generateRecipeChatResponse` (pre-existing correct precedent)

## See Also

- [SSE AbortController — cancel OpenAI stream on client disconnect](sse-abort-controller-cancel-openai-stream-2026-05-13.md)
