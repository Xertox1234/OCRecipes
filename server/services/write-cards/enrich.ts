import type { ChatMessage } from "@shared/schema";
import { storage } from "../../storage";
import { undoWindowOpen } from "../../storage/coach-write-cards";
import { storedEdits, writeCardReceiptFor } from "./index";
import { foodCardDayOver } from "./food";

/**
 * A saved message's write_card block is a snapshot from when Coach replied.
 * When messages are read back, each block takes the card row's current state
 * — status (saved / replaced / expired), stored edits, and the receipt once
 * saved — so a reopened chat shows a locked or saved card as it is now. A
 * log applied at once keeps its `loggedAtOnce` mark only while Undo is open.
 * One batch read, and none at all when no message carries a card.
 *
 * A live food card whose day is over in the user's timezone is served as
 * expired, so the app stops offering Save (audit 2026-11-24, L107; the save
 * refuses it too). With no known timezone it stays live: a UTC guess would
 * lock a card during a western user's evening. The timezone is looked up
 * only when a live food card is among the rows.
 */
export async function enrichWriteCardBlocks(
  messages: ChatMessage[],
  userId: string,
  resolveTz: () => Promise<string | null> = () => Promise.resolve(null),
): Promise<ChatMessage[]> {
  const ids: string[] = [];
  for (const m of messages) {
    for (const b of blocksOf(m)) {
      if (isWriteCardBlock(b)) ids.push(b.cardId);
    }
  }
  if (ids.length === 0) return messages;

  const now = new Date();
  const rows = new Map(
    (await storage.getWriteCardsByIds(userId, ids)).map((r) => [r.id, r]),
  );
  const tz = [...rows.values()].some(
    (r) => r.kind === "food" && r.status === "live",
  )
    ? await resolveTz()
    : null;
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
          // A log the Coach applied at once (T2) offers Undo only while the
          // server would still take it: not once undone, nor once too late.
          const { loggedAtOnce: _mark, ...rest } = b as typeof b & {
            loggedAtOnce?: true;
          };
          const stillUndoable =
            !!row.savedRefs?.loggedAtOnce && undoWindowOpen(row, now);
          const dayOver =
            row.status === "live" &&
            tz !== null &&
            foodCardDayOver(row, tz, now);
          return {
            ...rest,
            ...(stillUndoable && { loggedAtOnce: true as const }),
            payload: row.payload,
            edits: storedEdits(row),
            status: dayOver ? ("expired" as const) : row.status,
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
