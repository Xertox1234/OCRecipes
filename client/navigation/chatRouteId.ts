/**
 * `getId` for the Coach stack's Chat screen, extracted for testability (no
 * React or RN dependencies; the same-directory precedent is
 * `coachInitialRoute.ts`): one route instance per conversation, so navigating
 * to a different `conversationId` pushes a fresh Chat instead of re-pointing
 * the current one (which would carry its composer draft and in-flight reply
 * over to the other conversation). The argument is typed structurally rather
 * than importing the navigator module, and `params` is optional so the same
 * function satisfies both the screen's `getId` prop and the router's
 * `routeGetIdList` entry. New-chat shapes (`undefined`, `{ initialMessage }`)
 * carry no id and keep the default reuse-the-current-route behavior.
 */
export function getChatRouteId({
  params,
}: {
  params?: object;
}): string | undefined {
  return params !== undefined && "conversationId" in params
    ? String(params.conversationId)
    : undefined;
}
