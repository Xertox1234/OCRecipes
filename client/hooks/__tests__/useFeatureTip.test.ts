// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { useFeatureTip, claimTipSlot, releaseTipSlot } from "../useFeatureTip";

const storage = vi.hoisted(() => ({
  ready: true,
  seen: new Set<string>(),
  used: new Set<string>(),
  listeners: new Set<() => void>(),
}));

vi.mock("@/lib/feature-tips-storage", () => ({
  isFeatureTipsReady: () => storage.ready,
  onFeatureTipsReady: (listener: () => void) => {
    storage.listeners.add(listener);
    return () => storage.listeners.delete(listener);
  },
  hasSeenTip: (id: string) => storage.seen.has(id),
  hasUsedFeature: (feature: string) => storage.used.has(feature),
  markTipSeen: vi.fn(async (id: string) => {
    storage.seen.add(id);
  }),
}));

const opts = { feature: "scan" as const, eligible: true };

describe("useFeatureTip", () => {
  beforeEach(() => {
    storage.ready = true;
    storage.seen.clear();
    storage.used.clear();
    storage.listeners.clear();
    releaseTipSlot("home-scan");
    releaseTipSlot("quicklog-camera");
  });

  it("shows an eligible unseen tip and marks it seen", () => {
    const { result } = renderHook(() => useFeatureTip("home-scan", opts));
    expect(result.current.visible).toBe(true);
    expect(storage.seen.has("home-scan")).toBe(true);
  });

  it("never shows a seen tip", () => {
    storage.seen.add("home-scan");
    const { result } = renderHook(() => useFeatureTip("home-scan", opts));
    expect(result.current.visible).toBe(false);
  });

  it("never shows once the feature was used", () => {
    storage.used.add("scan");
    const { result } = renderHook(() => useFeatureTip("home-scan", opts));
    expect(result.current.visible).toBe(false);
  });

  it("stays hidden while not eligible", () => {
    const { result } = renderHook(() =>
      useFeatureTip("home-scan", { ...opts, eligible: false }),
    );
    expect(result.current.visible).toBe(false);
  });

  it("stays hidden until premium status resolves", () => {
    const { result, rerender } = renderHook(
      ({ ready }) => useFeatureTip("home-scan", { ...opts, ready }),
      { initialProps: { ready: false } },
    );
    expect(result.current.visible).toBe(false);
    rerender({ ready: true });
    expect(result.current.visible).toBe(true);
  });

  it("waits for saved tips to load", () => {
    storage.ready = false;
    const { result } = renderHook(() => useFeatureTip("home-scan", opts));
    expect(result.current.visible).toBe(false);
    act(() => {
      storage.ready = true;
      storage.listeners.forEach((listener) => listener());
    });
    expect(result.current.visible).toBe(true);
  });

  it("refuses a second tip while one is on screen", () => {
    renderHook(() => useFeatureTip("home-scan", opts));
    const second = renderHook(() => useFeatureTip("quicklog-camera", opts));
    expect(second.result.current.visible).toBe(false);
    expect(claimTipSlot("quicklog-camera")).toBe(false);
  });

  it("frees the slot on dismiss", () => {
    const { result } = renderHook(() => useFeatureTip("home-scan", opts));
    act(() => result.current.dismiss());
    expect(result.current.visible).toBe(false);
    expect(claimTipSlot("quicklog-camera")).toBe(true);
  });

  it("frees the slot on unmount", () => {
    const { unmount } = renderHook(() => useFeatureTip("home-scan", opts));
    unmount();
    expect(claimTipSlot("quicklog-camera")).toBe(true);
  });
});
