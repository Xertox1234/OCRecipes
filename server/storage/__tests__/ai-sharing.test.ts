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
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { AI_SHARING_VERSION } from "@shared/lib/ai-sharing";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const { getAiSharingStatus, isAiSharingAllowed, setAiSharing } = await import(
  "../ai-sharing"
);

let tx: NodePgDatabase<typeof schema>;
let user: schema.User;

async function row() {
  const [r] = await tx.select().from(users).where(eq(users.id, user.id));
  return r;
}

// Privacy audit H3 — the record behind "ask first, no AI call on Not now".
describe("AI-sharing permission storage", () => {
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

  it("a new account has not been asked and is not allowed", async () => {
    expect(await getAiSharingStatus(user.id)).toEqual({
      allowed: false,
      answered: false,
    });
    expect(await isAiSharingAllowed(user.id)).toBe(false);
  });

  it("allowing stamps the time and the disclosure version", async () => {
    const status = await setAiSharing(user.id, true);

    expect(status).toEqual({ allowed: true, answered: true });
    expect(await isAiSharingAllowed(user.id)).toBe(true);
    const r = await row();
    expect(r.aiSharingAllowedAt).toBeInstanceOf(Date);
    expect(r.aiSharingVersion).toBe(AI_SHARING_VERSION);
    expect(r.aiSharingHistory).toEqual([
      { event: "granted", at: expect.any(String), version: AI_SHARING_VERSION },
    ]);
  });

  it("allowing twice keeps the first record", async () => {
    await setAiSharing(user.id, true);
    const first = await row();
    await setAiSharing(user.id, true);
    const second = await row();

    expect(second.aiSharingAllowedAt).toEqual(first.aiSharingAllowedAt);
    expect(second.aiSharingHistory).toHaveLength(1);
  });

  it('"Not now" before any yes is recorded as declined', async () => {
    const status = await setAiSharing(user.id, false);

    expect(status).toEqual({ allowed: false, answered: true });
    expect((await row()).aiSharingHistory).toEqual([
      { event: "declined", at: expect.any(String) },
    ]);
  });

  it("turning it off clears the permission and keeps the history", async () => {
    await setAiSharing(user.id, true);
    const status = await setAiSharing(user.id, false);

    expect(status).toEqual({ allowed: false, answered: true });
    const r = await row();
    expect(r.aiSharingAllowedAt).toBeNull();
    expect(r.aiSharingVersion).toBeNull();
    expect(r.aiSharingHistory.map((e) => e.event)).toEqual([
      "granted",
      "withdrawn",
    ]);
  });

  it("an unknown user is not allowed", async () => {
    const missing = "00000000-0000-0000-0000-000000000000";
    expect(await isAiSharingAllowed(missing)).toBe(false);
    expect(await setAiSharing(missing, true)).toBeUndefined();
  });
});
