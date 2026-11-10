// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";
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

function renderForm(profile: Record<string, unknown> = {}) {
  const { queryClient, wrapper } = createQueryWrapper();
  queryClient.setQueryData(QUERY_KEYS.dietaryProfile, profile);
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

  // R48: the plain try/catch bypasses MutationCache.onError — report it.
  it("a failed save is reported off-device", async () => {
    const { logger } = await import("@/lib/logger");
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    try {
      const boom = new Error("500");
      mockApiRequest.mockRejectedValue(boom);
      const { result } = renderForm();

      await act(() => result.current.handleSave());

      expect(errorSpy).toHaveBeenCalledWith(
        "Dietary profile save failed",
        boom,
      );
    } finally {
      errorSpy.mockRestore();
    }
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

// Privacy audit H2 — "no consent, no health data".
describe("useDietaryProfileForm — health-data consent", () => {
  const allergy = [{ name: "peanuts", severity: "severe" }];

  it("needs the consent when an unconsented profile holds a health detail", async () => {
    const { result } = renderForm({
      allergies: allergy,
      healthDataConsentAt: null,
    });

    await waitFor(() => expect(result.current.allergies).toEqual(allergy));
    expect(result.current.needsConsent).toBe(true);
  });

  it("needs no consent for preferences alone, or once consent is on record", async () => {
    const preferences = renderForm({
      dietType: "vegan",
      healthDataConsentAt: null,
    });
    await waitFor(() =>
      expect(preferences.result.current.dietType).toBe("vegan"),
    );
    expect(preferences.result.current.needsConsent).toBe(false);

    const consented = renderForm({
      allergies: allergy,
      healthDataConsentAt: "2026-11-10T00:00:00Z",
    });
    await waitFor(() =>
      expect(consented.result.current.allergies).toEqual(allergy),
    );
    expect(consented.result.current.needsConsent).toBe(false);
  });

  it("sends the consent with the save only when asked to", async () => {
    mockApiRequest.mockResolvedValue({});
    const { result } = renderForm({ allergies: allergy });
    await waitFor(() => expect(result.current.allergies).toEqual(allergy));

    await act(async () => {
      await result.current.handleSave(true);
    });
    // The query may also refetch (a GET); pick the save.
    const putBody = () =>
      mockApiRequest.mock.calls.find(([method]) => method === "PUT")?.[2];
    expect(putBody()).toEqual(
      expect.objectContaining({ healthDataConsent: true }),
    );

    mockApiRequest.mockClear();
    await act(async () => {
      await result.current.handleSave();
    });
    expect(putBody()).toEqual(expect.objectContaining({ allergies: allergy }));
    expect(putBody()).not.toHaveProperty("healthDataConsent");
  });
});
