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
  getTestTx,
} from "../../../test/db-test-utils";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const { getDishImageUrl, recordDishImage } = await import("../dish-images");

const HASH = "a".repeat(64);
const CDN = "https://cdn.example.test";

describe("dish images storage", () => {
  beforeEach(async () => {
    await setupTestTransaction();
  });

  afterEach(async () => {
    await rollbackTestTransaction();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it("returns null for a name nobody has a picture for", async () => {
    expect(await getDishImageUrl(HASH)).toBeNull();
  });

  it("returns the recorded picture", async () => {
    await recordDishImage(HASH, `${CDN}/recipe-images/first.jpg`);

    expect(await getDishImageUrl(HASH)).toBe(`${CDN}/recipe-images/first.jpg`);
  });

  // Two people entering the same new dish at once: the second record must not
  // throw, and the first picture stays the shared one.
  it("keeps the first picture when the same name is recorded twice", async () => {
    await recordDishImage(HASH, `${CDN}/recipe-images/first.jpg`);
    await expect(
      recordDishImage(HASH, `${CDN}/recipe-images/second.jpg`),
    ).resolves.toBeUndefined();

    expect(await getDishImageUrl(HASH)).toBe(`${CDN}/recipe-images/first.jpg`);
  });
});
