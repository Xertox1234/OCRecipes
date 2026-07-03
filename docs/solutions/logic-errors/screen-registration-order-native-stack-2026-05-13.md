---
title: Native stack registration order controls navigation direction
track: bug
category: logic-errors
module: client
severity: medium
tags: [react-navigation, native-stack, navigation, screen-registration]
symptoms: [navigate() to a sibling screen animates as a pop instead of a push, Forward navigation has no back button, Transition animation plays in reverse]
applies_to: [client/navigation/*StackNavigator.tsx]
created: '2026-03-24'
---

# Native stack registration order controls navigation direction

## Problem

`CookbookCreate` was registered before `CookbookList` in the same native stack navigator. When `navigation.navigate("CookbookCreate")` fired from `CookbookList`, the navigator interpreted the move as a "pop back" — no back button appeared and the transition animated in reverse, even though the destination screen was functionally correct.

## Symptoms

- Forward navigation animates from left to right (pop) instead of right to left (push)
- Destination screen has no back button
- Gesture-back goes to the wrong screen

## Root Cause

React Navigation's native stack uses screen registration order to determine "depth." A screen registered earlier is treated as further up the back stack. Calling `navigate(target)` where `target` has a lower index than the current screen reads as "go back to an earlier screen."

```typescript
// Bad — Create registered before List
<Stack.Screen name="CookbookCreate" component={CookbookCreateScreen} />
<Stack.Screen name="CookbookList" component={CookbookListScreen} />
```

## Solution

Register screens in the order they will be navigated to (parent → child, list → detail, list → create):

```typescript
// Good — screens in navigation flow order
<Stack.Screen name="CookbookList" component={CookbookListScreen} />
<Stack.Screen name="CookbookCreate" component={CookbookCreateScreen} />
```

## Prevention

- When navigation "feels backwards," check registration order before debugging animations or gestures.
- This only affects native stack navigators; JS stack navigators ignore registration order for direction.
- Document the canonical flow with a comment at the top of each stack file.

## Related Files

- `client/navigation/MealPlanStackNavigator.tsx` — cookbook screen registration

## See Also

- [React Navigation native-stack docs](https://reactnavigation.org/docs/native-stack-navigator)
