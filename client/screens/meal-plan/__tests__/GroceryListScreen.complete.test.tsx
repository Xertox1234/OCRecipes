// @vitest-environment jsdom
import React from "react";
import { AccessibilityInfo } from "react-native";
import { screen, fireEvent, act } from "@testing-library/react";
import * as Haptics from "expo-haptics";
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
  useAddManualGroceryItem: () => ({ mutate: vi.fn() }),
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

const ALL_DONE = "All done! Everything on your list is checked off.";

beforeEach(() => {
  vi.clearAllMocks();
});

// The toggle is optimistic (useToggleGroceryItem.onMutate), so the checkbox
// and the "All done!" footer appear at tap — the Success moment belongs there.
describe("GroceryListScreen — checking off the last item", () => {
  it("checking the last unchecked item fires one Success and announces it", () => {
    const announceSpy = vi.spyOn(AccessibilityInfo, "announceForAccessibility");
    listItems.value = [
      { id: 1, name: "Milk", isChecked: true, category: "dairy" },
      { id: 2, name: "Eggs", isChecked: false, category: "dairy" },
    ];
    renderComponent(<GroceryListScreen />);

    fireEvent.click(screen.getByLabelText("Eggs"));

    expect(mockToggle).toHaveBeenCalledOnce();
    expect(mockNotification).toHaveBeenCalledExactlyOnceWith(
      Haptics.NotificationFeedbackType.Success,
    );
    expect(mockSelection).not.toHaveBeenCalled();
    expect(announceSpy).toHaveBeenCalledWith(ALL_DONE);
    announceSpy.mockRestore();
  });

  it("checking an item that is not the last is a selection tick", () => {
    const announceSpy = vi.spyOn(AccessibilityInfo, "announceForAccessibility");
    listItems.value = [
      { id: 1, name: "Milk", isChecked: false, category: "dairy" },
      { id: 2, name: "Eggs", isChecked: false, category: "dairy" },
    ];
    renderComponent(<GroceryListScreen />);

    fireEvent.click(screen.getByLabelText("Eggs"));

    expect(mockSelection).toHaveBeenCalledOnce();
    expect(mockNotification).not.toHaveBeenCalled();
    expect(announceSpy).not.toHaveBeenCalledWith(ALL_DONE);
    announceSpy.mockRestore();
  });

  it("unchecking an item on a finished list is a selection tick", () => {
    listItems.value = [
      { id: 1, name: "Milk", isChecked: true, category: "dairy" },
      { id: 2, name: "Eggs", isChecked: true, category: "dairy" },
    ];
    renderComponent(<GroceryListScreen />);

    fireEvent.click(screen.getByLabelText("Eggs"));

    expect(mockSelection).toHaveBeenCalledOnce();
    expect(mockNotification).not.toHaveBeenCalled();
  });
});

function reactProps(node: Element): Record<string, unknown> {
  const key = Object.keys(node).find((k) => k.startsWith("__reactProps$"));
  if (!key) throw new Error("React's internal props key was not on the node");
  return (node as unknown as Record<string, Record<string, unknown>>)[key];
}

function flattenStyle(style: unknown): Record<string, unknown> {
  const parts = (Array.isArray(style) ? style.flat(Infinity) : [style]).filter(
    Boolean,
  );
  return Object.assign({}, ...parts);
}

// QA #21: a percentage width on the absolute line resolved against the whole
// row (~296pt on device), not the shrink-wrapped name (~45pt for "Garlic"), so
// the line ran to the screen edge. The line's width must come from the name's
// measured width, in points.
describe("GroceryListScreen — strike-through", () => {
  it("spans the measured name width once the item is checked", async () => {
    listItems.value = [
      { id: 1, name: "Garlic", isChecked: true, category: "produce" },
    ];
    renderComponent(<GroceryListScreen />);

    const name = screen.getByTestId("grocery-item-name-1");
    const onLayout = reactProps(name).onLayout as (e: unknown) => void;
    await act(async () => {
      onLayout({ nativeEvent: { layout: { width: 44.5, height: 22 } } });
    });

    const line = screen.getByTestId("grocery-item-strike-1");
    expect(flattenStyle(reactProps(line).style).width).toBe(44.5);
  });
});
