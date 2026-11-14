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

  it("does not remember a yes that was read before the user turned it off", async () => {
    let release: (allowed: boolean) => void = () => undefined;
    lookup.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => (release = resolve)),
    );
    const inFlight = assertAiSharingAllowed();
    forgetAiSharing("u1"); // the user turns it off while the read is open
    release(true);
    await inFlight;

    lookup.mockResolvedValue(false);
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
