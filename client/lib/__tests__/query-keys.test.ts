import { QUERY_KEYS, chatMessagesKey, recipeStatsKey } from "../query-keys";

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

describe("recipeStatsKey", () => {
  it("keys a recipe's community stats by id", () => {
    expect(recipeStatsKey(7)).toEqual(["/api/recipes/7/stats"]);
  });

  it("is not a QUERY_KEYS entry, so the stats are never persisted", () => {
    const persisted = new Set<unknown>(
      Object.values(QUERY_KEYS).map((k) => k[0]),
    );
    expect(persisted.has(recipeStatsKey(7)[0])).toBe(false);
  });
});

describe("chatMessagesKey", () => {
  it("keys a conversation's messages by id", () => {
    expect(chatMessagesKey(12)).toEqual([
      "/api/chat/conversations/12/messages",
    ]);
  });

  it("is not a QUERY_KEYS entry, so chat messages are never persisted", () => {
    const persisted = new Set<unknown>(
      Object.values(QUERY_KEYS).map((k) => k[0]),
    );
    expect(persisted.has(chatMessagesKey(12)[0])).toBe(false);
  });
});
