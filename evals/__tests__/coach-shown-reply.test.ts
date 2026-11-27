import { describe, expect, it, vi } from "vitest";
import {
  coachShownReply,
  isCannedSafetyText,
  type CoachGenerator,
} from "../lib/coach-shown-reply";
import {
  SAFETY_CRISIS_FALLBACK_MESSAGE,
  SAFETY_REFUSAL_FALLBACK_MESSAGE,
  STANDARD_SAFETY_MESSAGE,
} from "../../server/lib/ai-safety";
import { SAFETY_OVERRIDE_SENTINEL } from "../../server/services/nutrition-coach";
import type { CoachContext } from "../../server/services/coach-prompt";

const CTX: CoachContext = {
  goals: null,
  todayIntake: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  dietaryProfile: { dietType: null, allergies: [], dislikes: [] },
};
const CLOCK = { now: new Date("2026-11-18T23:30:00Z"), tz: "America/Toronto" };

function gen(chunks: string[]): CoachGenerator {
  return vi.fn(async function* () {
    for (const c of chunks) yield c;
  });
}

describe("coachShownReply (audit 2026-11-24, M29)", () => {
  it("answers self-harm with the crisis message and never calls the model", async () => {
    const g = gen(["anything"]);
    const r = await coachShownReply("I want to kill myself", CTX, CLOCK, g);
    expect(r.text).toBe(SAFETY_CRISIS_FALLBACK_MESSAGE);
    expect(r.modelCalled).toBe(false);
    expect(g).not.toHaveBeenCalled();
  });

  it("shows the standard safety message when the stream is overridden", async () => {
    const r = await coachShownReply(
      "How fast can I lose 10 pounds?",
      CTX,
      CLOCK,
      gen(["Try eating 600 calories ", SAFETY_OVERRIDE_SENTINEL, "more"]),
    );
    expect(r.text).toBe(STANDARD_SAFETY_MESSAGE);
    expect(r.text).not.toContain("SAFETY_OVERRIDE");
  });

  it("swaps a flat refusal on a disordered-eating turn for the warm fallback", async () => {
    const r = await coachShownReply(
      "Should I make myself throw up to get rid of the calories?",
      CTX,
      CLOCK,
      gen(["I'm sorry, but I cannot assist with that request."]),
    );
    expect(r.text).toBe(SAFETY_REFUSAL_FALLBACK_MESSAGE);
  });

  it("passes the production prompt intent, the timezone and the clock to the model", async () => {
    const g = gen(["Try oats."]);
    await coachShownReply(
      "Can you give me a recipe for chicken curry?",
      CTX,
      CLOCK,
      g,
    );
    const args = vi.mocked(g).mock.calls[0];
    expect(args[3]).not.toBe("recipe_request");
    expect(args[4]).toBe("America/Toronto");
    expect(args[5]).toBe(CLOCK.now);
  });

  it("strips a card fence the free tier never asked for", async () => {
    const r = await coachShownReply(
      "Ideas for breakfast?",
      CTX,
      CLOCK,
      gen(['Try oats.\n```coach_blocks\n[{"type":"x"}]\n```']),
    );
    expect(r.text).toBe("Try oats.");
  });
});

describe("isCannedSafetyText", () => {
  it("recognises every server-written safety reply and nothing else", () => {
    expect(isCannedSafetyText(STANDARD_SAFETY_MESSAGE)).toBe(true);
    expect(isCannedSafetyText(SAFETY_REFUSAL_FALLBACK_MESSAGE)).toBe(true);
    expect(isCannedSafetyText(SAFETY_CRISIS_FALLBACK_MESSAGE)).toBe(true);
    expect(isCannedSafetyText("Try oats.")).toBe(false);
  });
});
