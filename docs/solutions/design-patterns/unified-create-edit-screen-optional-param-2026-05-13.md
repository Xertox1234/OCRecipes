---
title: "Unified create/edit screen via optional ID param"
track: knowledge
category: design-patterns
tags: [react-native, navigation, forms, crud, screens]
module: client
applies_to: ["client/screens/**/*.tsx"]
created: 2026-05-13
---

# Unified create/edit screen via optional ID param

## When this applies

Instead of separate `CreateScreen` and `EditScreen` with 90% duplication, use a single screen with an optional ID param. If the ID is present, fetch and pre-populate the form for editing; if absent, render a blank form for creation.

## Examples

```typescript
// Navigation types
type CookbookFormParams = {
  CookbookForm: { cookbookId?: number };
};

// Single screen handles both create and edit
export default function CookbookFormScreen() {
  const route = useRoute<RouteProp<CookbookFormParams, "CookbookForm">>();
  const cookbookId = route.params?.cookbookId;
  const isEditing = cookbookId != null;

  // Fetch existing data only when editing
  const { data: existing } = useCookbook(cookbookId!, {
    enabled: isEditing,
  });

  // Pre-populate form when data arrives
  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setDescription(existing.description ?? "");
    }
  }, [existing]);

  const handleSave = () => {
    if (isEditing) {
      updateMutation.mutate({ id: cookbookId!, name, description });
    } else {
      createMutation.mutate({ name, description });
    }
  };

  return (
    <View>
      <ThemedText type="title">
        {isEditing ? "Edit Cookbook" : "New Cookbook"}
      </ThemedText>
      {/* Form fields — identical for both modes */}
    </View>
  );
}
```

## Why

Eliminates duplication of form state, validation, layout, and styling. Changes to the form only need to happen in one place. The `isEditing` boolean provides a clear branch point for the few differences (title text, save handler, initial data).

## Exceptions

When to use: any CRUD resource where the create and edit forms share the same fields and layout (cookbooks, recipes, grocery lists, profiles).

When NOT to use: when create and edit have substantially different fields, validation rules, or layouts (e.g., onboarding vs profile editing).

## See Also

- [Route params for mode toggling](route-params-for-mode-toggling-2026-05-13.md)
- [Unified modal with type discriminator](unified-modal-with-type-discriminator-2026-05-13.md)
