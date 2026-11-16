import { describe, it, expect, vi, beforeEach } from "vitest";
import { storage } from "../../storage";
import { getFamilyContext } from "../family-context";
import { createMockUserProfile } from "../../__tests__/factories";
import { TIER_FEATURES } from "@shared/types/premium";

vi.mock("../../storage", () => ({
  storage: {
    getUserProfile: vi.fn(),
    getFamilyProfiles: vi.fn(),
  },
}));

const premium = TIER_FEATURES.premium;
const free = TIER_FEATURES.free;
const kid = {
  id: 1,
  userId: "1",
  name: "Kid",
  allergies: [],
  note: null,
  sortOrder: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("getFamilyContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.getFamilyProfiles).mockResolvedValue([kid]);
  });

  it("is active with profiles when the flag and the switch are on", async () => {
    vi.mocked(storage.getUserProfile).mockResolvedValue(
      createMockUserProfile({ familyPlanningEnabled: true }),
    );
    expect(await getFamilyContext("1", premium)).toEqual({
      active: true,
      profiles: [kid],
    });
  });

  it("is inactive without loading profiles when the flag is off", async () => {
    vi.mocked(storage.getUserProfile).mockResolvedValue(
      createMockUserProfile({ familyPlanningEnabled: true }),
    );
    expect(await getFamilyContext("1", free)).toEqual({
      active: false,
      profiles: [],
    });
    expect(storage.getFamilyProfiles).not.toHaveBeenCalled();
  });

  it("is inactive without loading profiles when the switch is off", async () => {
    vi.mocked(storage.getUserProfile).mockResolvedValue(
      createMockUserProfile({ familyPlanningEnabled: false }),
    );
    expect(await getFamilyContext("1", premium)).toEqual({
      active: false,
      profiles: [],
    });
    expect(storage.getFamilyProfiles).not.toHaveBeenCalled();
  });

  it("is inactive when the user has no profile row", async () => {
    vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);
    expect((await getFamilyContext("1", premium)).active).toBe(false);
  });
});
