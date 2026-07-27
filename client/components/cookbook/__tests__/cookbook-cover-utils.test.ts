import { describe, it, expect } from "vitest";

import {
  COVER_TITLE_PLACEHOLDER,
  COVER_WIDTH_COMPACT,
  COVER_WIDTH_RESTING,
  coverGenerateActionLabel,
  coverPhotoActionLabel,
  isCoverTitlePlaceholder,
  resolveCoverTitle,
  resolveCoverWidth,
} from "../cookbook-cover-utils";

describe("resolveCoverTitle", () => {
  it("returns the trimmed name", () => {
    expect(resolveCoverTitle("  Weeknight Dinners  ")).toBe(
      "Weeknight Dinners",
    );
  });

  it("falls back to the placeholder for an empty name", () => {
    expect(resolveCoverTitle("")).toBe(COVER_TITLE_PLACEHOLDER);
  });

  it("treats whitespace-only input as empty", () => {
    // Otherwise the cover renders a blank plate that reads as broken.
    expect(resolveCoverTitle("   ")).toBe(COVER_TITLE_PLACEHOLDER);
    expect(resolveCoverTitle("\n\t")).toBe(COVER_TITLE_PLACEHOLDER);
  });
});

describe("isCoverTitlePlaceholder", () => {
  it("agrees with resolveCoverTitle on every input shape", () => {
    for (const input of ["", "   ", "\n", "Dinners", " Dinners "]) {
      expect(isCoverTitlePlaceholder(input)).toBe(
        resolveCoverTitle(input) === COVER_TITLE_PLACEHOLDER,
      );
    }
  });
});

describe("coverPhotoActionLabel", () => {
  it("distinguishes adding from replacing", () => {
    expect(coverPhotoActionLabel(false)).toBe("Add cover photo");
    expect(coverPhotoActionLabel(true)).toBe("Replace cover photo");
  });
});

describe("coverGenerateActionLabel", () => {
  it("marks the action premium when the user cannot generate", () => {
    expect(coverGenerateActionLabel(false, false)).toBe(
      "Generate a cover, premium feature",
    );
  });

  it("omits the premium suffix for an entitled user", () => {
    expect(coverGenerateActionLabel(false, true)).toBe("Generate a cover");
    expect(coverGenerateActionLabel(true, true)).toBe("Generate a new cover");
  });
});

describe("resolveCoverWidth", () => {
  it("uses the resting width when no field is focused", () => {
    expect(resolveCoverWidth(390, false, 24)).toBe(COVER_WIDTH_RESTING);
  });

  it("shrinks while a field is focused so the plate clears the keyboard", () => {
    expect(resolveCoverWidth(390, true, 24)).toBe(COVER_WIDTH_COMPACT);
  });

  it("clamps to the available width on a narrow screen", () => {
    // 200 - 24*2 = 152, below the 232 resting target.
    expect(resolveCoverWidth(200, false, 24)).toBe(152);
  });

  it("never returns a negative width when padding exceeds the screen", () => {
    expect(resolveCoverWidth(40, false, 24)).toBe(0);
  });
});
