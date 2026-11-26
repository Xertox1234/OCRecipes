import type { z } from "zod";
import type { CoachWriteCard } from "@shared/schema";
import {
  WRITE_CARD_PAYLOAD_SCHEMAS,
  type WriteCardKind,
} from "@shared/schemas/coach-write-cards";
import { WriteCardEditError } from "./errors";

export type WriteCardPayloadFor<K extends WriteCardKind> = z.infer<
  (typeof WRITE_CARD_PAYLOAD_SCHEMAS)[K]
>;

/**
 * The card's stored payload, parsed with its kind's schema; null when the row
 * is another kind or its jsonb no longer has today's shape (stored before a
 * payload change). Never cast `card.payload` (audit 2026-11-24, L52).
 */
export function readCardPayload<K extends WriteCardKind>(
  card: CoachWriteCard,
  kind: K,
): WriteCardPayloadFor<K> | null {
  if (card.kind !== kind) return null;
  const parsed = WRITE_CARD_PAYLOAD_SCHEMAS[kind].safeParse(card.payload);
  // The schema is the kind's own, so a success is that kind's payload.
  return parsed.success ? (parsed.data as WriteCardPayloadFor<K>) : null;
}

/** As readCardPayload, for a save: a card that does not parse is refused. */
export function savableCardPayload<K extends WriteCardKind>(
  card: CoachWriteCard,
  kind: K,
): WriteCardPayloadFor<K> {
  const payload = readCardPayload(card, kind);
  if (!payload) throw new WriteCardEditError("This card can't be saved now.");
  return payload;
}

/** A saved card's line when its payload no longer parses. */
export const STALE_CARD_RECEIPT = "✓ Saved";
