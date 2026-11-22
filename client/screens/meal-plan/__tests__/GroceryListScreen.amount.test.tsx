// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import GroceryListScreen from "../GroceryListScreen";

const { mockToggle, mockSelection, mockNotification, listItems } = vi.hoisted(
  () => ({
    mockToggle: vi.fn(),
    mockSelection: vi.fn(),
    mockNotification: vi.fn(),
    listItems: {
      value: [] as {
        id: number;
        name: string;
        isChecked: boolean;
        category: string;
        quantity?: string | null;
        unit?: string | null;
      }[],
    },
  }),
);

vi.mock("@/hooks/useGroceryList", () => ({
  useGroceryListDetail: () => ({
    data: { id: 1, title: "Weekly shop", items: listItems.value },
    isLoading: false,
    isError: false,
    error: null,
    isRefetching: false,
    refetch: vi.fn(),
  }),
  useToggleGroceryItem: () => ({ mutate: mockToggle }),
  useAddManualGroceryItem: () => ({ mutate: vi.fn(), isPending: false }),
  useAddGroceryItemToPantry: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: vi.fn(),
    selection: mockSelection,
    notification: mockNotification,
  }),
}));

vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => ({ features: { pantryTracking: false } }),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn(), setOptions: vi.fn() }),
  useRoute: () => ({ params: { listId: 1 } }),
}));

vi.mock("@react-navigation/elements", () => ({
  useHeaderHeight: () => 44,
}));

vi.mock("@/components/SwipeableRow", () => ({
  SwipeableRow: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  listItems.value = [];
});

// The add box sits in the list footer, which the SectionList test mock does
// not draw; its logic is covered in grocery-add-utils.test.ts.
describe("GroceryListScreen — amounts", () => {
  it("writes a row's amount the shared way, in sight and in its label", () => {
    listItems.value = [
      {
        id: 1,
        name: "Tomatoes",
        isChecked: false,
        category: "produce",
        quantity: "3.00",
        unit: "can",
      },
    ];
    renderComponent(<GroceryListScreen />);
    expect(screen.getByText("3 cans")).toBeTruthy();
    expect(screen.getByLabelText("Tomatoes, 3 cans")).toBeTruthy();
  });
});
