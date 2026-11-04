import {
  initFeatureTipsCache,
  hasSeenTip,
  markTipSeen,
  hasUsedFeature,
  markFeatureUsed,
  incrementTypedLogCount,
  clearFeatureTipsState,
  isFeatureTipsReady,
  onFeatureTipsReady,
} from "../feature-tips-storage";

const store = vi.hoisted(() => new Map<string, string>());
const mockAsyncStorage = vi.hoisted(() => ({
  getItem: vi.fn(async (key: string) => store.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => {
    store.set(key, value);
  }),
  removeItem: vi.fn(async (key: string) => {
    store.delete(key);
  }),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: mockAsyncStorage,
}));

describe("feature-tips-storage", () => {
  beforeEach(async () => {
    store.clear();
    await initFeatureTipsCache("1");
  });

  it("marks a tip seen and remembers it after re-init", async () => {
    expect(hasSeenTip("home-scan")).toBe(false);
    await markTipSeen("home-scan");
    expect(hasSeenTip("home-scan")).toBe(true);

    await initFeatureTipsCache("1");
    expect(hasSeenTip("home-scan")).toBe(true);
  });

  it("marks a feature used", async () => {
    expect(hasUsedFeature("import")).toBe(false);
    await markFeatureUsed("import");
    expect(hasUsedFeature("import")).toBe(true);
  });

  it("increments the typed-log count from zero", async () => {
    expect(await incrementTypedLogCount()).toBe(1);
    expect(await incrementTypedLogCount()).toBe(2);
  });

  it("ignores another user's saved state", async () => {
    await markTipSeen("home-scan");
    await markFeatureUsed("scan");
    await incrementTypedLogCount();

    await initFeatureTipsCache("2");
    expect(hasSeenTip("home-scan")).toBe(false);
    expect(hasUsedFeature("scan")).toBe(false);
    expect(await incrementTypedLogCount()).toBe(1);
  });

  it("clears everything on sign-out", async () => {
    await markTipSeen("pantry-receipt");
    expect(await clearFeatureTipsState()).toBe(true);
    expect(hasSeenTip("pantry-receipt")).toBe(false);

    await initFeatureTipsCache("1");
    expect(hasSeenTip("pantry-receipt")).toBe(false);
  });

  it("starts empty when saved data is unreadable", async () => {
    store.set("@ocrecipes_feature_tips", "{not json");
    await initFeatureTipsCache("1");
    expect(hasSeenTip("home-scan")).toBe(false);
  });

  it("is ready only once saved data has loaded", async () => {
    await clearFeatureTipsState();
    expect(isFeatureTipsReady()).toBe(false);
    const listener = vi.fn();
    const unsubscribe = onFeatureTipsReady(listener);
    await initFeatureTipsCache("1");
    expect(isFeatureTipsReady()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("does not overwrite saved data while it is still loading", async () => {
    await clearFeatureTipsState();
    store.set(
      "@ocrecipes_feature_tips",
      JSON.stringify({
        owner: "1",
        seen: ["home-scan"],
        used: ["scan"],
        typedLogs: 2,
      }),
    );

    const loading = initFeatureTipsCache("1");
    await markTipSeen("pantry-receipt");
    await loading;

    expect(hasSeenTip("home-scan")).toBe(true);
    expect(hasUsedFeature("scan")).toBe(true);
    expect(JSON.parse(store.get("@ocrecipes_feature_tips")!).seen).toContain(
      "home-scan",
    );
  });
});
