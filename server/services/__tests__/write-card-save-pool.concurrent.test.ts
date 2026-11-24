/**
 * A card save must do all its database work on the one connection its
 * transaction holds (coach chat audit 2026-11-24, M47). A read through the
 * pool from inside the save needs a second connection while the first is
 * held: ten parallel saves then hold the whole pool and each waits for a
 * connection none of them can free.
 *
 * The test leaves the pool exactly one free connection, which the save's
 * transaction takes. Any pool read inside the save then waits out the pool's
 * 5 s connection timeout and the save rejects. Like the storage
 * `*.concurrent.test.ts` files, this does NOT mock `../../db`.
 */
import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { db, pool } from "../../db";
import {
  users,
  userProfiles,
  chatConversations,
  mealPlanRecipes,
  recipeIngredients,
  groceryLists,
  communityRecipes,
} from "@shared/schema";
import {
  createWriteCard,
  saveWriteCard,
  undoWriteCard,
} from "../../storage/coach-write-cards";
import { performWriteCardSave, revertWriteCardSave } from "../write-cards";

const createdUserIds: string[] = [];

afterAll(async () => {
  for (const id of createdUserIds) {
    await db.delete(users).where(eq(users.id, id));
  }
  await pool.end();
});

/** Holds every pool connection but one for the length of `run`. */
async function withOneFreeConnection<T>(run: () => Promise<T>): Promise<T> {
  const max = pool.options.max ?? 10;
  const held: PoolClient[] = [];
  for (let i = 0; i < max - 1; i++) held.push(await pool.connect());
  try {
    return await run();
  } finally {
    for (const client of held) client.release();
  }
}

async function seedUser() {
  const [user] = await db
    .insert(users)
    .values({
      username: `card_pool_${crypto.randomUUID()}`,
      email: `card_pool_${crypto.randomUUID()}@test.invalid`,
      password: "hashed_password_placeholder",
      subscriptionTier: "premium",
    })
    .returning({ id: users.id });
  createdUserIds.push(user.id);
  await db.insert(userProfiles).values({ userId: user.id });
  const [conv] = await db
    .insert(chatConversations)
    .values({ userId: user.id, title: "Coach", type: "coach" })
    .returning();
  const [list] = await db
    .insert(groceryLists)
    .values({
      userId: user.id,
      title: "Weekly shop",
      dateRangeStart: "2026-11-24",
      dateRangeEnd: "2026-11-30",
    })
    .returning();
  return { userId: user.id, conversationId: conv.id, listId: list.id };
}

function save(cardId: string, userId: string) {
  return withOneFreeConnection(() =>
    saveWriteCard(cardId, userId, (tx, card) =>
      performWriteCardSave(
        tx,
        card,
        {},
        {
          userId,
          tz: "UTC",
          now: new Date("2026-11-24T12:00:00Z"),
        },
      ),
    ),
  );
}

function undo(cardId: string, userId: string) {
  return withOneFreeConnection(() =>
    undoWriteCard(cardId, userId, (tx, card) => revertWriteCardSave(tx, card)),
  );
}

/** Saves, then undoes, each with one free connection. */
async function saveThenUndo(cardId: string, userId: string) {
  expect((await save(cardId, userId)).status).toBe("saved");
  expect((await undo(cardId, userId)).status).toBe("undone");
}

describe("card save uses only its transaction's connection (M47)", () => {
  it("saves and undoes a plan card with shopping when the pool has one free connection", async () => {
    const { userId, conversationId, listId } = await seedUser();
    const [recipe] = await db
      .insert(mealPlanRecipes)
      .values({ userId, title: "Lentil soup" })
      .returning();
    await db
      .insert(recipeIngredients)
      .values({ recipeId: recipe.id, name: "Red lentils", displayOrder: 0 });
    const { card } = await createWriteCard({
      userId,
      conversationId,
      kind: "plan",
      payload: {
        rows: [
          {
            plannedDate: "2026-11-25",
            mealType: "dinner",
            recipe: {
              source: "mine",
              id: recipe.id,
              title: "Lentil soup",
              calories: 400,
              protein: 20,
            },
            alternatives: [],
            alreadyPlanned: null,
          },
        ],
        shoppingListId: null,
        shopping: {
          lists: [{ id: listId, title: "Weekly shop" }],
          defaultListId: listId,
          newListName: "Coach list",
          ingredients: {},
        },
      },
    });

    await saveThenUndo(card.id, userId);
  }, 20_000);

  it("saves and undoes a pantry card when the pool has one free connection", async () => {
    const { userId, conversationId } = await seedUser();
    const { card } = await createWriteCard({
      userId,
      conversationId,
      kind: "pantry",
      payload: {
        rows: [
          {
            action: "add",
            name: "Rice",
            quantity: "1",
            unit: "kg",
            itemId: null,
            held: null,
            all: false,
            expiresInDays: null,
          },
        ],
      },
    });

    await saveThenUndo(card.id, userId);
  }, 20_000);

  it("saves and undoes a grocery card to an existing list when the pool has one free connection", async () => {
    const { userId, conversationId, listId } = await seedUser();
    const { card } = await createWriteCard({
      userId,
      conversationId,
      kind: "grocery",
      payload: {
        items: [{ name: "Spinach", quantity: null, unit: null, ticked: true }],
        lists: [{ id: listId, title: "Weekly shop" }],
        defaultListId: listId,
        newListName: "Coach list",
      },
    });

    await saveThenUndo(card.id, userId);
  }, 20_000);
  it("saves and undoes a plan card that copies a community recipe to a new list", async () => {
    const { userId, conversationId } = await seedUser();
    const [recipe] = await db
      .insert(communityRecipes)
      .values({
        authorId: userId,
        normalizedProductName: `card pool ${crypto.randomUUID()}`,
        title: "Chickpea curry",
        instructions: ["Cook."],
        ingredients: [{ name: "Chickpeas", quantity: "1", unit: "can" }],
        isPublic: true,
      })
      .returning();
    const { card } = await createWriteCard({
      userId,
      conversationId,
      kind: "plan",
      payload: {
        rows: [
          {
            plannedDate: "2026-11-25",
            mealType: "dinner",
            recipe: {
              source: "community",
              id: recipe.id,
              title: "Chickpea curry",
              calories: 400,
              protein: 20,
            },
            alternatives: [],
            alreadyPlanned: null,
          },
        ],
        shoppingListId: null,
        shopping: {
          lists: [],
          defaultListId: null,
          newListName: "Coach list",
          ingredients: {},
        },
      },
    });

    await saveThenUndo(card.id, userId);
  }, 20_000);

  it("saves and undoes a grocery card to a new list", async () => {
    const { userId, conversationId } = await seedUser();
    const { card } = await createWriteCard({
      userId,
      conversationId,
      kind: "grocery",
      payload: {
        items: [{ name: "Spinach", quantity: null, unit: null, ticked: true }],
        lists: [],
        defaultListId: null,
        newListName: "Coach list",
      },
    });

    await saveThenUndo(card.id, userId);
  }, 20_000);

  it("saves and undoes a food card", async () => {
    const { userId, conversationId } = await seedUser();
    const { card } = await createWriteCard({
      userId,
      conversationId,
      kind: "food",
      payload: {
        items: [
          {
            name: "Apple",
            unitLabel: "1 medium",
            perUnit: { calories: 95, protein: 0, carbs: 25, fat: 0 },
            count: 1,
            source: "estimate",
          },
        ],
        mealType: "snack",
        day: "today",
      },
    });

    await saveThenUndo(card.id, userId);
  }, 20_000);

  it("saves and undoes a goals card", async () => {
    const { userId, conversationId } = await seedUser();
    const { card } = await createWriteCard({
      userId,
      conversationId,
      kind: "goals",
      payload: { rows: [{ key: "protein", current: null, proposed: 120 }] },
    });

    await saveThenUndo(card.id, userId);
  }, 20_000);
});
