// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { useImportTeachingToast } from "../useImportTeachingToast";
import { releaseTipSlot } from "../useFeatureTip";
import {
  initFeatureTipsCache,
  clearFeatureTipsState,
  markFeatureUsed,
} from "@/lib/feature-tips-storage";

const { mockInfo, mockNavigate, plan } = vi.hoisted(() => ({
  mockInfo: vi.fn(),
  mockNavigate: vi.fn(),
  plan: { urlImport: true },
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
  usePremiumFeature: (key: string) =>
    key === "urlImport" ? plan.urlImport : false,
}));

describe("useImportTeachingToast", () => {
  beforeEach(async () => {
    mockInfo.mockClear();
    mockNavigate.mockClear();
    plan.urlImport = true;
    releaseTipSlot("toast-import");
    await clearFeatureTipsState();
    await initFeatureTipsCache("1");
  });

  it("shows the import toast after a hand-built recipe is saved", () => {
    const { result } = renderHook(() => useImportTeachingToast());
    act(() => result.current());
    expect(mockInfo).toHaveBeenCalledWith(
      "Next time, import it from a link or photo",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Import" }),
      }),
    );
    mockInfo.mock.calls[0][1].action.onPress();
    expect(mockNavigate).toHaveBeenCalledWith("RecipeImport");
  });

  it("does not show the import toast to a free user", () => {
    plan.urlImport = false;
    const { result } = renderHook(() => useImportTeachingToast());
    act(() => result.current());
    expect(mockInfo).not.toHaveBeenCalled();
  });

  it("does not show the import toast once import was used", async () => {
    await markFeatureUsed("import");
    const { result } = renderHook(() => useImportTeachingToast());
    act(() => result.current());
    expect(mockInfo).not.toHaveBeenCalled();
  });

  it("shows the import toast only once", () => {
    const { result } = renderHook(() => useImportTeachingToast());
    act(() => result.current());
    act(() => result.current());
    expect(mockInfo).toHaveBeenCalledTimes(1);
  });
});
