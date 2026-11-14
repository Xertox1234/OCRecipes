// @vitest-environment jsdom
/**
 * Perf audit 2026-11-08 L1: the grocery SectionList (a week plan can reach
 * 100+ swipeable rows) passed no virtualization props. It now takes the
 * batching/window props from FLATLIST_DEFAULTS but explicitly turns clipping
 * OFF: rows slide with transforms (SwipeableRow), which RN documents as the
 * removeClippedSubviews bug case, and clipped cells are unreachable by screen
 * readers — an omitted prop still clips on Android (docs/rules/performance.md).
 * The shared SectionList mock drops these props, so capture them here (same
 * technique as RecipeBrowserScreen.params.test.tsx).
 */
import React from "react";
import { renderComponent } from "../../../../test/utils/render-component";
import { FLATLIST_DEFAULTS } from "@/constants/performance";
import GroceryListScreen from "../GroceryListScreen";

const { captured } = vi.hoisted(() => ({
  captured: { props: undefined as Record<string, unknown> | undefined },
}));

vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native")>();
  const SectionList = React.forwardRef<unknown, Record<string, unknown>>(
    (props, _ref) => {
      captured.props = props;
      return null;
    },
  );
  SectionList.displayName = "SectionList";
  // RefreshControl is not an own enumerable export of the shared mock, so
  // the spread drops it; the screen only needs it to render.
  return { ...actual, SectionList, RefreshControl: () => null };
});

vi.mock("@/hooks/useGroceryList", () => ({
  useGroceryListDetail: () => ({
    data: {
      id: 1,
      title: "Weekly shop",
      items: [{ id: 1, name: "Milk", isChecked: false, category: "dairy" }],
    },
    isLoading: false,
    isError: false,
    error: null,
    isRefetching: false,
    refetch: vi.fn(),
  }),
  useToggleGroceryItem: () => ({ mutate: vi.fn() }),
  useAddManualGroceryItem: () => ({ mutate: vi.fn() }),
  useAddGroceryItemToPantry: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: vi.fn(),
    selection: vi.fn(),
    notification: vi.fn(),
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

describe("GroceryListScreen — SectionList virtualization props (perf audit L1)", () => {
  it("takes the batching and window defaults but never clips rows", () => {
    renderComponent(<GroceryListScreen />);
    expect(captured.props).toBeDefined();
    expect(captured.props?.maxToRenderPerBatch).toBe(
      FLATLIST_DEFAULTS.maxToRenderPerBatch,
    );
    expect(captured.props?.windowSize).toBe(FLATLIST_DEFAULTS.windowSize);
    expect(captured.props?.removeClippedSubviews).toBe(false);
  });
});
