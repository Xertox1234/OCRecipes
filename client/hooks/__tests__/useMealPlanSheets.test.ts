// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";

import type { MealPlanHomeScreenNavigationProp } from "@/types/navigation";

import type { FamilyProfile } from "@shared/schema";
import { clearPendingAudience, takePendingAudience } from "@/lib/plan-audience";

import { useMealPlanSheets } from "../useMealPlanSheets";
import { useSheetBackHandler } from "../useSheetBackHandler";

const onSheetChange = vi.fn();
const onSheetAnimate = vi.fn();

vi.mock("../useSheetBackHandler", () => ({
  useSheetBackHandler: vi.fn(),
}));

vi.mock("@/components/meal-plan/AddItemMenuSheet", () => ({
  AddItemMenuSheetContent: () => null,
}));
vi.mock("@/components/meal-plan/ImportRecipeSheet", () => ({
  ImportRecipeSheetContent: () => null,
}));
vi.mock("@/components/meal-plan/QuickAddSheet", () => ({
  QuickAddSheetContent: () => null,
}));
vi.mock("@/components/meal-plan/SimpleEntrySheet", () => ({
  SimpleEntrySheetContent: () => null,
}));

vi.mock("@/lib/run-after-transition", () => ({
  runAfterTransition: (task: () => void) => task(),
}));

function fakeSheet() {
  return { present: vi.fn(), dismiss: vi.fn() };
}

function setup(family?: Parameters<typeof useMealPlanSheets>[0]["family"]) {
  vi.mocked(useSheetBackHandler).mockReturnValue({
    onSheetChange,
    onSheetAnimate,
  });
  const hook = renderHook(() =>
    useMealPlanSheets({
      navigation: {
        navigate: vi.fn(),
      } as unknown as MealPlanHomeScreenNavigationProp,
      selectedDateStr: "2026-10-29",
      family,
    }),
  );
  const sheets = {
    addItemMenu: fakeSheet(),
    importRecipe: fakeSheet(),
    quickAdd: fakeSheet(),
    simpleEntry: fakeSheet(),
    audience: fakeSheet(),
  };
  // Assigned after mount: the real BottomSheetModal ref attaches at commit.
  hook.result.current.addItemMenuSheetRef.current =
    sheets.addItemMenu as unknown as BottomSheetModal;
  hook.result.current.importRecipeSheetRef.current =
    sheets.importRecipe as unknown as BottomSheetModal;
  hook.result.current.quickAddSheetRef.current =
    sheets.quickAdd as unknown as BottomSheetModal;
  hook.result.current.simpleEntrySheetRef.current =
    sheets.simpleEntry as unknown as BottomSheetModal;
  hook.result.current.audienceSheetRef.current =
    sheets.audience as unknown as BottomSheetModal;
  return { ...hook, sheets };
}

describe("useMealPlanSheets", () => {
  it("starts with no sheet open", () => {
    const { result } = setup();
    expect(result.current.isAnySheetOpen).toBe(false);
    expect(result.current.addItemMenuMealType).toBeNull();
  });

  it("presents the sheet for the opened kind and derives its meal type", () => {
    const { result, sheets } = setup();
    act(() => result.current.openSheet("addItemMenu", "lunch"));
    expect(sheets.addItemMenu.present).toHaveBeenCalledTimes(1);
    expect(result.current.addItemMenuMealType).toBe("lunch");
    expect(result.current.quickAddMealType).toBeNull();
    expect(result.current.isAnySheetOpen).toBe(true);
  });

  it("switching kinds dismisses only the previous sheet and presents the new one", () => {
    const { result, sheets } = setup();
    act(() => result.current.openSheet("addItemMenu", "dinner"));
    act(() => result.current.openSheet("quickAdd", "dinner"));
    expect(sheets.addItemMenu.dismiss).toHaveBeenCalledTimes(1);
    expect(sheets.quickAdd.present).toHaveBeenCalledTimes(1);
    expect(sheets.importRecipe.dismiss).not.toHaveBeenCalled();
    expect(sheets.simpleEntry.dismiss).not.toHaveBeenCalled();
  });

  it("closeSheet ignores a stale kind (kind guard)", () => {
    const { result } = setup();
    act(() => result.current.openSheet("quickAdd", "snack"));
    act(() => result.current.closeSheet("addItemMenu"));
    expect(result.current.quickAddMealType).toBe("snack");
    expect(result.current.isAnySheetOpen).toBe(true);
  });

  it("closeSheet on the active kind clears it and dismisses the sheet", () => {
    const { result, sheets } = setup();
    act(() => result.current.openSheet("quickAdd", "snack"));
    act(() => result.current.closeSheet("quickAdd"));
    expect(result.current.isAnySheetOpen).toBe(false);
    expect(sheets.quickAdd.dismiss).toHaveBeenCalledTimes(1);
  });

  it("hands the back handler the active sheet ref and open flag, never cleared on close", () => {
    const { result, sheets } = setup();
    act(() => result.current.openSheet("simpleEntry", "breakfast"));
    const calls = vi.mocked(useSheetBackHandler).mock.calls;
    const [lastRef, lastOpen] = calls[calls.length - 1];
    expect(lastOpen).toBe(true);
    expect(lastRef.current).toBe(sheets.simpleEntry);
    act(() => result.current.closeSheet("simpleEntry"));
    const after = vi.mocked(useSheetBackHandler).mock.calls.at(-1)!;
    expect(after[1]).toBe(false);
    expect(after[0].current).toBe(sheets.simpleEntry);
  });

  it("handoff handlers close the menu then open the destination for the same meal", () => {
    const { result, sheets } = setup();
    act(() => result.current.openSheet("addItemMenu", "lunch"));
    act(() => result.current.handleChooseRecipe());
    expect(result.current.quickAddMealType).toBe("lunch");
    expect(sheets.quickAdd.present).toHaveBeenCalledTimes(1);
  });

  it("passes the selected date and active meal type to the sheet content", () => {
    const { result } = setup();
    act(() => result.current.openSheet("simpleEntry", "dinner"));
    const props = result.current.simpleEntrySheetChildren.props as {
      mealType: string | null;
      plannedDate: string;
    };
    expect(props.mealType).toBe("dinner");
    expect(props.plannedDate).toBe("2026-10-29");
  });

  it("quick-add change wrapper forwards to onSheetChange", () => {
    const { result } = setup();
    act(() => result.current.handleQuickAddSheetChange(-1));
    expect(onSheetChange).toHaveBeenCalledWith(-1);
  });

  it("presents the audience sheet for its own kind", () => {
    const { result, sheets } = setup();
    act(() => result.current.openSheet("audience", "dinner"));
    expect(sheets.audience.present).toHaveBeenCalledTimes(1);
    expect(result.current.isAnySheetOpen).toBe(true);
  });
});

describe("useMealPlanSheets — who's it for", () => {
  const ivy = { id: 7, name: "Ivy", allergies: [] } as unknown as FamilyProfile;
  const slot = { plannedDate: "2026-10-29", mealType: "lunch" };

  beforeEach(() => clearPendingAudience());

  const audienceProps = (hook: ReturnType<typeof setup>) =>
    (
      hook.result.current.addItemMenuSheetChildren.props as {
        audience?: {
          value: { audience: string; familyProfileId: number | null };
          onChange: (choice: {
            audience: "profile";
            familyProfileId: number;
          }) => void;
        };
      }
    ).audience;

  it("offers no audience choice without a family", () => {
    const hook = setup();
    act(() => hook.result.current.openSheet("addItemMenu", "lunch"));
    expect(audienceProps(hook)).toBeUndefined();
    expect(takePendingAudience(slot)).toBeNull();
  });

  it("opening the menu sets the default audience for its slot", () => {
    const hook = setup({
      profiles: [ivy],
      filter: { kind: "profile", profileId: 7 },
    });
    act(() => hook.result.current.openSheet("addItemMenu", "lunch"));
    expect(audienceProps(hook)?.value).toEqual({
      audience: "profile",
      familyProfileId: 7,
    });
    expect(takePendingAudience(slot)).toEqual({
      audience: "profile",
      familyProfileId: 7,
    });
  });

  it("defaults to everyone when no profile is filtered", () => {
    const hook = setup({ profiles: [ivy], filter: { kind: "all" } });
    act(() => hook.result.current.openSheet("addItemMenu", "lunch"));
    expect(takePendingAudience(slot)).toEqual({
      audience: "shared",
      familyProfileId: null,
    });
  });

  it("a change in the menu replaces the pending choice for the slot", () => {
    const hook = setup({ profiles: [ivy], filter: { kind: "all" } });
    act(() => hook.result.current.openSheet("addItemMenu", "lunch"));
    act(() =>
      audienceProps(hook)!.onChange({
        audience: "profile",
        familyProfileId: 7,
      }),
    );
    expect(audienceProps(hook)?.value.familyProfileId).toBe(7);
    expect(takePendingAudience(slot)).toEqual({
      audience: "profile",
      familyProfileId: 7,
    });
  });

  it("forgets the pending choice once family planning is inactive", () => {
    type Family = Parameters<typeof useMealPlanSheets>[0]["family"];
    const hook = renderHook(
      ({ family }: { family: Family }) =>
        useMealPlanSheets({
          navigation: {
            navigate: vi.fn(),
          } as unknown as MealPlanHomeScreenNavigationProp,
          selectedDateStr: "2026-10-29",
          family,
        }),
      {
        initialProps: {
          family: { profiles: [ivy], filter: { kind: "all" } } as Family,
        },
      },
    );
    act(() => hook.result.current.openSheet("addItemMenu", "lunch"));
    hook.rerender({ family: null });
    expect(takePendingAudience(slot)).toBeNull();
  });
});
