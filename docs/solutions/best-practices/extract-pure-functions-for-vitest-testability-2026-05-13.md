---
title: "Extract pure functions to `*-utils.ts` for Vitest testability"
track: knowledge
category: best-practices
tags: [testing, vitest, react-native, pure-functions, extraction]
module: client
applies_to: ["client/**/*.ts", "client/**/*.tsx", "client/**/__tests__/**/*.ts"]
created: 2026-05-13
---

# Extract pure functions to `*-utils.ts` for Vitest testability

## When this applies

When a React Native hook or component contains business logic that you want to unit test, extract the pure functions into a separate `*-utils.ts` file that does **not** import from `react-native`, `expo-*`, or any native module. Vitest runs in Node via Vite/Rollup, which cannot parse React Native's JSX runtime or native module bindings.

## Why

Vitest evaluates code in Node; React Native's JSX runtime and native module bindings break import. Moving pure logic to a sibling utility file unblocks unit testing without touching the hook/component.

## Examples

```
# File structure
client/lib/iap/
  usePurchase.ts          # Hook — imports React Native, not directly testable in Vitest
  purchase-utils.ts       # Pure functions — no RN imports, fully testable
  __tests__/
    usePurchase.test.ts   # Tests import from purchase-utils.ts only

client/components/
  UpgradeModal.tsx        # Component — imports React Native
  upgrade-modal-utils.ts  # Pure functions — BENEFITS array, getCtaLabel(), isCtaDisabled()
```

```typescript
// purchase-utils.ts — Pure, no React Native imports
import type { PurchaseError } from "@shared/types/subscription";
import type { UpgradeRequest } from "@shared/schemas/subscription";

export function mapIAPError(error: unknown): PurchaseError {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("user-cancelled") || msg.includes("user cancelled")) {
      return { code: "USER_CANCELLED", message: "Purchase cancelled" };
    }
    // ... other mappings
  }
  return {
    code: "UNKNOWN",
    message: "An unexpected error occurred",
    originalError: error,
  };
}

export function buildReceiptPayload(
  purchase: {
    transactionReceipt: string;
    productId: string;
    transactionId: string;
  },
  platform: "ios" | "android",
): UpgradeRequest {
  return {
    receipt: purchase.transactionReceipt,
    platform,
    productId: purchase.productId,
    transactionId: purchase.transactionId,
  };
}
```

```typescript
// usePurchase.ts — Hook that imports pure functions + React Native
import { useState, useRef, useCallback, useEffect } from "react";
import { Platform } from "react-native";
import {
  mapIAPError,
  buildReceiptPayload,
  isSupportedPlatform,
} from "./purchase-utils";

export function usePurchase() {
  // ... uses pure functions for logic, RN APIs for platform/state
}
```

```typescript
// __tests__/usePurchase.test.ts — Tests pure functions directly
import {
  mapIAPError,
  buildReceiptPayload,
  isSupportedPlatform,
} from "../purchase-utils";

describe("mapIAPError", () => {
  it("maps user-cancelled error", () => {
    expect(mapIAPError(new Error("user-cancelled")).code).toBe(
      "USER_CANCELLED",
    );
  });
});
```

## Extraction checklist

Move to `*-utils.ts` if the function:

- Takes plain data in, returns plain data out (no hooks, no `Platform.OS`, no `Haptics`)
- Does not import from `react-native`, `expo-*`, or any native module
- Can be described without mentioning React (e.g., "maps error codes", "builds payload", "computes label")

## What stays in the hook/component

- `useState`, `useRef`, `useCallback`, `useEffect`
- `Platform.OS`, `Haptics.*`, `AsyncStorage`
- Anything that requires a React rendering context

## Exceptions

Logic genuinely coupled to React state or native APIs (animation drivers, gesture handlers, navigation actions). For those, use integration tests or manual testing.

## Related Files

- `client/lib/iap/purchase-utils.ts` — `mapIAPError`, `buildReceiptPayload`, `buildRestorePayload`, `isSupportedPlatform`
- `client/components/upgrade-modal-utils.ts` — `BENEFITS`, `getCtaLabel`, `isCtaDisabled`
- `client/lib/serving-size-utils.ts` — serving size calculation logic

## See Also

- [Extract pure server-service functions](extract-pure-server-service-functions-2026-05-13.md)
- [Pure functions outside React component bodies](../conventions/pure-functions-outside-react-component-bodies-2026-05-13.md)
