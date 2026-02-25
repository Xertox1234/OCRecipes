import {
  healthKitAvailable,
  requestPermissions,
  readWeightSamples,
  readWorkouts,
  readSteps,
} from "../healthkit";

describe("healthkit", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("reports healthKitAvailable as true on iOS", () => {
    expect(healthKitAvailable).toBe(true);
  });

  it("requestPermissions returns all-false stub", async () => {
    const perms = await requestPermissions();
    expect(perms).toEqual({
      weight: false,
      steps: false,
      workouts: false,
      activeEnergy: false,
    });
  });

  it("readWeightSamples returns empty array", async () => {
    const result = await readWeightSamples(new Date(), new Date());
    expect(result).toEqual([]);
  });

  it("readWorkouts returns empty array", async () => {
    const result = await readWorkouts(new Date(), new Date());
    expect(result).toEqual([]);
  });

  it("readSteps returns empty array", async () => {
    const result = await readSteps(new Date(), new Date());
    expect(result).toEqual([]);
  });
});
