---
title: "Share a navigator screen's options, not its Stack.Screen registration — two guards parse the registrations from source"
track: knowledge
category: conventions
module: client
tags: [react-native, react-navigation, navigation, dedup, guards, maintainability]
applies_to: [client/navigation/**/*.tsx]
created: '2026-11-05'
---

# Share a navigator screen's options, not its Stack.Screen registration

## Rule

When the same screen is registered in several stacks (the library screens in the Plan, Coach and Profile stacks), deduplicate its **options** — titles, header components — into a shared module (`client/navigation/library-screen-options.tsx`). Keep every `<Stack.Screen name="…" component={…}>` line written out in its own navigator file. Do not move registrations into a helper that returns a `<Stack.Group>` or a fragment.

## Why

React Navigation 7 itself accepts it — `useNavigationBuilder` allows `Screen`, `Group` or `React.Fragment` as navigator children — so a registration helper type-checks and runs. But two repo guards read the registrations as text:

- `scripts/__tests__/navigation-route-reachability.test.ts` parses each navigator for `name="…"` + `component={…}` to prove every route a screen navigates to is registered in that navigator or an ancestor.
- `scripts/__tests__/native-modal-sheet-provider.test.ts` parses `Stack.Screen` blocks for modal screens that need `layout={withSheetProvider}`.

A helper hides the registrations from both: the reachability guard either fails or — worse, once taught to skip the helper — stops checking those routes at all.

## Examples

```tsx
// Each navigator: registration stays, options come from the shared table.
<Stack.Screen
  name="GroceryLists"
  component={GroceryListsScreen}
  options={LIBRARY_SCREEN_OPTIONS.GroceryLists}
/>
<Stack.Screen
  name="CookbookCreate"
  component={CookbookCreateScreen}
  options={cookbookCreateOptions}
/>
```

`cookbookCreateOptions` takes `{ route: { params?: { cookbookId?: number } } }`, which every stack's `RouteProp<…, "CookbookCreate">` satisfies structurally.

## Related Files

- `client/navigation/library-screen-options.tsx`
- `client/navigation/{Chat,Profile,MealPlan}StackNavigator.tsx`
- `scripts/__tests__/navigation-route-reachability.test.ts`, `scripts/__tests__/native-modal-sheet-provider.test.ts`

## See Also

- `docs/solutions/logic-errors/bare-navigate-cannot-descend-into-an-unrelated-nested-navigator-2026-09-29.md`
- `.claude/skills/audit/maintainability-checklist.md` (dedup guard: check for source-parsing guards before extracting)
