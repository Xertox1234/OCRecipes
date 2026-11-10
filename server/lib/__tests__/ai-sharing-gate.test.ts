import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  AiSharingRequiredError,
  assertAiSharingAllowed,
  forgetAiSharing,
  installAiSharingLookup,
  resetAiSharingGateForTests,
} from "../ai-sharing-gate";

const { mockContext } = vi.hoisted(() => ({
  mockContext:
    vi.fn<() => { requestId: string; userId: string | null } | undefined>(),
}));

vi.mock("../request-context", () => ({
  getRequestContext: () => mockContext(),
}));

// Privacy audit H3: no AI call for a signed-in user who has not allowed it.
describe("assertAiSharingAllowed", () => {
  const lookup = vi.fn<(userId: string) => Promise<boolean>>();

  beforeEach(() => {
    vi.clearAllMocks();
    resetAiSharingGateForTests();
    installAiSharingLookup(lookup);
    mockContext.mockReturnValue({ requestId: "r1", userId: "u1" });
  });

  it("refuses a user who has not allowed AI sharing", async () => {
    lookup.mockResolvedValue(false);
    await expect(assertAiSharingAllowed()).rejects.toBeInstanceOf(
      AiSharingRequiredError,
    );
    expect(lookup).toHaveBeenCalledWith("u1");
  });

  it("lets a user who allowed it through", async () => {
    lookup.mockResolvedValue(true);
    await expect(assertAiSharingAllowed()).resolves.toBeUndefined();
  });

  it("does not gate work that runs outside a signed-in request", async () => {
    lookup.mockResolvedValue(false);
    mockContext.mockReturnValue(undefined);
    await expect(assertAiSharingAllowed()).resolves.toBeUndefined();
    mockContext.mockReturnValue({ requestId: "r2", userId: null });
    await expect(assertAiSharingAllowed()).resolves.toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("refuses when no lookup is installed (fails closed)", async () => {
    resetAiSharingGateForTests();
    await expect(assertAiSharingAllowed()).rejects.toBeInstanceOf(
      AiSharingRequiredError,
    );
  });

  it("remembers a yes briefly, never a no", async () => {
    lookup.mockResolvedValue(false);
    await expect(assertAiSharingAllowed()).rejects.toThrow();
    lookup.mockResolvedValue(true);
    await assertAiSharingAllowed(); // a fresh yes is seen at once
    await assertAiSharingAllowed();
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("forgets the yes when the permission is turned off", async () => {
    lookup.mockResolvedValue(true);
    await assertAiSharingAllowed();
    forgetAiSharing("u1");
    lookup.mockResolvedValue(false);
    await expect(assertAiSharingAllowed()).rejects.toBeInstanceOf(
      AiSharingRequiredError,
    );
  });
});

describe("wasAiSharingRefused", () => {
  it("still knows after a service replaced the error", async () => {
    const { wasAiSharingRefused } = await import("../ai-sharing-gate");
    resetAiSharingGateForTests();
    installAiSharingLookup(async () => false);
    const ctx = { requestId: "r9", userId: "u9" };
    mockContext.mockReturnValue(ctx);

    expect(wasAiSharingRefused(new Error("Failed to analyze photo"))).toBe(
      false,
    );
    await expect(assertAiSharingAllowed()).rejects.toThrow();
    expect(wasAiSharingRefused(new Error("Failed to analyze photo"))).toBe(
      true,
    );
  });
});
