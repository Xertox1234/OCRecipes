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
import { sql, eq } from "drizzle-orm";
import { hashResetCode } from "../../lib/password-reset-code";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const users_ = await import("../users");
const reset = await import("../password-reset");

const RESET_KEYS = [
  "resetCodeHash",
  "resetCodeExpiresAt",
  "resetCodeAttempts",
  "resetIssueCount",
  "resetIssueWindowStart",
] as const;

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

describe("password reset storage", () => {
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

  describe("SafeUser never carries reset columns", () => {
    it("getUser omits all five reset keys", async () => {
      const u = await users_.getUser(testUser.id);
      for (const key of RESET_KEYS) expect(u).not.toHaveProperty(key);
    });
    it("getUserByEmail omits all five reset keys", async () => {
      const u = await users_.getUserByEmail(testUser.email);
      for (const key of RESET_KEYS) expect(u).not.toHaveProperty(key);
    });
  });

  async function setWindowStart(id: string, ago: string) {
    await tx.execute(
      sql`UPDATE users SET reset_issue_window_start = now() - ${ago}::interval WHERE id = ${id}`,
    );
  }
  async function expireCode(id: string) {
    await tx.execute(
      sql`UPDATE users SET reset_code_expires_at = now() - interval '16 minutes' WHERE id = ${id}`,
    );
  }
  async function row(id: string) {
    const [r] = await tx.select().from(users).where(eq(users.id, id));
    return r;
  }

  describe("getUserByEmailForAuth", () => {
    it("matches case-insensitively, including a legacy mixed-case stored row", async () => {
      const legacy = await createTestUser(tx, {
        email: "Alice.Legacy@Example.com",
      });
      const found = await users_.getUserByEmailForAuth(
        "alice.legacy@example.com",
      );
      expect(found?.id).toBe(legacy.id);
      expect(found?.password).toBeDefined();
    });
    it("never matches a staged pending_email", async () => {
      await users_.stagePendingEmail(testUser.id, "staged-only@example.com");
      expect(
        await users_.getUserByEmailForAuth("staged-only@example.com"),
      ).toBeUndefined();
    });
  });

  describe("issuePasswordResetCode", () => {
    it("stores the hash with a ~15 min DB-clock expiry and zero attempts", async () => {
      const hash = hashResetCode(testUser.id, "123456");
      expect(await reset.issuePasswordResetCode(testUser.id, hash)).toBe(true);
      const r = await row(testUser.id);
      expect(r.resetCodeHash).toBe(hash);
      expect(r.resetCodeAttempts).toBe(0);
      const [{ live }] = (
        await tx.execute(
          sql`SELECT (reset_code_expires_at > now() + interval '14 minutes'
                  AND reset_code_expires_at <= now() + interval '15 minutes') AS live
              FROM users WHERE id = ${testUser.id}`,
        )
      ).rows as { live: boolean }[];
      expect(live).toBe(true);
    });

    it("a new issue overwrites the old code and resets attempts", async () => {
      await reset.issuePasswordResetCode(
        testUser.id,
        hashResetCode(testUser.id, "111111"),
      );
      await reset.reservePasswordResetAttempt(testUser.email);
      const second = hashResetCode(testUser.id, "222222");
      await reset.issuePasswordResetCode(testUser.id, second);
      const r = await row(testUser.id);
      expect(r.resetCodeHash).toBe(second);
      expect(r.resetCodeAttempts).toBe(0);
    });

    it("allows 6 issues per 24 h window and refuses the 7th without storing", async () => {
      for (let i = 0; i < 6; i++) {
        expect(
          await reset.issuePasswordResetCode(
            testUser.id,
            hashResetCode(testUser.id, `00000${i}`),
          ),
        ).toBe(true);
      }
      const seventh = hashResetCode(testUser.id, "999999");
      expect(await reset.issuePasswordResetCode(testUser.id, seventh)).toBe(
        false,
      );
      expect((await row(testUser.id)).resetCodeHash).not.toBe(seventh);
    });

    it("re-opens the window after 24 h", async () => {
      for (let i = 0; i < 6; i++) {
        await reset.issuePasswordResetCode(
          testUser.id,
          hashResetCode(testUser.id, `00000${i}`),
        );
      }
      await setWindowStart(testUser.id, "24 hours 1 second");
      expect(
        await reset.issuePasswordResetCode(
          testUser.id,
          hashResetCode(testUser.id, "777777"),
        ),
      ).toBe(true);
      expect((await row(testUser.id)).resetIssueCount).toBe(1);
    });
  });

  describe("reservePasswordResetAttempt", () => {
    beforeEach(async () => {
      await reset.issuePasswordResetCode(
        testUser.id,
        hashResetCode(testUser.id, "123456"),
      );
    });

    it("returns the row and increments attempts", async () => {
      const r = await reset.reservePasswordResetAttempt(
        testUser.email.toUpperCase(),
      );
      expect(r?.id).toBe(testUser.id);
      expect(r?.resetCodeHash).toBe(hashResetCode(testUser.id, "123456"));
      expect((await row(testUser.id)).resetCodeAttempts).toBe(1);
    });

    it("stops after 5 attempts (6th returns undefined)", async () => {
      for (let i = 0; i < 5; i++) {
        expect(
          await reset.reservePasswordResetAttempt(testUser.email),
        ).toBeDefined();
      }
      expect(
        await reset.reservePasswordResetAttempt(testUser.email),
      ).toBeUndefined();
      expect((await row(testUser.id)).resetCodeAttempts).toBe(5);
    });

    it("6 parallel attempts still cap at 5", async () => {
      // Same connection (test transaction) — proves the predicate, not lock
      // contention; atomicity across connections follows from it being one UPDATE.
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          reset.reservePasswordResetAttempt(testUser.email),
        ),
      );
      expect(results.filter(Boolean)).toHaveLength(5);
    });

    it("rejects an expired code", async () => {
      await expireCode(testUser.id);
      expect(
        await reset.reservePasswordResetAttempt(testUser.email),
      ).toBeUndefined();
    });

    it("returns undefined for an unknown email and for a pending_email", async () => {
      expect(
        await reset.reservePasswordResetAttempt("nobody@example.com"),
      ).toBeUndefined();
      await users_.stagePendingEmail(testUser.id, "pending@example.com");
      expect(
        await reset.reservePasswordResetAttempt("pending@example.com"),
      ).toBeUndefined();
    });

    it("matches a legacy mixed-case stored email", async () => {
      const legacy = await createTestUser(tx, {
        email: "Bob.Mixed@Example.com",
      });
      await reset.issuePasswordResetCode(
        legacy.id,
        hashResetCode(legacy.id, "123456"),
      );
      expect(
        (await reset.reservePasswordResetAttempt("bob.mixed@example.com"))?.id,
      ).toBe(legacy.id);
    });

    it.each(["America/Los_Angeles", "Asia/Tokyo"])(
      "expiry is correct with session time zone %s",
      async (zone) => {
        await tx.execute(sql.raw(`SET LOCAL TIME ZONE '${zone}'`));
        expect(
          await reset.reservePasswordResetAttempt(testUser.email),
        ).toBeDefined();
        await expireCode(testUser.id);
        expect(
          await reset.reservePasswordResetAttempt(testUser.email),
        ).toBeUndefined();
      },
    );
  });

  describe("completePasswordReset", () => {
    const matched = () => hashResetCode(testUser.id, "123456");
    beforeEach(async () => {
      await reset.issuePasswordResetCode(testUser.id, matched());
    });

    it("sets the password, bumps tokenVersion, verifies email, clears code and pending_email", async () => {
      await users_.stagePendingEmail(testUser.id, "attacker@example.com");
      const before = await row(testUser.id);
      expect(
        await reset.completePasswordReset(testUser.id, matched(), "new-hash"),
      ).toBe(true);
      const r = await row(testUser.id);
      expect(r.password).toBe("new-hash");
      expect(r.tokenVersion).toBe(before.tokenVersion + 1);
      expect(r.emailVerified).toBe(true);
      expect(r.pendingEmail).toBeNull();
      expect(r.resetCodeHash).toBeNull();
      expect(r.resetCodeExpiresAt).toBeNull();
      expect(r.resetCodeAttempts).toBe(0);
    });

    it("cancels a staged email change: the old change link then updates 0 rows", async () => {
      await users_.stagePendingEmail(testUser.id, "attacker@example.com");
      await reset.completePasswordReset(testUser.id, matched(), "new-hash");
      expect(
        await users_.applyEmailVerification(
          testUser.id,
          "attacker@example.com",
        ),
      ).toBeUndefined();
      expect((await row(testUser.id)).email).toBe(testUser.email);
    });

    it("adds a password to a social-only account (NULL password)", async () => {
      const social = await createTestUser(tx, { password: null });
      const hash = hashResetCode(social.id, "123456");
      await reset.issuePasswordResetCode(social.id, hash);
      expect(
        await reset.reservePasswordResetAttempt(social.email),
      ).toBeDefined();
      expect(
        await reset.completePasswordReset(social.id, hash, "first-hash"),
      ).toBe(true);
      expect((await row(social.id)).password).toBe("first-hash");
    });

    it("is single-use (second completion fails)", async () => {
      expect(
        await reset.completePasswordReset(testUser.id, matched(), "h1"),
      ).toBe(true);
      expect(
        await reset.completePasswordReset(testUser.id, matched(), "h2"),
      ).toBe(false);
    });

    it("fails when a newer code replaced the matched one", async () => {
      await reset.issuePasswordResetCode(
        testUser.id,
        hashResetCode(testUser.id, "654321"),
      );
      expect(
        await reset.completePasswordReset(testUser.id, matched(), "h"),
      ).toBe(false);
    });

    it("keeps the issuance counters (a reset does not refill the daily cap)", async () => {
      await reset.completePasswordReset(testUser.id, matched(), "h");
      expect((await row(testUser.id)).resetIssueCount).toBe(1);
    });
  });

  describe("email-change commit points kill a live code", () => {
    beforeEach(async () => {
      await reset.issuePasswordResetCode(
        testUser.id,
        hashResetCode(testUser.id, "123456"),
      );
    });

    it("applyEmailVerification branch 2 (commit staged change) clears the code", async () => {
      await users_.stagePendingEmail(testUser.id, "new-addr@example.com");
      await users_.applyEmailVerification(testUser.id, "new-addr@example.com");
      expect((await row(testUser.id)).resetCodeHash).toBeNull();
    });

    it("updateUserEmail (gate off) clears the code", async () => {
      await users_.updateUserEmail(testUser.id, "direct@example.com");
      expect((await row(testUser.id)).resetCodeHash).toBeNull();
    });

    it("stagePendingEmail does NOT clear the code", async () => {
      await users_.stagePendingEmail(testUser.id, "staged@example.com");
      expect((await row(testUser.id)).resetCodeHash).not.toBeNull();
    });

    it("applyEmailVerification branch 1 (re-verify same address) does NOT clear the code", async () => {
      await users_.applyEmailVerification(testUser.id, testUser.email);
      expect((await row(testUser.id)).resetCodeHash).not.toBeNull();
    });
  });
});
