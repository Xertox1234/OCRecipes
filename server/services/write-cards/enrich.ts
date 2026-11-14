import type { ChatMessage } from "@shared/schema";
import { storage } from "../../storage";
import { storedEdits, writeCardReceiptFor } from "./index";

/**
 * A saved message's write_card block is a snapshot from when Coach replied.
 * When messages are read back, each block takes the card row's current state
 * — status (saved / replaced / expired), stored edits, and the receipt once
 * saved — so a reopened chat shows a locked or saved card as it is now.
 * One batch read, and none at all when no message carries a card.
 */
export async function enrichWriteCardBlocks(
  messages: ChatMessage[],
  userId: string,
): Promise<ChatMessage[]> {
  const ids: string[] = [];
  for (const m of messages) {
    for (const b of blocksOf(m)) {
      if (isWriteCardBlock(b)) ids.push(b.cardId);
    }
  }
  if (ids.length === 0) return messages;

  const rows = new Map(
    (await storage.getWriteCardsByIds(userId, ids)).map((r) => [r.id, r]),
  );
  return messages.map((m) => {
    const blocks = blocksOf(m);
    if (!blocks.some(isWriteCardBlock)) return m;
    return {
      ...m,
      metadata: {
        ...(m.metadata as Record<string, unknown>),
        blocks: blocks.map((b) => {
          if (!isWriteCardBlock(b)) return b;
          const row = rows.get(b.cardId);
          if (!row) return b;
          return {
            ...b,
            payload: row.payload,
            edits: storedEdits(row),
            status: row.status,
            ...(row.status === "saved" && {
              receipt: writeCardReceiptFor(row),
            }),
          };
        }),
      },
    };
  });
}

function blocksOf(m: ChatMessage): unknown[] {
  const meta = m.metadata as { blocks?: unknown } | null;
  return Array.isArray(meta?.blocks) ? meta.blocks : [];
}

function isWriteCardBlock(
  b: unknown,
): b is { type: "write_card"; cardId: string } {
  return (
    typeof b === "object" &&
    b !== null &&
    (b as { type?: unknown }).type === "write_card" &&
    typeof (b as { cardId?: unknown }).cardId === "string"
  );
}
