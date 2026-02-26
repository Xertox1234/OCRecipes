// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { GroceryListPickerModal } from "../GroceryListPickerModal";

const mockLists = [
  {
    id: 1,
    userId: 1,
    title: "Weekly Groceries",
    startDate: "2024-01-01",
    endDate: "2024-01-07",
    createdAt: new Date(),
  },
  {
    id: 2,
    userId: 1,
    title: "Party Prep",
    startDate: "2024-01-01",
    endDate: "2024-01-07",
    createdAt: new Date(),
  },
];

const { mockUseGroceryLists, mockCreateList, mockAddItem } = vi.hoisted(() => ({
  mockUseGroceryLists: vi.fn(),
  mockCreateList: vi.fn(),
  mockAddItem: vi.fn(),
}));

vi.mock("@/hooks/useGroceryList", () => ({
  useGroceryLists: () => mockUseGroceryLists(),
  useCreateGroceryList: () => ({
    mutateAsync: mockCreateList,
    isPending: false,
  }),
  useAddManualGroceryItem: () => ({
    mutateAsync: mockAddItem,
    isPending: false,
  }),
}));

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

describe("GroceryListPickerModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseGroceryLists.mockReturnValue({
      data: mockLists,
      isLoading: false,
    });
  });

  it("renders modal header when visible", () => {
    renderComponent(
      <GroceryListPickerModal
        visible={true}
        onClose={() => {}}
        itemName="Chicken Breast"
      />,
    );
    expect(screen.getByText("Add to Grocery List")).toBeDefined();
  });

  it("renders item name in subtitle", () => {
    renderComponent(
      <GroceryListPickerModal
        visible={true}
        onClose={() => {}}
        itemName="Chicken Breast"
      />,
    );
    expect(screen.getByText("Chicken Breast")).toBeDefined();
  });

  it("renders grocery lists", () => {
    renderComponent(
      <GroceryListPickerModal
        visible={true}
        onClose={() => {}}
        itemName="Eggs"
      />,
    );
    expect(screen.getByText("Weekly Groceries")).toBeDefined();
    expect(screen.getByText("Party Prep")).toBeDefined();
  });

  it("shows empty state when no lists", () => {
    mockUseGroceryLists.mockReturnValue({ data: [], isLoading: false });
    renderComponent(
      <GroceryListPickerModal
        visible={true}
        onClose={() => {}}
        itemName="Eggs"
      />,
    );
    expect(
      screen.getByText("No grocery lists yet. Create one to get started."),
    ).toBeDefined();
  });

  it("does not render when not visible", () => {
    const { container } = renderComponent(
      <GroceryListPickerModal
        visible={false}
        onClose={() => {}}
        itemName="Eggs"
      />,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
