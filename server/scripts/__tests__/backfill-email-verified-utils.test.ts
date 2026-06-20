import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@shared/schema";

import {
  ALLOW_FLAG,
  isBackfillAuthorized,
  REFUSAL_MESSAGE,
  resendGateWarning,
} from "../backfill-email-verified-utils";

import {
  backfillEmailVerified,
  type BackfillDb,
} from "../backfill-email-verified";

// Mock the db module so importing the backfill script does not open a real pg
// connection. backfillEmailVerified() below is exercised with a fake db passed
// in, so this mock only needs to satisfy the module-level imports.
vi.mock("../../db", () => ({
  db: {},
  pool: { end: vi.fn().mockResolvedValue(undefined) },
}));

describe("backfill-email-verified guard (isBackfillAuthorized)", () => {
  it("refuses (false) when the opt-in flag is absent", () => {
    expect(isBackfillAuthorized(["node", "script.ts"])).toBe(false);
    expect(isBackfillAuthorized([])).toBe(false);
    // A near-miss flag must NOT authorize.
    expect(isBackfillAuthorized(["--allow-prod-seed"])).toBe(false);
  });

  it("authorizes (true) only when the exact opt-in flag is present", () => {
    expect(isBackfillAuthorized(["node", "script.ts", ALLOW_FLAG])).toBe(true);
    // Flag may appear anywhere in argv.
    expect(isBackfillAuthorized([ALLOW_FLAG, "extra"])).toBe(true);
  });

  it("refusal message names the flag and the destructive statement", () => {
    expect(REFUSAL_MESSAGE).toContain(ALLOW_FLAG);
    expect(REFUSAL_MESSAGE).toContain("UPDATE users SET email_verified = true");
  });
});

describe("backfill-email-verified resendGateWarning", () => {
  it("returns null when RESEND_API_KEY is unset (correct ordering)", () => {
    expect(
      resendGateWarning({ NODE_ENV: "production" } as NodeJS.ProcessEnv),
    ).toBeNull();
  });

  it("returns null when RESEND_API_KEY is present but empty/whitespace", () => {
    expect(
      resendGateWarning({
        NODE_ENV: "production",
        RESEND_API_KEY: "",
      } as NodeJS.ProcessEnv),
    ).toBeNull();
    expect(
      resendGateWarning({
        NODE_ENV: "production",
        RESEND_API_KEY: "   ",
      } as NodeJS.ProcessEnv),
    ).toBeNull();
  });

  it("warns when RESEND_API_KEY is set (backfill running late)", () => {
    const warning = resendGateWarning({
      NODE_ENV: "production",
      RESEND_API_KEY: "re_live_123",
    } as NodeJS.ProcessEnv);
    expect(warning).not.toBeNull();
    expect(warning).toContain("RESEND_API_KEY");
  });
});

/**
 * Fake db that records the update chain and returns the queued `.returning()`
 * rows. The idempotency guarantee lives in the `WHERE email_verified = false`
 * clause, so the test asserts the script passes exactly that predicate.
 */
function makeFakeDb(returningRows: { id: string }[]) {
  const whereArgs: unknown[] = [];
  const setArgs: unknown[] = [];
  const updateTargets: unknown[] = [];

  const chain = {
    set(values: unknown) {
      setArgs.push(values);
      return chain;
    },
    where(condition: unknown) {
      whereArgs.push(condition);
      return chain;
    },
    returning() {
      return Promise.resolve(returningRows);
    },
  };

  const db = {
    update(target: unknown) {
      updateTargets.push(target);
      return chain;
    },
  } as unknown as BackfillDb;

  return { db, whereArgs, setArgs, updateTargets };
}

describe("backfillEmailVerified (idempotency contract)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("filters on the email_verified = false predicate (idempotency clause)", async () => {
    const { db, whereArgs, setArgs, updateTargets } = makeFakeDb([]);

    await backfillEmailVerified(db);

    // Targets the users table, sets the verified flag, and — critically —
    // scopes the UPDATE to rows still at false so a re-run is a no-op.
    expect(updateTargets).toEqual([users]);
    expect(setArgs).toEqual([{ emailVerified: true }]);
    expect(whereArgs).toHaveLength(1);
    expect(whereArgs[0]).toStrictEqual(eq(users.emailVerified, false));
  });

  it("returns the number of rows actually flipped", async () => {
    const { db } = makeFakeDb([{ id: "a" }, { id: "b" }, { id: "c" }]);
    expect(await backfillEmailVerified(db)).toBe(3);
  });

  it("returns 0 on a re-run where every user is already verified (idempotent)", async () => {
    // Second run: the WHERE clause matches no rows, so .returning() is empty.
    const { db } = makeFakeDb([]);
    expect(await backfillEmailVerified(db)).toBe(0);
  });
});
