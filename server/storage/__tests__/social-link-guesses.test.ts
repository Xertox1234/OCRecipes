import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  setupTestTransaction,
  rollbackTestTransaction,
  closeTestPool,
  createTestUser,
  getTestTx,
} from "../../../test/db-test-utils";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@shared/schema";
import { socialLinkGuesses } from "@shared/schema";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const MAX = 10;
let tx: NodePgDatabase<typeof schema>;

// Auth audit 2026-10-10 L15: the per-account cap on /social/link password
// guesses lived in an in-memory store that every deploy reset.
describe("social link password-guess cap (real DB)", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
  });

  afterEach(async () => {
    await rollbackTestTransaction();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it("allows 10 guesses, refuses the 11th, and still refuses after a restart", async () => {
    const user = await createTestUser(tx);
    const ids = await import("../identities");
    for (let i = 0; i < MAX; i++) {
      expect(await ids.reserveLinkPasswordGuess(user.id, MAX)).toBe(true);
    }
    expect(await ids.reserveLinkPasswordGuess(user.id, MAX)).toBe(false);

    // A deploy: a fresh copy of the module, no in-process state carried over.
    vi.resetModules();
    const fresh = await import("../identities");
    expect(fresh).not.toBe(ids);
    expect(await fresh.reserveLinkPasswordGuess(user.id, MAX)).toBe(false);
  });

  it("counts per account: another account is unaffected", async () => {
    const a = await createTestUser(tx);
    const b = await createTestUser(tx);
    const ids = await import("../identities");
    for (let i = 0; i < MAX; i++) await ids.reserveLinkPasswordGuess(a.id, MAX);
    expect(await ids.reserveLinkPasswordGuess(a.id, MAX)).toBe(false);
    expect(await ids.reserveLinkPasswordGuess(b.id, MAX)).toBe(true);
  });

  it("a fixed 15-minute window: once it has passed, guessing starts again from 1", async () => {
    const user = await createTestUser(tx);
    const ids = await import("../identities");
    for (let i = 0; i < MAX; i++)
      await ids.reserveLinkPasswordGuess(user.id, MAX);
    expect(await ids.reserveLinkPasswordGuess(user.id, MAX)).toBe(false);

    await tx
      .update(socialLinkGuesses)
      .set({ windowStart: sql`now() - interval '16 minutes'` })
      .where(eq(socialLinkGuesses.userId, user.id));
    expect(await ids.reserveLinkPasswordGuess(user.id, MAX)).toBe(true);
    const [row] = await tx
      .select()
      .from(socialLinkGuesses)
      .where(eq(socialLinkGuesses.userId, user.id));
    expect(row.count).toBe(1);
  });

  it("a refund (the password was right) gives the guess back", async () => {
    const user = await createTestUser(tx);
    const ids = await import("../identities");
    for (let i = 0; i < MAX; i++)
      await ids.reserveLinkPasswordGuess(user.id, MAX);
    await ids.refundLinkPasswordGuess(user.id);
    expect(await ids.reserveLinkPasswordGuess(user.id, MAX)).toBe(true);
    expect(await ids.reserveLinkPasswordGuess(user.id, MAX)).toBe(false);
  });

  it("a refund never takes the count below zero", async () => {
    const user = await createTestUser(tx);
    const ids = await import("../identities");
    await ids.reserveLinkPasswordGuess(user.id, MAX);
    await ids.refundLinkPasswordGuess(user.id);
    await ids.refundLinkPasswordGuess(user.id);
    const [row] = await tx
      .select()
      .from(socialLinkGuesses)
      .where(eq(socialLinkGuesses.userId, user.id));
    expect(row.count).toBe(0);
  });
});
