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
import {
  chatConversations,
  chatMessages,
  communityRecipes,
  cookbooks,
  mealPlanRecipes,
  users,
} from "@shared/schema";
import { eq } from "drizzle-orm";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const { mockDeleteImage } = vi.hoisted(() => ({ mockDeleteImage: vi.fn() }));
vi.mock("../../lib/image-store", () => ({ deleteImage: mockDeleteImage }));

const {
  collectUserImageUrls,
  filterUnreferencedImageUrls,
  deleteImagesIfUnreferenced,
} = await import("../account-images");

const CDN = "https://cdn.example.test";
let tx: NodePgDatabase<typeof schema>;
let owner: schema.User;
let other: schema.User;

async function addCommunityRecipe(authorId: string, imageUrl: string | null) {
  await tx.insert(communityRecipes).values({
    authorId,
    normalizedProductName: "test",
    title: "Test recipe",
    instructions: ["Cook"],
    ingredients: [],
    imageUrl,
  });
}

async function addCanonicalGallery(authorId: string, images: string[]) {
  await tx.insert(communityRecipes).values({
    authorId,
    normalizedProductName: "featured",
    title: "Featured recipe",
    instructions: ["Cook"],
    ingredients: [],
    canonicalImages: images,
  });
}

async function addMealPlanRecipe(userId: string, imageUrl: string | null) {
  await tx.insert(mealPlanRecipes).values({ userId, title: "Plan", imageUrl });
}

async function addChatRecipeImage(userId: string, imageUrl: string) {
  const [conv] = await tx
    .insert(chatConversations)
    .values({ userId, title: "Chat" })
    .returning({ id: chatConversations.id });
  await tx.insert(chatMessages).values({
    conversationId: conv.id,
    role: "assistant",
    content: "Here is a recipe",
    metadata: { metadataVersion: 1, recipe: {}, imageUrl },
  });
}

describe("account image cleanup storage", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
    owner = await createTestUser(tx);
    other = await createTestUser(tx);
  });

  afterEach(async () => {
    await rollbackTestTransaction();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  describe("collectUserImageUrls", () => {
    it("collects the user's cookbook covers, recipe, meal-plan and chat images", async () => {
      await tx.insert(cookbooks).values({
        userId: owner.id,
        name: "Mine",
        coverImageUrl: `${CDN}/cookbook-covers/a.jpg?v=2`,
      });
      await addCommunityRecipe(owner.id, `${CDN}/recipe-images/c.jpg`);
      await addMealPlanRecipe(owner.id, `${CDN}/recipe-images/m.jpg`);
      await addChatRecipeImage(owner.id, `${CDN}/recipe-images/chat.jpg`);

      const images = await collectUserImageUrls(owner.id);

      expect(images).toEqual(
        expect.arrayContaining([
          { url: `${CDN}/cookbook-covers/a.jpg?v=2`, kind: "cookbook" },
          { url: `${CDN}/recipe-images/c.jpg`, kind: "recipe" },
          { url: `${CDN}/recipe-images/m.jpg`, kind: "recipe" },
          { url: `${CDN}/recipe-images/chat.jpg`, kind: "recipe" },
        ]),
      );
      expect(images).toHaveLength(4);
    });

    it("skips nulls, dedupes, and never returns another user's images", async () => {
      await addCommunityRecipe(owner.id, null);
      await addCommunityRecipe(owner.id, `${CDN}/recipe-images/same.jpg`);
      await addMealPlanRecipe(owner.id, `${CDN}/recipe-images/same.jpg`);
      await addMealPlanRecipe(other.id, `${CDN}/recipe-images/theirs.jpg`);
      await tx.insert(cookbooks).values({
        userId: other.id,
        name: "Theirs",
        coverImageUrl: `${CDN}/cookbook-covers/theirs.jpg`,
      });

      const images = await collectUserImageUrls(owner.id);

      expect(images).toEqual([
        { url: `${CDN}/recipe-images/same.jpg`, kind: "recipe" },
      ]);
    });
  });

  it("collects the author's featured-recipe gallery images too", async () => {
    await addCanonicalGallery(owner.id, [
      `${CDN}/recipe-images/g1.jpg`,
      `${CDN}/recipe-images/g2.jpg`,
    ]);

    expect(await collectUserImageUrls(owner.id)).toEqual(
      expect.arrayContaining([
        { url: `${CDN}/recipe-images/g1.jpg`, kind: "recipe" },
        { url: `${CDN}/recipe-images/g2.jpg`, kind: "recipe" },
      ]),
    );
  });

  describe("filterUnreferencedImageUrls (run after the user's rows are gone)", () => {
    it("keeps an image nothing references any more", async () => {
      const images = [
        { url: `${CDN}/recipe-images/gone.jpg`, kind: "recipe" as const },
        { url: `${CDN}/cookbook-covers/gone.jpg`, kind: "cookbook" as const },
      ];

      expect(await filterUnreferencedImageUrls(images)).toEqual(images);
    });

    it("drops an image another user still references, in any table", async () => {
      // A crafted meal-plan URL pointing at someone else's image must not
      // let a deleting account remove it, and a shared copy keeps its picture.
      await addMealPlanRecipe(other.id, `${CDN}/recipe-images/plan.jpg`);
      await addCommunityRecipe(other.id, `${CDN}/recipe-images/community.jpg`);
      await addChatRecipeImage(other.id, `${CDN}/recipe-images/chat.jpg`);
      await tx.insert(cookbooks).values({
        userId: other.id,
        name: "Theirs",
        coverImageUrl: `${CDN}/cookbook-covers/shared.jpg`,
      });

      const result = await filterUnreferencedImageUrls([
        { url: `${CDN}/recipe-images/plan.jpg`, kind: "recipe" },
        { url: `${CDN}/recipe-images/community.jpg`, kind: "recipe" },
        { url: `${CDN}/recipe-images/chat.jpg`, kind: "recipe" },
        { url: `${CDN}/cookbook-covers/shared.jpg`, kind: "cookbook" },
        { url: `${CDN}/recipe-images/free.jpg`, kind: "recipe" },
      ]);

      expect(result).toEqual([
        { url: `${CDN}/recipe-images/free.jpg`, kind: "recipe" },
      ]);
    });

    it("drops an image that is in another user's featured-recipe gallery", async () => {
      await addCanonicalGallery(other.id, [`${CDN}/recipe-images/gallery.jpg`]);

      const result = await filterUnreferencedImageUrls([
        { url: `${CDN}/recipe-images/gallery.jpg`, kind: "recipe" },
      ]);

      expect(result).toEqual([]);
    });

    it("treats a ?v= cache-buster as the same stored image", async () => {
      await addMealPlanRecipe(other.id, `${CDN}/recipe-images/v.jpg?v=3`);

      const result = await filterUnreferencedImageUrls([
        { url: `${CDN}/recipe-images/v.jpg`, kind: "recipe" },
      ]);

      expect(result).toEqual([]);
    });

    it("end to end: after deleteUser, the owner's own images come back as deletable", async () => {
      await addCommunityRecipe(owner.id, `${CDN}/recipe-images/own.jpg`);
      const collected = await collectUserImageUrls(owner.id);
      await tx
        .delete(communityRecipes)
        .where(eq(communityRecipes.authorId, owner.id));
      await tx.delete(users).where(eq(users.id, owner.id));

      expect(await filterUnreferencedImageUrls(collected)).toEqual(collected);
    });
  });

  describe("deleteImagesIfUnreferenced", () => {
    it("deletes only the images nothing else references", async () => {
      await addMealPlanRecipe(other.id, `${CDN}/recipe-images/kept.jpg`);
      mockDeleteImage.mockClear();

      await deleteImagesIfUnreferenced([
        { url: `${CDN}/recipe-images/kept.jpg`, kind: "recipe" },
        { url: `${CDN}/recipe-images/free.jpg`, kind: "recipe" },
      ]);

      expect(mockDeleteImage).toHaveBeenCalledTimes(1);
      expect(mockDeleteImage).toHaveBeenCalledWith(
        `${CDN}/recipe-images/free.jpg`,
        "recipe",
      );
    });
  });
});
