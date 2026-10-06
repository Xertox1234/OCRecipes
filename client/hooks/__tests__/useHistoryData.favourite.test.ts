// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import * as Haptics from "expo-haptics";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";
import { QUERY_KEYS } from "@/lib/query-keys";
import { useHistoryData } from "../useHistoryData";

const { mockMutate, mockImpact, mockNotification } = vi.hoisted(() => ({
  mockMutate: vi.fn(),
  mockImpact: vi.fn(),
  mockNotification: vi.fn(),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn() }),
  useRoute: () => ({ params: { showAll: true } }),
}));
// No user: both queries stay disabled and read the seeded cache only.
vi.mock("@/context/AuthContext", () => ({
  useAuthContext: () => ({ user: null }),
}));
vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => ({ isPremium: false }),
}));
vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/hooks/useAccessibility", () => ({
  useAccessibility: () => ({ reducedMotion: false }),
}));
vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: mockImpact,
    notification: mockNotification,
    selection: vi.fn(),
  }),
}));
vi.mock("@/hooks/useFavourites", () => ({
  useToggleFavourite: () => ({
    mutate: mockMutate,
    isPending: false,
    variables: undefined,
  }),
}));
vi.mock("@/hooks/useDiscardItem", () => ({
  useDiscardItem: () => ({ mutate: vi.fn(), isPending: false }),
}));

function renderWithItems(items: { id: number; isFavourited: boolean }[]) {
  const { queryClient, wrapper } = createQueryWrapper();
  queryClient.setQueryData(QUERY_KEYS.scannedItems, {
    pages: [{ items, total: items.length }],
    pageParams: [0],
  });
  return renderHook(() => useHistoryData(), { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// The toggle is optimistic (useToggleFavourite.onMutate), so the heart flips
// at tap: favouriting is a Success moment, unfavouriting a light tap.
describe("useHistoryData — favourite haptics", () => {
  it("favouriting fires one Success haptic and no tap", () => {
    const { result } = renderWithItems([{ id: 7, isFavourited: false }]);

    act(() => result.current.handleFavourite(7));

    expect(mockMutate).toHaveBeenCalledWith(7);
    expect(mockNotification).toHaveBeenCalledExactlyOnceWith(
      Haptics.NotificationFeedbackType.Success,
    );
    expect(mockImpact).not.toHaveBeenCalled();
  });

  it("unfavouriting fires a light tap and no Success", () => {
    const { result } = renderWithItems([{ id: 7, isFavourited: true }]);

    act(() => result.current.handleFavourite(7));

    expect(mockMutate).toHaveBeenCalledWith(7);
    expect(mockImpact).toHaveBeenCalledExactlyOnceWith(
      Haptics.ImpactFeedbackStyle.Light,
    );
    expect(mockNotification).not.toHaveBeenCalled();
  });
});
