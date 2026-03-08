import { syncHealthKitData } from "../healthkit-sync";

import { storage } from "../../storage";

vi.mock("../../storage", () => ({
  storage: {
    getWeightLogs: vi.fn(),
    createWeightLog: vi.fn(),
    updateHealthKitLastSync: vi.fn(),
  },
}));

const mockStorage = vi.mocked(storage);

describe("HealthKit Sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns zeros when no data provided", async () => {
    const result = await syncHealthKitData("user-1", {});
    expect(result).toEqual({ weightsSynced: 0 });
  });

  it("returns zeros for empty arrays", async () => {
    const result = await syncHealthKitData("user-1", {
      weights: [],
    });
    expect(result).toEqual({ weightsSynced: 0 });
  });

  it("syncs weight samples that don't exist yet", async () => {
    mockStorage.getWeightLogs.mockResolvedValue([]); // no existing entries
    mockStorage.createWeightLog.mockResolvedValue({ id: 1 } as any);
    mockStorage.updateHealthKitLastSync.mockResolvedValue(undefined as any);

    const result = await syncHealthKitData("user-1", {
      weights: [
        {
          weight: 80.5,
          date: "2026-02-20T08:00:00Z",
          source: "Apple Watch",
        },
      ],
    });

    expect(result.weightsSynced).toBe(1);
    expect(mockStorage.createWeightLog).toHaveBeenCalledWith({
      userId: "user-1",
      weight: "80.5",
      source: "healthkit",
    });
    expect(mockStorage.updateHealthKitLastSync).toHaveBeenCalledWith(
      "user-1",
      "weight",
    );
  });

  it("skips duplicate weight entries", async () => {
    // Simulate existing weight log at that time
    mockStorage.getWeightLogs.mockResolvedValue([
      {
        id: 1,
        userId: "user-1",
        weight: "80.5",
        source: "healthkit",
        note: null,
        loggedAt: new Date("2026-02-20T08:00:00Z"),
      },
    ]);
    mockStorage.updateHealthKitLastSync.mockResolvedValue(undefined as any);

    const result = await syncHealthKitData("user-1", {
      weights: [
        {
          weight: 80.5,
          date: "2026-02-20T08:00:00Z",
          source: "Apple Watch",
        },
      ],
    });

    expect(result.weightsSynced).toBe(0);
    expect(mockStorage.createWeightLog).not.toHaveBeenCalled();
  });

  it("syncs multiple weight samples", async () => {
    mockStorage.getWeightLogs.mockResolvedValue([]);
    mockStorage.createWeightLog.mockResolvedValue({ id: 1 } as any);
    mockStorage.updateHealthKitLastSync.mockResolvedValue(undefined as any);

    const result = await syncHealthKitData("user-1", {
      weights: [
        { weight: 80, date: "2026-02-20T08:00:00Z", source: "Apple Watch" },
        { weight: 79.5, date: "2026-02-21T08:00:00Z", source: "Apple Watch" },
      ],
    });

    expect(result.weightsSynced).toBe(2);
    expect(mockStorage.createWeightLog).toHaveBeenCalledTimes(2);
  });
});
