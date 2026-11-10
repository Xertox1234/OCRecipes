import { describe, it, expect } from "vitest";
import { AI_RECIPIENTS, AI_RECIPIENT_NAMES } from "@shared/lib/ai-sharing";
import { PINNED_HOSTS } from "../ai-models";

// Privacy audit H3: the in-app disclosure must name every company an AI
// request can reach. The routing table is the source of truth.
describe("AI recipients shown to the user", () => {
  it("names every host an AI model is pinned to", () => {
    const named = AI_RECIPIENTS.map((r) => r.host as string);
    for (const host of Object.values(PINNED_HOSTS)) {
      expect(named).toContain(host);
    }
  });

  it("names OpenRouter, the route every request takes first", () => {
    expect(AI_RECIPIENTS.map((r) => r.name)).toContain("OpenRouter");
  });

  it("puts every recipient in the one-line phrase", () => {
    for (const { name } of AI_RECIPIENTS) {
      expect(AI_RECIPIENT_NAMES).toContain(name);
    }
  });
});
