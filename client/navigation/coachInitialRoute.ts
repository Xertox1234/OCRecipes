/**
 * The Coach tab's landing-screen gate, extracted for testability (no React
 * or RN dependencies): initialRouteName is evaluated once at navigator mount,
 * so the decision itself is unit-tested here rather than through a full
 * navigator render. The literal union return keeps the call site typed
 * against ChatStackParamList without importing the navigator module.
 */
export function coachInitialRoute(
  isCoachPro: boolean,
): "CoachPro" | "ChatList" {
  return isCoachPro ? "CoachPro" : "ChatList";
}
