import { needsAiSharingAnswer, shouldReask } from "../ai-sharing-gate-utils";

// Privacy audit H3 — when the AI-sharing question is put in front of the user.
describe("needsAiSharingAnswer", () => {
  it("asks a signed-in account that has never answered", () => {
    expect(
      needsAiSharingAnswer(true, { allowed: false, answered: false }),
    ).toBe(true);
  });

  it("does not ask again once answered, either way", () => {
    expect(needsAiSharingAnswer(true, { allowed: true, answered: true })).toBe(
      false,
    );
    expect(needsAiSharingAnswer(true, { allowed: false, answered: true })).toBe(
      false,
    );
  });

  it("does not block the app while the status is unknown (loading, offline)", () => {
    expect(needsAiSharingAnswer(true, undefined)).toBe(false);
  });

  it("never asks a signed-out visitor", () => {
    expect(
      needsAiSharingAnswer(false, { allowed: false, answered: false }),
    ).toBe(false);
  });
});

describe("shouldReask", () => {
  it("opens the question when an AI request was refused", () => {
    expect(shouldReask("Main")).toBe(true);
    expect(shouldReask("PhotoAnalysis")).toBe(true);
  });

  it("does not stack a second copy on top of the question", () => {
    expect(shouldReask("AiSharing")).toBe(false);
  });

  it("waits when the current screen is unknown", () => {
    expect(shouldReask(undefined)).toBe(false);
  });
});
