import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";

import { runAfterTransition } from "@/lib/run-after-transition";
import { useSheetBackHandler } from "@/hooks/useSheetBackHandler";
import type { MealType } from "@/screens/meal-plan/meal-plan-utils";
import type { MealPlanHomeScreenNavigationProp } from "@/types/navigation";
import { AddItemMenuSheetContent } from "@/components/meal-plan/AddItemMenuSheet";
import { ImportRecipeSheetContent } from "@/components/meal-plan/ImportRecipeSheet";
import {
  QuickAddSheetContent,
  type QuickAddSheetContentHandle,
} from "@/components/meal-plan/QuickAddSheet";
import {
  SimpleEntrySheetContent,
  type SimpleEntrySheetContentHandle,
} from "@/components/meal-plan/SimpleEntrySheet";

// The 4 bottom sheets MealPlanHomeScreen hosts, collapsed into one union so at
// most one can ever be "active" at a time (matches production reality — the
// app never opens two of these simultaneously).
export type SheetKind =
  | "addItemMenu"
  | "importRecipe"
  | "quickAdd"
  | "simpleEntry";
export type ActiveSheet = { kind: SheetKind; mealType: MealType } | null;

/**
 * Owns MealPlanHomeScreen's sheet state machine: the `activeSheet` union, the
 * sheet refs, the present/dismiss effect, the unified Android back handler and
 * the dismiss/handoff handlers. The `<BottomSheetModal>` JSX itself stays in
 * the screen — BottomSheetModal must be declared directly in the screen
 * component (declaring it inside an imported child component silently breaks
 * .present(): no error, no onChange/onAnimate, no visual change). This hook
 * only hands the screen the refs and handlers to wire onto them.
 */
export function useMealPlanSheets({
  navigation,
  selectedDateStr,
}: {
  navigation: MealPlanHomeScreenNavigationProp;
  selectedDateStr: string;
}) {
  const addItemMenuSheetRef = useRef<BottomSheetModal>(null);
  const importRecipeSheetRef = useRef<BottomSheetModal>(null);
  const quickAddSheetRef = useRef<BottomSheetModal>(null);
  const quickAddSheetContentRef = useRef<QuickAddSheetContentHandle>(null);
  const simpleEntrySheetRef = useRef<BottomSheetModal>(null);
  const simpleEntrySheetContentRef =
    useRef<SimpleEntrySheetContentHandle>(null);

  // One union replaces the 4 hand-duplicated xxxMealType atoms — at most one
  // sheet is ever active. Each kind's own local (addItemMenuMealType, etc.)
  // is derived below so the rest of the screen (memoized children,
  // effects) reads the same names it always has.
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(null);
  const addItemMenuMealType =
    activeSheet?.kind === "addItemMenu" ? activeSheet.mealType : null;
  const importRecipeMealType =
    activeSheet?.kind === "importRecipe" ? activeSheet.mealType : null;
  const quickAddMealType =
    activeSheet?.kind === "quickAdd" ? activeSheet.mealType : null;
  const simpleEntryMealType =
    activeSheet?.kind === "simpleEntry" ? activeSheet.mealType : null;

  // Opens/closes a sheet by kind. `closeSheet` is guarded (only clears when
  // its OWN kind is still active) because gorhom's `onDismiss` fires on
  // close-ANIMATION-complete, which is not guaranteed to run strictly before
  // the destination sheet's runAfterTransition-scheduled open during a
  // same-screen handoff (e.g. `handleChooseRecipe` below) — an unguarded
  // `setActiveSheet(null)` from a late-firing onDismiss would clobber the
  // sheet that opened in the meantime.
  const openSheet = useCallback((kind: SheetKind, mealType: MealType) => {
    setActiveSheet({ kind, mealType });
  }, []);
  const closeSheet = useCallback((kind: SheetKind) => {
    setActiveSheet((prev) => (prev?.kind === kind ? null : prev));
  }, []);

  // Android TalkBack background focus trap (iOS already trapped via
  // accessibilityViewIsModal on each sheet's own content root, PR #1000).
  // Applied to the screen's own background ScrollView while ANY sheet is
  // active; releases as soon as activeSheet clears to null (see
  // docs/solutions/logic-errors/
  // gorhom-onchange-fires-on-animation-complete-not-start-2026-07-07.md for
  // why that can be a little ahead of the close animation finishing — the
  // accepted early-release direction, not the never-releases one).
  const isAnySheetOpen = activeSheet !== null;

  const handleAddItemMenuDismiss = useCallback(() => {
    closeSheet("addItemMenu");
  }, [closeSheet]);

  const handleChooseRecipe = useCallback(() => {
    const mt = addItemMenuMealType;
    closeSheet("addItemMenu");
    runAfterTransition(() => {
      if (mt !== null) openSheet("quickAdd", mt);
    });
  }, [addItemMenuMealType, closeSheet, openSheet]);

  const handleSimpleEntry = useCallback(() => {
    const mt = addItemMenuMealType;
    closeSheet("addItemMenu");
    runAfterTransition(() => {
      if (mt !== null) openSheet("simpleEntry", mt);
    });
  }, [addItemMenuMealType, closeSheet, openSheet]);

  const handleQuickAddDismiss = useCallback(() => {
    closeSheet("quickAdd");
  }, [closeSheet]);

  const handleSimpleEntryDismiss = useCallback(() => {
    closeSheet("simpleEntry");
  }, [closeSheet]);

  const handleImportRecipe = useCallback(() => {
    const mt = addItemMenuMealType;
    closeSheet("addItemMenu");
    runAfterTransition(() => {
      if (mt !== null) openSheet("importRecipe", mt);
    });
  }, [addItemMenuMealType, closeSheet, openSheet]);

  const handleImportRecipeDismiss = useCallback(() => {
    closeSheet("importRecipe");
  }, [closeSheet]);

  // The ref the unified back-handler below should dismiss. Only ever
  // reassigned when a sheet OPENS (never cleared on close) — mirrors
  // useSheetBackHandler's own asymmetric isOpenRef bias, so a back press
  // during a close animation still targets the sheet the user can still see.
  const activeSheetRef = useRef<BottomSheetModal | null>(null);
  const prevSheetKindRef = useRef<SheetKind | null>(null);

  // ONE present/dismiss effect for all 4 sheets, replacing the 4
  // near-identical per-kind effects above. Dismisses only the PREVIOUSLY
  // active kind (not every other kind on every change) so this fires exactly
  // like the 4 independent effects it replaces: one dismiss (closing) plus
  // one present (opening) per transition, not a dismiss on every sibling.
  useEffect(() => {
    // Stable lookup from kind to its own BottomSheetModal ref — refs never
    // change identity, so the 4 targets resolve identically every run; they
    // are listed as dependencies below only to satisfy exhaustive-deps (an
    // eslint-disable would make React Compiler skip this whole hook).
    const sheetRefs: Record<
      SheetKind,
      React.RefObject<BottomSheetModal | null>
    > = {
      addItemMenu: addItemMenuSheetRef,
      importRecipe: importRecipeSheetRef,
      quickAdd: quickAddSheetRef,
      simpleEntry: simpleEntrySheetRef,
    };
    const kind = activeSheet?.kind ?? null;
    const prevKind = prevSheetKindRef.current;
    if (prevKind && prevKind !== kind) {
      sheetRefs[prevKind].current?.dismiss();
    }
    if (kind) {
      activeSheetRef.current = sheetRefs[kind].current;
      sheetRefs[kind].current?.present();
    }
    prevSheetKindRef.current = kind;
  }, [
    activeSheet,
    addItemMenuSheetRef,
    importRecipeSheetRef,
    quickAddSheetRef,
    simpleEntrySheetRef,
  ]);

  // Android hardware back dismisses whichever sheet is active, consuming the
  // event instead of popping the screen underneath — @gorhom/bottom-sheet has
  // no built-in BackHandler wiring. ONE call for all 4 sheets: `activeSheetRef`
  // (assigned by the present/dismiss effect above) always points at whichever
  // of the 4 real refs is currently active, and `activeSheet !== null` is the
  // isOpen signal. The returned onSheetChange/onSheetAnimate are wired onto
  // every <BottomSheetModal>'s own onChange/onAnimate props in the screen —
  // isOpen flipping false no longer closes the ref by itself; only
  // onSheetChange(-1) does, so the ref stays "open" for the sheet's full close
  // animation instead of racing ahead of what the user still sees on screen
  // (see useSheetBackHandler's JSDoc). A single call also means there is no
  // multi-listener registration order to get wrong during a same-screen
  // handoff (e.g. handleChooseRecipe) — the prior 4-call architecture needed
  // a documented load-bearing declaration order for exactly that reason.
  //
  // Because onSheetChange/onSheetAnimate are now SHARED across all 4
  // BottomSheetModal instances (unlike the old 4-hook-instance design, where
  // each had its own private isOpenRef), any one of them firing onChange(-1)
  // — a late close from a just-abandoned sheet during a handoff, or the
  // spurious blur/refocus duplicate event useSheetBackHandler's own JSDoc
  // documents — clears the ONE shared isOpenRef even while a different sheet
  // is genuinely open. Correctness in that window depends entirely on
  // useSheetBackHandler's `stateIsOpenRef` fallback (derived here from
  // `activeSheet !== null`), which was originally added for an unrelated
  // single-sheet blur/refocus bug and is now silently load-bearing for this
  // screen's multi-sheet aliasing too — do not change that fallback's logic
  // without checking this call site.
  const { onSheetChange, onSheetAnimate } = useSheetBackHandler(
    activeSheetRef,
    activeSheet !== null,
  );

  const handleNavigateUrlImport = useCallback(
    (mt: MealType | null, date?: string) => {
      if (mt === null || date === undefined) return;
      closeSheet("importRecipe");
      navigation.navigate("RecipeImport", {
        returnToMealPlan: { mealType: mt, plannedDate: date },
      });
    },
    [navigation, closeSheet],
  );

  const handlePhotoImport = useCallback(
    (uri: string, mt: MealType | null, date?: string) => {
      if (mt === null || date === undefined) return;
      closeSheet("importRecipe");
      navigation.navigate("RecipePhotoImport", {
        photoUri: uri,
        returnToMealPlan: { mealType: mt, plannedDate: date },
      });
    },
    [navigation, closeSheet],
  );

  const handleTextImport = useCallback(
    (text: string, mt: MealType | null, date?: string) => {
      if (mt === null || date === undefined) return;
      closeSheet("importRecipe");
      navigation.navigate("RecipeTextImport", {
        pastedText: text,
        returnToMealPlan: { mealType: mt, plannedDate: date },
      });
    },
    [navigation, closeSheet],
  );

  const handleNavigateCreate = useCallback(
    (mt: MealType, date: string) => {
      navigation.navigate("RecipeEntryHub", {
        returnToMealPlan: { mealType: mt, plannedDate: date },
      });
    },
    [navigation],
  );

  const handleOpenCommunityRecipe = useCallback(
    (communityRecipeId: number) => {
      navigation.navigate("FeaturedRecipeDetail", {
        recipeId: communityRecipeId,
        recipeType: "community",
      });
    },
    [navigation],
  );

  const handleOpenImportSheet = useCallback(
    (mt: MealType) => {
      runAfterTransition(() => openSheet("importRecipe", mt));
    },
    [openSheet],
  );

  const handleQuickAddSheetChange = useCallback(
    (index: number) => {
      onSheetChange(index);
      if (index === 0) quickAddSheetContentRef.current?.focusSearchInput();
    },
    [onSheetChange],
  );

  const handleSimpleEntrySheetChange = useCallback(
    (index: number) => {
      onSheetChange(index);
      if (index === 0) simpleEntrySheetContentRef.current?.focusDishNameInput();
    },
    [onSheetChange],
  );

  // Memoized so BottomSheetModal's own memo(forwardRef(...)) wrapping can
  // bail out on unrelated screen re-renders instead of re-invoking its
  // ~20-hook body every time.
  const addItemMenuSheetChildren = useMemo(
    () => (
      <AddItemMenuSheetContent
        mealType={addItemMenuMealType}
        onChooseRecipe={handleChooseRecipe}
        onSimpleEntry={handleSimpleEntry}
        onImportRecipe={handleImportRecipe}
      />
    ),
    [
      addItemMenuMealType,
      handleChooseRecipe,
      handleSimpleEntry,
      handleImportRecipe,
    ],
  );

  const importRecipeSheetChildren = useMemo(
    () => (
      <ImportRecipeSheetContent
        mealType={importRecipeMealType}
        plannedDate={selectedDateStr}
        onDismiss={handleImportRecipeDismiss}
        onNavigateUrlImport={handleNavigateUrlImport}
        onPhotoImport={handlePhotoImport}
        onTextImport={handleTextImport}
      />
    ),
    [
      importRecipeMealType,
      selectedDateStr,
      handleImportRecipeDismiss,
      handleNavigateUrlImport,
      handlePhotoImport,
      handleTextImport,
    ],
  );

  const quickAddSheetChildren = useMemo(
    () => (
      <QuickAddSheetContent
        ref={quickAddSheetContentRef}
        mealType={quickAddMealType}
        plannedDate={selectedDateStr}
        onDismiss={handleQuickAddDismiss}
        onNavigateCreate={handleNavigateCreate}
        onOpenImportSheet={handleOpenImportSheet}
        onOpenCommunityRecipe={handleOpenCommunityRecipe}
      />
    ),
    [
      quickAddMealType,
      selectedDateStr,
      handleQuickAddDismiss,
      handleNavigateCreate,
      handleOpenImportSheet,
      handleOpenCommunityRecipe,
    ],
  );

  const simpleEntrySheetChildren = useMemo(
    () => (
      <SimpleEntrySheetContent
        ref={simpleEntrySheetContentRef}
        mealType={simpleEntryMealType}
        plannedDate={selectedDateStr}
        onDismiss={handleSimpleEntryDismiss}
      />
    ),
    [simpleEntryMealType, selectedDateStr, handleSimpleEntryDismiss],
  );

  return {
    addItemMenuSheetRef,
    importRecipeSheetRef,
    quickAddSheetRef,
    quickAddSheetContentRef,
    simpleEntrySheetRef,
    simpleEntrySheetContentRef,
    addItemMenuMealType,
    importRecipeMealType,
    quickAddMealType,
    simpleEntryMealType,
    isAnySheetOpen,
    openSheet,
    closeSheet,
    onSheetChange,
    onSheetAnimate,
    handleAddItemMenuDismiss,
    handleChooseRecipe,
    handleSimpleEntry,
    handleImportRecipeDismiss,
    handleQuickAddDismiss,
    handleSimpleEntryDismiss,
    handleQuickAddSheetChange,
    handleSimpleEntrySheetChange,
    addItemMenuSheetChildren,
    importRecipeSheetChildren,
    quickAddSheetChildren,
    simpleEntrySheetChildren,
  };
}
