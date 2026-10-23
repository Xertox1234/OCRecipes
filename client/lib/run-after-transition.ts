/**
 * Runs `task` once the current sheet or screen transition has been handed off,
 * so a close and the next open land in separate turns.
 *
 * Replaces `InteractionManager.runAfterInteractions` (removed in React Native
 * 0.87). Since RN 0.81 that call was already a `setImmediate` stub
 * (`disableInteractionManager` defaults to true), so this keeps the exact
 * timing the app has shipped with.
 *
 * Tests mock this module rather than the global `setImmediate`, which React's
 * scheduler also uses under Node.
 */
export function runAfterTransition(task: () => void): void {
  setImmediate(task);
}
