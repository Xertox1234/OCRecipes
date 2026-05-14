---
title: "Extract action selection into a tested util to lock variant→callback wiring"
track: knowledge
category: best-practices
tags: [testing, vitest, react, variants, pure-functions, wiring]
module: client
applies_to:
  ["client/components/**/*.tsx", "client/components/**/__tests__/**/*.test.ts"]
created: 2026-05-13
---

# Extract action selection into a tested util to lock variant→callback wiring

## When this applies

Pure function utils (`*-utils.ts`) catch logic bugs reliably. But when multiple component variants share a single JSX block, the **prop-to-callback wiring** between variant and action is untested — even if the underlying logic is fully covered.

## The gap

If `step2_review` and `step2_confirmed` share one block that calls `onStepConfirmed`, the test for `step2_review` passes while `step2_confirmed` silently calls the wrong callback.

## Why

The reducer/logic test exercises what happens AFTER the callback fires, not WHICH callback fires for which variant. The variant→callback mapping is a separate piece of behavior; if you don't extract it into a testable surface, you can't cover it.

## Examples

Extract the action mapping into a tested pure function:

```typescript
// ProductChip-utils.ts
export function getChipPrimaryAction(
  variant: ProductChipVariant,
): "confirm" | "stepConfirmed" | "smartPhotoConfirm" {
  switch (variant) {
    case "barcode_lock":
    case "step2_confirmed":
    case "step3_review":
    case "session_complete":
      return "confirm";
    case "step2_review":
      return "stepConfirmed";
    case "smart_photo":
      return "smartPhotoConfirm";
  }
}
```

```typescript
// ProductChip-utils.test.ts
it("step2_confirmed primary is confirm, not stepConfirmed", () => {
  expect(getChipPrimaryAction("step2_confirmed")).toBe("confirm");
});
```

Then in the component: `onPress={actionMap[getChipPrimaryAction(variant)]}`.

## When to use

Any component with multiple variants that call different callbacks. If two variants share a JSX block, extract the callback selection. The block sharing is the smell.

## Exceptions

Single-variant components or variants where the action is structurally enforced by having separate JSX blocks.

**Origin:** `ProductChip` `step2_confirmed` primary dispatched `STEP_CONFIRMED` (no-op from that state) instead of `CONFIRM_PRODUCT` — caught in code review because no test covered the wiring, only the reducer logic.

## See Also

- [Extract pure functions to `*-utils.ts` for Vitest testability](extract-pure-functions-for-vitest-testability-2026-05-13.md)
