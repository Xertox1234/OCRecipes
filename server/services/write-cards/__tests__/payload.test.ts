import { describe, it, expect } from "vitest";
import type { WriteCardKind } from "@shared/schemas/coach-write-cards";
import type { WriteCardTx } from "../../../storage/coach-write-cards";
import { createMockCoachWriteCard } from "../../../__tests__/factories";

const {
  describeLiveCard,
  describeLoggedFood,
  performWriteCardSave,
  writeCardReceiptFor,
  WriteCardEditError,
} = await import("../index");
const { readCardPayload } = await import("../payload");

// Audit 2026-11-24, L52: a card stored before a payload-shape change (or a
// row edited by hand) must never be read as if it had today's shape.
const stale = (kind: WriteCardKind) =>
  createMockCoachWriteCard({
    kind,
    payload: { items: [{ name: "egg" }], rows: [{}], allergen: 7 },
  });

const KINDS: WriteCardKind[] = [
  "food",
  "grocery",
  "plan",
  "pantry",
  "goals",
  "allergy",
];

describe("readCardPayload", () => {
  it("returns the parsed payload when it matches the kind", () => {
    const card = createMockCoachWriteCard({
      kind: "allergy",
      payload: { allergen: "milk" },
    });
    expect(readCardPayload(card, "allergy")).toEqual({ allergen: "milk" });
  });

  it("returns null for a payload that does not parse, or another kind", () => {
    expect(readCardPayload(stale("food"), "food")).toBeNull();
    const allergy = createMockCoachWriteCard({
      kind: "allergy",
      payload: { allergen: "milk" },
    });
    expect(readCardPayload(allergy, "food")).toBeNull();
  });
});

describe("a stored payload that no longer parses", () => {
  const tx = {} as WriteCardTx;
  const ctx = { userId: "1", tz: "UTC", now: new Date() };

  it.each(KINDS)("%s: the save refuses it", async (kind) => {
    const edits = kind === "allergy" ? { severity: "mild" } : {};
    await expect(
      performWriteCardSave(tx, stale(kind), edits, ctx),
    ).rejects.toBeInstanceOf(WriteCardEditError);
  });

  it.each(KINDS)("%s: no prompt line, no throw", (kind) => {
    expect(describeLiveCard(stale(kind))).toBeNull();
  });

  it("a logged food: no prompt line, no throw", () => {
    expect(describeLoggedFood(stale("food"))).toBeNull();
  });

  it.each(KINDS)("%s: the receipt falls back to a plain line", (kind) => {
    expect(
      writeCardReceiptFor({
        ...stale(kind),
        status: "saved",
        savedRefs: { listId: 7, groceryItemIds: [1] },
      }),
    ).toBe("✓ Saved");
  });
});
