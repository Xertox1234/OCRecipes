import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockUser } from "../../server/__tests__/factories";

const { storage, sendTwoFactorNotice } = vi.hoisted(() => ({
  storage: { getUser: vi.fn(), disableMfa: vi.fn() },
  sendTwoFactorNotice: vi.fn(),
}));
vi.mock("../../server/storage", () => ({ storage }));
vi.mock("../../server/services/email", () => ({ sendTwoFactorNotice }));

const { resetMfaForUser, parseArgs } = await import("../mfa-reset");

beforeEach(() => {
  vi.resetAllMocks();
  storage.disableMfa.mockResolvedValue(3);
  sendTwoFactorNotice.mockResolvedValue(undefined);
});

describe("resetMfaForUser", () => {
  it("no such user → no_user, nothing written", async () => {
    storage.getUser.mockResolvedValue(undefined);
    expect(await resetMfaForUser("u1", { dryRun: false })).toBe("no_user");
    expect(storage.disableMfa).not.toHaveBeenCalled();
  });

  it("MFA already off → not_enabled, nothing written", async () => {
    storage.getUser.mockResolvedValue(createMockUser({ id: "u1" }));
    expect(await resetMfaForUser("u1", { dryRun: false })).toBe("not_enabled");
    expect(storage.disableMfa).not.toHaveBeenCalled();
  });

  it("a dry run reports what it would do and writes nothing", async () => {
    storage.getUser.mockResolvedValue(
      createMockUser({ id: "u1", mfaEnabledAt: new Date() }),
    );
    expect(await resetMfaForUser("u1", { dryRun: true })).toBe("reset");
    expect(storage.disableMfa).not.toHaveBeenCalled();
    expect(sendTwoFactorNotice).not.toHaveBeenCalled();
  });

  it("a real run turns MFA off, drops a staged email change, then emails the account", async () => {
    storage.getUser.mockResolvedValue(
      createMockUser({ id: "u1", mfaEnabledAt: new Date() }),
    );
    expect(await resetMfaForUser("u1", { dryRun: false })).toBe("reset");
    expect(storage.disableMfa).toHaveBeenCalledWith("u1", {
      clearPendingEmail: true,
    });
    expect(sendTwoFactorNotice).toHaveBeenCalledWith(
      "testuser@example.com",
      "testuser",
      "disabled",
    );
    expect(storage.disableMfa.mock.invocationCallOrder[0]).toBeLessThan(
      sendTwoFactorNotice.mock.invocationCallOrder[0],
    );
  });

  // The stored hash can't show the password's length, so the script can't
  // refuse on it; the sign-in gate (needsPasswordUpgrade) stops a short one.
  // Both runs must tell the operator, so the person is told to expect it.
  it.each([true, false])(
    "dryRun=%s tells the operator a short password must be replaced at sign-in",
    async (dryRun) => {
      storage.getUser.mockResolvedValue(
        createMockUser({ id: "u1", mfaEnabledAt: new Date() }),
      );
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        await resetMfaForUser("u1", { dryRun });
        expect(log.mock.calls.flat().join("\n")).toMatch(
          /shorter than 15 characters.*choose a longer one/,
        );
      } finally {
        log.mockRestore();
      }
    },
  );
});

describe("parseArgs", () => {
  it("is a dry run unless --commit is passed", () => {
    expect(parseArgs(["node", "x", "--user", "u1"])).toEqual({
      userId: "u1",
      dryRun: true,
    });
    expect(parseArgs(["node", "x", "--user", "u1", "--commit"])).toEqual({
      userId: "u1",
      dryRun: false,
    });
  });
  it("--dry-run vetoes --commit", () => {
    expect(
      parseArgs(["node", "x", "--user", "u1", "--commit", "--dry-run"]).dryRun,
    ).toBe(true);
  });
  it("requires --user", () => {
    expect(() => parseArgs(["node", "x"])).toThrow(/--user/);
  });
});
