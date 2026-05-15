---
title: "Add image load error fallbacks across the app"
status: backlog
priority: medium
created: 2026-03-25
updated: 2026-03-25
assignee:
labels: [frontend, polish, launch-readiness]
---

# Add image load error fallbacks across the app

## Summary

Add `onError` handlers with fallback placeholders for images that fail to load (404, timeout, corrupted URLs), preventing broken image states that make the app feel unpolished.

## Background

The frontend handles network errors well via TanStack Query and the offline banner, but image URIs that fail silently show blank/broken states. This is especially visible for recipe photos, user avatars, and scanned item thumbnails.

## Acceptance Criteria

- [ ] Recipe photos show a generic food/recipe icon on load failure
- [ ] User avatars show initials or a generic person icon on load failure
- [ ] Scanned item images show a barcode/food icon on load failure
- [ ] Community recipe images show a placeholder on load failure
- [ ] Fallback placeholders match the app's theme (use `useTheme()` colors)
- [ ] Placeholders are the same dimensions as the expected image (no layout shifts)
- [ ] Works in both light and dark mode

## Implementation Notes

Consider creating a reusable `FallbackImage` component:

```tsx
function FallbackImage({ source, fallback, style, ...props }) {
  const [hasError, setHasError] = useState(false);

  if (hasError || !source?.uri) return fallback;

  return (
    <Image
      source={source}
      onError={() => setHasError(true)}
      style={style}
      {...props}
    />
  );
}
```

Alternatively, add `onError` + local state to existing Image usages directly if a wrapper feels like over-abstraction for the number of cases.

## Dependencies

- None

## Risks

- Need to audit all Image usages across screens to find the ones that load remote URLs
- Some images may use `resolveImageUrl()` — ensure fallback triggers on both network errors and 404s

## Updates

### 2026-03-25

- Initial creation from launch readiness audit
