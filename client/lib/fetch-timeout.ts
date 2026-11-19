/**
 * Default deadline for an app API request. React Native's fetch has NO default
 * timeout (Android has no read timeout at all; iOS gives up after ~60s idle),
 * so without one a captive portal or half-open connection hangs the request
 * forever — wedging cold-start auth, the offline-queue drain lock, and any
 * pending mutation button. 60s matches iOS's de-facto behavior and leaves room
 * for the slower AI-backed endpoints that go through `apiRequest`.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

/** An error with a fixed `name`, so classifiers can key on it. */
function namedError(name: "TimeoutError" | "AbortError", message: string) {
  const err = new Error(message);
  err.name = name;
  return err;
}

/**
 * The error a deliberate caller cancel rejects with: name "AbortError", which
 * the global mutation net treats as "not a failure". Code that aborts its own
 * raw `fetch` (useReceiptScan) rethrows this, because on a device the global
 * fetch is expo/fetch, whose abort rejection is a plain `Error` (name "Error").
 */
export function requestAbortedError(): Error {
  return namedError("AbortError", "Request cancelled");
}

/**
 * `fetch` that aborts after `timeoutMs`, and ALSO when `init.signal` aborts (a
 * caller cancel, or TanStack Query's per-query cancellation signal). Uses the
 * global `AbortController` + `setTimeout`. The timer and the caller listener
 * are always released when the request settles.
 *
 * It names the outcome itself — `TimeoutError` when its own deadline fired,
 * `AbortError` when the caller cancelled — instead of passing fetch's rejection
 * through: expo/fetch (the global fetch on a device) rejects every abort before
 * headers as a plain `Error` and drops the reason, so a timeout and a cancel
 * would otherwise look the same (reliability audit 2026-11-19, M-obs-1).
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
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (callerSignal?.aborted) throw requestAbortedError();
    if (timedOut) {
      throw namedError(
        "TimeoutError",
        `Request timed out after ${timeoutMs} ms`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }
}
