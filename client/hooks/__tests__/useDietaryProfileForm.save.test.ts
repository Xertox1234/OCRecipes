// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import * as Haptics from "expo-haptics";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";
import { QUERY_KEYS } from "@/lib/query-keys";
import { useDietaryProfileForm } from "../useDietaryProfileForm";

const {
  mockGoBack,
  mockApiRequest,
  mockNotification,
  mockToastSuccess,
  mockToastError,
} = vi.hoisted(() => ({
  mockGoBack: vi.fn(),
  mockApiRequest: vi.fn(),
  mockNotification: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
}));
vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: vi.fn(),
    notification: mockNotification,
    selection: vi.fn(),
  }),
}));
vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({
    success: mockToastSuccess,
    error: mockToastError,
    info: vi.fn(),
  }),
}));
vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

function renderForm() {
  const { queryClient, wrapper } = createQueryWrapper();
  queryClient.setQueryData(QUERY_KEYS.dietaryProfile, {});
  return renderHook(() => useDietaryProfileForm(), { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// The screen closes on save, so the confirmation is a toast (it survives the
// navigation and fires its own Success haptic — no second buzz).
describe("useDietaryProfileForm — save feedback", () => {
  it("a successful save toasts once, closes, and fires no extra Success haptic", async () => {
    mockApiRequest.mockResolvedValue({ json: async () => ({}) });
    const { result } = renderForm();

    await act(() => result.current.handleSave());

    expect(mockToastSuccess).toHaveBeenCalledExactlyOnceWith(
      "Dietary profile saved",
    );
    expect(mockGoBack).toHaveBeenCalledOnce();
    expect(mockNotification).not.toHaveBeenCalled();
  });

  it("a failed save keeps the inline error and Error haptic, with no toast", async () => {
    mockApiRequest.mockRejectedValue(new Error("500"));
    const { result } = renderForm();

    await act(() => result.current.handleSave());

    expect(mockToastSuccess).not.toHaveBeenCalled();
    expect(mockToastError).not.toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(result.current.saveError).toBe(
      "Failed to save profile. Please try again.",
    );
    expect(mockNotification).toHaveBeenCalledExactlyOnceWith(
      Haptics.NotificationFeedbackType.Error,
    );
  });
});
