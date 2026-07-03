---
title: Advisory-only local rendering in scan screens — never fabricate AI-only fields
track: knowledge
category: conventions
module: client
tags: [react-native, ocr, ai, scan, placeholder, ux]
applies_to: [client/screens/**/*Scan*.tsx, client/components/**/MenuItem*.tsx, client/components/**/Receipt*.tsx]
created: '2026-05-13'
---

# Advisory-only local rendering in scan screens — never fabricate AI-only fields

## Rule

When local OCR seeds a scan screen before the AI result arrives, only render fields that the parser can reliably extract. Never fabricate AI-only fields.

## Examples

| Field                             | Local OCR can provide | AI-only (show placeholder) |
| --------------------------------- | --------------------- | -------------------------- |
| Item / product name               | yes (raw/abbreviated) | —                          |
| Price, quantity                   | yes                   | —                          |
| Category, shelf life              | no                    | Default (`"other"`, `7`)   |
| Calories, macros, recommendations | no                    | `"Analysing nutrition…"`   |

### Implementation

- Populate AI-only fields with safe defaults in the local item object (`category: "other"`, `estimatedShelfLifeDays: 7`).
- Guard their display in the card component with an `isLocal` prop or a `_isLocal` tag on the item — hide or replace with a placeholder string when true.
- Never use `0` for calorie/macro defaults — this is misleading. Use `undefined` or omit the field so the UI can show a placeholder instead of a zero.

## Why

Showing `0 cal` for a local item would appear as though the scanner detected a zero-calorie food, which is more confusing than showing "Analysing…".

## Related Files

- `MenuItemCard` in `MenuScanResultScreen.tsx` (guards on `isLocal`)
- `ReceiptReviewScreen.tsx` (category badge defaults to `"other"`)

## See Also

- [Camera scan screen: on-device OCR race+swap state machine](../design-patterns/camera-scan-ocr-race-swap-state-machine-2026-05-13.md)
- [OCR parser module contract](../design-patterns/ocr-parser-module-contract-2026-05-13.md)
