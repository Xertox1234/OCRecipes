import React, { useCallback, useMemo, useRef } from "react";

import { DismissReasonSheet } from "@/components/home/DismissReasonSheet";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import type { CarouselRecipeCard } from "@shared/types/carousel";

/**
 * Hook-returned component pattern (same shape as `useBeverageSheet`) for the
 * "Why hide this recipe?" sheet.
 *
 * Returns `{ open, DismissReasonSheet }`. Call it in the SCREEN component —
 * the sheet ref must be owned there or `.present()` silently fails — render
 * `<DismissReasonSheet />` once, and call `open(card)` from the X button.
 */
export function useDismissReasonSheet() {
  const cardRef = useRef<CarouselRecipeCard | null>(null);
  const sheetRef = useRef<BottomSheetModal>(null);

  const open = useCallback((card: CarouselRecipeCard) => {
    cardRef.current = card;
    sheetRef.current?.present();
  }, []);

  const Sheet = useMemo(
    () =>
      function StableDismissReasonSheet() {
        return React.createElement(DismissReasonSheet, { sheetRef, cardRef });
      },
    [],
  );

  return { open, DismissReasonSheet: Sheet };
}
