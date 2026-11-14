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
import {
  chatConversations,
  coachResponseCache,
  coachWriteCards,
  cookbookCoverCandidates,
  cookbookCoverGenerationLog,
  inspiredSuggestions,
  mealSuggestionCache,
  notificationSends,
  recipeFinderClaims,
  scannedItems,
  suggestionCache,
  userIdentities,
} from "@shared/schema";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const { getUserDataExport } = await import("../export");

let tx: NodePgDatabase<typeof schema>;
let user: schema.User;
let other: schema.User;

const later = () => new Date(Date.now() + 24 * 60 * 60 * 1000);

/** One row in every table privacy audit M6 found missing from the export. */
async function seed(owner: schema.User, tag: string) {
  const [conversation] = await tx
    .insert(chatConversations)
    .values({ userId: owner.id, title: `chat ${tag}` })
    .returning();
  const [scanned] = await tx
    .insert(scannedItems)
    .values({ userId: owner.id, productName: `oats ${tag}` })
    .returning();

  await tx.insert(userIdentities).values({
    userId: owner.id,
    provider: "google",
    providerSubject: `subject-${tag}`,
    email: `${tag}@example.com`,
    appleRefreshTokenEnc: `token-${tag}`,
  });
  await tx.insert(coachWriteCards).values({
    userId: owner.id,
    conversationId: conversation.id,
    kind: "food",
    payload: { name: `card ${tag}` },
  });
  await tx
    .insert(recipeFinderClaims)
    .values({ userId: owner.id, kind: "recipe_generation" });
  await tx.insert(inspiredSuggestions).values({
    userId: owner.id,
    title: `idea ${tag}`,
    description: "a quick dinner",
    totalMinutes: 20,
    expiresAt: later(),
  });
  await tx.insert(suggestionCache).values({
    scannedItemId: scanned.id,
    userId: owner.id,
    profileHash: `profile-${tag}`,
    suggestions: [],
    expiresAt: later(),
  });
  await tx.insert(mealSuggestionCache).values({
    userId: owner.id,
    cacheKey: `meal-key-${tag}`,
    suggestions: [],
    expiresAt: later(),
  });
  await tx.insert(coachResponseCache).values({
    userId: owner.id,
    questionHash: `question-hash-${tag}`,
    question: `question ${tag}`,
    response: `answer ${tag}`,
    expiresAt: later(),
  });
  await tx.insert(cookbookCoverCandidates).values({
    userId: owner.id,
    imageUrl: `https://cdn.example.com/${tag}.jpg`,
    expiresAt: later(),
  });
  await tx.insert(cookbookCoverGenerationLog).values({ userId: owner.id });
  await tx.insert(notificationSends).values({
    userId: owner.id,
    category: "weekly_report",
    sentAt: new Date(),
  });
}

describe("data export — user-linked tables added for privacy audit M6", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
    user = await createTestUser(tx);
    other = await createTestUser(tx);
    await seed(user, "mine");
    await seed(other, "theirs");
  });
  afterEach(async () => {
    await rollbackTestTransaction();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("includes each table's rows for this user only", async () => {
    const data = await getUserDataExport(user.id);

    expect(data.signInConnections).toHaveLength(1);
    expect(data.coachWriteCards).toHaveLength(1);
    expect(data.coachWriteCards[0]).toMatchObject({
      payload: { name: "card mine" },
    });
    expect(data.inspiredSuggestions).toHaveLength(1);
    expect(data.inspiredSuggestions[0]).toMatchObject({ title: "idea mine" });
    expect(data.savedAiAnswers.coach).toHaveLength(1);
    expect(data.savedAiAnswers.coach[0]).toMatchObject({
      question: "question mine",
      response: "answer mine",
    });
    expect(data.savedAiAnswers.mealSuggestions).toHaveLength(1);
    expect(data.savedAiAnswers.scanSuggestions).toHaveLength(1);
    expect(data.cookbookCoverCandidates).toHaveLength(1);
    expect(data.cookbookCoverCandidates[0]).toMatchObject({
      imageUrl: "https://cdn.example.com/mine.jpg",
    });
    expect(data.usageLogs.recipeFinderClaims).toHaveLength(1);
    expect(data.usageLogs.cookbookCoverGenerations).toHaveLength(1);
    expect(data.notificationsSent).toHaveLength(1);
    expect(data.notificationsSent[0]).toMatchObject({
      category: "weekly_report",
    });

    expect(JSON.stringify(data)).not.toContain("theirs");
  });

  it("leaves out credentials and internal lookup keys", async () => {
    const data = await getUserDataExport(user.id);
    const text = JSON.stringify(data);

    expect(data.signInConnections[0]).toMatchObject({
      provider: "google",
      email: "mine@example.com",
    });
    expect(text).not.toContain("token-mine");
    expect(text).not.toContain("subject-mine");
    expect(text).not.toContain("profile-mine");
    expect(text).not.toContain("meal-key-mine");
    expect(text).not.toContain("question-hash-mine");
  });
});
