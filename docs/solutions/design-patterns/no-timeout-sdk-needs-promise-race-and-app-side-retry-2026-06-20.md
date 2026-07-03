---
title: SDKs with no AbortSignal need a Promise.race timeout + app-side 429-aware retry
track: knowledge
category: design-patterns
module: server
tags: [api, timeout, retry, backoff, resend, error-handling]
applies_to: [server/services/email.ts, server/services/**/*.ts]
created: '2026-06-20'
---

# SDKs with no AbortSignal need a Promise.race timeout + app-side 429-aware retry

## When this applies

Calling a third-party SDK whose request method exposes **no** timeout / `AbortSignal`
option and does **not throw** on API errors (it returns a `{ data, error }` shape).
The Resend email SDK (`resend@6`) is the live example: `resend.emails.send(payload)`
accepts only an `idempotencyKey` option, and returns `{ data, error }` where `error`
is `{ message, statusCode, name }` and `name` is a fixed `RESEND_ERROR_CODE_KEY`
union. Contrast with the OpenAI SDK, which takes `{ timeout: ms }` and throws — see
the See Also.

## Why

- **No `AbortSignal` ⇒ `fetch`-style `AbortSignal.timeout(ms)` is useless** (the SDK
  ignores the signal). The project convention for a non-`fetch` SDK call is
  `Promise.race([sdkCall(), timeoutReject])` with a `setTimeout`-reject and
  `clearTimeout` in `finally` — the same shape already used in
  `server/services/push-notifications.ts`. This bounds the **orchestration promise**
  so a slow send can't linger as a multi-minute background promise. It does **not**
  abort the underlying socket (nothing can, without a signal) — the comment must say
  "bounds the orchestration promise," not "bounds the connection."
- **`Promise.race([send, timeout])` already attaches a rejection handler to `send`
  synchronously.** So when the timeout wins the race and `send` rejects later, it is
  *not* an unhandledRejection — a separate `void send.catch(() => {})` is dead code.
  (Verified empirically: a late-rejecting losing promise raises no unhandledRejection.)
  Do not add the defensive `.catch()`; it misleads future readers into thinking the
  race leaves a dangling rejection.
- **Returns-`{error}`-instead-of-throwing ⇒ retry by inspecting `error.name`,
  allowlist the retryables.** Retry only transient names; default to no-retry so a
  terminal 4xx (validation, auth) is logged once and not hammered. For Resend the
  retryable set is `rate_limit_exceeded` (429, distinct/longer backoff),
  `internal_server_error` (5xx), `application_error`. **Exclude quota errors**
  (`monthly_quota_exceeded` / `daily_quota_exceeded`) — a retry can never fix them.
- **Bound the *total* lifetime, not just per attempt.** With retries + backoff the
  worst case is `(attempts) * timeout + Σ backoffs`; a "distinct, longer" 429 backoff
  is exactly what can reintroduce the multi-minute linger you were trying to kill.
  Pick values so the total stays well under a minute.
- **A pre-send per-recipient throttle is consumed once.** Retries reuse the single
  already-counted slot (the cap check runs before the retry helper), so retrying
  never violates the cap.

## Examples

```typescript
const SEND_TIMEOUT_MS = 8_000;
const MAX_RETRIES = 2; // up to MAX_RETRIES + 1 sends total
const TRANSIENT_BACKOFF_BASE_MS = 500; // 500, 1000 (doubled per attempt)
const RATE_LIMIT_BACKOFF_BASE_MS = 1_000; // 1000, 2000 — distinctly longer for 429
const RETRYABLE = new Set(["rate_limit_exceeded", "internal_server_error", "application_error"]);

for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { error } = await Promise.race([
      resend.emails.send(payload), // race attaches the reject handler — no extra .catch()
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timed out")), SEND_TIMEOUT_MS);
      }),
    ]);
    if (!error) return null; // success
    if (!RETRYABLE.has(error.name)) return error; // terminal — log once, no retry
    if (attempt < MAX_RETRIES) {
      const base = error.name === "rate_limit_exceeded"
        ? RATE_LIMIT_BACKOFF_BASE_MS : TRANSIENT_BACKOFF_BASE_MS;
      await sleep(base * 2 ** attempt);
    }
  } catch (err) {
    // rejected promise (network OR the race timeout) — synthesize a terminal-shaped
    // error so the caller's logger.error fires, then retry transiently
    if (attempt < MAX_RETRIES) await sleep(TRANSIENT_BACKOFF_BASE_MS * 2 ** attempt);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
```

Test the distinctness, not just "a retry happened": with `vi.useFakeTimers()`, drive
the helper with `await vi.advanceTimersByTimeAsync(ms)` (the async form flushes
microtasks between attempts; the sync form does not). Assert the 429 path is still at
1 call at 999ms and fires at 1000ms, while the network path fires by 500ms — that pins
the two backoffs as genuinely different.

## Exceptions

- SDKs that **do** take a `{ timeout }` option and **throw** (OpenAI) use that option
  + `try/catch`, not this pattern — see See Also.
- One-shot `fetch` calls use `AbortSignal.timeout(ms)` directly (the signal works).

## Related Files

- `server/services/email.ts`
- `server/services/__tests__/email.test.ts`
- `server/services/push-notifications.ts`

## See Also

- [OpenAI SDK timeout and tiered error handling](openai-sdk-timeout-and-error-handling-2026-05-13.md)
- [Vitest 4 mock-new needs a real class, not an arrow vi.fn()](../runtime-errors/vitest4-mock-new-needs-real-class-not-arrow-vifn-2026-06-19.md)
