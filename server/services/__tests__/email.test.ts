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
});
