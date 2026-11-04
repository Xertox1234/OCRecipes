/**
 * Default deadline for an app API request. React Native's fetch has NO default
 * timeout (Android has no read timeout at all; iOS gives up after ~60s idle),
 * so without one a captive portal or half-open connection hangs the request
 * forever — wedging cold-start auth, the offline-queue drain lock, and any
 * pending mutation button. 60s matches iOS's de-facto behavior and leaves room
 * for the slower AI-backed endpoints that go through `apiRequest`.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

/**
 * `fetch` that aborts after `timeoutMs`, and ALSO when `init.signal` aborts (a
 * caller cancel, or TanStack Query's per-query cancellation signal). Uses the
 * documented global `AbortController` + `setTimeout` — never
 * `AbortSignal.timeout` / `AbortSignal.any`, which Hermes does not provide. The
 * timer and the caller listener are always released when the request settles.
 */
export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const callerSignal = init.signal ?? undefined;
  const onCallerAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener("abort", onCallerAbort);
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }
}
