// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import ReceiptReviewScreen from "../ReceiptReviewScreen";

const { mockTriggerPop, mockNotification, confirmSpy } = vi.hoisted(() => ({
  mockTriggerPop: vi.fn(),
  mockNotification: vi.fn(),
  confirmSpy: vi.fn(),
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
    mutate: (items: unknown, opts: { onSuccess?: () => void }) => {
      confirmSpy(items);
      opts.onSuccess?.();
    },
    isPending: false,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

const qty = async () =>
  (await screen.findByLabelText("Quantity for Milk")) as HTMLInputElement;

describe("ReceiptReviewScreen — quantity box", () => {
  it("keeps '1.' while typing, commits 1.5, and may be emptied until blur", async () => {
    renderComponent(<ReceiptReviewScreen />);
    const input = await qty();

    fireEvent.change(input, { target: { value: "1." } });
    expect((await qty()).value).toBe("1.");

    fireEvent.change(await qty(), { target: { value: "1.5" } });
    expect((await qty()).value).toBe("1.5");

    fireEvent.change(await qty(), { target: { value: "" } });
    expect((await qty()).value).toBe("");

    fireEvent.blur(await qty());
    expect((await qty()).value).toBe("1.5");
  });

  it("accepts a comma decimal and sends the number on confirm", async () => {
    renderComponent(<ReceiptReviewScreen />);
    fireEvent.change(await qty(), { target: { value: "2,5" } });
    fireEvent.click(await screen.findByLabelText("Add 1 items to pantry"));
    expect(confirmSpy).toHaveBeenCalledWith([
      expect.objectContaining({ name: "Milk", quantity: 2.5 }),
    ]);
  });

  it("restores the last good quantity on blur after junk input", async () => {
    renderComponent(<ReceiptReviewScreen />);
    fireEvent.change(await qty(), { target: { value: "abc" } });
    fireEvent.blur(await qty());
    expect((await qty()).value).toBe("1");
  });
});
