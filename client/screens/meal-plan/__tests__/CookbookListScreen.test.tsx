// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { FadeInDown } from "react-native-reanimated";
import { renderComponent } from "../../../../test/utils/render-component";
import CookbookListScreen from "../CookbookListScreen";
import type { CookbookWithCount } from "@shared/schema";
import { listStaggerMaxIndex, listStaggerStep } from "@/constants/animations";

const { mockUseCookbooks, mockSetOptions } = vi.hoisted(() => ({
  mockUseCookbooks: vi.fn(),
  mockSetOptions: vi.fn(),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn(), setOptions: mockSetOptions }),
  useFocusEffect: vi.fn(),
}));

vi.mock("@/hooks/useSafeTabBarHeight", () => ({
  useSafeTabBarHeight: () => 0,
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/hooks/useCookbooks", () => ({
  useCookbooks: () => mockUseCookbooks(),
  useDeleteCookbook: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/hooks/useFavouriteRecipes", () => ({
  useFavouriteRecipeIds: () => ({ data: { ids: [] } }),
}));

function cookbook(i: number): CookbookWithCount {
  return {
    id: i,
    userId: "user-1",
    name: `Cookbook ${i}`,
    description: null,
    coverImageUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    recipeCount: 0,
  };
}

// Rows slide in one after another when the screen opens, capped so a long
// list never leaves a row waiting.
describe("CookbookListScreen row entrance", () => {
  it("staggers each cookbook row, capped", () => {
    const delaySpy = vi.spyOn(FadeInDown, "delay");
    const count = listStaggerMaxIndex + 2;
    mockUseCookbooks.mockReturnValue({
      data: Array.from({ length: count }, (_, i) => cookbook(i + 1)),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderComponent(<CookbookListScreen />);

    const delays = delaySpy.mock.calls.map(([d]) => d);
    expect(delays).toEqual(
      Array.from(
        { length: count },
        (_, i) => Math.min(i, listStaggerMaxIndex) * listStaggerStep,
      ),
    );
    delaySpy.mockRestore();
  });
});

// The header "+" is a 24pt icon; hitSlop must lift the tap target to 44pt.
describe("CookbookListScreen header + hit area", () => {
  it("has a tap target of at least 44pt (24pt icon + hitSlop on both sides)", () => {
    mockUseCookbooks.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mockSetOptions.mockClear();
    renderComponent(<CookbookListScreen />);

    const headerRight = mockSetOptions.mock.calls
      .map(
        ([o]) => (o as { headerRight?: () => React.ReactElement }).headerRight,
      )
      .filter((h) => h !== undefined)
      .at(-1);
    const hitSlop = (headerRight!().props as { hitSlop: number }).hitSlop;
    expect(24 + 2 * hitSlop).toBeGreaterThanOrEqual(44);
  });
});
