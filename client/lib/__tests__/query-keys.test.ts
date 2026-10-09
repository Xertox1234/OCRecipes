import { QUERY_KEYS } from "../query-keys";

describe("QUERY_KEYS persistence membership", () => {
  // client/App.tsx persists exactly the first element of every QUERY_KEYS
  // entry (PERSISTED_QUERY_KEYS), so being in QUERY_KEYS IS being persisted.
  const persisted = new Set<unknown>(
    Object.values(QUERY_KEYS).map((k) => k[0]),
  );

  it("persists the subscription status so a relaunch after a 429 keeps the last tier", () => {
    expect(QUERY_KEYS.subscriptionStatus).toEqual(["/api/subscription/status"]);
    expect(persisted.has("/api/subscription/status")).toBe(true);
  });
});
