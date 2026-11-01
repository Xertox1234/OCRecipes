// @vitest-environment jsdom
import React from "react";
import { AccessibilityInfo } from "react-native";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import * as Haptics from "expo-haptics";
import { renderComponent } from "../../../test/utils/render-component";
import ReceiptReviewScreen from "../ReceiptReviewScreen";

const { mockTriggerPop, mockNotification, mockToastInfo, confirmOutcome } =
  vi.hoisted(() => ({
    mockTriggerPop: vi.fn(),
    mockNotification: vi.fn(),
    mockToastInfo: vi.fn(),
    confirmOutcome: { value: "ok" as "ok" | "fail", skipped: 0 },
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

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn(), info: mockToastInfo }),
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
      opts: {
        onSuccess?: (r: { added: number; skipped: number }) => void;
        onError?: () => void;
      },
    ) => {
      if (confirmOutcome.value === "ok")
        opts.onSuccess?.({ added: 1, skipped: confirmOutcome.skipped });
      else opts.onError?.();
    },
    isPending: false,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  confirmOutcome.value = "ok";
  confirmOutcome.skipped = 0;
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

  it("tells the user how many items were left out when the pantry is full", async () => {
    confirmOutcome.skipped = 3;
    renderComponent(<ReceiptReviewScreen />);

    fireEvent.click(await screen.findByLabelText("Add 1 items to pantry"));

    await waitFor(() => {
      expect(mockToastInfo).toHaveBeenCalledWith(
        "Pantry full: 3 items weren't added",
      );
    });
  });

  it("shows no pantry-full toast when everything was added", async () => {
    renderComponent(<ReceiptReviewScreen />);

    fireEvent.click(await screen.findByLabelText("Add 1 items to pantry"));

    await waitFor(() => {
      expect(mockTriggerPop).toHaveBeenCalledOnce();
    });
    expect(mockToastInfo).not.toHaveBeenCalled();
  });

  it("a failed add does not pop", async () => {
    confirmOutcome.value = "fail";
    renderComponent(<ReceiptReviewScreen />);

    fireEvent.click(await screen.findByLabelText("Add 1 items to pantry"));

    expect(mockTriggerPop).not.toHaveBeenCalled();
    expect(screen.queryByText("Items added to pantry!")).toBeNull();
  });
});
