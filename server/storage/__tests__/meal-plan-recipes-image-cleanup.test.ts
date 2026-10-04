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
import { communityRecipes, mealPlanRecipes } from "@shared/schema";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

vi.mock("../../lib/search-index", () => ({
  addToIndex: vi.fn(),
  removeFromIndex: vi.fn(),
  mealPlanToSearchable: vi.fn((r: { id: number }) => ({
    id: `personal:${r.id}`,
  })),
  getDocumentStore: vi.fn(() => new Map()),
}));

const { mockDeleteImage, pending } = vi.hoisted(() => ({
  mockDeleteImage: vi.fn(),
  pending: [] as Promise<unknown>[],
}));
vi.mock("../../lib/image-store", () => ({ deleteImage: mockDeleteImage }));
// Capture fire-and-forget work so a test can wait for it to finish and then
// assert that a delete did NOT happen.
vi.mock("../../lib/fire-and-forget", () => ({
  fireAndForget: (_label: string, promise: Promise<unknown>) => {
    pending.push(promise);
  },
}));

const { updateMealPlanRecipe, deleteMealPlanRecipe } = await import(
  "../meal-plan-recipes-crud"
);

const CDN = "https://cdn.example.test";
const VICTIM_IMAGE = `${CDN}/recipe-images/victim.jpg`;
const VICTIM_GALLERY = `${CDN}/recipe-images/victim-gallery.jpg`;
const OWN_IMAGE = `${CDN}/recipe-images/own.jpg`;

let tx: NodePgDatabase<typeof schema>;
let attacker: schema.User;
let victim: schema.User;

async function settle() {
  await Promise.all(pending.splice(0));
}

async function addPlanRecipe(userId: string, imageUrl: string) {
  const [row] = await tx
    .insert(mealPlanRecipes)
    .values({ userId, title: "Plan", imageUrl })
    .returning({ id: mealPlanRecipes.id });
  return row.id;
}

describe("meal-plan recipe image cleanup only removes unreferenced images", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
    attacker = await createTestUser(tx);
    victim = await createTestUser(tx);
    await tx.insert(communityRecipes).values({
      authorId: victim.id,
      normalizedProductName: "victim",
      title: "Victim recipe",
      instructions: ["Cook"],
      ingredients: [],
      imageUrl: VICTIM_IMAGE,
      canonicalImages: [VICTIM_GALLERY],
    });
    mockDeleteImage.mockClear();
    pending.length = 0;
  });

  afterEach(async () => {
    await rollbackTestTransaction();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it("deleting a recipe that points at someone else's image keeps that image", async () => {
    const id = await addPlanRecipe(attacker.id, VICTIM_IMAGE);

    expect(await deleteMealPlanRecipe(id, attacker.id)).toBe(true);
    await settle();

    expect(mockDeleteImage).not.toHaveBeenCalledWith(VICTIM_IMAGE, "recipe");
  });

  it("deleting a recipe that points at a featured gallery image keeps it", async () => {
    const id = await addPlanRecipe(attacker.id, VICTIM_GALLERY);

    await deleteMealPlanRecipe(id, attacker.id);
    await settle();

    expect(mockDeleteImage).not.toHaveBeenCalledWith(VICTIM_GALLERY, "recipe");
  });

  it("replacing the image of a recipe that pointed at someone else's image keeps it", async () => {
    const id = await addPlanRecipe(attacker.id, VICTIM_IMAGE);

    await updateMealPlanRecipe(id, attacker.id, { imageUrl: OWN_IMAGE });
    await settle();

    expect(mockDeleteImage).not.toHaveBeenCalledWith(VICTIM_IMAGE, "recipe");
  });

  it("still deletes the user's own image once nothing references it", async () => {
    const id = await addPlanRecipe(attacker.id, OWN_IMAGE);

    await deleteMealPlanRecipe(id, attacker.id);
    await settle();

    expect(mockDeleteImage).toHaveBeenCalledWith(OWN_IMAGE, "recipe");
  });
});
