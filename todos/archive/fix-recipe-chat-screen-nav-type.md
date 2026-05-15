---
title: "Use canonical RecipeChatScreenNavigationProp type"
status: backlog
priority: low
created: 2026-04-02
updated: 2026-04-02
assignee:
labels: [code-quality, recipe-chat]
---

# Use canonical RecipeChatScreenNavigationProp type

## Summary

`RecipeChatScreen.tsx` uses an inline `useNavigation<NativeStackNavigationProp<RootStackParamList>>()` instead of importing the already-exported `RecipeChatScreenNavigationProp` from `client/types/navigation.ts`. The inline version is also looser (no route key).

## Background

The project pattern centralizes all navigation prop types in `client/types/navigation.ts`. `RecipeChatScreenNavigationProp` was created there but the screen file doesn't use it.

Found during code review of PR #33.

## Acceptance Criteria

- [ ] `RecipeChatScreen.tsx` imports and uses `RecipeChatScreenNavigationProp` from `@/types/navigation`

## Implementation Notes

```typescript
// Before
const navigation =
  useNavigation<NativeStackNavigationProp<RootStackParamList>>();

// After
import type { RecipeChatScreenNavigationProp } from "@/types/navigation";
const navigation = useNavigation<RecipeChatScreenNavigationProp>();
```

## Dependencies

- None

## Updates

### 2026-04-02

- Created from PR #33 code review finding (CLAUDE.md 2, Low)
