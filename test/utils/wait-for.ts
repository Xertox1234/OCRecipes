/**
 * Deterministic polling helpers for tests that wait on real async side effects
 * (fire-and-forget DB writes, background queues, etc.).
 *
 * Prefer this over `await new Promise(r => setTimeout(r, N))` wall-clock waits
 * between an action and an assertion — those are flaky on slow CI runners.
 *
 * See docs/patterns/testing.md → "`setTimeout` in Test Fixtures vs. Real Async Waits"
 * for the rationale and audit reference (H1, 2026-05-11).
 */

/**
 * Poll a predicate until it resolves to `true` or the timeout elapses.
 *
 * @param check     async predicate; return `true` when the awaited condition holds
 * @param timeoutMs total wait budget (default 1000ms)
 * @param pollMs    interval between polls (default 20ms)
 * @throws Error    if the condition is not met within `timeoutMs`
 */
export async function waitForCondition(
  check: () => Promise<boolean>,
  timeoutMs = 1000,
  pollMs = 20,
): Promise<void> {
  // performance.now() is monotonic — immune to system clock adjustments/NTP
  // skew that can otherwise corrupt a Date.now()-based deadline mid-poll.
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(
    `waitForCondition: predicate did not become true within ${timeoutMs}ms`,
  );
}
