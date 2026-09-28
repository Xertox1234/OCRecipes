import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import {
  setupTestTransaction,
  rollbackTestTransaction,
  closeTestPool,
  createTestUser,
  getTestTx,
} from "../../../test/db-test-utils";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@shared/schema";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const {
  createChatConversation,
  createChatMessage,
  createChatMessageWithLimitCheck,
} = await import("../chat");
const {
  createFinderUserMessage,
  claimRecipeGeneration,
  claimSpoonacularSearch,
  deleteUnclaimedChatMessage,
} = await import("../chat-quota");

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

// Recipe finder quota (spec §6, R2).
describe("chat quota — recipe finder generation quota and Spoonacular cap", () => {
  const FLOW_A = "11111111-1111-4111-8111-111111111111";
  const FLOW_B = "22222222-2222-4222-8222-222222222222";

  beforeEach(async () => {
    tx = await setupTestTransaction();
    testUser = await createTestUser(tx);
  });

  afterEach(async () => {
    await rollbackTestTransaction();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it("finder-step rows in a recipe conversation never count as generations", async () => {
    const conv = await createChatConversation(testUser.id, "Recipe", "recipe");
    for (const text of ["Mediterranean", "None of these", "Under 20 minutes"]) {
      const r = await createFinderUserMessage(conv.id, testUser.id, text);
      expect(r.status).toBe("created");
    }
    // Limit 1: the three finder rows must not have used it up.
    const legacy = await createChatMessageWithLimitCheck(
      conv.id,
      testUser.id,
      "Make pasta",
      1,
      "recipe",
    );
    expect(legacy).not.toBeNull();
  });

  it("a claimed Generate counts, and shares the limit with the legacy path", async () => {
    const conv = await createChatConversation(testUser.id, "Recipe", "recipe");
    const r1 = await createFinderUserMessage(conv.id, testUser.id, "Generate", {
      action: { flowId: FLOW_A, type: "generate" },
    });
    if (r1.status !== "created") throw new Error("expected created");
    expect(await claimRecipeGeneration(testUser.id, r1.message.id, 1)).toBe(
      true,
    );

    const r2 = await createFinderUserMessage(conv.id, testUser.id, "Generate", {
      action: { flowId: FLOW_B, type: "generate" },
    });
    if (r2.status !== "created") throw new Error("expected created");
    expect(await claimRecipeGeneration(testUser.id, r2.message.id, 1)).toBe(
      false,
    );
    expect(
      await createChatMessageWithLimitCheck(
        conv.id,
        testUser.id,
        "Make pasta",
        1,
        "recipe",
      ),
    ).toBeNull();
  });

  it("a Coach Generate counts against the same 20/day recipe limit", async () => {
    const coach = await createChatConversation(testUser.id, "Coach", "coach");
    const row = await createChatMessage(
      coach.id,
      testUser.id,
      "user",
      "Generate",
    );
    expect(await claimRecipeGeneration(testUser.id, row.id, 1)).toBe(true);
    const recipeConv = await createChatConversation(
      testUser.id,
      "Recipe",
      "recipe",
    );
    expect(
      await createChatMessageWithLimitCheck(
        recipeConv.id,
        testUser.id,
        "Make pasta",
        1,
        "recipe",
      ),
    ).toBeNull();
  });

  it("control: without a claim, a Coach row does not touch the recipe limit", async () => {
    const coach = await createChatConversation(testUser.id, "Coach", "coach");
    await createChatMessage(coach.id, testUser.id, "user", "How am I doing?");
    const recipeConv = await createChatConversation(
      testUser.id,
      "Recipe",
      "recipe",
    );
    expect(
      await createChatMessageWithLimitCheck(
        recipeConv.id,
        testUser.id,
        "Make pasta",
        1,
        "recipe",
      ),
    ).not.toBeNull();
  });

  it("a repeated action on the same flowId is a duplicate (double tap)", async () => {
    const conv = await createChatConversation(testUser.id, "Recipe", "recipe");
    const first = await createFinderUserMessage(
      conv.id,
      testUser.id,
      "Generate",
      {
        action: { flowId: FLOW_A, type: "generate" },
      },
    );
    const second = await createFinderUserMessage(
      conv.id,
      testUser.id,
      "Generate",
      { action: { flowId: FLOW_A, type: "generate" } },
    );
    expect(first.status).toBe("created");
    expect(second).toEqual({ status: "duplicate" });
    const other = await createFinderUserMessage(
      conv.id,
      testUser.id,
      "None of these",
      { action: { flowId: FLOW_B, type: "none_of_these" } },
    );
    expect(other.status).toBe("created");
  });

  it("enforces the Coach Pro message limit for Coach button taps", async () => {
    const coach = await createChatConversation(testUser.id, "Coach", "coach");
    await createChatMessage(coach.id, testUser.id, "user", "hi");
    const r = await createFinderUserMessage(coach.id, testUser.id, "Generate", {
      action: { flowId: FLOW_A, type: "generate" },
      coachDailyLimit: 1,
    });
    expect(r).toEqual({ status: "limit_reached" });
  });

  it("caps Spoonacular searches per user per day", async () => {
    const conv = await createChatConversation(testUser.id, "Recipe", "recipe");
    const claims: boolean[] = [];
    for (const flowId of [
      FLOW_A,
      FLOW_B,
      "33333333-3333-4333-8333-333333333333",
    ]) {
      const r = await createFinderUserMessage(
        conv.id,
        testUser.id,
        "Search Spoonacular",
        { action: { flowId, type: "search_online" } },
      );
      if (r.status !== "created") throw new Error("expected created");
      claims.push(await claimSpoonacularSearch(testUser.id, r.message.id, 2));
    }
    expect(claims).toEqual([true, true, false]);
  });

  it("another user's searches do not count toward this user's cap", async () => {
    const other = await createTestUser(tx);
    const otherConv = await createChatConversation(
      other.id,
      "Recipe",
      "recipe",
    );
    const o = await createFinderUserMessage(
      otherConv.id,
      other.id,
      "Search Spoonacular",
      { action: { flowId: FLOW_A, type: "search_online" } },
    );
    if (o.status !== "created") throw new Error("expected created");
    expect(await claimSpoonacularSearch(other.id, o.message.id, 1)).toBe(true);

    const conv = await createChatConversation(testUser.id, "Recipe", "recipe");
    const r = await createFinderUserMessage(
      conv.id,
      testUser.id,
      "Search Spoonacular",
      { action: { flowId: FLOW_B, type: "search_online" } },
    );
    if (r.status !== "created") throw new Error("expected created");
    expect(await claimSpoonacularSearch(testUser.id, r.message.id, 1)).toBe(
      true,
    );
  });

  it("cannot claim another user's message", async () => {
    const other = await createTestUser(tx);
    const otherConv = await createChatConversation(
      other.id,
      "Recipe",
      "recipe",
    );
    const o = await createFinderUserMessage(otherConv.id, other.id, "Generate");
    if (o.status !== "created") throw new Error("expected created");
    expect(await claimRecipeGeneration(testUser.id, o.message.id, 20)).toBe(
      false,
    );
  });

  it("a disconnect refund never deletes a row that holds a paid claim (#1151 review)", async () => {
    const conv = await createChatConversation(testUser.id, "Coach", "coach");
    const r = await createFinderUserMessage(
      conv.id,
      testUser.id,
      "Search Spoonacular",
      { action: { flowId: FLOW_A, type: "search_online" } },
    );
    if (r.status !== "created") throw new Error("expected created");
    expect(await claimSpoonacularSearch(testUser.id, r.message.id, 1)).toBe(
      true,
    );
    // The refund refuses the claimed row …
    expect(await deleteUnclaimedChatMessage(r.message.id, testUser.id)).toBe(
      false,
    );
    // … so the cap still holds for the next tap.
    const next = await createFinderUserMessage(
      conv.id,
      testUser.id,
      "Search Spoonacular",
      { action: { flowId: FLOW_B, type: "search_online" } },
    );
    if (next.status !== "created") throw new Error("expected created");
    expect(await claimSpoonacularSearch(testUser.id, next.message.id, 1)).toBe(
      false,
    );
  });

  it("a claimed Generate row also survives the refund", async () => {
    const coach = await createChatConversation(testUser.id, "Coach", "coach");
    const row = await createChatMessage(
      coach.id,
      testUser.id,
      "user",
      "Generate",
    );
    expect(await claimRecipeGeneration(testUser.id, row.id, 1)).toBe(true);
    expect(await deleteUnclaimedChatMessage(row.id, testUser.id)).toBe(false);
    const recipeConv = await createChatConversation(
      testUser.id,
      "Recipe",
      "recipe",
    );
    expect(
      await createChatMessageWithLimitCheck(
        recipeConv.id,
        testUser.id,
        "Make pasta",
        1,
        "recipe",
      ),
    ).toBeNull();
  });

  it("control: an unclaimed row is refunded, and never another user's", async () => {
    const coach = await createChatConversation(testUser.id, "Coach", "coach");
    const row = await createChatMessage(coach.id, testUser.id, "user", "Hi");
    const other = await createTestUser(tx);
    expect(await deleteUnclaimedChatMessage(row.id, other.id)).toBe(false);
    expect(await deleteUnclaimedChatMessage(row.id, testUser.id)).toBe(true);
  });

  it("rejects a conversation the user does not own", async () => {
    const other = await createTestUser(tx);
    const otherConv = await createChatConversation(
      other.id,
      "Recipe",
      "recipe",
    );
    await expect(
      createFinderUserMessage(otherConv.id, testUser.id, "x"),
    ).rejects.toThrow("Conversation not found");
  });
});
