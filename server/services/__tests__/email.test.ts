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

describe("email service", () => {
  beforeEach(() => {
    mockSend.mockClear();
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
});
