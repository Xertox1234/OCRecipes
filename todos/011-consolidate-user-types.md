---
title: "Consolidate duplicate User type definitions"
status: ready
priority: medium
created: 2026-01-30
updated: 2026-01-30
assignee:
labels: [types, cleanup, code-review]
---

# Consolidate User Type Definitions

## Summary

The `User` interface is defined in 3 separate locations with identical structures, risking type drift if one is updated without the others.

## Background

**Duplicate locations:**
1. `client/hooks/useAuth.ts:6-12`
2. `client/context/AuthContext.tsx:4-10`
3. `shared/types/auth.ts:20-28` (inline in AuthResponse)

All define:
```typescript
interface User {
  id: string;
  username: string;
  displayName?: string;
  dailyCalorieGoal?: number;
  onboardingCompleted?: boolean;
}
```

Similarly, `ScannedItem` is duplicated in:
- `client/screens/HistoryScreen.tsx:30-41`
- `client/screens/ItemDetailScreen.tsx:28-43`
- `shared/schema.ts:162` (exported)

## Acceptance Criteria

- [ ] Create single `User` type in `shared/types/auth.ts`
- [ ] Export and import User type in client code
- [ ] Remove duplicate User interfaces
- [ ] Import `ScannedItem` from `@shared/schema` in screens
- [ ] Remove local ScannedItem interfaces

## Implementation Notes

```typescript
// shared/types/auth.ts
export interface User {
  id: string;
  username: string;
  displayName?: string;
  dailyCalorieGoal?: number;
  onboardingCompleted?: boolean;
}

export interface AuthResponse {
  user: User;
  token: string;
}
```

```typescript
// client/hooks/useAuth.ts
import { User } from "@shared/types/auth";
// Remove local interface
```

```typescript
// client/screens/HistoryScreen.tsx
import { ScannedItem } from "@shared/schema";
// Remove local interface
```

## Dependencies

- None

## Risks

- None - types are already identical

## Updates

### 2026-01-30
- Initial creation from code review
