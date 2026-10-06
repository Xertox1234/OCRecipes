// @vitest-environment jsdom
//
// Feedback for adding an AI meal suggestion to the plan. The suggestion modal
// closes on add, so the confirmation is a toast (it fires its own Success
// haptic — no second buzz). Mock set trimmed from MealPlanHomeScreen.test.tsx;
// the suggestion modal is a stub button that hands the screen a fixture.
import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import * as Haptics from "expo-haptics";
import { renderComponent } from "../../../../test/utils/render-component";
import MealPlanHomeScreen from "../MealPlanHomeScreen";
import { TIER_FEATURES } from "@shared/types/premium";
import type { MealSuggestion } from "@shared/types/meal-suggestions";

const {
  mockApiRequest,
  mockCreateRecipe,
  mockAddItem,
  mockNotification,
  mockToastSuccess,
  mockToastError,
  SUGGESTION,
} = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
  mockCreateRecipe: vi.fn(),
  mockAddItem: vi.fn(),
  mockNotification: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
  SUGGESTION: {
    title: "Overnight oats",
    description: "Oats soaked overnight",
    reasoning: "High fibre",
    calories: 350,
    protein: 12,
    carbs: 55,
    fat: 8,
    prepTimeMinutes: 5,
    difficulty: "Easy",
    ingredients: [{ name: "oats", quantity: "1", unit: "cup" }],
    instructions: ["Soak"],
    dietTags: [],
  } satisfies MealSuggestion,
}));

vi.mock("@/hooks/useMealPlan", () => ({
  useMealPlanItems: () => ({
    data: [],
    isLoading: false,
    isRefetching: false,
    isLoadingError: false,
    isRefetchError: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useAddMealPlanItem: () => ({ mutateAsync: mockAddItem, isPending: false }),
  useRemoveMealPlanItem: () => ({ mutate: vi.fn(), isPending: false }),
  useConfirmMealPlanItem: () => ({ mutate: vi.fn(), isPending: false }),
  useReorderMealPlanItems: () => ({ mutate: vi.fn(), isPending: false }),
  invalidateMealPlanItems: vi.fn(),
}));

vi.mock("@/hooks/useDailyBudget", () => ({
  useDailyBudget: () => ({ data: undefined, isError: false, refetch: vi.fn() }),
}));

vi.mock("@/hooks/useMealPlanRecipes", () => ({
  useCreateMealPlanRecipe: () => ({
    mutateAsync: mockCreateRecipe,
    isPending: false,
  }),
}));

vi.mock("@/hooks/usePantry", () => ({
  useExpiringPantryItems: () => ({ data: [] }),
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: vi.fn(),
    selection: vi.fn(),
    notification: mockNotification,
  }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({
    success: mockToastSuccess,
    error: mockToastError,
    info: vi.fn(),
  }),
}));

vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => ({
    features: TIER_FEATURES.free,
    isPremium: false,
  }),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn() }),
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

vi.mock("@react-navigation/elements", () => ({
  useHeaderHeight: () => 44,
}));

vi.mock("@react-navigation/bottom-tabs", () => ({
  useBottomTabBarHeight: () => 49,
}));

vi.mock("@/components/meal-plan/AddItemMenuSheet", () => ({
  AddItemMenuSheetContent: () => null,
  ADD_ITEM_MENU_SNAP_POINTS: ["add-item-menu"],
}));

vi.mock("@/components/meal-plan/ImportRecipeSheet", () => ({
  ImportRecipeSheetContent: () => null,
  IMPORT_RECIPE_SNAP_POINTS: ["import-recipe"],
}));

vi.mock("@/components/meal-plan/QuickAddSheet", () => ({
  QuickAddSheetContent: () => null,
  QUICK_ADD_SNAP_POINTS: ["quick-add"],
}));

vi.mock("@/components/meal-plan/SimpleEntrySheet", () => ({
  SimpleEntrySheetContent: () => null,
  SIMPLE_ENTRY_SNAP_POINTS: ["simple-entry"],
}));

vi.mock("@/components/MealSuggestionsModal", () => ({
  MealSuggestionsModal: ({
    onSelectSuggestion,
  }: {
    onSelectSuggestion: (s: MealSuggestion) => void;
  }) => (
    <button
      aria-label="Pick suggestion"
      onClick={() => onSelectSuggestion(SUGGESTION)}
    />
  ),
}));

vi.mock("@/components/UpgradeModal", () => ({
  UpgradeModal: () => null,
}));

// The modal's meal type defaults to breakfast and the date to today.
const todayWeekday = new Date().toLocaleDateString("en-US", {
  weekday: "long",
});

beforeEach(() => {
  vi.clearAllMocks();
  mockApiRequest.mockResolvedValue({ json: async () => ({}) });
  mockCreateRecipe.mockResolvedValue({ id: 31 });
});

describe("MealPlanHomeScreen — adding a meal suggestion", () => {
  it("toasts the day and meal once, with no extra Success haptic", async () => {
    mockAddItem.mockResolvedValue({ id: 1 });
    renderComponent(<MealPlanHomeScreen />);

    fireEvent.click(screen.getByLabelText("Pick suggestion"));

    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledExactlyOnceWith(
        `Added to ${todayWeekday} Breakfast`,
      );
    });
    expect(mockNotification).not.toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Success,
    );
  });

  it("a failed add shows the error toast and no success toast", async () => {
    mockAddItem.mockRejectedValue(new Error("500"));
    renderComponent(<MealPlanHomeScreen />);

    fireEvent.click(screen.getByLabelText("Pick suggestion"));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledOnce();
    });
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });
});
