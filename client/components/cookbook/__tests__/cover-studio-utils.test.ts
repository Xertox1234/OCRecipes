import { describe, it, expect, vi } from "vitest";

import {
  COVER_IDEAS,
  coverStudioErrorCopy,
  generateButtonLabel,
  requestCoverSet,
} from "../cover-studio-utils";
import { ApiError } from "@/lib/api-error";
import { COOKBOOK_COVER_PROMPT_MAX } from "@shared/constants/cookbook-cover-styles";

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));

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

describe("requestCoverSet", () => {
  it("returns the set on success", async () => {
    await expect(requestCoverSet(async () => "set")).resolves.toEqual({
      ok: true,
      set: "set",
    });
  });

  it("returns user copy, never the raw message, on failure", async () => {
    await expect(
      requestCoverSet(async () => {
        throw new ApiError("429: raw", "RATE_LIMITED", 429);
      }),
    ).resolves.toEqual({
      ok: false,
      error: "Give it a moment, then try again.",
    });
  });
});
