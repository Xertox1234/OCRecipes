# Design System Rules

- Import `withOpacity` from `@/constants/theme` (scale 0–1) — the deleted `@/lib/colors` version used a 0–100 scale and no longer exists
- Never define color dictionaries with raw hex values in component files — use `useTheme()` tokens; raw hex bypasses dark mode
- `theme.buttonText` is `#FFFFFF` in both light and dark modes — safe for white-on-colored-button text in either mode
- Static `StyleSheet.create` blocks cannot use `useTheme()` values — only computed/dynamic styles can; raw `#FFFFFF` in static camera overlay styles is intentional
