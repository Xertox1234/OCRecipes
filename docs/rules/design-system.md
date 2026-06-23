# Design System Rules

- Import `withOpacity` from `@/constants/theme` (scale 0–1) — the deleted `@/lib/colors` version used a 0–100 scale and no longer exists
- Never define color dictionaries with raw hex values in component files — use `useTheme()` tokens; raw hex bypasses dark mode
- `theme.buttonText` is `#FFFFFF` in both light and dark modes — safe for white-on-colored-button text in either mode
- Static `StyleSheet.create` blocks cannot use `useTheme()` values — only computed/dynamic styles can; raw `#FFFFFF` in static camera overlay styles is intentional
- Use `theme.accentSolid` for solid `backgroundColor` fills that carry white text/icons (buttons, FAB, chips, badges, progress fills); use `theme.link` for `color`/`borderColor`/`tintColor` and `withOpacity(theme.link, …)` tints. They share `#B5451C` in light mode but diverge in dark: `link` (`#E07050`) is tuned to read as on-dark TEXT (passes AA) but fails as a white-on-fill background (3.18:1); `accentSolid` (`#B5451C`) is the AA-safe fill in both modes. Applies to fills reached via an intermediate variable too (`const bg = theme.link` → use `accentSolid` if it backs white content).
