---
title: "Config-driven screen rendering with centralized navigateAction()"
track: knowledge
category: design-patterns
tags: [react-native, configuration, navigation, dry, dashboard]
module: client
applies_to:
  [
    "client/components/home/**/*.ts",
    "client/screens/**/*.tsx",
    "client/components/**/*.tsx",
  ]
created: 2026-05-13
---

# Config-driven screen rendering with centralized navigateAction()

## When this applies

When a screen displays a list of actions, items, or sections that map to navigation targets, define the items as a typed config array in a separate file and render by mapping over the array. Keep navigation logic in a single `navigateAction()` function co-located with the config so any consumer can reuse the same targets.

## Examples

```typescript
// client/components/home/action-config.ts

export interface HomeAction {
  id: string;
  group: "scanning" | "nutrition" | "recipes" | "planning";
  icon: string;
  label: string;
  subtitle?: string;
  premium?: boolean;
}

/** Single source of truth for navigation targets */
export function navigateAction(
  action: HomeAction,
  navigation: HomeScreenNavigationProp,
) {
  switch (action.id) {
    case "scan-barcode":
      navigation.navigate("Scan");
      break;
    case "quick-log":
      navigation.navigate("QuickLog");
      break;
    // ... all other actions
  }
}

export const HOME_ACTIONS: HomeAction[] = [
  {
    id: "scan-barcode",
    group: "scanning",
    icon: "maximize",
    label: "Scan Barcode",
  },
  { id: "quick-log", group: "nutrition", icon: "edit-3", label: "Quick Log" },
  {
    id: "search-recipes",
    group: "recipes",
    icon: "search",
    label: "Search Recipes",
    subtitle: "Browse the recipe catalog",
  },
  // ... all 16 actions
];

export function getActionsByGroup(group: HomeAction["group"]): HomeAction[] {
  return HOME_ACTIONS.filter((a) => a.group === group);
}
```

```typescript
// client/screens/HomeScreen.tsx — renders sections by mapping over config

const SECTIONS: { key: SectionKey; title: string; delay: number }[] = [
  { key: "scanning", title: "Camera & Scanning", delay: 150 },
  { key: "nutrition", title: "Nutrition & Health", delay: 200 },
  { key: "recipes", title: "Recipes", delay: 250 },
  { key: "planning", title: "Planning", delay: 300 },
];

// In JSX — no per-section component duplication
{SECTIONS.map(({ key, title, delay }) => (
  <Animated.View key={key} entering={reducedMotion ? undefined : FadeInDown.delay(delay).duration(400)}>
    <CollapsibleSection title={title} isExpanded={sections[key]} onToggle={() => toggleSection(key)}>
      {getActionsByGroup(key).map((action) => (
        <ActionRow
          key={action.id}
          icon={action.icon}
          label={action.label}
          subtitle={action.subtitle}
          onPress={() => handleActionPress(action)}
          isLocked={action.premium && !isPremium}
        />
      ))}
    </CollapsibleSection>
  </Animated.View>
))}
```

```typescript
// client/components/ScanFAB.tsx — reuses the same config + navigateAction

import {
  getActionsByGroup,
  navigateAction,
} from "@/components/home/action-config";

const scanningActions = getActionsByGroup("scanning");

const speedDialActions = useMemo(
  () =>
    scanningActions.map((action) => ({
      icon: action.icon,
      label: action.label,
      onPress: () => {
        closeMenu();
        navigateAction(action, navigation);
      },
    })),
  [closeMenu, haptics, navigation],
);
```

## Why

**Key elements:**

1. **Config array is the single source of truth** — adding a new action is one object in the array + one case in `navigateAction()`. No template changes needed.
2. **`navigateAction()` centralizes all navigation** — both HomeScreen and ScanFAB call it, preventing divergent navigation targets for the same action.
3. **Group filtering** — `getActionsByGroup()` lets different consumers show subsets without duplicating the list.
4. **Optional props drive visual variants** — `subtitle` presence switches ActionRow from plain row to card style, avoiding a second component.
5. **Section metadata as config** — the `SECTIONS` array in HomeScreen defines section keys, titles, and animation delays, eliminating per-section JSX blocks.

## Exceptions

When to use:

- Screens with repeated action items, settings rows, or menu entries that navigate to different destinations
- When multiple UI surfaces (screen, FAB, drawer) need to share the same set of navigation targets
- Hub/dashboard screens where the item list is likely to grow

When NOT to use:

- Screens with 2-3 hardcoded actions that are unlikely to change (config overhead exceeds benefit)
- Highly heterogeneous layouts where each item has unique rendering logic that cannot be parameterized

## Related Files

- `client/components/home/action-config.ts` — config array + `navigateAction()`
- `client/screens/HomeScreen.tsx` — config-driven section rendering
- `client/components/ScanFAB.tsx` — reuses config for speed dial menu

## See Also

- [Typed navigation dispatch from AI-generated actions](typed-navigation-dispatch-ai-actions-2026-05-13.md)
- [Progressive disclosure via usage counting](progressive-disclosure-usage-counting-2026-05-13.md)
