/**
 * Runs a Coach-Pro-only fetch, or resolves to the tier's empty value without
 * calling it. Replaces `isCoachPro ? storage.x() : Promise.resolve([] as ...)`.
 */
export function proOnly<T>(
  isCoachPro: boolean,
  fetch: () => Promise<T>,
  empty: T,
): Promise<T> {
  return isCoachPro ? fetch() : Promise.resolve(empty);
}
