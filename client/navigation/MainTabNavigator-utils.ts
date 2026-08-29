export type TabContentA11y = "auto" | "no-hide-descendants";

/**
 * Android TalkBack focus trap for the tab content behind the open scan menu.
 *
 * `ScanFAB` (and the `SpeedDial` it opens) mounts as a SIBLING of the whole
 * `Tab.Navigator`, not inside it, so `SpeedDial`'s `accessibilityViewIsModal`
 * (iOS-only, sibling-scoped) already correctly traps focus on iOS — but has
 * no effect on Android. Mirror that trap here: `"no-hide-descendants"`
 * removes the tab content (screens + tab bar) from the accessibility tree
 * while the menu is open; `"auto"` restores it once the menu closes. No-op
 * on iOS (React Native ignores `importantForAccessibility` there), so the
 * existing iOS trapping via `accessibilityViewIsModal` is unchanged.
 *
 * See docs/solutions/conventions/in-screen-overlay-needs-android-focus-trap-2026-06-22.md
 */
export function getTabContentA11y(menuOpen: boolean): TabContentA11y {
  return menuOpen ? "no-hide-descendants" : "auto";
}
