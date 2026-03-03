---
title: "Fix missing VisionCameraBarcodeType in CameraView"
status: complete
priority: p2
issue_id: "026"
created: 2026-02-01
updated: 2026-02-01
assignee:
labels: [typescript, camera, bug]
tags: [typescript, camera, bug]
dependencies: []
---

# Fix missing VisionCameraBarcodeType in CameraView

## Summary

The `CameraView.tsx` file has a TypeScript error where `VisionCameraBarcodeType` is used but not defined or imported, causing type checking to fail.

## Background

During a design review and dark mode fix session, the TypeScript type checker revealed this pre-existing error:

```
client/camera/components/CameraView.tsx(57,4): error TS2304: Cannot find name 'VisionCameraBarcodeType'.
```

The type is used in the `mapBarcodeTypes` function return type annotation but is never imported or defined.

## Acceptance Criteria

- [ ] `npm run check:types` passes without errors in CameraView.tsx
- [ ] The `mapBarcodeTypes` function has correct type annotations
- [ ] No runtime behavior changes

## Implementation Notes

The fix likely involves one of:

1. **Import the type** from `react-native-vision-camera` if it exists there
2. **Import from shared types** - check `@shared/types/camera` which already has `BARCODE_TYPE_MAP` and related exports
3. **Define the type locally** based on the vision-camera CodeType enum

Looking at line 57, the function signature is:

```typescript
function mapBarcodeTypes(
  expoTypes: ExpoBarcodeType[],
): VisionCameraBarcodeType[] {
```

The `BARCODE_TYPE_MAP` is imported from `@shared/types/camera`, so the type definition may need to come from there or be inferred from the map's value type.

## Dependencies

- None

## Risks

- Type may have been renamed or removed in a vision-camera update
- Need to ensure type matches actual runtime values

## Updates

### 2026-02-01

- Initial creation during design review session
- Error discovered via `npm run check:types`

### 2026-02-01 - Approved for Work

**By:** Claude Triage System
**Actions:**

- Issue approved during triage session
- Status changed from backlog → ready
- Priority confirmed as P2 (IMPORTANT)
- Ready to be picked up and worked on

**Learnings:**

- TypeScript type errors block pre-commit hooks
- Type likely available from `@shared/types/camera` or `react-native-vision-camera`

### 2026-02-01 - Resolved

**By:** Claude Code
**Actions:**

- Added `type VisionCameraBarcodeType` to import from `@shared/types/camera`
- Verified `npm run check:types` passes
- Committed: 17b0922

**Resolution:**
The type was already exported from `@shared/types/camera.ts` (line 31). Simply added it to the existing import statement alongside `BARCODE_TYPE_MAP`, `BARCODE_TYPE_REVERSE_MAP`, and `isVisionCameraBarcodeType`.
