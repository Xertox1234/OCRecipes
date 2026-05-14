---
title: "Intent-driven config object shared across client/server"
track: knowledge
category: design-patterns
tags: [api, shared, config, intent, branching]
module: shared
applies_to: ["shared/constants/**/*.ts", "server/**/*.ts", "client/**/*.ts"]
created: 2026-05-13
---

# Intent-driven config object shared across client/server

## When this applies

Multiple code paths share the same feature with mode-dependent behavior (photo intents, notification types, export formats). Place a shared config record in `shared/constants/` keyed by intent/mode union type. Both client and server import the same object to drive branching behavior.

## Why

Eliminates scattered `if (intent === "log")` checks across client and server. Adding a new intent means adding one config entry instead of hunting for conditionals.

## Examples

```typescript
// shared/constants/preparation.ts
export const INTENT_CONFIG: Record<
  PhotoIntent,
  {
    needsNutrition: boolean;
    needsSession: boolean;
    canLog: boolean;
    label: string;
  }
> = {
  log: { needsNutrition: true, needsSession: true, canLog: true, label: "Log this meal" },
  identify: { needsNutrition: false, needsSession: false, canLog: false, label: "Just identify" },
  // ...
};

// Server usage — drives which steps to execute
const intentConfig = INTENT_CONFIG[intent];
if (intentConfig.needsNutrition) {
  foods = await batchNutritionLookup(result.foods);
}
if (intentConfig.needsSession) {
  sessionStore.set(sessionId, { userId, result, createdAt: new Date() });
}

// Client usage — drives which UI to render
const config = INTENT_CONFIG[intent];
{config.canLog && <LogButton onPress={handleConfirm} />}
```

## Exceptions

Only 2 simple modes with a boolean flag — a simple `if` is clearer.

## See Also

- [Centralized domain defaults](../conventions/centralized-domain-defaults-2026-05-13.md)
