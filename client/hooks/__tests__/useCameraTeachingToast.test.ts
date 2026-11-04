// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { useCameraTeachingToast } from "../useCameraTeachingToast";
import { releaseTipSlot, claimTipSlot } from "../useFeatureTip";
import {
  initFeatureTipsCache,
  clearFeatureTipsState,
  markFeatureUsed,
} from "@/lib/feature-tips-storage";

const { mockInfo, mockNavigate, scans } = vi.hoisted(() => ({
  mockInfo: vi.fn(),
  mockNavigate: vi.fn(),
  scans: { canScan: true },
}));

vi.mock("@react-native-async-storage/async-storage", () => {
  const store = new Map<string, string>();
  return {
    default: {
      getItem: async (k: string) => store.get(k) ?? null,
      setItem: async (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: async (k: string) => {
        store.delete(k);
      },
    },
  };
});
vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ info: mockInfo, success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));
vi.mock("@/hooks/usePremiumFeatures", () => ({
  useCanScanToday: () => ({ canScan: scans.canScan, remainingScans: null }),
}));

const typed = [{ sourceType: "text" }];
const spoken = [{ sourceType: "voice" }];

async function logTimes(
  note: (items: { sourceType?: string }[]) => Promise<void>,
  items: { sourceType?: string }[],
  times: number,
) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await note(items);
    });
  }
}

describe("useCameraTeachingToast", () => {
  beforeEach(async () => {
    mockInfo.mockClear();
    mockNavigate.mockClear();
    scans.canScan = true;
    releaseTipSlot("toast-camera");
    releaseTipSlot("home-scan");
    await clearFeatureTipsState();
    await initFeatureTipsCache("1");
  });

  it("shows the camera toast on the third typed log", async () => {
    const { result } = renderHook(() => useCameraTeachingToast());
    await logTimes(result.current, typed, 2);
    expect(mockInfo).not.toHaveBeenCalled();
    await logTimes(result.current, typed, 1);
    expect(mockInfo).toHaveBeenCalledWith(
      "Logging is faster with the camera",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Try it" }),
      }),
    );
    mockInfo.mock.calls[0][1].action.onPress();
    expect(mockNavigate).toHaveBeenCalledWith("Scan");
  });

  it("does not count spoken logs", async () => {
    const { result } = renderHook(() => useCameraTeachingToast());
    await logTimes(result.current, spoken, 3);
    expect(mockInfo).not.toHaveBeenCalled();
  });

  it("skips the camera toast when no scans are left", async () => {
    scans.canScan = false;
    const { result } = renderHook(() => useCameraTeachingToast());
    await logTimes(result.current, typed, 3);
    expect(mockInfo).not.toHaveBeenCalled();
  });

  it("never shows the camera toast twice", async () => {
    const { result } = renderHook(() => useCameraTeachingToast());
    await logTimes(result.current, typed, 5);
    expect(mockInfo).toHaveBeenCalledTimes(1);
  });

  it("does not show once the camera was used", async () => {
    await markFeatureUsed("scan");
    const { result } = renderHook(() => useCameraTeachingToast());
    await logTimes(result.current, typed, 3);
    expect(mockInfo).not.toHaveBeenCalled();
  });

  it("waits while another tip is on screen", async () => {
    claimTipSlot("home-scan");
    const { result } = renderHook(() => useCameraTeachingToast());
    await logTimes(result.current, typed, 3);
    expect(mockInfo).not.toHaveBeenCalled();
    releaseTipSlot("home-scan");
    await logTimes(result.current, typed, 1);
    expect(mockInfo).toHaveBeenCalledTimes(1);
  });
});
