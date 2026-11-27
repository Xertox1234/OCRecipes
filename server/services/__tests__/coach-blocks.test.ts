// server/services/__tests__/coach-blocks.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  validateBlocks,
  parseBlocksFromContent,
  BLOCKS_SYSTEM_PROMPT,
  getBlocksSystemPrompt,
  dropCommitmentCards,
  withOfferRecipeRule,
} from "../coach-blocks";
import { dropMoreCharts } from "../more-charts";
import {
  coachBlockSchema,
  mealPlanCardSchema,
  type CoachBlock,
} from "@shared/schemas/coach-blocks";
import { expectResponseToMatch } from "../../../test/utils/expect-response-schema";
import { logger } from "../../lib/logger";

describe("Coach Blocks Service", () => {
  it("warns with the parse error when a coach_blocks fence holds malformed JSON", () => {
    const warn = vi.spyOn(logger, "warn");
    const result = parseBlocksFromContent(
      "Here you go\n```coach_blocks\n[{not json\n```",
    );
    expect(result.blocks).toEqual([]);
    expect(result.text).toBe("Here you go");
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining("coach blocks JSON"),
    );
    warn.mockRestore();
  });

  it("validates valid blocks array", () => {
    const blocks = [
      {
        type: "quick_replies",
        options: [{ label: "Yes", message: "Yes please" }],
      },
      {
        type: "meal_plan_card",
        title: "High-Protein Day Plan",
        days: [
          {
            label: "Today",
            meals: [
              {
                type: "breakfast",
                title: "Greek Yogurt",
                calories: 320,
                protein: 28,
              },
            ],
            totals: { calories: 320, protein: 28 },
          },
        ],
      },
    ];
    const result = validateBlocks(blocks);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("quick_replies");
    expect(result[1].type).toBe("meal_plan_card");
    // Contract anchor: every block the server emits must satisfy the schema the
    // client parses each SSE block with (client/components/coach/coach-chat-utils.ts).
    // The two loops below are the provider-side anchor that
    // scripts/__tests__/contract-coverage-guard.test.ts requires for
    // coachBlockSchema and mealPlanCardSchema. They cannot fail while
    // validateBlocks filters with the same schema object (a regression pin, not
    // a check), so do not delete them without moving the anchor: the guard goes
    // red the moment no server test references either name.
    for (const block of result) expectResponseToMatch(block, coachBlockSchema);
    for (const block of result)
      if (block.type === "meal_plan_card")
        expectResponseToMatch(block, mealPlanCardSchema);
  });

  it("filters out invalid blocks silently", () => {
    const blocks = [
      { type: "unknown_type", data: "bad" },
      {
        type: "quick_replies",
        options: [{ label: "Yes", message: "Yes please" }],
      },
    ];
    const result = validateBlocks(blocks);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("quick_replies");
  });

  it("returns empty array for no valid blocks", () => {
    const result = validateBlocks([{ type: "bad" }]);
    expect(result).toEqual([]);
  });

  it("parses blocks from JSON-annotated content", () => {
    const content =
      'Here are some options:\n```coach_blocks\n[{"type":"quick_replies","options":[{"label":"Yes","message":"Yes"}]}]\n```';
    const { text, blocks } = parseBlocksFromContent(content);
    expect(text).toBe("Here are some options:");
    expect(blocks).toHaveLength(1);
    for (const block of blocks) expectResponseToMatch(block, coachBlockSchema);
  });

  it("returns original content when no blocks marker found", () => {
    const content = "Just plain text response";
    const { text, blocks } = parseBlocksFromContent(content);
    expect(text).toBe("Just plain text response");
    expect(blocks).toEqual([]);
  });

  it("BLOCKS_SYSTEM_PROMPT contains a complete example whose blocks survive schema validation", () => {
    // Models copy formatting from examples far more reliably than from schema
    // descriptions — and validateBlocks drops malformed blocks silently in
    // prod, so a drifted example would be an invisible feature failure. This
    // test pins the embedded example to coachBlockSchema permanently.
    const { blocks } = parseBlocksFromContent(BLOCKS_SYSTEM_PROMPT);
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    expect(blocks.some((b) => b.type === "quick_replies")).toBe(true);
  });

  it("BLOCKS_SYSTEM_PROMPT does not both mandate and discourage blocks (contradiction fix)", () => {
    // The old rules said "don't force them into every response" AND "Always
    // include quick_replies" — the model resolved the conflict arbitrarily.
    expect(BLOCKS_SYSTEM_PROMPT).not.toMatch(/Always include quick_replies/);
    expect(BLOCKS_SYSTEM_PROMPT).toMatch(
      /quick_replies.*(every|each).*fence|fence.*must contain.*quick_replies/i,
    );
  });

  it("forbids markdown images and links in prose and names recipes instead", () => {
    expect(BLOCKS_SYSTEM_PROMPT).toMatch(
      /never put a recipe image or link in your prose/i,
    );
    expect(BLOCKS_SYSTEM_PROMPT).toMatch(/refer to a recipe by its name/i);
  });

  // search_recipes returns no calories/protein/prep time, and recipe_card
  // requires all three: steering every search hit into a card would make the
  // model invent nutrition numbers in an authoritative-looking card.
  it("allows a recipe_card only when real calories, protein and prep time came from a tool", () => {
    expect(BLOCKS_SYSTEM_PROMPT).toMatch(
      /recipe_card only when you have real calories, protein and prep time/i,
    );
    expect(BLOCKS_SYSTEM_PROMPT).toMatch(
      /search_recipes does not return calories or protein/i,
    );
    expect(BLOCKS_SYSTEM_PROMPT).not.toMatch(
      /Present each recipe from that result as a recipe_card/,
    );
  });

  it("parses both fences when content contains two coach_blocks fences", () => {
    const content = `Here is chart one.\n\`\`\`coach_blocks\n[{"type":"quick_replies","options":[{"label":"Yes","message":"yes"}]}]\n\`\`\`\nAnd here is another.\n\`\`\`coach_blocks\n[{"type":"quick_replies","options":[{"label":"No","message":"no"}]}]\n\`\`\``;
    const result = parseBlocksFromContent(content);
    // Both fences stripped from text
    expect(result.text).not.toContain("```coach_blocks");
    // At least two blocks parsed
    expect(result.blocks.length).toBe(2);
  });
});

// Coach chat audit 2026-11-24, bundle A: replies that showed broken on screen.
describe("replies the old parser saved broken", () => {
  const blocksJson =
    '[{"type":"quick_replies","options":[{"label":"Log breakfast","message":"Help me log breakfast"}]}]';

  it("reads the cards when the model closes the fence with ``> (seen live)", () => {
    const { text, blocks } = parseBlocksFromContent(
      `Try edamame.\n\n\`\`\`coach_blocks\n${blocksJson}\n\`\`>\n`,
    );
    expect(text).toBe("Try edamame.");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("quick_replies");
  });

  it("drops a fence cut off mid-array instead of saving its JSON as prose", () => {
    const warn = vi.spyOn(logger, "warn");
    const { text, blocks } = parseBlocksFromContent(
      'Plan below.\n```coach_blocks\n[{"type":"meal_plan_card","title":"We',
    );
    expect(text).toBe("Plan below.");
    expect(blocks).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("removes the model's own citation markup from the text (seen live)", () => {
    const { text } = parseBlocksFromContent(
      "plant-based yogurts vary. \uE200cite\uE202memory_refs\uE201",
    );
    expect(text).toBe("plant-based yogurts vary.");
  });

  it("keeps the tail of a reply longer than 16,000 characters, and its cards", () => {
    const prose = "word ".repeat(4000).trim();
    const { text, blocks } = parseBlocksFromContent(
      `${prose}\n\`\`\`coach_blocks\n${blocksJson}\n\`\`\``,
    );
    expect(text).toBe(prose);
    expect(blocks).toHaveLength(1);
  });
});

describe("form block", () => {
  const form = {
    type: "form",
    fields: [
      { kind: "choice", label: "Which meal?", options: ["Lunch", "Dinner"] },
      { kind: "number", label: "Servings", min: 1, max: 8, step: 1, value: 2 },
    ],
  };

  it("keeps a form the model wrote, and drops one that breaks the field rules", () => {
    expect(validateBlocks([form])).toHaveLength(1);
    expect(
      validateBlocks([
        { type: "form", fields: [{ ...form.fields[1], value: 99 }] },
      ]),
    ).toEqual([]);
  });

  it("the prompt describes the form, says it saves nothing, and frees it from quick_replies", () => {
    expect(BLOCKS_SYSTEM_PROMPT).toMatch(/- form: \{ type: "form"/);
    expect(BLOCKS_SYSTEM_PROMPT).toMatch(/form only asks/i);
    expect(BLOCKS_SYSTEM_PROMPT).toMatch(
      /must contain a quick_replies block[^\n]*unless it contains a form/i,
    );
  });
});

describe("server-only finder blocks", () => {
  const flow = {
    flowId: "11111111-1111-4111-8111-111111111111",
    stage: "results",
    request: "anything",
    query: { q: "anything" },
    round: 0,
    shownIds: [],
  };

  it("drops a recipe_results block the model wrote — only the server builds finder blocks", () => {
    const content =
      "Here you go.\n```coach_blocks\n" +
      JSON.stringify([
        {
          type: "recipe_results",
          source: "community",
          items: [],
          actions: [],
          notice: null,
          flow,
        },
        {
          type: "quick_replies",
          options: [{ label: "More", message: "More" }],
        },
      ]) +
      "\n```";
    const { blocks } = parseBlocksFromContent(content);
    expect(blocks.map((b) => b.type)).toEqual(["quick_replies"]);
  });

  it("drops model-authored recipe_offer and recipe_adjust blocks but accepts server-built ones", () => {
    // (a) validateBlocks DROPS model-authored blocks of type recipe_offer and recipe_adjust
    const modelContent =
      "Here you go.\n```coach_blocks\n" +
      JSON.stringify([
        {
          type: "recipe_offer",
          flow: { ...flow, stage: "offer" },
        },
        {
          type: "recipe_adjust",
          prefill: { servings: 4, spice: "mild", time: "quick" },
          avoiding: [],
          noted: { dislikes: [] },
          followUps: [],
          flow: { ...flow, stage: "adjust", dish: "Pasta" },
        },
        {
          type: "quick_replies",
          options: [{ label: "Yes", message: "Yes" }],
        },
      ]) +
      "\n```";
    const { blocks: modelBlocks } = parseBlocksFromContent(modelContent);
    // Only quick_replies should survive; offer and adjust are dropped
    expect(modelBlocks.map((b) => b.type)).toEqual(["quick_replies"]);

    // (b) coachBlockSchema ACCEPTS a schema-valid server-built recipe_offer and recipe_adjust block
    const serverOfferBlock = {
      type: "recipe_offer" as const,
      flow: { ...flow, stage: "offer" as const },
    };
    const serverAdjustBlock = {
      type: "recipe_adjust" as const,
      prefill: { servings: 4, spice: "mild" as const, time: "quick" as const },
      avoiding: [],
      noted: { dislikes: [] },
      followUps: [],
      flow: { ...flow, stage: "adjust" as const, dish: "Pasta" },
    };
    // Both should validate against coachBlockSchema
    expectResponseToMatch(serverOfferBlock, coachBlockSchema);
    expectResponseToMatch(serverAdjustBlock, coachBlockSchema);
  });
});

describe("getBlocksSystemPrompt", () => {
  it("is the unchanged prompt with the finder off", () => {
    expect(getBlocksSystemPrompt(false)).toBe(BLOCKS_SYSTEM_PROMPT);
  });

  it("drops every search_recipes instruction with the finder on", () => {
    // Positive control: the source prompt really has the lines being replaced.
    expect(BLOCKS_SYSTEM_PROMPT).toContain("search_recipes");
    const on = getBlocksSystemPrompt(true);
    expect(on).not.toContain("search_recipes");
    expect(on).toContain("recipe finder");
    // The example still validates.
    expect(parseBlocksFromContent(on).blocks.length).toBeGreaterThan(0);
  });

  it("with offer on, replaces the finder rule with the offer_recipe rule", () => {
    const offer = getBlocksSystemPrompt(true, { offer: true });
    expect(offer).toContain("offer_recipe tool");
    expect(offer).not.toContain("ask for one directly");
    expect(offer).not.toContain("search_recipes");
    expect(parseBlocksFromContent(offer).blocks.length).toBeGreaterThan(0);
  });

  it("default output is unchanged by the offer option existing", () => {
    expect(getBlocksSystemPrompt(false, { offer: true })).toBe(
      BLOCKS_SYSTEM_PROMPT,
    );
    expect(getBlocksSystemPrompt(true, {})).toBe(getBlocksSystemPrompt(true));
    expect(getBlocksSystemPrompt(true)).toContain("ask for one directly");
    expect(getBlocksSystemPrompt(true)).toMatchSnapshot();
  });
});

describe("BLOCKS_SYSTEM_PROMPT allergy rule", () => {
  it("offers add_allergy for an allergen missing from the profile, never guessing severity", () => {
    expect(BLOCKS_SYSTEM_PROMPT).toContain('"add_allergy"');
    expect(BLOCKS_SYSTEM_PROMPT).toMatch(/not already in their allergies/i);
    expect(BLOCKS_SYSTEM_PROMPT).toMatch(/never guess.*severity/i);
  });
});

describe("server-only write cards", () => {
  it("drops a write_card block the model wrote — only the server builds write cards", () => {
    const modelWritten = {
      type: "write_card",
      cardId: "6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
      kind: "food",
      status: "live",
      payload: {
        items: [
          {
            name: "Large eggs",
            unitLabel: "egg",
            perUnit: { calories: 72, protein: 6, carbs: 0, fat: 5 },
            count: 2,
            source: "lookup",
          },
        ],
        mealType: "breakfast",
        day: "today",
      },
    };
    expect(validateBlocks([modelWritten])).toEqual([]);
  });

  it("drops a checked_trail block the model wrote — only the server builds the trail", () => {
    expect(
      validateBlocks([{ type: "checked_trail", items: ["your pantry"] }]),
    ).toEqual([]);
  });
});

describe("write-card prompt rules", () => {
  it("writeCards prompt carries the earlier-day Quick Log rule", () => {
    const on = getBlocksSystemPrompt(false, { writeCards: true });
    expect(on).toContain("today or yesterday only");
    expect(on).toContain("Quick Log");
    expect(on).toMatch(
      /Never emit log_food, add_meal_plan or add_grocery_list action cards/,
    );
    expect(
      getBlocksSystemPrompt(true, { offer: true, writeCards: true }),
    ).toContain("find_plan_recipes");
  });

  it("writeCards prompt sends a plan-plus-shopping request to the one card (A1)", () => {
    expect(getBlocksSystemPrompt(false, { writeCards: true })).toMatch(
      /withGroceryList: true[^\n]*never also call add_to_grocery_list/,
    );
  });

  // Coach roadmap T2: for an app that can show a log applied at once.
  it("quickLog lets the reply say a small log was logged, and warns against logging it twice", () => {
    const quick = getBlocksSystemPrompt(false, {
      writeCards: true,
      quickLog: true,
    });
    expect(quick).toMatch(/log_food_item result says it is already logged/);
    expect(quick).toMatch(/would log it twice/);
    // The tap-to-save sentence names its exception instead of contradicting it.
    expect(quick).toMatch(
      /never say something was logged or added, except a small food log/,
    );
    // Without it, never: the card waits on the user's tap.
    const plain = getBlocksSystemPrompt(false, { writeCards: true });
    expect(plain).not.toMatch(/already logged/);
    expect(plain).toMatch(/never say something was logged or added/);
  });

  it("is today's prompt without writeCards", () => {
    expect(getBlocksSystemPrompt(false)).toBe(BLOCKS_SYSTEM_PROMPT);
    expect(getBlocksSystemPrompt(false, { writeCards: false })).toBe(
      BLOCKS_SYSTEM_PROMPT,
    );
  });
});

describe("commitment cards while Coach's notes are paused", () => {
  it("leaves the commitment card out of the prompt and says nothing can be saved", () => {
    const paused = getBlocksSystemPrompt(false, { notesPaused: true });
    expect(paused).not.toContain("commitment_card");
    expect(paused).toMatch(/cannot save a commitment or check in later/);
    // Every other block type is still offered.
    expect(paused).toContain("- quick_replies:");
    expect(paused).toContain("- inline_chart:");
  });

  it("holds with the finder, the offer tool and write cards on", () => {
    const paused = getBlocksSystemPrompt(true, {
      offer: true,
      writeCards: true,
      notesPaused: true,
    });
    expect(paused).not.toContain("commitment_card");
    expect(paused).toMatch(/cannot save a commitment or check in later/);
  });

  it("changes nothing when the notes are not paused", () => {
    expect(getBlocksSystemPrompt(false, { notesPaused: false })).toBe(
      BLOCKS_SYSTEM_PROMPT,
    );
  });

  it("dropCommitmentCards removes only commitment cards", () => {
    const { blocks } = parseBlocksFromContent(
      'Done.\n```coach_blocks\n[{"type":"commitment_card","title":"10,000 steps daily","followUpText":"Check in","followUpDate":"2026-11-30"},{"type":"quick_replies","options":[{"label":"A","message":"a"},{"label":"B","message":"b"}]}]\n```',
    );
    expect(blocks.map((b) => b.type)).toEqual([
      "commitment_card",
      "quick_replies",
    ]);
    expect(dropCommitmentCards(blocks).map((b) => b.type)).toEqual([
      "quick_replies",
    ]);
  });
});

// Coach roadmap T3: the day progress card is a query the server resolves.
describe("day_progress requests", () => {
  const fence = (blocks: unknown[]) =>
    "You're doing well.\n```coach_blocks\n" + JSON.stringify(blocks) + "\n```";
  const QR = {
    type: "quick_replies",
    options: [
      { label: "A", message: "a" },
      { label: "B", message: "b" },
    ],
  };

  it("hands back the day asked for and keeps no model-written block", () => {
    const parsed = parseBlocksFromContent(
      fence([{ type: "day_progress", day: "today" }, QR]),
    );
    expect(parsed.dayProgress).toBe("today");
    expect(parsed.blocks.map((b) => b.type)).toEqual(["quick_replies"]);
  });

  it("drops a model-written block with numbers of its own", () => {
    const forged = {
      type: "day_progress",
      date: "2026-11-26",
      snapshot: {
        totals: { calories: 1, protein: 1, carbs: 1, fat: 1 },
        goals: { calories: 2000, protein: 150, carbs: 250, fat: 67 },
      },
    };
    expect(validateBlocks([forged])).toEqual([]);
    expect(parseBlocksFromContent(fence([forged])).dayProgress).toBeUndefined();
  });

  it("takes the first request when the model asks twice", () => {
    expect(
      parseBlocksFromContent(
        fence([
          { type: "day_progress", day: "yesterday" },
          { type: "day_progress", day: "today" },
        ]),
      ).dayProgress,
    ).toBe("yesterday");
  });

  it("has no request in a reply without one", () => {
    expect(parseBlocksFromContent(fence([QR])).dayProgress).toBeUndefined();
    expect(parseBlocksFromContent("Plain text.").dayProgress).toBeUndefined();
  });

  it("is offered in the prompt only to an app that can draw it", () => {
    const on = getBlocksSystemPrompt(false, {
      writeCards: true,
      dayProgress: true,
    });
    expect(on).toContain('- day_progress: { type: "day_progress", day:');
    expect(on).toMatch(/use one day_progress block, not an inline_chart/);
    // The card's numbers move on; the reply's words should not pin them.
    expect(on).toMatch(/say in words how the day is going/);
    // A week or a trend is still an inline_chart.
    expect(on).toContain("- inline_chart:");
    expect(getBlocksSystemPrompt(false, { writeCards: true })).not.toContain(
      "day_progress",
    );
    expect(getBlocksSystemPrompt(false)).not.toContain("day_progress");
  });
});

describe("withOfferRecipeRule", () => {
  it("is the offer prompt for every option the turn built its prompt with", () => {
    for (const opts of [
      {},
      { writeCards: true },
      { writeCards: true, quickLog: true },
      { writeCards: true, dayProgress: true, notesPaused: true },
    ]) {
      expect(withOfferRecipeRule(getBlocksSystemPrompt(true, opts))).toBe(
        getBlocksSystemPrompt(true, { ...opts, offer: true }),
      );
    }
  });
});

describe("week_progress requests", () => {
  const fence = (blocks: unknown[]) =>
    "A steady week.\n```coach_blocks\n" + JSON.stringify(blocks) + "\n```";

  it("hands back the request and keeps no model-written block", () => {
    const parsed = parseBlocksFromContent(fence([{ type: "week_progress" }]));
    expect(parsed.weekProgress).toBe(true);
    expect(parsed.blocks).toEqual([]);
  });

  it("drops a model-written block with numbers of its own", () => {
    const forged = {
      type: "week_progress",
      endDate: "2026-11-26",
      snapshot: { calories: [1, 1, 1, 1, 1, 1, 1], calorieGoal: 2000 },
    };
    expect(validateBlocks([forged])).toEqual([]);
    // The request form ignores what the model added: the server still reads
    // the week itself.
    expect(parseBlocksFromContent(fence([forged])).weekProgress).toBe(true);
  });

  it("has no request in a reply without one", () => {
    expect(
      parseBlocksFromContent(fence([{ type: "day_progress", day: "today" }]))
        .weekProgress,
    ).toBeUndefined();
    expect(parseBlocksFromContent("Plain text.").weekProgress).toBeUndefined();
  });

  it("is offered in the prompt only to an app that can draw it", () => {
    const on = getBlocksSystemPrompt(false, {
      writeCards: true,
      weekProgress: true,
    });
    expect(on).toContain('- week_progress: { type: "week_progress" }');
    expect(on).toMatch(/use one week_progress block, not an inline_chart/);
    expect(on).toMatch(/say in words how the week went/);
    // It is the last seven days, and the model never saw the card's numbers.
    expect(on).toMatch(/call it the last seven days, not this week/);
    expect(on).toMatch(/only from the days your tools or context showed you/);
    expect(on).toMatch(/rather than guessing how the week went/);
    expect(on).not.toContain("day_progress");
    expect(
      getBlocksSystemPrompt(false, { writeCards: true, dayProgress: true }),
    ).not.toContain("week_progress");
  });

  it("with the day card too, no longer sends a week to inline_chart", () => {
    const both = getBlocksSystemPrompt(false, {
      writeCards: true,
      dayProgress: true,
      weekProgress: true,
    });
    expect(both).toContain("- day_progress:");
    expect(both).toContain("- week_progress:");
    expect(both).not.toMatch(/such as a week or a trend/);
    expect(both).toMatch(/such as a longer trend/);
    // Without the week card the day rule is as it was.
    expect(
      getBlocksSystemPrompt(false, { writeCards: true, dayProgress: true }),
    ).toMatch(/such as a week or a trend/);
  });

  it("keeps the offer prompt equal to a rebuilt one", () => {
    const opts = { writeCards: true, dayProgress: true, weekProgress: true };
    expect(withOfferRecipeRule(getBlocksSystemPrompt(true, opts))).toBe(
      getBlocksSystemPrompt(true, { ...opts, offer: true }),
    );
  });
});

describe("more chart kinds (Coach roadmap T4)", () => {
  const ring = {
    type: "inline_chart",
    chartType: "ring",
    title: "This week's averages",
    data: [{ label: "Protein", value: 120, target: 150 }],
  };
  const bar = { ...ring, chartType: "bar" };

  it("offers ring, sparkline and heatmap only to an app that can draw them", () => {
    const on = getBlocksSystemPrompt(false, {
      writeCards: true,
      moreCharts: true,
    });
    expect(on).toContain(
      'chartType: "bar"|"progress"|"stat_row"|"ring"|"sparkline"|"heatmap"',
    );
    expect(on).toMatch(
      /ring: one to four values, never more, each with its own target above zero/,
    );
    expect(on).toMatch(/put it as target on the last point only/);
    expect(on).toMatch(/heatmap: one square per day, oldest first, at most 35/);
    expect(on).toMatch(
      /for today or yesterday against the goals use day_progress/,
    );
    // It has no multi-day or weight history: no data, no chart.
    expect(on).toMatch(
      /Every value, label and hit must come from a tool result or your context/,
    );
    expect(on).toMatch(/do not draw the chart/);
    expect(on).toMatch(/never estimate or fill in a missing day/);
    expect(on).not.toMatch(/weight over a month|week's average/);

    const off = getBlocksSystemPrompt(false, { writeCards: true });
    expect(off).not.toMatch(/sparkline|heatmap|"ring"/);
    expect(off).toContain('chartType: "bar"|"progress"|"stat_row",');
  });

  it("still places the progress cards next to inline_chart", () => {
    const all = getBlocksSystemPrompt(false, {
      writeCards: true,
      dayProgress: true,
      weekProgress: true,
      moreCharts: true,
    });
    expect(all).toMatch(
      /"heatmap", title, data: \[[^\n]*\n- day_progress:[^\n]*\n- week_progress:/,
    );
  });

  it("drops the new kinds for an app that did not ask for them", () => {
    expect(dropMoreCharts([ring, bar] as CoachBlock[])).toEqual([bar]);
    expect(dropMoreCharts([bar] as CoachBlock[])).toEqual([bar]);
  });

  it("keeps the offer prompt equal to a rebuilt one", () => {
    const opts = { writeCards: true, moreCharts: true };
    expect(withOfferRecipeRule(getBlocksSystemPrompt(true, opts))).toBe(
      getBlocksSystemPrompt(true, { ...opts, offer: true }),
    );
  });
});

describe("label_compare requests (Coach roadmap T4)", () => {
  const fence = (blocks: unknown[]) =>
    "Here they are.\n```coach_blocks\n" + JSON.stringify(blocks) + "\n```";

  it("is read from the reply, and the model's block itself is dropped", () => {
    const parsed = parseBlocksFromContent(
      fence([{ type: "label_compare", scanIds: [4, 9] }]),
    );
    expect(parsed.labelCompare).toEqual([4, 9]);
    expect(parsed.blocks).toEqual([]);
  });

  it("drops a model-authored card that carries its own numbers", () => {
    const forged = {
      type: "label_compare",
      items: [
        {
          scanId: 1,
          name: "A",
          brand: null,
          servingSize: null,
          calories: 1,
          protein: 1,
          carbs: 1,
          fat: 1,
          fiber: null,
          sugar: null,
          sodium: null,
        },
        {
          scanId: 2,
          name: "B",
          brand: null,
          servingSize: null,
          calories: 1,
          protein: 1,
          carbs: 1,
          fat: 1,
          fiber: null,
          sugar: null,
          sodium: null,
        },
      ],
    };
    expect(validateBlocks([forged])).toEqual([]);
    expect(parseBlocksFromContent("Plain text.").labelCompare).toBeUndefined();
  });

  it("is offered in the prompt only to an app that can draw it", () => {
    const on = getBlocksSystemPrompt(false, {
      writeCards: true,
      labelCompare: true,
    });
    expect(on).toContain(
      '- label_compare: { type: "label_compare", scanIds: [id, id] }',
    );
    expect(on).toMatch(
      /call get_recent_scans \(without a limit\), then use one label_compare block/,
    );
    expect(on).toMatch(/each per its own serving/);
    expect(on).toMatch(/say so when the servings differ/);
    // Reviewed 2026-11-27: no guessed ids, no numbers that disagree with
    // the card, no health claims.
    expect(on).toMatch(/never guess an id/);
    expect(on).toMatch(/fewer than two scans[^.]*write no label_compare block/);
    expect(on).toMatch(/do not repeat its numbers, convert them to per 100 g/);
    expect(on).toMatch(
      /A blank value means the label did not list it, not zero/,
    );
    expect(on).toMatch(/no medical claims/);
    expect(on).toMatch(/never say a product is safe for an allergy/);
    expect(getBlocksSystemPrompt(false, { writeCards: true })).not.toContain(
      "label_compare",
    );
  });

  it("keeps the offer prompt equal to a rebuilt one", () => {
    const opts = { writeCards: true, labelCompare: true, moreCharts: true };
    expect(withOfferRecipeRule(getBlocksSystemPrompt(true, opts))).toBe(
      getBlocksSystemPrompt(true, { ...opts, offer: true }),
    );
  });
});
