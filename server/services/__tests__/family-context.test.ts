import { describe, it, expect, vi, beforeEach } from "vitest";
import { storage } from "../../storage";
import { getFamilyContext } from "../family-context";
import { createMockUserProfile } from "../../__tests__/factories";
import { TIER_FEATURES } from "@shared/types/premium";

vi.mock("../../storage", () => ({
  storage: {
    getUserProfile: vi.fn(),
    countFamilyProfiles: vi.fn(),
    getFamilyProfiles: vi.fn(),
  },
}));

const premium = TIER_FEATURES.premium;
const free = TIER_FEATURES.free;

describe("getFamilyContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.countFamilyProfiles).mockResolvedValue(2);
  });

  it("is active with the profile count when the flag and the switch are on", async () => {
    vi.mocked(storage.getUserProfile).mockResolvedValue(
      createMockUserProfile({ familyPlanningEnabled: true }),
    );
    expect(await getFamilyContext("1", premium)).toEqual({
      active: true,
      profileCount: 2,
    });
  });

  it("never loads the profiles themselves (health data stays out of its callers)", async () => {
    vi.mocked(storage.getUserProfile).mockResolvedValue(
      createMockUserProfile({ familyPlanningEnabled: true }),
    );
    await getFamilyContext("1", premium);
    expect(storage.getFamilyProfiles).not.toHaveBeenCalled();
  });

  it("is inactive without counting when the flag is off", async () => {
    vi.mocked(storage.getUserProfile).mockResolvedValue(
      createMockUserProfile({ familyPlanningEnabled: true }),
    );
    expect(await getFamilyContext("1", free)).toEqual({
      active: false,
      profileCount: 0,
    });
    expect(storage.countFamilyProfiles).not.toHaveBeenCalled();
  });

  it("is inactive without counting when the switch is off", async () => {
    vi.mocked(storage.getUserProfile).mockResolvedValue(
      createMockUserProfile({ familyPlanningEnabled: false }),
    );
    expect(await getFamilyContext("1", premium)).toEqual({
      active: false,
      profileCount: 0,
    });
    expect(storage.countFamilyProfiles).not.toHaveBeenCalled();
  });

  it("is inactive when the user has no profile row", async () => {
    vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);
    expect((await getFamilyContext("1", premium)).active).toBe(false);
  });
});
