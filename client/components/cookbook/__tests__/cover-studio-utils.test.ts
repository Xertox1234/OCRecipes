import { describe, it, expect } from "vitest";

import {
  COVER_IDEAS,
  coverStudioErrorCopy,
  generateButtonLabel,
} from "../cover-studio-utils";
import { ApiError } from "@/lib/api-error";
import { COOKBOOK_COVER_PROMPT_MAX } from "@shared/constants/cookbook-cover-styles";

describe("COVER_IDEAS", () => {
  it("leads with the design's first idea", () => {
    expect(COVER_IDEAS[0]).toBe("Fresh pasta on a floured wooden board");
  });

  it("fit the server's request limit", () => {
    for (const idea of COVER_IDEAS) {
      expect(idea.length).toBeLessThanOrEqual(COOKBOOK_COVER_PROMPT_MAX);
    }
  });
});

describe("generateButtonLabel", () => {
  it("reads 'Generate 4 covers' before the first set", () => {
    expect(generateButtonLabel(false, false)).toBe("Generate 4 covers");
  });

  it("reads 'Generate 4 more' once a set is showing", () => {
    expect(generateButtonLabel(false, true)).toBe("Generate 4 more");
  });

  it("reads 'Generating…' while a set is being made", () => {
    expect(generateButtonLabel(true, true)).toBe("Generating…");
  });
});

describe("coverStudioErrorCopy", () => {
  it.each([
    [
      "DAILY_LIMIT_REACHED",
      "You've made a lot of covers today. Try again tomorrow.",
    ],
    ["RATE_LIMITED", "Give it a moment, then try again."],
    ["PREMIUM_REQUIRED", "AI covers are a premium feature."],
    ["AI_UNAVAILABLE", "Couldn't make covers right now. Try again."],
    ["IMAGE_GENERATION_FAILED", "Couldn't make covers right now. Try again."],
  ])("maps %s to user copy", (code, copy) => {
    expect(coverStudioErrorCopy(new ApiError("429: raw", code, 429))).toBe(
      copy,
    );
  });

  it("never shows a raw error message", () => {
    expect(coverStudioErrorCopy(new Error("500: stack trace"))).toBe(
      "Couldn't make covers right now. Try again.",
    );
  });
});
