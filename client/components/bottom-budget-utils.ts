/**
 * Pure bottom-budget math for screens rendered inside a tab stack.
 * Extracted for testability — no React or RN dependencies.
 *
 * The tab bar floats over screen content (it is absolutely positioned and its
 * height already includes the home-indicator inset), so a tab-stack screen must
 * reserve the full tab bar height at the bottom — `insets.bottom` alone leaves
 * ~54pt of content behind the bar. Outside a tab navigator the tab bar height
 * is 0 and the safe-area inset is the right budget.
 */

/** Bottom space a screen must reserve for the tab bar / home indicator. */
export function getBottomBudget(
  tabBarHeight: number,
  insetBottom: number,
): number {
  return Math.max(tabBarHeight, insetBottom);
}

interface InputBarPaddingArgs {
  keyboardVisible: boolean;
  tabBarHeight: number;
  insetBottom: number;
  /** Gap kept under the input when it rests on the keyboard. */
  restingGap: number;
}

/**
 * Bottom padding for an input bar that sits under a KeyboardAvoidingView.
 * Keyboard down: clear the tab bar. Keyboard up: the keyboard covers the tab
 * bar, so only a small resting gap is needed.
 */
export function getInputBarBottomPadding({
  keyboardVisible,
  tabBarHeight,
  insetBottom,
  restingGap,
}: InputBarPaddingArgs): number {
  return keyboardVisible
    ? restingGap
    : getBottomBudget(tabBarHeight, insetBottom);
}
