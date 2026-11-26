import { describe, it, expect } from "vitest";
import { ApiError } from "@/lib/api-error";
import {
  atOnceUndoShown,
  cardUiState,
  dayChipLabel,
  mealChipLabel,
  saveErrorMessage,
  stackCardRow,
  stepCount,
} from "../write-card-utils";

describe("stackCardRow", () => {
  // iOS body text: Large (default) 1.0, XXXL ≈ 1.35, the largest
  // accessibility size ≈ 3.1. Side by side, the tag and amount left the name
  // one letter wide at the largest size (sim check 2026-11-22).
  it("keeps the row on one line at the default sizes", () => {
    expect(stackCardRow(1)).toBe(false);
    expect(stackCardRow(1.24)).toBe(false);
  });
  it("stacks the row from XXXL up", () => {
    expect(stackCardRow(1.35)).toBe(true);
    expect(stackCardRow(3.1)).toBe(true);
  });
});

describe("stepCount", () => {
  it("stepCount clamps at 0 and 20", () => {
    expect(stepCount(0, -1)).toBe(0);
    expect(stepCount(20, 1)).toBe(20);
    expect(stepCount(2, 1)).toBe(3);
    expect(stepCount(2, -1)).toBe(1);
  });
});

describe("cardUiState", () => {
  const idle = { saving: false, error: null };
  it("cardUiState: saving overrides live; server saved wins", () => {
    expect(cardUiState("live", idle)).toBe("live");
    expect(cardUiState("live", { saving: true, error: null })).toBe("saving");
    expect(cardUiState("live", { saving: false, error: "x" })).toBe("failed");
    expect(cardUiState("saved", { saving: false, error: "x" })).toBe("saved");
    expect(cardUiState("replaced", idle)).toBe("replaced");
    expect(cardUiState("expired", { saving: true, error: null })).toBe(
      "expired",
    );
  });
});

describe("labels", () => {
  it("names meals and days", () => {
    expect(mealChipLabel("breakfast")).toBe("Breakfast");
    expect(dayChipLabel("today")).toBe("Today");
    expect(dayChipLabel("yesterday")).toBe("Yesterday");
  });
});

describe("saveErrorMessage", () => {
  it("speaks to the cause", () => {
    expect(saveErrorMessage(new ApiError("409: x", "CARD_LOCKED", 409))).toBe(
      "This card was replaced by a newer one.",
    );
    expect(saveErrorMessage(new ApiError("409: x", "UNDO_EXPIRED", 409))).toBe(
      "It's too late to undo this.",
    );
    expect(
      saveErrorMessage(
        new ApiError(
          '400: {"error":"That list isn\'t available.","code":"VALIDATION_ERROR"}',
          "VALIDATION_ERROR",
          400,
        ),
      ),
    ).toBe("That list isn't available.");
    expect(saveErrorMessage(new TypeError("Network request failed"))).toBe(
      "Couldn't save. Check your connection and try again.",
    );
  });
});

// Coach roadmap T2: a food log the Coach applied at once arrives saved, and
// offers Undo with no Save tap.
describe("atOnceUndoShown", () => {
  const shown = {
    loggedAtOnce: true as const,
    status: "saved" as const,
    isActive: true as boolean | undefined,
    replyInFlight: false,
    closed: false,
  };

  it("shows Undo on the newest reply's card", () => {
    expect(atOnceUndoShown(shown)).toBe(true);
    // The reply still on its way in (the footer copy) has no isActive.
    expect(atOnceUndoShown({ ...shown, isActive: undefined })).toBe(true);
  });

  it("not for a card the user saves with a tap", () => {
    expect(atOnceUndoShown({ ...shown, loggedAtOnce: undefined })).toBe(false);
  });

  it("ends when the user sends the next message", () => {
    expect(atOnceUndoShown({ ...shown, replyInFlight: true })).toBe(false);
    expect(atOnceUndoShown({ ...shown, isActive: false })).toBe(false);
  });

  it("ends once undone, or once the server said it is too late", () => {
    expect(atOnceUndoShown({ ...shown, status: "live" })).toBe(false);
    expect(atOnceUndoShown({ ...shown, closed: true })).toBe(false);
  });
});
