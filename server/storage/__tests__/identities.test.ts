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
import {
  authNonces,
  pendingSocialSignIns,
  userIdentities,
  users,
} from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { sha256Hex } from "../../lib/social-identity/nonce";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const ids = await import("../identities");

const baseTicket = {
  provider: "google" as const,
  providerSubject: "g-sub",
  email: "new@gmail.com",
  isPrivateRelay: false,
  providerAuthoritative: true,
  emailVerified: true,
  displayName: "New Person",
  appleRefreshTokenEnc: null,
};

describe("identities storage", () => {
  beforeEach(async () => {
    await setupTestTransaction();
  });
  afterEach(async () => {
    await rollbackTestTransaction();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  describe("nonces", () => {
    it("issues a nonce whose hash is stored, and consumes it exactly once", async () => {
      const { nonce, nonceHash } = await ids.issueNonce("sign_in", null);
      expect(nonceHash).toBe(sha256Hex(nonce));
      expect(await ids.consumeNonce(nonce, "sign_in", null)).toBe(true);
      expect(await ids.consumeNonce(nonce, "sign_in", null)).toBe(false);
    });

    it("rejects the wrong purpose", async () => {
      const { nonce } = await ids.issueNonce("sign_in", null);
      expect(await ids.consumeNonce(nonce, "reauth", null)).toBe(false);
    });

    it("rejects an expired nonce", async () => {
      const { nonce, nonceHash } = await ids.issueNonce("sign_in", null);
      await getTestTx()
        .update(authNonces)
        .set({ expiresAt: sql`now() - interval '1 minute'` })
        .where(eq(authNonces.nonceHash, nonceHash));
      expect(await ids.consumeNonce(nonce, "sign_in", null)).toBe(false);
    });

    it("binds a reauth nonce to its user", async () => {
      const a = await createTestUser(getTestTx());
      const b = await createTestUser(getTestTx());
      const { nonce } = await ids.issueNonce("reauth", a.id);
      expect(await ids.consumeNonce(nonce, "reauth", b.id)).toBe(false);
      expect(await ids.consumeNonce(nonce, "reauth", a.id)).toBe(true);
    });

    it("accepts a public link nonce from an unauthenticated caller", async () => {
      const { nonce } = await ids.issueNonce("link", null);
      expect(await ids.consumeNonce(nonce, "link", null)).toBe(true);
    });

    it("rejects a user-bound link nonce for another user", async () => {
      const a = await createTestUser(getTestTx());
      const b = await createTestUser(getTestTx());
      const { nonce } = await ids.issueNonce("link", a.id);
      expect(await ids.consumeNonce(nonce, "link", b.id)).toBe(false);
    });

    it("a signed-in caller cannot consume a PUBLIC link nonce (connect needs one bound to them)", async () => {
      const a = await createTestUser(getTestTx());
      const { nonce } = await ids.issueNonce("link", null);
      expect(await ids.consumeNonce(nonce, "link", a.id)).toBe(false);
      // Still usable by the unauthenticated Connect prompt it was minted for.
      expect(await ids.consumeNonce(nonce, "link", null)).toBe(true);
    });

    it("an unauthenticated caller cannot consume a user-bound link nonce", async () => {
      const a = await createTestUser(getTestTx());
      const { nonce } = await ids.issueNonce("link", a.id);
      expect(await ids.consumeNonce(nonce, "link", null)).toBe(false);
      expect(await ids.consumeNonce(nonce, "link", a.id)).toBe(true);
    });
  });

  describe("createUserWithIdentity", () => {
    it("creates a passwordless verified user with the identity and burns the ticket", async () => {
      const ticket = await ids.createPendingSignIn({
        ...baseTicket,
        kind: "sign_up",
        targetUserId: null,
      });
      const user = await ids.createUserWithIdentity(ticket, "new_person");
      expect(user?.password).toBeNull();
      expect(user?.emailVerified).toBe(true);
      expect(user?.displayName).toBe("New Person");
      expect(await ids.findIdentity("google", "g-sub")).toMatchObject({
        userId: user!.id,
      });
      expect(
        await ids.createUserWithIdentity(ticket, "other_name"),
      ).toBeUndefined();
    });

    it("leaves the account unverified when the provider did not verify the email", async () => {
      const ticket = await ids.createPendingSignIn({
        ...baseTicket,
        emailVerified: false,
        providerAuthoritative: false,
        kind: "sign_up",
        targetUserId: null,
      });
      const user = await ids.createUserWithIdentity(
        ticket,
        "unverified_person",
      );
      expect(user?.emailVerified).toBe(false);
    });

    it("keeps the ticket when the username is taken", async () => {
      await createTestUser(getTestTx(), { username: "taken_name" });
      const ticket = await ids.createPendingSignIn({
        ...baseTicket,
        kind: "sign_up",
        targetUserId: null,
      });
      await expect(
        ids.createUserWithIdentity(ticket, "taken_name"),
      ).rejects.toThrow();
      const user = await ids.createUserWithIdentity(ticket, "free_name");
      expect(user?.username).toBe("free_name");
    });

    it("refuses a link-kind ticket", async () => {
      const target = await createTestUser(getTestTx());
      const ticket = await ids.createPendingSignIn({
        ...baseTicket,
        kind: "link",
        targetUserId: target.id,
      });
      expect(
        await ids.createUserWithIdentity(ticket, "someone"),
      ).toBeUndefined();
    });
  });

  describe("sweepExpiredPendingSignIns", () => {
    const apple = (sub: string, token: string | null) => ({
      ...baseTicket,
      provider: "apple" as const,
      providerSubject: sub,
      appleRefreshTokenEnc: token,
      kind: "sign_up" as const,
      targetUserId: null,
    });
    const expire = (ticket: string) =>
      getTestTx()
        .update(pendingSocialSignIns)
        .set({ expiresAt: sql`now() - interval '1 minute'` })
        .where(eq(pendingSocialSignIns.ticketHash, sha256Hex(ticket)));

    it("deletes expired tickets and returns the Apple tokens nobody else holds", async () => {
      const gone = await ids.createPendingSignIn(apple("a-1", "v1:tok-1"));
      const noToken = await ids.createPendingSignIn(apple("a-3", null));
      await expire(gone);
      await expire(noToken);
      // Creating a ticket must not silently drop expired ones (and their tokens).
      const live = await ids.createPendingSignIn(apple("a-2", "v1:tok-2"));

      expect(await ids.sweepExpiredPendingSignIns()).toEqual(["v1:tok-1"]);
      expect(await ids.getPendingSignIn(live, "sign_up")).toBeDefined();
      const left = await getTestTx()
        .select({ h: pendingSocialSignIns.ticketHash })
        .from(pendingSocialSignIns);
      expect(left.map((r) => r.h)).toEqual([sha256Hex(live)]);
    });

    it("keeps the token of an Apple ID that has since been linked", async () => {
      // Revoking any token can end the whole Apple authorization for the app.
      const user = await createTestUser(getTestTx());
      await ids.insertIdentity({
        userId: user.id,
        provider: "apple",
        providerSubject: "a-1",
        email: null,
        isPrivateRelay: false,
        appleRefreshTokenEnc: "v1:stored",
      });
      await expire(await ids.createPendingSignIn(apple("a-1", "v1:old")));
      expect(await ids.sweepExpiredPendingSignIns()).toEqual([]);
    });

    it("keeps the token of an Apple ID that is mid-sign-in on a newer ticket", async () => {
      await expire(await ids.createPendingSignIn(apple("a-1", "v1:old")));
      await ids.createPendingSignIn(apple("a-1", "v1:new"));
      expect(await ids.sweepExpiredPendingSignIns()).toEqual([]);
    });
  });

  describe("link tickets", () => {
    it("allows at most 5 reserved attempts", async () => {
      const target = await createTestUser(getTestTx());
      const ticket = await ids.createPendingSignIn({
        ...baseTicket,
        kind: "link",
        targetUserId: target.id,
      });
      for (let i = 0; i < 5; i++)
        expect(await ids.reservePendingLinkAttempt(ticket)).toBeDefined();
      expect(await ids.reservePendingLinkAttempt(ticket)).toBeUndefined();
    });

    it("completeLinkFromTicket inserts the identity, can verify the email, and burns the ticket", async () => {
      // emailVerified defaults to false.
      const target = await createTestUser(getTestTx());
      const ticket = await ids.createPendingSignIn({
        ...baseTicket,
        kind: "link",
        targetUserId: target.id,
      });
      const identity = await ids.completeLinkFromTicket(ticket, {
        markEmailVerified: true,
      });
      expect(identity).toMatchObject({ userId: target.id, provider: "google" });
      const [row] = await getTestTx()
        .select()
        .from(users)
        .where(eq(users.id, target.id));
      expect(row.emailVerified).toBe(true);
      expect(
        await ids.completeLinkFromTicket(ticket, { markEmailVerified: false }),
      ).toBeUndefined();
    });

    it("completeLinkByTicketHash completes a link from the ticket's hash alone (2FA verify path)", async () => {
      const target = await createTestUser(getTestTx());
      const ticket = await ids.createPendingSignIn({
        ...baseTicket,
        kind: "link",
        targetUserId: target.id,
      });
      const intruder = await createTestUser(getTestTx());
      expect(
        await ids.completeLinkByTicketHash(sha256Hex(ticket), {
          markEmailVerified: false,
          targetUserId: intruder.id,
        }),
      ).toBeUndefined();
      const identity = await ids.completeLinkByTicketHash(sha256Hex(ticket), {
        markEmailVerified: false,
        targetUserId: target.id,
      });
      expect(identity).toMatchObject({ userId: target.id, provider: "google" });
      expect(
        await ids.completeLinkFromTicket(ticket, { markEmailVerified: false }),
      ).toBeUndefined();
    });
  });

  describe("getSignInMethods", () => {
    it("reports password presence and linked providers", async () => {
      const u = await createTestUser(getTestTx(), { password: null });
      await ids.insertIdentity({
        userId: u.id,
        provider: "apple",
        providerSubject: "a",
        email: "x@privaterelay.appleid.com",
        isPrivateRelay: true,
      });
      expect(await ids.getSignInMethods(u.id)).toEqual({
        password: false,
        google: null,
        apple: { email: "x@privaterelay.appleid.com", isPrivateRelay: true },
      });
    });
  });

  it("setAppleRefreshToken and touchIdentity only touch the caller's own identity", async () => {
    const owner = await createTestUser(getTestTx());
    const other = await createTestUser(getTestTx());
    const identity = await ids.insertIdentity({
      userId: owner.id,
      provider: "apple",
      providerSubject: "a-own",
    });
    await ids.setAppleRefreshToken(identity.id, other.id, "v1:x:y:z");
    await getTestTx()
      .update(userIdentities)
      .set({ lastUsedAt: null })
      .where(eq(userIdentities.id, identity.id));
    await ids.touchIdentity(identity.id, other.id);
    let [row] = await ids.listIdentities(owner.id);
    expect(row.appleRefreshTokenEnc).toBeNull();
    expect(row.lastUsedAt).toBeNull();

    await ids.setAppleRefreshToken(identity.id, owner.id, "v1:x:y:z");
    await ids.touchIdentity(identity.id, owner.id);
    [row] = await ids.listIdentities(owner.id);
    expect(row.appleRefreshTokenEnc).toBe("v1:x:y:z");
    expect(row.lastUsedAt).not.toBeNull();
  });

  it("deleteIdentity removes only that provider", async () => {
    const u = await createTestUser(getTestTx());
    await ids.insertIdentity({
      userId: u.id,
      provider: "apple",
      providerSubject: "a",
    });
    await ids.insertIdentity({
      userId: u.id,
      provider: "google",
      providerSubject: "g",
    });
    expect(await ids.deleteIdentity(u.id, "apple")).toMatchObject({
      provider: "apple",
    });
    expect((await ids.listIdentities(u.id)).map((i) => i.provider)).toEqual([
      "google",
    ]);
  });

  it("pending tickets store only the hash", async () => {
    const ticket = await ids.createPendingSignIn({
      ...baseTicket,
      kind: "sign_up",
      targetUserId: null,
    });
    const rows = await getTestTx().select().from(pendingSocialSignIns);
    expect(rows.some((r) => r.ticketHash === sha256Hex(ticket))).toBe(true);
    expect(rows.some((r) => r.ticketHash === ticket)).toBe(false);
  });
});
