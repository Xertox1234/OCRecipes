import React, { useCallback, useMemo, useRef, useState } from "react";

import { BeveragePickerSheet } from "@/components/BeveragePickerSheet";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import type { BeverageSize } from "@shared/constants/beverages";

export interface BeverageSheetOptions {
  mealType: string | null;
  onLogged?: (beverageName: string, size: BeverageSize) => void;
}

const defaults: BeverageSheetOptions = { mealType: null };

/**
 * Hook-returned component pattern for the beverage picker bottom sheet.
 *
 * Returns `{ open, BeverageSheet }`. Render `<BeverageSheet />` once at
 * the bottom of your JSX (inside the accessibilityViewIsModal container).
 * Call `open({ mealType })` to present the sheet.
 */
export function useBeverageSheet() {
  const optionsRef = useRef<BeverageSheetOptions>(defaults);
  const sheetRef = useRef<BottomSheetModal>(null);
  const [, setRevision] = useState(0);

  const open = useCallback((options: BeverageSheetOptions) => {
    optionsRef.current = options;
    setRevision((r) => r + 1);
    sheetRef.current?.present();
  }, []);

  // Stable component identity — empty deps so React never remounts the sheet.
  // setRevision triggers a re-render which reads fresh optionsRef.current.
  const BeverageSheet = useMemo(
    () =>
      function StableBeverageSheet() {
        return React.createElement(BeveragePickerSheet, {
          sheetRef,
          optionsRef,
        });
      },
    [],
  );

  return { open, BeverageSheet };
}
