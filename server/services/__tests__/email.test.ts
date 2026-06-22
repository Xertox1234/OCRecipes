import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockSend = vi
  .fn()
  .mockResolvedValue({ data: { id: "mock" }, error: null });
// email.ts does `new Resend(key)`, so the mock must be constructable. A
// `vi.fn().mockImplementation(arrow)` is NOT newable under Vitest 4 (arrow
// functions can't be constructors), so we mock with a real class instead. The
// `mock`-prefixed `mockSend` is exempt from vi.mock's hoisting guard.
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mockSend };
  },
}));

// Spy on the service logger so we can assert the failure path logs the real
// Resend error fields (the `mock`-prefix exempts it from vi.mock's hoist guard).
const mockLoggerError = vi.fn();
vi.mock("../../lib/logger", () => ({
  createServiceLogger: () => ({
    error: mockLoggerError,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe("email service", () => {
  beforeEach(() => {
    // Reset implementation (not just call history) so a test's `mockResolvedValue`
    // default cannot leak into the next test; re-seed the success baseline.
    mockSend.mockReset();
    mockSend.mockResolvedValue({ data: { id: "mock" }, error: null });
    mockLoggerError.mockClear();
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is a no-op when RESEND_API_KEY is absent", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const { sendVerificationEmail } = await import("../email");
    await sendVerificationEmail("a@b.com", "tok");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("sends a verification email when configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const { sendVerificationEmail } = await import("../email");
    await sendVerificationEmail("a@b.com", "tok123");
    expect(mockSend).toHaveBeenCalledTimes(1);
    const arg = mockSend.mock.calls[0][0];
    expect(arg.to).toBe("a@b.com");
    expect(arg.html).toContain("verify-email?token=tok123");
  });

  it("throttles to at most 5 sends per recipient", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const { sendVerificationEmail } = await import("../email");
    for (let i = 0; i < 7; i++) await sendVerificationEmail("c@d.com", "t");
    expect(mockSend).toHaveBeenCalledTimes(5);
  });

  it("evicts fully-expired keys so the recipient map stays bounded", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.useFakeTimers();
    try {
      const { sendVerificationEmail, _testInternals } = await import(
        "../email"
      );
      const { recipientSends, RECIPIENT_WINDOW_MS, RECIPIENT_SWEEP_THRESHOLD } =
        _testInternals;

      // Register more distinct recipients than the sweep threshold, each touched
      // exactly once — the enumeration case the bound must survive.
      const count = RECIPIENT_SWEEP_THRESHOLD + 5;
      for (let i = 0; i < count; i++) {
        await sendVerificationEmail(`enum-${i}@example.com`, "t");
      }
      expect(recipientSends.size).toBe(count);

      // Advance past the window so every prior entry is fully expired, then make
      // one more send to trigger the size-gated sweep.
      vi.advanceTimersByTime(RECIPIENT_WINDOW_MS + 1);
      await sendVerificationEmail("fresh@example.com", "t");

      // All expired keys are evicted; only the single fresh recipient remains.
      expect(recipientSends.size).toBe(1);
      expect(recipientSends.has("fresh@example.com")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves the 5/hour cap for an active recipient after a sweep runs", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.useFakeTimers();
    try {
      const { sendVerificationEmail, _testInternals } = await import(
        "../email"
      );
      const { RECIPIENT_SWEEP_THRESHOLD } = _testInternals;

      // An active recipient that has hit the cap.
      for (let i = 0; i < 5; i++) {
        await sendVerificationEmail("active@example.com", "t");
      }
      // Push the map past the sweep threshold with unrelated recipients so the
      // next call sweeps — the active key is NOT expired and must survive.
      for (let i = 0; i < RECIPIENT_SWEEP_THRESHOLD + 1; i++) {
        await sendVerificationEmail(`other-${i}@example.com`, "t");
      }
      mockSend.mockClear();

      // The active recipient is still capped (no 6th send) even though a sweep
      // ran in between — the cap behavior is unchanged for active recipients.
      await sendVerificationEmail("active@example.com", "t");
      expect(mockSend).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  describe("timeout + 429-aware retry/backoff", () => {
    it("times out a hung send, retries, and succeeds on a later attempt", async () => {
      vi.stubEnv("RESEND_API_KEY", "re_test");
      vi.useFakeTimers();
      try {
        // First attempt: a send that never resolves — must be cut off by the
        // per-attempt timeout. Second attempt: resolves cleanly.
        mockSend
          .mockReturnValueOnce(new Promise(() => {})) // hangs forever
          .mockResolvedValueOnce({ data: { id: "ok" }, error: null });

        const { sendVerificationEmail } = await import("../email");
        const done = sendVerificationEmail("hung@example.com", "t");

        // Advance past the 8s per-attempt timeout + the transient backoff so the
        // hung first attempt is abandoned and the retry runs.
        await vi.advanceTimersByTimeAsync(8_000); // timeout fires
        await vi.advanceTimersByTimeAsync(500); // transient backoff
        await done;

        expect(mockSend).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it("backs off distinctly for a 429 vs a network failure before retrying", async () => {
      vi.stubEnv("RESEND_API_KEY", "re_test");
      vi.useFakeTimers();
      try {
        const { sendVerificationEmail } = await import("../email");

        // --- 429 (rate_limit_exceeded): first attempt rate-limited, then ok ---
        mockSend
          .mockResolvedValueOnce({
            data: null,
            error: {
              message: "Too many requests",
              name: "rate_limit_exceeded",
              statusCode: 429,
            },
          })
          .mockResolvedValueOnce({ data: { id: "ok" }, error: null });

        const rateLimited = sendVerificationEmail("rl@example.com", "t");
        // The 429 backoff base is 1000ms. Advancing only 999ms must NOT yet have
        // triggered the retry — distinctly longer than the network path below.
        await vi.advanceTimersByTimeAsync(999);
        expect(mockSend).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1); // cross the 1000ms boundary
        await rateLimited;
        expect(mockSend).toHaveBeenCalledTimes(2);

        mockSend.mockClear();

        // --- Network failure (rejected promise): first attempt throws, then ok ---
        mockSend
          .mockRejectedValueOnce(new Error("ECONNRESET"))
          .mockResolvedValueOnce({ data: { id: "ok" }, error: null });

        const network = sendVerificationEmail("net@example.com", "t");
        // The transient backoff base is 500ms — the retry fires by 500ms, well
        // before the 429 path's 1000ms, proving the two back off distinctly.
        await vi.advanceTimersByTimeAsync(500);
        await network;
        expect(mockSend).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it("gives up after bounded retries and does not throw", async () => {
      vi.stubEnv("RESEND_API_KEY", "re_test");
      vi.useFakeTimers();
      try {
        // Every attempt rate-limited — 3 sends total (initial + 2 retries).
        mockSend.mockResolvedValue({
          data: null,
          error: {
            message: "Too many requests",
            name: "rate_limit_exceeded",
            statusCode: 429,
          },
        });

        const { sendVerificationEmail } = await import("../email");
        const done = sendVerificationEmail("exhaust@example.com", "t");
        // Run all backoffs (1000ms, then 2000ms) to completion.
        await vi.advanceTimersByTimeAsync(5_000);
        await expect(done).resolves.toBeUndefined();

        expect(mockSend).toHaveBeenCalledTimes(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not retry a terminal validation error", async () => {
      vi.stubEnv("RESEND_API_KEY", "re_test");
      mockSend.mockResolvedValueOnce({
        data: null,
        error: {
          message: "Invalid `from` address",
          name: "validation_error",
          statusCode: 422,
        },
      });

      const { sendVerificationEmail } = await import("../email");
      await sendVerificationEmail("bad@example.com", "t");

      // A terminal error is not retried — exactly one send attempt.
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe("error logging", () => {
    it("logs the structured Resend error fields (not [object Object]) on send failure", async () => {
      vi.stubEnv("RESEND_API_KEY", "re_test");
      mockSend.mockResolvedValue({
        data: null,
        error: {
          message: "The ocrecipes.com domain is not verified.",
          name: "validation_error",
          statusCode: 403,
        },
      });

      const { sendVerificationEmail } = await import("../email");
      await sendVerificationEmail("a@b.com", "tok");

      expect(mockLoggerError).toHaveBeenCalledTimes(1);
      const [logObj, msg] = mockLoggerError.mock.calls[0];
      expect(msg).toBe("verification email failed");
      // The real Resend reason must survive into the log — the old
      // `toError(error)` flattened this object to the string "[object Object]".
      expect(logObj.resendError).toMatchObject({
        name: "validation_error",
        message: "The ocrecipes.com domain is not verified.",
        statusCode: 403,
      });
    });
  });
});
