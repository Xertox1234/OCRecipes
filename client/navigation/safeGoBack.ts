/**
 * A cold-start deep link can land a modal screen as the only entry in the
 * stack, making `goBack()` a silent no-op. Callers pass a fallback that
 * navigates somewhere sane instead of leaving the user stranded.
 */
export function safeGoBack(
  navigation: { canGoBack(): boolean; goBack(): void },
  fallback: () => void,
): void {
  if (navigation.canGoBack()) {
    navigation.goBack();
  } else {
    fallback();
  }
}
