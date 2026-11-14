import { shouldReask } from "../ai-sharing-gate-utils";

// Privacy audit H3 — when a refused AI request opens the question.
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
