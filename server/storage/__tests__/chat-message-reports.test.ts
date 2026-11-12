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
} from "../../../test/db-test-utils";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@shared/schema";
import { chatMessageReports } from "@shared/schema";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const {
  createChatConversation,
  createChatMessage,
  deleteChatConversation,
  reportChatMessage,
} = await import("../chat");
const { getUserDataExport } = await import("../export");

let tx: NodePgDatabase<typeof schema>;
let user: schema.User;

async function replyFor(userId: string, role = "assistant") {
  const conv = await createChatConversation(userId, "Chat");
  const msg = await createChatMessage(conv.id, userId, role, "Eat more fibre.");
  return { conv, msg };
}

describe("chat message reports (privacy audit G7)", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
    user = await createTestUser(tx);
  });
  afterEach(async () => {
    await rollbackTestTransaction();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("saves the reply id, the reason and who reported — nothing else", async () => {
    const { msg } = await replyFor(user.id);

    expect(await reportChatMessage(msg.id, user.id, "harmful")).toBe(true);

    const rows = await tx.select().from(chatMessageReports);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual([
      "createdAt",
      "id",
      "messageId",
      "reason",
      "userId",
    ]);
    expect(rows[0]).toMatchObject({
      messageId: msg.id,
      userId: user.id,
      reason: "harmful",
    });
  });

  it("refuses a reply in someone else's conversation", async () => {
    const other = await createTestUser(tx);
    const { msg } = await replyFor(other.id);

    expect(await reportChatMessage(msg.id, user.id, "harmful")).toBe(false);
    expect(await tx.select().from(chatMessageReports)).toHaveLength(0);
  });

  it("refuses the person's own message — only AI replies can be reported", async () => {
    const { msg } = await replyFor(user.id, "user");

    expect(await reportChatMessage(msg.id, user.id, "other")).toBe(false);
    expect(await tx.select().from(chatMessageReports)).toHaveLength(0);
  });

  it("refuses a reply that does not exist", async () => {
    expect(await reportChatMessage(999999999, user.id, "other")).toBe(false);
  });

  it("reporting the same reply twice keeps one row, with the first reason", async () => {
    const { msg } = await replyFor(user.id);

    expect(await reportChatMessage(msg.id, user.id, "harmful")).toBe(true);
    expect(await reportChatMessage(msg.id, user.id, "offensive")).toBe(true);

    const rows = await tx.select().from(chatMessageReports);
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe("harmful");
  });

  it("the report goes when the reply's conversation is deleted", async () => {
    const { conv, msg } = await replyFor(user.id);
    await reportChatMessage(msg.id, user.id, "inaccurate");

    await deleteChatConversation(conv.id, user.id);

    expect(
      await tx
        .select()
        .from(chatMessageReports)
        .where(eq(chatMessageReports.userId, user.id)),
    ).toHaveLength(0);
  });

  it("the data export lists the person's own reports, not other people's", async () => {
    const other = await createTestUser(tx);
    const mine = await replyFor(user.id);
    const theirs = await replyFor(other.id);
    await reportChatMessage(mine.msg.id, user.id, "inaccurate");
    await reportChatMessage(theirs.msg.id, other.id, "harmful");

    const exp = await getUserDataExport(user.id);

    expect(exp.chatMessageReports).toHaveLength(1);
    expect(exp.chatMessageReports[0]).toMatchObject({
      messageId: mine.msg.id,
      reason: "inaccurate",
    });
    expect(exp.chatMessageReports[0]).not.toHaveProperty("userId");
  });
});
