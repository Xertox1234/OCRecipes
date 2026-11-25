/**
 * The whole nudge against a real database: only the push itself is faked.
 * Proves the rules that live in SQL — the day's one slot, the expiry window,
 * the conversation written in one piece.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";
import {
  setupTestTransaction,
  rollbackTestTransaction,
  closeTestPool,
  createTestUser,
  getTestTx,
} from "../../../../test/db-test-utils";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

vi.mock("../../../db", () => ({
  get db() {
    return getTestTx();
  },
}));
const sendPushToUser = vi.fn();
vi.mock("../../push-notifications", () => ({
  sendPushToUser: (...args: unknown[]) => sendPushToUser(...args),
}));

const { nudgeAboutExpiringPantry } = await import("../pantry-expiry");

const NOW = new Date("2026-11-25T16:00:00Z");
const HOUR = 60 * 60 * 1000;

let tx: NodePgDatabase<typeof schema>;
let user: schema.User;

const conversations = () =>
  tx
    .select()
    .from(schema.chatConversations)
    .where(eq(schema.chatConversations.userId, user.id));

describe("nudgeAboutExpiringPantry (real database)", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
    user = await createTestUser(tx, { subscriptionTier: "premium" });
    await tx.insert(schema.pantryItems).values([
      {
        userId: user.id,
        name: "Spinach",
        expiresAt: new Date(NOW.getTime() + 5 * HOUR),
      },
      {
        userId: user.id,
        name: "Rice",
        expiresAt: new Date(NOW.getTime() + 90 * 24 * HOUR),
      },
    ]);
    sendPushToUser.mockReset().mockResolvedValue(true);
  });
  afterEach(async () => {
    await rollbackTestTransaction();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("writes the conversation, pushes a link to it, and will not send twice that day", async () => {
    expect(await nudgeAboutExpiringPantry(user.id, NOW, "UTC")).toBe("sent");

    const [conversation] = await conversations();
    expect(conversation.title).toBe("Expiring soon");
    const messages = await tx
      .select()
      .from(schema.chatMessages)
      .where(eq(schema.chatMessages.conversationId, conversation.id));
    expect(messages.map((m) => [m.role, m.content])).toEqual([
      [
        "assistant",
        "Your spinach expires within a day. Want an idea for using it up?",
      ],
    ]);
    expect(sendPushToUser).toHaveBeenCalledWith(
      user.id,
      "Use it before it goes",
      "Your spinach expires within a day.",
      {
        url: `ocrecipes://chat/${conversation.id}`,
        type: "pantry-expiring",
        conversationId: conversation.id,
      },
    );

    // Three hours later, still the same UTC day: the slot is gone.
    expect(
      await nudgeAboutExpiringPantry(
        user.id,
        new Date(NOW.getTime() + 3 * HOUR),
        "UTC",
      ),
    ).toBe("skipped-daily-cap");
    expect(await conversations()).toHaveLength(1);
    expect(sendPushToUser).toHaveBeenCalledTimes(1);
  });

  it("leaves no conversation behind when the push reaches no device", async () => {
    sendPushToUser.mockResolvedValue(false);
    expect(await nudgeAboutExpiringPantry(user.id, NOW, "UTC")).toBe(
      "not-delivered",
    );
    expect(await conversations()).toHaveLength(0);
  });

  it("says nothing the next day about the same item", async () => {
    await nudgeAboutExpiringPantry(user.id, NOW, "UTC");
    expect(
      await nudgeAboutExpiringPantry(
        user.id,
        new Date(NOW.getTime() + 24 * HOUR),
        "UTC",
      ),
    ).toBe("skipped-nothing-expiring");
  });

  it("does nothing for a free user", async () => {
    const free = await createTestUser(tx);
    await tx.insert(schema.pantryItems).values({
      userId: free.id,
      name: "Milk",
      expiresAt: new Date(NOW.getTime() + HOUR),
    });
    expect(await nudgeAboutExpiringPantry(free.id, NOW, "UTC")).toBe(
      "skipped-no-pantry",
    );
    expect(sendPushToUser).not.toHaveBeenCalled();
  });
});
