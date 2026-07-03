---
title: Import AND re-export shared types — `export type` alone isn't a local binding
track: knowledge
category: conventions
module: shared
tags: [typescript, types, modules, re-export, shared]
applies_to: [server/**/*.ts, client/**/*.ts, client/**/*.tsx, shared/**/*.ts]
created: '2026-05-13'
---

# Import AND re-export shared types — `export type` alone isn't a local binding

## Rule

When a module both uses a shared type internally and re-exports it for consumers, you must import it separately — `export type` alone doesn't bring the type into scope.

## Examples

```typescript
// server/services/photo-analysis.ts

// Import for use in this file
import type { LabelExtractionResult } from "@shared/types/label-analysis";
// Re-export for consumers that import from this module
export type { LabelExtractionResult } from "@shared/types/label-analysis";

export async function analyzeLabelPhoto(
  imageBase64: string,
): Promise<LabelExtractionResult> {
  // ← needs the import above
  // ...
}
```

## When this applies

Any file that both uses and re-exports a type from `shared/types/`.

## Exceptions

If the file only re-exports (barrel file) or only uses the type internally.

## Why

TypeScript's `export type { X } from "..."` is a pass-through — it doesn't create a local binding. Without the separate `import type`, the type is `undefined` within the file.

## See Also

- [Mass-assignment protection: whitelist updatable fields](mass-assignment-protection-whitelist-fields-2026-05-13.md)
