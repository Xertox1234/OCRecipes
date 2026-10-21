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
import { pushTokens, users, type User } from "@shared/schema";
import { eq } from "drizzle-orm";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const { upsertPushToken, getPushTokensForUser } = await import(
  "../push-tokens"
);
const { completePasswordReset } = await import("../password-reset");
const { enableEmailMfa, issueMfaEmailCode } = await import("../mfa-email");
const { disableMfa } = await import("../mfa");
const { changePassword } = await import("../password-change");
const { incrementTokenVersion } = await import("../users");

// Every session ending on the server must also stop pushes to the phones that
// held those sessions — the client can't send its own DELETE once its token
// is dead (ultrareview of #1371, finding 2). A caller that stays signed in
// gets a new session and re-registers its own token (establishSession).
describe("a token-version bump drops the user's push tokens", () => {
  let me: User;
  let other: User;

  beforeEach(async () => {
    await setupTestTransaction();
    me = await createTestUser(getTestTx());
    other = await createTestUser(getTestTx());
    await upsertPushToken(me.id, "ExponentPushToken[me-ios]", "ios");
    await upsertPushToken(me.id, "ExponentPushToken[me-android]", "android");
    await upsertPushToken(other.id, "ExponentPushToken[other]", "ios");
  });
  afterEach(async () => {
    await rollbackTestTransaction();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  async function expectMineGoneOthersKept() {
    expect(await getPushTokensForUser(me.id)).toEqual([]);
    expect((await getPushTokensForUser(other.id)).map((t) => t.token)).toEqual([
      "ExponentPushToken[other]",
    ]);
  }

  it("completePasswordReset", async () => {
    await getTestTx()
      .update(users)
      .set({ resetCodeHash: "rh" })
      .where(eq(users.id, me.id));
    expect(await completePasswordReset(me.id, "rh", "new-hash")).toBe(true);
    await expectMineGoneOthersKept();
  });

  it("enableEmailMfa", async () => {
    await issueMfaEmailCode(me.id, "h1");
    expect(await enableEmailMfa(me.id, "h1")).toBe(me.tokenVersion + 1);
    await expectMineGoneOthersKept();
  });

  it("disableMfa", async () => {
    expect(await disableMfa(me.id)).toBe(me.tokenVersion + 1);
    await expectMineGoneOthersKept();
  });

  it("changePassword", async () => {
    const r = await changePassword({
      userId: me.id,
      expectedTokenVersion: me.tokenVersion,
      newPasswordHash: "new-hash",
    });
    expect(r).toEqual({ ok: true, tokenVersion: me.tokenVersion + 1 });
    await expectMineGoneOthersKept();
  });

  it("incrementTokenVersion (sign-out)", async () => {
    expect((await incrementTokenVersion(me.id))?.tokenVersion).toBe(
      me.tokenVersion + 1,
    );
    await expectMineGoneOthersKept();
  });

  it("a refused bump keeps the tokens (control)", async () => {
    const r = await changePassword({
      userId: me.id,
      expectedTokenVersion: me.tokenVersion - 1,
      newPasswordHash: "new-hash",
    });
    expect(r).toEqual({ ok: false, reason: "version_moved" });
    const rows = await getTestTx()
      .select()
      .from(pushTokens)
      .where(eq(pushTokens.userId, me.id));
    expect(rows).toHaveLength(2);
  });
});
