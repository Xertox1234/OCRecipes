---
title: 'Camera scan screen: on-device OCR race+swap state machine (two-useEffect mount)'
track: knowledge
category: design-patterns
module: client
tags: [react-native, camera, ocr, ai, race-condition, state-machine]
applies_to: [client/screens/**/*Scan*.tsx, client/screens/**/Label*.tsx, client/screens/**/Receipt*.tsx, client/screens/**/Menu*.tsx]
created: '2026-05-13'
---

# Camera scan screen: on-device OCR race+swap state machine (two-useEffect mount)

## When this applies

Scan screens that pair an on-device OCR parser with an AI backend call use a two-`useEffect` mount pattern. One effect seeds the UI immediately from local OCR text; the second fires the AI call and swaps the result in when it arrives.

## Examples

```typescript
const dataSourceRef = useRef<"local" | "ai" | null>(null);
const localItemsRef = useRef<LocalItem[]>([]);

// Effect 1 — instant local preview (runs once on mount)
useEffect(() => {
  if (!localOCRText) return;
  const parsed = parseItemsFromOCR(localOCRText);
  if (parsed.confidence >= CONFIDENCE_THRESHOLD && parsed.items.length > 0) {
    localItemsRef.current = parsed.items;
    setItems(toDisplayItems(parsed.items));
    dataSourceRef.current = "local";
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

// Effect 2 — AI call, races with Effect 1 (runs once on mount)
useEffect(() => {
  let cancelled = false;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  runAIMutation(input, {
    onSuccess: (result) => {
      if (cancelled) return;
      const replace =
        dataSourceRef.current === "local"
          ? shouldReplaceWithAI(localItemsRef.current, result)
          : true;

      if (replace) {
        setItems(toDisplayItems(result.items));
        if (dataSourceRef.current === "local") {
          setShowUpdatedToast(true);
          toastTimer = setTimeout(() => setShowUpdatedToast(false), 3000);
        }
      } else {
        // Still merge AI fields (macros, categories) even when keeping local names
        setItems(mergeAIFields(localItemsRef.current, result.items));
      }
      dataSourceRef.current = "ai";
    },
  });

  return () => {
    cancelled = true;
    if (toastTimer) clearTimeout(toastTimer);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only run on mount
}, []);
```

## Why

**Critical rules:**

- Always read `dataSourceRef.current` (not state) inside Effects — it avoids stale closures from the `[]` dependency array.
- The `cancelled` flag must be the **first check** in every async callback branch.
- The `toastTimer` handle must be captured in the Effect's local scope and cleared in the cleanup.
- Toast uses `FadeInUp` from `react-native-reanimated` with a 3-second auto-dismiss.
- Loading guard: only show a blocking spinner when `isPending && items.length === 0`. When local items exist, the list renders immediately.

**Confidence thresholds (2026-04-28):** back-label 0.6, menu/receipt/front-label 0.5.

## Related Files

- `LabelAnalysisScreen.tsx` (canonical), `MenuScanResultScreen.tsx`, `ReceiptReviewScreen.tsx`, `FrontLabelConfirmScreen.tsx`

## See Also

- [OCR parser module contract](ocr-parser-module-contract-2026-05-13.md)
- [Advisory-only local rendering in scan screens](../conventions/advisory-only-local-rendering-scan-screens-2026-05-13.md)
- [Use useRef for synchronous checks in callbacks](../conventions/useref-for-synchronous-checks-in-callbacks-2026-05-13.md)
