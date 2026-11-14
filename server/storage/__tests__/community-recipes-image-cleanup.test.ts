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
  communityToSearchable: vi.fn(),
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

const { deleteCommunityRecipe, updateCommunityRecipeImageUrl } = await import(
  "../community-recipes"
);

const CDN = "https://cdn.example.test";
const SHARED_IMAGE = `${CDN}/recipe-images/shared.jpg`;
const OWN_IMAGE = `${CDN}/recipe-images/own.jpg`;
const NEW_IMAGE = `${CDN}/recipe-images/new.jpg`;

let tx: NodePgDatabase<typeof schema>;
let author: schema.User;

async function settle() {
  await Promise.all(pending.splice(0));
}

async function addCommunityRecipe(imageUrl: string) {
  const [row] = await tx
    .insert(communityRecipes)
    .values({
      authorId: author.id,
      normalizedProductName: "test",
      title: "Community recipe",
      instructions: ["Cook"],
      ingredients: [],
      imageUrl,
    })
    .returning({ id: communityRecipes.id });
  return row.id;
}

async function addPlanRecipe(imageUrl: string) {
  await tx
    .insert(mealPlanRecipes)
    .values({ userId: author.id, title: "Plan", imageUrl });
}

describe("community recipe image cleanup only removes unreferenced images", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
    author = await createTestUser(tx);
    mockDeleteImage.mockClear();
    pending.length = 0;
  });

  afterEach(async () => {
    await rollbackTestTransaction();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it("deleting a recipe whose image a meal-plan recipe also uses keeps the image", async () => {
    const id = await addCommunityRecipe(SHARED_IMAGE);
    await addPlanRecipe(SHARED_IMAGE);

    expect(await deleteCommunityRecipe(id, author.id)).toBe(true);
    await settle();

    expect(mockDeleteImage).not.toHaveBeenCalledWith(SHARED_IMAGE, "recipe");
  });

  it("deleting a recipe whose image nothing else uses removes the image", async () => {
    const id = await addCommunityRecipe(OWN_IMAGE);

    expect(await deleteCommunityRecipe(id, author.id)).toBe(true);
    await settle();

    expect(mockDeleteImage).toHaveBeenCalledWith(OWN_IMAGE, "recipe");
  });

  it("replacing an image a meal-plan recipe also uses keeps the old image", async () => {
    const id = await addCommunityRecipe(SHARED_IMAGE);
    await addPlanRecipe(SHARED_IMAGE);

    await updateCommunityRecipeImageUrl(id, NEW_IMAGE);
    await settle();

    expect(mockDeleteImage).not.toHaveBeenCalledWith(SHARED_IMAGE, "recipe");
  });

  it("replacing an image nothing else uses removes the old image", async () => {
    const id = await addCommunityRecipe(OWN_IMAGE);

    await updateCommunityRecipeImageUrl(id, NEW_IMAGE);
    await settle();

    expect(mockDeleteImage).toHaveBeenCalledWith(OWN_IMAGE, "recipe");
  });
});
