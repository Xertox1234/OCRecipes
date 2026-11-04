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
import { cookbookCoverCandidates } from "@shared/schema";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const deleteImageMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../../lib/image-store", () => ({
  deleteImage: (...args: unknown[]) => deleteImageMock(...args),
}));

const {
  COVER_CANDIDATE_TTL_MS,
  storeCoverCandidateSet,
  claimCoverCandidate,
  countCoverSetsSince,
  purgeExpiredCoverCandidates,
} = await import("../cookbook-cover-candidates");

let tx: NodePgDatabase<typeof schema>;
let user: schema.User;
let other: schema.User;

const urls = (prefix: string) =>
  [1, 2, 3, 4].map(
    (n) => `https://cdn.test/cookbook-covers/${prefix}-${n}.jpg`,
  );

async function expire(id: string) {
  await tx
    .update(cookbookCoverCandidates)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(cookbookCoverCandidates.id, id));
}

beforeEach(async () => {
  tx = await setupTestTransaction();
  user = await createTestUser(tx);
  other = await createTestUser(tx);
  deleteImageMock.mockClear();
});

afterEach(async () => {
  await rollbackTestTransaction();
});

afterAll(async () => {
  await closeTestPool();
});

describe("storeCoverCandidateSet", () => {
  it("stores a set with ids and a 2 h expiry", async () => {
    const before = Date.now();
    const result = await storeCoverCandidateSet(user.id, urls("a"));

    expect(result.candidates.map((c) => c.imageUrl)).toEqual(urls("a"));
    expect(new Set(result.candidates.map((c) => c.id)).size).toBe(4);
    expect(result.replacedUrls).toEqual([]);
    expect(COVER_CANDIDATE_TTL_MS).toBe(2 * 60 * 60 * 1000);
    const expiry = new Date(result.expiresAt).getTime();
    // 24h-tolerant per docs/rules/database.md would hide a wrong TTL here;
    // the expiry is computed in JS from Date.now(), so a tight bound holds.
    expect(expiry).toBeGreaterThanOrEqual(before + COVER_CANDIDATE_TTL_MS);
    expect(expiry).toBeLessThanOrEqual(Date.now() + COVER_CANDIDATE_TTL_MS);
  });

  it("replaces the user's previous set and returns its URLs", async () => {
    await storeCoverCandidateSet(user.id, urls("a"));
    const second = await storeCoverCandidateSet(user.id, urls("b"));

    expect(second.replacedUrls.sort()).toEqual(urls("a").sort());
    const rows = await tx
      .select()
      .from(cookbookCoverCandidates)
      .where(eq(cookbookCoverCandidates.userId, user.id));
    expect(rows.map((r) => r.imageUrl).sort()).toEqual(urls("b").sort());
  });

  it("never touches another user's set", async () => {
    await storeCoverCandidateSet(other.id, urls("o"));
    const mine = await storeCoverCandidateSet(user.id, urls("a"));

    expect(mine.replacedUrls).toEqual([]);
    const rows = await tx
      .select()
      .from(cookbookCoverCandidates)
      .where(eq(cookbookCoverCandidates.userId, other.id));
    expect(rows).toHaveLength(4);
  });

  it("counts each stored set toward the daily cap", async () => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect(await countCoverSetsSince(user.id, since)).toBe(0);

    await storeCoverCandidateSet(user.id, urls("a"));
    await storeCoverCandidateSet(user.id, urls("b"));

    expect(await countCoverSetsSince(user.id, since)).toBe(2);
    expect(await countCoverSetsSince(other.id, since)).toBe(0);
  });
});

describe("claimCoverCandidate", () => {
  it("returns the image URL once, then null", async () => {
    const { candidates } = await storeCoverCandidateSet(user.id, urls("a"));
    const id = candidates[1].id;

    expect(await claimCoverCandidate(id, user.id)).toBe(urls("a")[1]);
    expect(await claimCoverCandidate(id, user.id)).toBeNull();
  });

  it("returns null for another user's candidate and leaves it in place", async () => {
    const { candidates } = await storeCoverCandidateSet(other.id, urls("o"));

    expect(await claimCoverCandidate(candidates[0].id, user.id)).toBeNull();
    expect(await claimCoverCandidate(candidates[0].id, other.id)).toBe(
      urls("o")[0],
    );
  });

  it("returns null for an expired candidate", async () => {
    const { candidates } = await storeCoverCandidateSet(user.id, urls("a"));
    await expire(candidates[0].id);

    expect(await claimCoverCandidate(candidates[0].id, user.id)).toBeNull();
  });

  it("keeps a claimed URL out of a later replace and purge", async () => {
    const { candidates } = await storeCoverCandidateSet(user.id, urls("a"));
    const claimed = await claimCoverCandidate(candidates[0].id, user.id);
    for (const c of candidates.slice(1)) await expire(c.id);

    const purged = await purgeExpiredCoverCandidates();
    const replaced = await storeCoverCandidateSet(user.id, urls("b"));

    expect(purged).not.toContain(claimed);
    expect(replaced.replacedUrls).not.toContain(claimed);
    expect(deleteImageMock).not.toHaveBeenCalledWith(claimed, "cookbook");
  });
});

describe("purgeExpiredCoverCandidates", () => {
  it("deletes only expired rows and their stored objects", async () => {
    const { candidates } = await storeCoverCandidateSet(user.id, urls("a"));
    await expire(candidates[0].id);

    const purged = await purgeExpiredCoverCandidates();

    expect(purged).toContain(urls("a")[0]);
    expect(purged).not.toContain(urls("a")[1]);
    expect(deleteImageMock).toHaveBeenCalledWith(urls("a")[0], "cookbook");
    expect(deleteImageMock).not.toHaveBeenCalledWith(urls("a")[1], "cookbook");
    const left = await tx
      .select()
      .from(cookbookCoverCandidates)
      .where(eq(cookbookCoverCandidates.userId, user.id));
    expect(left).toHaveLength(3);
  });

  it("keeps going when one object delete fails", async () => {
    const { candidates } = await storeCoverCandidateSet(user.id, urls("a"));
    await expire(candidates[0].id);
    await expire(candidates[1].id);
    deleteImageMock.mockRejectedValueOnce(new Error("r2 down"));

    const purged = await purgeExpiredCoverCandidates();

    expect(purged).toEqual(expect.arrayContaining(urls("a").slice(0, 2)));
    expect(deleteImageMock).toHaveBeenCalledTimes(purged.length);
  });
});
