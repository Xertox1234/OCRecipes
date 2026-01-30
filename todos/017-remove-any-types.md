---
title: "Replace 'any' types with proper TypeScript types"
status: ready
priority: low
created: 2026-01-30
updated: 2026-01-30
assignee:
labels: [types, cleanup, code-review]
---

# Replace 'any' Types

## Summary

Multiple files use `any` type annotations which bypass TypeScript's type safety guarantees.

## Background

**Locations:**
- `client/screens/HistoryScreen.tsx:230` - `useNavigation<any>()`
- `client/screens/ScanScreen.tsx:38` - `useNavigation<any>()`
- `client/screens/ScanScreen.tsx:44` - `useRef<any>(null)` for cameraRef
- `client/screens/NutritionDetailScreen.tsx:91` - `useNavigation<any>()`
- `client/screens/ProfileScreen.tsx:137` - `name={icon as any}`
- `client/screens/LoginScreen.tsx:60` - `catch (err: any)`
- `client/components/Card.tsx:33` - `theme: any`

## Acceptance Criteria

- [ ] Create typed navigation definitions
- [ ] Type useNavigation hooks properly
- [ ] Type cameraRef with CameraView ref type
- [ ] Fix icon name type
- [ ] Type error catch blocks properly
- [ ] Fix theme type in Card component

## Implementation Notes

```typescript
// types/navigation.ts
import { NativeStackNavigationProp } from "@react-navigation/native-stack";

export type RootStackParamList = {
  Login: undefined;
  Onboarding: undefined;
  Main: undefined;
  NutritionDetail: { barcode?: string; imageUri?: string; itemId?: number };
  ItemDetail: { itemId: number };
  HistoryTab: undefined;
};

export type ScanScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  "Main"
>;
```

```typescript
// In screens:
const navigation = useNavigation<ScanScreenNavigationProp>();
```

```typescript
// For camera ref:
import { CameraView } from "expo-camera";
const cameraRef = useRef<CameraView>(null);
```

```typescript
// For error handling:
catch (err: unknown) {
  const message = err instanceof Error ? err.message : "Unknown error";
}
```

## Dependencies

- None

## Risks

- May uncover actual type errors that were hidden

## Updates

### 2026-01-30
- Initial creation from code review
