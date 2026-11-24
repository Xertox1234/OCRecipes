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
  deleteChatMessage,
  deleteChatConversation,
} = await import("../chat");
const quotaModule = await import("../chat-quota");
const {
  createFinderUserMessage,
  claimRecipeGeneration,
  claimSpoonacularSearch,
} = quotaModule;

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

afterAll(async () => {
  await closeTestPool();
});

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

  it("the daily limit resets at midnight in the STORED timezone, not UTC", async () => {
    const { users, chatMessages } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const { getDayBounds } = await import("../helpers");
    await getTestTx()
      .update(users)
      .set({ timezone: "Pacific/Kiritimati" })
      .where(eq(users.id, testUser.id));
    const { startOfDay } = getDayBounds(new Date(), "Pacific/Kiritimati");
    const conv = await createChatConversation(testUser.id, "Coach", "coach");
    // A typed row one minute before local midnight = yesterday there.
    await getTestTx()
      .insert(chatMessages)
      .values({
        conversationId: conv.id,
        role: "user",
        content: "old",
        createdAt: new Date(startOfDay.getTime() - 60 * 1000),
      });
    const first = await createFinderUserMessage(conv.id, testUser.id, "a", {
      coachDailyLimit: 1,
    });
    expect(first.status).toBe("created");
    // CONTROL: that row is today, so the limit now holds.
    const second = await createFinderUserMessage(conv.id, testUser.id, "b", {
      coachDailyLimit: 1,
    });
    expect(second.status).toBe("limit_reached");
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

  it("Coach: excludeFinderTaps leaves finder tap rows out of the typed daily limit", async () => {
    const coach = await createChatConversation(testUser.id, "Coach", "coach");
    for (const [i, flowId] of [FLOW_A, FLOW_B].entries()) {
      const r = await createFinderUserMessage(
        coach.id,
        testUser.id,
        `tap ${i}`,
        {
          action: { flowId, type: "offer_yes" },
        },
      );
      expect(r.status).toBe("created");
    }
    // Limit 3: two tap rows + two typed rows (limit − 1 typed).
    for (const text of ["hi", "how am I doing?"]) {
      await createChatMessage(coach.id, testUser.id, "user", text);
    }
    // Without the option (flag off) the taps count: 4 ≥ 3 → rejected.
    expect(
      await createChatMessageWithLimitCheck(
        coach.id,
        testUser.id,
        "one more",
        3,
        "coach",
      ),
    ).toBeNull();
    // With it, only the 2 typed rows count → accepted.
    expect(
      await createChatMessageWithLimitCheck(
        coach.id,
        testUser.id,
        "one more",
        3,
        "coach",
        { excludeFinderTaps: true },
      ),
    ).not.toBeNull();
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

  // Pre-flip item 4: a claim must outlive the row it was taken on — the user
  // can delete a message, or a whole conversation (which cascades its rows).
  describe("a claim survives the user deleting its row", () => {
    const deletions = {
      "the message": (ids: { conversationId: number; messageId: number }) =>
        deleteChatMessage(ids.messageId, testUser.id),
      "the whole conversation": (ids: {
        conversationId: number;
        messageId: number;
      }) => deleteChatConversation(ids.conversationId, testUser.id),
    };
    const claims = {
      Generate: claimRecipeGeneration,
      "Spoonacular search": claimSpoonacularSearch,
    };

    for (const [what, remove] of Object.entries(deletions)) {
      for (const [kind, claim] of Object.entries(claims)) {
        it(`${kind}: deleting ${what} does not hand the slot back`, async () => {
          const coach = await createChatConversation(
            testUser.id,
            "Coach",
            "coach",
          );
          const row = await createChatMessage(
            coach.id,
            testUser.id,
            "user",
            kind,
          );
          expect(await claim(testUser.id, row.id, 1)).toBe(true);
          expect(
            await remove({ conversationId: coach.id, messageId: row.id }),
          ).toBe(true);

          const next = await createChatConversation(
            testUser.id,
            "Coach",
            "coach",
          );
          const again = await createChatMessage(
            next.id,
            testUser.id,
            "user",
            kind,
          );
          expect(await claim(testUser.id, again.id, 1)).toBe(false);
        });
      }
    }

    it("control: a deleted claim-free row never blocked the next claim", async () => {
      const coach = await createChatConversation(testUser.id, "Coach", "coach");
      const row = await createChatMessage(coach.id, testUser.id, "user", "Hi");
      expect(await deleteChatConversation(coach.id, testUser.id)).toBe(true);
      const next = await createChatConversation(testUser.id, "Coach", "coach");
      const again = await createChatMessage(
        next.id,
        testUser.id,
        "user",
        "Generate",
      );
      expect(row.id).not.toBe(again.id);
      expect(await claimRecipeGeneration(testUser.id, again.id, 1)).toBe(true);
    });
  });

  it("claiming the same row twice counts once", async () => {
    const coach = await createChatConversation(testUser.id, "Coach", "coach");
    const row = await createChatMessage(
      coach.id,
      testUser.id,
      "user",
      "Generate",
    );
    expect(await claimRecipeGeneration(testUser.id, row.id, 2)).toBe(true);
    expect(await claimRecipeGeneration(testUser.id, row.id, 2)).toBe(true);
    const other = await createChatMessage(
      coach.id,
      testUser.id,
      "user",
      "Generate",
    );
    expect(await claimRecipeGeneration(testUser.id, other.id, 2)).toBe(true);
  });

  it("the disconnect refund deletes a claimed row, and the cap still holds (#1151 review)", async () => {
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
    // The refund (a plain delete) removes the row …
    expect(await deleteChatMessage(r.message.id, testUser.id)).toBe(true);
    // … and the cap still holds for the next tap.
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

  it("a refunded Generate still counts against the legacy recipe limit", async () => {
    const coach = await createChatConversation(testUser.id, "Coach", "coach");
    const row = await createChatMessage(
      coach.id,
      testUser.id,
      "user",
      "Generate",
    );
    expect(await claimRecipeGeneration(testUser.id, row.id, 1)).toBe(true);
    expect(await deleteChatMessage(row.id, testUser.id)).toBe(true);
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

  it("control: the refund never deletes another user's row", async () => {
    const coach = await createChatConversation(testUser.id, "Coach", "coach");
    const row = await createChatMessage(coach.id, testUser.id, "user", "Hi");
    const other = await createTestUser(tx);
    expect(await deleteChatMessage(row.id, other.id)).toBe(false);
    expect(await deleteChatMessage(row.id, testUser.id)).toBe(true);
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

// Coach chat audit 2026-11-24 (H4, M48): the daily message and generation
// limits were counts of live rows, so deleting a message or its conversation
// handed the slot back. Each quota-checked message now records a claim, as
// the finder's Generate already did.
describe("chat quota — a deleted message does not hand its slot back", () => {
  const { refundUndeliveredMessage, REMIX_REFINEMENTS_PER_GENERATION } =
    quotaModule;

  beforeEach(async () => {
    tx = await setupTestTransaction();
    testUser = await createTestUser(tx);
  });

  afterEach(async () => {
    await rollbackTestTransaction();
  });

  const send = (
    conversationId: number,
    type: "coach" | "recipe" | "remix",
    limit = 1,
  ) =>
    createChatMessageWithLimitCheck(
      conversationId,
      testUser.id,
      "hello",
      limit,
      type,
    );

  const deletions = {
    "the message": (ids: { conversationId: number; messageId: number }) =>
      deleteChatMessage(ids.messageId, testUser.id),
    "the whole conversation": (ids: {
      conversationId: number;
      messageId: number;
    }) => deleteChatConversation(ids.conversationId, testUser.id),
  };

  for (const type of ["coach", "recipe", "remix"] as const) {
    for (const [what, remove] of Object.entries(deletions)) {
      it(`${type}: deleting ${what} does not hand the slot back`, async () => {
        const conv = await createChatConversation(testUser.id, "A", type);
        const first = await send(conv.id, type);
        expect(first).not.toBeNull();
        expect(
          await remove({ conversationId: conv.id, messageId: first!.id }),
        ).toBe(true);

        const next = await createChatConversation(testUser.id, "B", type);
        expect(await send(next.id, type)).toBeNull();
      });
    }

    it(`${type}: control — the limit holds without any delete`, async () => {
      const conv = await createChatConversation(testUser.id, "A", type);
      expect(await send(conv.id, type)).not.toBeNull();
      const next = await createChatConversation(testUser.id, "B", type);
      expect(await send(next.id, type)).toBeNull();
    });
  }

  it("the disconnect refund hands the slot back, and removes the row", async () => {
    const conv = await createChatConversation(testUser.id, "Coach", "coach");
    const first = await send(conv.id, "coach");
    expect(await refundUndeliveredMessage(first!.id, testUser.id)).toBe(true);
    expect(await send(conv.id, "coach")).not.toBeNull();
  });

  it("the refund never touches another user's row", async () => {
    const conv = await createChatConversation(testUser.id, "Coach", "coach");
    const first = await send(conv.id, "coach");
    const other = await createTestUser(tx);
    expect(await refundUndeliveredMessage(first!.id, other.id)).toBe(false);
    // Still counted for its owner.
    expect(await send(conv.id, "coach")).toBeNull();
  });

  it("the refund keeps a Generate claim on the row (#1151)", async () => {
    const conv = await createChatConversation(testUser.id, "Coach", "coach");
    const first = await send(conv.id, "coach", 5);
    expect(await claimRecipeGeneration(testUser.id, first!.id, 1)).toBe(true);
    expect(await refundUndeliveredMessage(first!.id, testUser.id)).toBe(true);
    const again = await send(conv.id, "coach", 5);
    expect(await claimRecipeGeneration(testUser.id, again!.id, 1)).toBe(false);
  });

  it("a remix conversation created on an earlier day still counts on the day of its first message (M48)", async () => {
    const { chatConversations } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const old = await createChatConversation(testUser.id, "Old", "remix");
    await getTestTx()
      .update(chatConversations)
      .set({ createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) })
      .where(eq(chatConversations.id, old.id));
    expect(await send(old.id, "remix")).not.toBeNull();

    const fresh = await createChatConversation(testUser.id, "New", "remix");
    expect(await send(fresh.id, "remix")).toBeNull();
  });

  it("remix refinements are free up to a daily bound, then refused (M48)", async () => {
    const conv = await createChatConversation(testUser.id, "Remix", "remix");
    expect(await send(conv.id, "remix")).not.toBeNull();
    for (let i = 0; i < REMIX_REFINEMENTS_PER_GENERATION; i++) {
      expect(
        await send(conv.id, "remix"),
        `refinement ${i + 1}`,
      ).not.toBeNull();
    }
    expect(await send(conv.id, "remix")).toBeNull();
  });
});
