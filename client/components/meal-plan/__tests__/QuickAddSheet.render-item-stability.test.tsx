// @vitest-environment jsdom
/**
 * Perf audit 2026-11-08 M2: QuickAddSheet is a React Compiler bailout, and
 * `handleAdd` listed the whole `useAddMealPlanItem()` result in its deps.
 * TanStack's useMutation returns a new wrapper object every render (only
 * `mutate`/`mutateAsync` are stable), so `handleAdd` — and the
 * BottomSheetFlatList `renderItem` built on it — changed identity on every
 * re-render (keystrokes, dictation, mutation state), re-rendering every row.
 * Same technique as RecipeBrowserScreen.render-item-stability.test.tsx.
 */
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { FLATLIST_DEFAULTS } from "@/constants/performance";
import { QuickAddSheetContent } from "../QuickAddSheet";

const { mockAddItem, stableHaptics, stableToast, recipesResult, captured } =
  vi.hoisted(() => ({
    mockAddItem: vi.fn(),
    // Real useHaptics/useToast return memoized values — keep them stable so
    // the mutation wrapper is the only thing the test can catch.
    stableHaptics: {
      impact: vi.fn(),
      selection: vi.fn(),
      notification: vi.fn(),
    },
    stableToast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
    recipesResult: {
      data: {
        personal: [{ id: 5, title: "Oats", caloriesPerServing: null }],
        frequent: [],
        community: [],
      },
      isLoading: false,
      isError: false,
    },
    captured: { props: undefined as Record<string, unknown> | undefined },
  }));

vi.mock("@gorhom/bottom-sheet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@gorhom/bottom-sheet")>();
  const BottomSheetFlatList = (props: Record<string, unknown>) => {
    captured.props = props;
    return null;
  };
  return { ...actual, BottomSheetFlatList };
});

vi.mock("@/hooks/useHaptics", () => ({ useHaptics: () => stableHaptics }));
vi.mock("@/context/ToastContext", () => ({ useToast: () => stableToast }));
vi.mock("@/hooks/useMealPlanRecipes", () => ({
  useUnifiedRecipes: () => recipesResult,
}));
vi.mock("@/hooks/useSpeechToText", () => {
  const speech = {
    isListening: false,
    transcript: "",
    isFinal: false,
    volume: 0,
    error: null,
    startListening: vi.fn(),
    stopListening: vi.fn(),
  };
  return { useSpeechToText: () => speech };
});
// Fresh wrapper per call, stable mutateAsync inside — faithful to useMutation.
vi.mock("@/hooks/useMealPlan", () => ({
  useAddMealPlanItem: () => ({ mutateAsync: mockAddItem, isPending: false }),
}));

describe("QuickAddSheet — renderItem identity across re-renders (perf audit M2)", () => {
  const props = {
    mealType: "breakfast" as const,
    plannedDate: "2025-06-01",
    onDismiss: vi.fn(),
    onNavigateCreate: vi.fn(),
    onOpenImportSheet: vi.fn(),
    onOpenCommunityRecipe: vi.fn(),
  };

  it("keeps the BottomSheetFlatList renderItem stable across a search keystroke", () => {
    renderComponent(<QuickAddSheetContent {...props} />);
    const first = captured.props;
    expect(typeof first?.renderItem).toBe("function");

    // The sheet is React.memo, so re-render it through its own state.
    const input = screen.getByLabelText("Search recipes");
    fireEvent.change(input, { target: { value: "o" } });
    expect((input as HTMLInputElement).value).toBe("o");
    const second = captured.props;
    // Denominator: the list really re-rendered (fresh props object).
    expect(second).not.toBe(first);
    expect(second?.renderItem).toBe(first?.renderItem);
  });

  // Perf audit L2: batching/window defaults, but no clipping — the sheet
  // moves its content with transforms, and clipped rows are unreachable by
  // screen readers (an omitted prop still clips on Android).
  it("takes the batching and window defaults but never clips rows", () => {
    renderComponent(<QuickAddSheetContent {...props} />);
    expect(captured.props?.maxToRenderPerBatch).toBe(
      FLATLIST_DEFAULTS.maxToRenderPerBatch,
    );
    expect(captured.props?.windowSize).toBe(FLATLIST_DEFAULTS.windowSize);
    expect(captured.props?.removeClippedSubviews).toBe(false);
  });
});
