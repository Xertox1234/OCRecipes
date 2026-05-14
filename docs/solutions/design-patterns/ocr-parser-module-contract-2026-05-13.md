---
title: "OCR parser module contract — pure parser + screen-utils pair"
track: knowledge
category: design-patterns
tags: [react-native, ocr, parser, ai, contract, modules]
module: client
applies_to: ["client/lib/**/*-ocr-parser.ts", "client/screens/**/*-utils.ts"]
created: 2026-05-13
---

# OCR parser module contract — pure parser + screen-utils pair

## When this applies

Every scan flow that uses local OCR has two co-located modules:

- `client/lib/*-ocr-parser.ts` — pure function, no React, no network. Returns `{ items, confidence }` (and flow-specific fields). Confidence is a 0–1 number gating whether the local preview is shown.
- `client/screens/*-utils.ts` — exports two functions: `shouldReplaceWithAI*(local, aiResult): boolean` and `mergeItems*(local, aiItems): AIItem[]`.

## Examples

**`shouldReplaceWithAI*`** decides whether the AI result replaces local items. Typical triggers: local had no items, AI confidence is high, or item counts differ beyond a threshold.

**`mergeItems*`** is called even when `shouldReplaceWithAI*` returns false. It propagates AI-only fields (macros, categories, recommendations) onto items whose names matched locally — the user sees AI-enriched data without a full list swap. Never discard AI data when the swap rule returns false; always merge.

```typescript
// Always called — even when replace=false
const aiDisplayItems = replace
  ? result.items
  : mergeItems(localItemsRef.current, result.items);
setItems(aiDisplayItems);
```

## Why

The pure parser pattern keeps OCR logic unit-testable (no React/network mocks needed) and makes the race+swap state machine simpler. The screen-utils pair encodes per-flow merge rules outside the screen component, so the same scan screen pattern handles back-labels, menus, receipts, and front-labels by swapping in different utils.

## Exceptions

When to add a new flow: create `lib/*-ocr-parser.ts` + tests, `screens/*-utils.ts` + tests, then wire into the screen with the two-`useEffect` pattern above. No shared `useRaceAndSwap` hook — evaluate that abstraction if a fifth concrete user is added.

## See Also

- [Camera scan screen: on-device OCR race+swap state machine](camera-scan-ocr-race-swap-state-machine-2026-05-13.md)
- [Advisory-only local rendering in scan screens](../conventions/advisory-only-local-rendering-scan-screens-2026-05-13.md)
