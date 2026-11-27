import { describe, expect, it, vi } from "vitest";
import {
  coachProShownReply,
  NO_FIXTURE_RESULT,
  type CoachProGenerator,
} from "../lib/coach-shown-reply";
import {
  SAFETY_CRISIS_FALLBACK_MESSAGE,
  STANDARD_SAFETY_MESSAGE,
} from "../../server/lib/ai-safety";
import type { CoachProChunk } from "../../server/services/nutrition-coach";
import type { CoachContext } from "../../server/services/coach-prompt";

const CTX: CoachContext = {
  goals: { calories: 2000, protein: 120, carbs: 220, fat: 65 },
  todayIntake: { calories: 900, protein: 50, carbs: 100, fat: 30 },
  dietaryProfile: { dietType: null, allergies: [], dislikes: [] },
};
const BASE = {
  history: [],
  context: CTX,
  clock: { now: new Date("2026-11-18T17:30:00Z"), tz: "America/Toronto" },
  flags: { writeCards: true, offer: false },
  fixtures: {},
};

/** A fake generator that yields the chunks and records what it was given. */
function gen(chunks: CoachProChunk[], onCall?: (args: unknown[]) => void) {
  return vi.fn(async function* (...args: unknown[]) {
    onCall?.(args);
    for (const c of chunks) yield c;
  }) as unknown as CoachProGenerator;
}

describe("coachProShownReply (audit 2026-11-24, M30)", () => {
  it("returns the crisis reply without calling the model", async () => {
    const g = gen([]);
    const r = await coachProShownReply(
      { ...BASE, message: "I want to kill myself" },
      g,
    );
    expect(r.text).toBe(SAFETY_CRISIS_FALLBACK_MESSAGE);
    expect(r.modelCalled).toBe(false);
    expect(g).not.toHaveBeenCalled();
  });

  it("splits shown text from blocks and records the tool calls", async () => {
    const r = await coachProShownReply(
      { ...BASE, message: "log two eggs" },
      gen([
        {
          type: "tool_calls",
          toolNames: ["log_food_item"],
          calls: [
            { name: "log_food_item", arguments: '{"food":"egg","count":2}' },
          ],
        },
        { type: "content", content: "Tap the card to log them." },
        {
          type: "content",
          content:
            '\n```coach_blocks\n[{"type":"quick_replies","options":[{"label":"Thanks","message":"Thanks"}]}]\n```',
        },
      ]),
    );
    expect(r.text).toBe("Tap the card to log them.");
    expect(r.blockTypes).toEqual(["quick_replies"]);
    expect(r.toolCalls).toEqual([
      { name: "log_food_item", args: { food: "egg", count: 2 } },
    ]);
    expect(r.modelCalled).toBe(true);
  });

  it("counts a day_progress request as a block, as the app draws it", async () => {
    const r = await coachProShownReply(
      {
        ...BASE,
        message: "how am I doing today?",
        flags: { dayProgress: true },
      },
      gen([
        { type: "content", content: "Here's today." },
        {
          type: "content",
          content:
            '\n```coach_blocks\n[{"type":"day_progress","day":"today"}]\n```',
        },
      ]),
    );
    expect(r.blockTypes).toContain("day_progress");
  });

  it("a safety override replaces the reply with the standard message", async () => {
    const r = await coachProShownReply(
      { ...BASE, message: "hi" },
      gen([{ type: "content", content: "x" }, { type: "safety_override" }]),
    );
    expect(r.text).toBe(STANDARD_SAFETY_MESSAGE);
  });

  it("a provider failure is an error, not a reply to score", async () => {
    await expect(
      coachProShownReply(
        { ...BASE, message: "hi" },
        gen([{ type: "provider_failure" }]),
      ),
    ).rejects.toThrow(/provider failed/);
  });

  it("records an offer_recipe call", async () => {
    const r = await coachProShownReply(
      { ...BASE, message: "how do I make pad thai?", flags: { offer: true } },
      gen([
        {
          type: "terminal_tool",
          name: "offer_recipe",
          args: '{"dish":"pad thai"}',
        },
      ]),
    );
    expect(r.offer).toEqual({ dish: "pad thai" });
  });

  it("passes the history, clock, flags and fixtures to the generator", async () => {
    let seen: unknown[] = [];
    await coachProShownReply(
      {
        ...BASE,
        history: [
          { role: "user", content: "plan my week" },
          { role: "assistant", content: "Here is a plan." },
        ],
        message: "Yes please",
        fixtures: { get_meal_plan: { items: [] } },
        flags: { writeCards: true, pantryCard: true, offer: false },
      },
      gen([{ type: "content", content: "Ok" }], (a) => (seen = a)),
    );
    const [messages, context, , , , , tz, options] = seen as [
      { role: string; content: string }[],
      CoachContext,
      unknown,
      unknown,
      unknown,
      unknown,
      string,
      {
        now: Date;
        writeCards: boolean;
        pantryCard: boolean;
        offerRecipe: boolean;
        readToolResult: (n: string, a: object) => unknown;
      },
    ];
    expect(messages.map((m) => m.content)).toEqual([
      "plan my week",
      "Here is a plan.",
      "Yes please",
    ]);
    expect(context.blocksPrompt).toBeTruthy();
    expect(tz).toBe("America/Toronto");
    expect(options.now.toISOString()).toBe("2026-11-18T17:30:00.000Z");
    expect(options.writeCards).toBe(true);
    expect(options.pantryCard).toBe(true);
    expect(options.offerRecipe).toBe(false);
    expect(options.readToolResult("get_meal_plan", {})).toEqual({ items: [] });
    // A read tool with no fixture gets an empty result, never the database.
    expect(options.readToolResult("get_pantry_items", {})).toEqual(
      NO_FIXTURE_RESULT,
    );
  });
});
