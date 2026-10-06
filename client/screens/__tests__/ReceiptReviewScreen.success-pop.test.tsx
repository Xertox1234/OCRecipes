// @vitest-environment jsdom
import React from "react";
import { AccessibilityInfo } from "react-native";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import * as Haptics from "expo-haptics";
import { renderComponent } from "../../../test/utils/render-component";
import ReceiptReviewScreen from "../ReceiptReviewScreen";

const { mockTriggerPop, mockNotification, confirmOutcome } = vi.hoisted(() => ({
  mockTriggerPop: vi.fn(),
  mockNotification: vi.fn(),
  confirmOutcome: { value: "ok" as "ok" | "fail" },
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    navigate: vi.fn(),
    replace: vi.fn(),
    popToTop: vi.fn(),
    goBack: vi.fn(),
  }),
  useRoute: () => ({ params: { photoUris: ["file://r.jpg"] } }),
}));

vi.mock("@react-navigation/elements", () => ({
  useHeaderHeight: () => 44,
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: vi.fn(),
    selection: vi.fn(),
    notification: mockNotification,
  }),
}));

// The pop fires its own Success haptic, so the trigger spy stands for both.
vi.mock("@/hooks/useSuccessAnimation", () => ({
  useSuccessPop: () => ({ trigger: mockTriggerPop, animatedStyle: {} }),
}));

vi.mock("@/components/SwipeableRow", () => ({
  SwipeableRow: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/hooks/useReceiptScan", () => ({
  useReceiptScan: () => ({
    mutate: (_uris: string[], opts: { onSuccess: (r: unknown) => void }) =>
      opts.onSuccess({
        items: [
          {
            name: "Milk",
            quantity: 1,
            unit: "each",
            category: "dairy",
            isFood: true,
            estimatedShelfLifeDays: 7,
            confidence: 0.9,
          },
        ],
        isPartialExtraction: false,
      }),
    isPending: false,
    isError: false,
    isSuccess: true,
  }),
  useReceiptConfirm: () => ({
    mutate: (
      _items: unknown,
      opts: { onSuccess?: () => void; onError?: () => void },
    ) => {
      if (confirmOutcome.value === "ok") opts.onSuccess?.();
      else opts.onError?.();
    },
    isPending: false,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  confirmOutcome.value = "ok";
});

// Adding the receipt to the pantry swaps in a success view. Its check icon
// pops once that view has mounted (a shared-value write before the first
// commit is lost), and the pop carries the Success haptic — no second buzz.
describe("ReceiptReviewScreen — pantry add success", () => {
  it("pops the check icon once, announces, and fires no extra Success haptic", async () => {
    const announceSpy = vi.spyOn(AccessibilityInfo, "announceForAccessibility");
    renderComponent(<ReceiptReviewScreen />);

    fireEvent.click(await screen.findByLabelText("Add 1 items to pantry"));

    await waitFor(() => {
      expect(mockTriggerPop).toHaveBeenCalledOnce();
    });
    expect(screen.getByText("Items added to pantry!")).toBeTruthy();
    expect(announceSpy).toHaveBeenCalledWith("Items added to pantry");
    expect(mockNotification).not.toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Success,
    );
    announceSpy.mockRestore();
  });

  it("a failed add does not pop", async () => {
    confirmOutcome.value = "fail";
    renderComponent(<ReceiptReviewScreen />);

    fireEvent.click(await screen.findByLabelText("Add 1 items to pantry"));

    expect(mockTriggerPop).not.toHaveBeenCalled();
    expect(screen.queryByText("Items added to pantry!")).toBeNull();
  });
});
