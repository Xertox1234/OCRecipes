/* eslint-disable no-console */
/**
 * Local-only seed: puts a live Coach pantry card in a new chat, with no model
 * call, so the card can be looked at in the simulator
 * (todos/…coach-pantry-card-simulator-and-voiceover-check.md).
 *
 * The card is built the way a real turn builds it: `buildPantryPayload` reads
 * the user's pantry, `createWriteCard` stores the row, and the assistant
 * message carries the same `write_card` block `coach-pro-chat.ts` writes.
 *
 * Refuses NODE_ENV=production and any non-local DATABASE_URL.
 *
 * Usage:
 *   npx tsx server/scripts/seed-pantry-card-check.ts [username]
 * Prints the ids. Open the chat from the Coach tab (its "Pantry card check"
 * chip): `ocrecipes://chat/<id>` opens the plain chat, which draws no cards
 * (todos/P2-2026-11-22-coach-pro-links-open-the-plain-chat-without-cards.md).
 * The user needs a plan with Coach Pro and pantryTracking (local `demo` has).
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { pantryItems, users } from "@shared/schema";
import { db, pool } from "../db";
import { buildPantryPayload } from "../services/write-cards/pantry";
import type { UpdatePantryCardArgs } from "../services/write-cards/tool-args";
import { createChatConversation, createChatMessage } from "../storage/chat";
import { createWriteCard } from "../storage/coach-write-cards";
import { isLocalDbHost } from "./seed-recipes-utils";

/** Pantry rows the card's use and remove rows point at. */
const STOCK = [
  { name: "Card check milk", quantity: "2", unit: "l" },
  { name: "Card check rice", quantity: "1", unit: "kg" },
  { name: "Card check eggs", quantity: "6", unit: null },
  { name: "Card check spinach", quantity: "1", unit: "bag" },
] as const;

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run with NODE_ENV=production.");
  }
  if (!isLocalDbHost(process.env.DATABASE_URL)) {
    throw new Error("Refusing to run against a non-local DATABASE_URL.");
  }

  const username = process.argv[2] ?? "demo";
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  if (!user) throw new Error(`No local user named "${username}".`);

  const stock = await db
    .insert(pantryItems)
    .values(STOCK.map((s) => ({ ...s, userId: user.id })))
    .returning({ id: pantryItems.id, name: pantryItems.name });
  const idOf = (name: string): number => {
    const row = stock.find((s) => s.name === name);
    if (!row) throw new Error(`Seeded pantry row missing: ${name}`);
    return row.id;
  };

  const args: UpdatePantryCardArgs = {
    changes: [
      // Tops up the seeded eggs row (same name, same unit).
      { action: "add", name: "Card check eggs", quantity: "12" },
      // A new row, with a best-before.
      {
        action: "add",
        name: "Card check oat milk",
        quantity: "1",
        unit: "l",
        expiresInDays: 7,
      },
      { action: "use", itemId: idOf("Card check milk"), quantity: "0.5" },
      { action: "use", itemId: idOf("Card check rice"), all: true },
      { action: "remove", itemId: idOf("Card check spinach") },
    ],
  };
  const payload = await buildPantryPayload(args, user.id);

  const conversation = await createChatConversation(
    user.id,
    "Pantry card check",
    "coach",
  );
  await createChatMessage(
    conversation.id,
    user.id,
    "user",
    "I bought eggs and oat milk, used some milk and the rice, and threw out the spinach.",
  );
  const { card } = await createWriteCard({
    userId: user.id,
    conversationId: conversation.id,
    kind: "pantry",
    payload,
  });
  await createChatMessage(
    conversation.id,
    user.id,
    "assistant",
    "Here are those pantry changes. Untick anything that is wrong, then save.",
    {
      blocks: [
        {
          type: "write_card",
          cardId: card.id,
          kind: "pantry",
          payload,
          status: "live",
        },
      ],
    },
  );

  console.log(
    JSON.stringify(
      {
        conversationId: conversation.id,
        cardId: card.id,
        pantryRowIds: stock,
        open: 'Coach tab → "Pantry card check" chip',
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
