import { describe, it, expect } from "vitest";
import { buildSystemPrompt, type CoachContext } from "../nutrition-coach";
import type { CoachIntent } from "../coach-intent-classifier";

// Show-the-work spec 2026-11-09 (R8, M4): targets only when they change the
// answer; answer first in two or three sentences.

const context: CoachContext = {
  goals: { calories: 2000, protein: 120, carbs: 250, fat: 65 },
  todayIntake: { calories: 600, protein: 40, carbs: 70, fat: 20 },
  dietaryProfile: { dietType: null, allergies: [], dislikes: [] },
};
const NOW = new Date("2026-11-09T12:00:00Z");
const INTENTS: CoachIntent[] = [
  "personalized_advice",
  "general_fact",
  "vague_request",
  "safety_refusal",
];
const prompt = (
  tier: "free" | "pro",
  intent: CoachIntent = "personalized_advice",
) => buildSystemPrompt(context, intent, { now: NOW, tz: "UTC", tier });

describe("coach reply-shape prompt rules", () => {
  it("no blanket cite-remaining rule in any intent or tier", () => {
    for (const tier of ["free", "pro"] as const) {
      for (const intent of INTENTS) {
        const p = prompt(tier, intent);
        expect(p).not.toMatch(/ALWAYS reference at least one specific number/);
        expect(p).not.toMatch(/Calculate remaining macros/);
        expect(p).not.toMatch(/MUST reference a visible number/);
        expect(p).not.toMatch(/cite remaining protein today/);
      }
    }
  });

  it("numbers only when they bear on the answer", () => {
    for (const tier of ["free", "pro"] as const) {
      expect(prompt(tier)).toMatch(/only when the answer depends on them/);
    }
  });

  it("answer first, two or three sentences", () => {
    for (const tier of ["free", "pro"] as const) {
      expect(prompt(tier)).toMatch(/two or three sentences, then stop/);
      expect(prompt(tier)).not.toMatch(/aim for 2-4 sentences/);
    }
  });

  it("pro: no text before tools, follow-ups as chips", () => {
    expect(prompt("pro")).toMatch(
      /Do not write anything before calling a tool/,
    );
    expect(prompt("pro")).toMatch(/quick_replies block/);
    expect(prompt("free")).not.toMatch(
      /Do not write anything before calling a tool/,
    );
    expect(prompt("free")).not.toMatch(/quick_replies block/);
  });

  it("free: at most one follow-up question", () => {
    expect(prompt("free")).toMatch(/at most one short follow-up question/);
  });

  it("examples no longer open on the remaining-macros sentence", () => {
    for (const intent of INTENTS) {
      const examples = prompt("pro", intent)
        .split("\n")
        .filter((l) => l.startsWith("NutriCoach: '"));
      for (const line of examples) {
        expect(line).not.toMatch(/^NutriCoach: '(You've got|You have) about/);
        expect(line).not.toMatch(/cal and \d+g protein left today/);
      }
    }
  });

  it("no example recites two targets or two remaining figures", () => {
    for (const intent of INTENTS) {
      for (const line of prompt("pro", intent)
        .split("\n")
        .filter((l) => l.startsWith("NutriCoach: '"))) {
        expect(line).not.toMatch(/of [\d,]+ cal and \d+ of \d+g protein/);
        expect(line).not.toMatch(
          /\d+g (carbs|protein|fat) and \d+g (carbs|protein|fat) (remaining|left)/,
        );
      }
    }
  });

  it("the unsafe-request template keeps refusal and referral in one clause", () => {
    const p = prompt("pro", "safety_refusal");
    expect(p).toMatch(/REFUSAL \+ REFERRAL/);
    expect(p).toMatch(/recommend the relevant professional/);
  });
});
