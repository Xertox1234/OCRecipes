import { describe, it, expect } from "vitest";
import { ApiError } from "@/lib/api-error";
import {
  UNDO_VISIBLE_MS,
  cardUiState,
  dayChipLabel,
  mealChipLabel,
  saveErrorMessage,
  stepCount,
} from "../write-card-utils";

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
    expect(UNDO_VISIBLE_MS).toBe(6000);
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
