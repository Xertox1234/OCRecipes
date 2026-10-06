// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import BatchSummaryScreen from "../BatchSummaryScreen";

const { mockSelection, mockUpdateQuantity, items } = vi.hoisted(() => ({
  mockSelection: vi.fn(),
  mockUpdateQuantity: vi.fn(),
  items: {
    value: [] as {
      id: string;
      productName: string;
      quantity: number;
      status: "resolved";
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
    }[],
  },
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    addListener: () => () => {},
    popToTop: vi.fn(),
    dispatch: vi.fn(),
  }),
}));

vi.mock("@/context/BatchScanContext", () => ({
  useBatchScan: () => ({
    getItems: () => items.value,
    pendingCount: 0,
    itemCount: items.value.length,
    removeItem: vi.fn(),
    retryItem: vi.fn(),
    updateItemQuantity: mockUpdateQuantity,
    clearSession: vi.fn(),
    isSaving: false,
    setSaving: vi.fn(),
  }),
}));

vi.mock("@/hooks/useBatchConfirm", () => ({
  useBatchConfirm: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: vi.fn(),
    selection: mockSelection,
    notification: vi.fn(),
  }),
}));

vi.mock("@/components/SwipeableRow", () => ({
  SwipeableRow: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

function oat(quantity: number) {
  return {
    id: "a",
    productName: "Oat milk",
    quantity,
    status: "resolved" as const,
    calories: 120,
    protein: 3,
    carbs: 16,
    fat: 5,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// Steppers and the destination radios are selection controls: each change
// is a selection() tick. A disabled bound or a re-tap of the current
// destination changes nothing, so it doesn't buzz.
describe("BatchSummaryScreen — selection haptics", () => {
  it("increasing the quantity ticks once and updates it", () => {
    items.value = [oat(2)];
    renderComponent(<BatchSummaryScreen />);

    fireEvent.click(screen.getByLabelText("Increase quantity, currently 2"));

    expect(mockSelection).toHaveBeenCalledOnce();
    expect(mockUpdateQuantity).toHaveBeenCalledWith("a", 3);
  });

  it("decreasing at quantity 1 is disabled and does not tick", () => {
    items.value = [oat(1)];
    renderComponent(<BatchSummaryScreen />);

    fireEvent.click(screen.getByLabelText("Decrease quantity, currently 1"));

    expect(mockSelection).not.toHaveBeenCalled();
  });

  it("choosing a different destination ticks once", () => {
    items.value = [oat(1)];
    renderComponent(<BatchSummaryScreen />);

    fireEvent.click(screen.getByLabelText("Add to Pantry"));

    expect(mockSelection).toHaveBeenCalledOnce();
  });

  it("re-tapping the current destination does not tick", () => {
    items.value = [oat(1)];
    renderComponent(<BatchSummaryScreen />);

    fireEvent.click(screen.getByLabelText("Log to Daily Intake"));

    expect(mockSelection).not.toHaveBeenCalled();
  });
});
