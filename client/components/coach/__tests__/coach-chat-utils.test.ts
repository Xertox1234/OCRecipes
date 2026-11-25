import { describe, it, expect } from "vitest";
import {
  announcedOffset,
  getStreamFinishAnnouncement,
  parsePlanDays,
  planBannerA11yLabel,
  stripCoachBlocksFence,
  stripCoachBlocksFenceIncremental,
  createFenceScanState,
  filterValidBlocks,
  latestLiveWriteCard,
  lockOlderWriteCards,
  deriveMessageView,
  draftToRestore,
  turnStartBlocked,
} from "../coach-chat-utils";
import type { CoachBlock } from "@shared/schemas/coach-blocks";

const validDays = [
  {
    label: "Monday",
    meals: [
      {
        type: "breakfast" as const,
        title: "Oatmeal",
        calories: 350,
        protein: 12,
      },
      {
        type: "lunch" as const,
        title: "Grilled Chicken Salad",
        calories: 480,
        protein: 38,
      },
      {
        type: "dinner" as const,
        title: "Salmon Bowl",
        calories: 550,
        protein: 42,
      },
    ],
    totals: { calories: 1380, protein: 92 },
  },
  {
    label: "Tuesday",
    meals: [
      {
        type: "breakfast" as const,
        title: "Smoothie",
        calories: 280,
        protein: 20,
      },
    ],
    totals: { calories: 280, protein: 20 },
  },
];

describe("parsePlanDays", () => {
  it("returns typed days from valid plan data", () => {
    const result = parsePlanDays(validDays);
    expect(result).toHaveLength(2);
    expect(result![0].label).toBe("Monday");
    expect(result![0].meals).toHaveLength(3);
    expect(result![1].meals[0].title).toBe("Smoothie");
  });

  it("returns undefined for non-array input", () => {
    expect(parsePlanDays("not an array")).toBeUndefined();
    expect(parsePlanDays(42)).toBeUndefined();
    expect(parsePlanDays(null)).toBeUndefined();
    expect(parsePlanDays(undefined)).toBeUndefined();
  });

  it("returns undefined for array with invalid shape", () => {
    expect(parsePlanDays([{ wrong: "shape" }])).toBeUndefined();
    expect(parsePlanDays([{ label: "Monday" }])).toBeUndefined();
  });

  it("returns undefined for missing required fields in meals", () => {
    const missingCalories = [
      {
        label: "Monday",
        meals: [{ type: "breakfast", title: "Oatmeal", protein: 12 }],
        totals: { calories: 350, protein: 12 },
      },
    ];
    expect(parsePlanDays(missingCalories)).toBeUndefined();
  });

  it("returns undefined for invalid meal type enum", () => {
    const badMealType = [
      {
        label: "Monday",
        meals: [{ type: "brunch", title: "Eggs", calories: 300, protein: 20 }],
        totals: { calories: 300, protein: 20 },
      },
    ];
    expect(parsePlanDays(badMealType)).toBeUndefined();
  });

  it("returns empty array for empty input array", () => {
    expect(parsePlanDays([])).toEqual([]);
  });
});

describe("planBannerA11yLabel", () => {
  it("pluralizes days and meals correctly", () => {
    expect(planBannerA11yLabel(validDays)).toBe(
      "AI meal plan with 2 days and 4 meals",
    );
  });

  it("uses singular for 1 day", () => {
    const oneDay = [validDays[1]];
    expect(planBannerA11yLabel(oneDay)).toBe(
      "AI meal plan with 1 day and 1 meal",
    );
  });

  it("handles day with no meals", () => {
    const emptyDay = [
      { label: "Rest Day", meals: [], totals: { calories: 0, protein: 0 } },
    ];
    expect(planBannerA11yLabel(emptyDay)).toBe(
      "AI meal plan with 1 day and 0 meals",
    );
  });
});

describe("stripCoachBlocksFence", () => {
  it("returns trimmed text when no fence present", () => {
    expect(stripCoachBlocksFence("  hello world  ")).toBe("hello world");
  });

  it("strips fence when only fence present (no preceding text)", () => {
    const input = '```coach_blocks\n{"type":"action_card"}\n```';
    expect(stripCoachBlocksFence(input)).toBe("");
  });

  it("preserves text before the fence and strips fence block", () => {
    const input =
      'Here is your plan.\n```coach_blocks\n{"type":"action_card"}\n```';
    expect(stripCoachBlocksFence(input)).toBe("Here is your plan.");
  });

  it("strips up to end of string when closing fence not yet arrived", () => {
    const input = 'Some text.\n```coach_blocks\n{"type":"action';
    expect(stripCoachBlocksFence(input)).toBe("Some text.");
  });

  it("handles text after closing fence", () => {
    const input = "Before.\n```coach_blocks\n{}\n```\nAfter.";
    expect(stripCoachBlocksFence(input)).toBe("Before.\nAfter.");
  });
});

// AC #2 of
// todos/P3-2026-09-23-perf-minor-recipe-browser-windowing-and-stream-rescan.md
// (2026-09-23 front-end audit finding L10): `stripCoachBlocksFence` re-scans
// the FULL accumulated text from index 0 on every SSE event, which is O(n^2)
// over a long streamed response. `stripCoachBlocksFenceIncremental` tracks
// scan offsets in a `FenceScanState` across repeated calls on a growing
// string so each call only re-scans the unsearched suffix (plus a small
// constant overlap to catch a marker split across two chunks) instead of
// starting over from position 0 every time.
//
// The contract under test: for ANY sequence of chunks appended to build up
// `accumulated`, calling stripCoachBlocksFenceIncremental(accumulated, state)
// after each chunk must return EXACTLY what the whole-text
// stripCoachBlocksFence(accumulated) would return at that same point — the
// incremental version must be a drop-in, cheaper-to-compute replacement, not
// a behavior change.
describe("stripCoachBlocksFenceIncremental", () => {
  /** Feed `full` in the given chunk sizes and assert equivalence with the
   *  whole-text stripCoachBlocksFence after every chunk. */
  function assertEquivalentAcrossChunks(full: string, chunkSizes: number[]) {
    const state = createFenceScanState();
    let acc = "";
    let pos = 0;
    for (const size of chunkSizes) {
      acc += full.slice(pos, pos + size);
      pos += size;
      expect(stripCoachBlocksFenceIncremental(acc, state)).toBe(
        stripCoachBlocksFence(acc),
      );
    }
    expect(pos).toBe(full.length); // sanity: chunk sizes covered the whole string
  }

  it("matches the whole-text version for a single-chunk call with no fence", () => {
    const state = createFenceScanState();
    expect(stripCoachBlocksFenceIncremental("  hello world  ", state)).toBe(
      stripCoachBlocksFence("  hello world  "),
    );
  });

  it("matches the whole-text version for a single-chunk call with a complete fence", () => {
    const state = createFenceScanState();
    const input =
      'Here is your plan.\n```coach_blocks\n{"type":"action_card"}\n```';
    expect(stripCoachBlocksFenceIncremental(input, state)).toBe(
      stripCoachBlocksFence(input),
    );
  });

  it("stays equivalent when the open marker is split across chunks (split at 3, 8, 15 chars in)", () => {
    const full = 'Before text.\n```coach_blocks\n{"a":1}\n```\nAfter.';
    const markerStart = full.indexOf("```coach_blocks\n");
    for (const splitAt of [3, 8, 15]) {
      const firstChunkLen = markerStart + splitAt;
      assertEquivalentAcrossChunks(full, [
        firstChunkLen,
        full.length - firstChunkLen,
      ]);
    }
  });

  it("stays equivalent when the close marker is split across chunks", () => {
    const full = "Before.\n```coach_blocks\n{}\n```\nAfter.";
    const closeStart = full.lastIndexOf("```");
    for (const splitAt of [1, 2]) {
      const firstChunkLen = closeStart + splitAt;
      assertEquivalentAcrossChunks(full, [
        firstChunkLen,
        full.length - firstChunkLen,
      ]);
    }
  });

  it("stays equivalent when the newline right after the close fence arrives in the next chunk", () => {
    const full = "Before.\n```coach_blocks\n{}\n```\nAfter.";
    const closeEnd =
      full.indexOf("```", full.indexOf("```coach_blocks\n") + 16) + 3;
    assertEquivalentAcrossChunks(full, [closeEnd, full.length - closeEnd]);
  });

  it("does not confuse a near-miss triple-backtick fence (e.g. ```json) with the coach_blocks marker", () => {
    const state = createFenceScanState();
    const input = 'Here\'s some code:\n```json\n{"a":1}\n```\nDone.';
    expect(stripCoachBlocksFenceIncremental(input, state)).toBe(
      stripCoachBlocksFence(input),
    );
  });

  it("stays equivalent when the fence never closes (stream still mid-block)", () => {
    const full = 'Before.\n```coach_blocks\n{"partial":"jso';
    assertEquivalentAcrossChunks(
      full,
      Array.from({ length: full.length }, () => 1),
    );
  });

  it("stays equivalent across every possible 1-character chunk boundary for a fenced response", () => {
    const full =
      'Here is your meal plan for today.\n```coach_blocks\n{"type":"action_card","title":"Log Lunch"}\n```\nLet me know if you want changes.';
    assertEquivalentAcrossChunks(
      full,
      Array.from({ length: full.length }, () => 1),
    );
  });

  it("stays equivalent across every possible 1-character chunk boundary for a response with no fence", () => {
    const full =
      "Just a plain streamed answer with no coach_blocks fence at all.";
    assertEquivalentAcrossChunks(
      full,
      Array.from({ length: full.length }, () => 1),
    );
  });
});

describe("filterValidBlocks", () => {
  it("returns only items matching coachBlockSchema", () => {
    const valid = {
      type: "action_card" as const,
      title: "Log Lunch",
      subtitle: "Quick meal entry",
      actionLabel: "Log it",
      action: {
        type: "log_food" as const,
        description: "Chicken salad",
        calories: 350,
        protein: 35,
        fat: 12,
        carbs: 25,
      },
    };
    const invalid = { type: "unknown_block", garbage: true };
    const result = filterValidBlocks([valid, invalid, null, 42]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: "action_card" });
  });

  it("returns empty array when nothing passes validation", () => {
    expect(filterValidBlocks([null, undefined, {}, { type: "bad" }])).toEqual(
      [],
    );
  });
});

describe("announcedOffset", () => {
  it("continues after the announced text when the reply still starts with it", () => {
    expect(announcedOffset("Eat more beans. Then", "Eat more beans.")).toBe(15);
  });

  it("starts over when the text was replaced (a safety override)", () => {
    expect(announcedOffset("Safe message here.", "Eat more beans.")).toBe(0);
  });

  it("starts at zero when nothing was announced", () => {
    expect(announcedOffset("Hello.", "")).toBe(0);
  });
});

describe("getStreamFinishAnnouncement", () => {
  it("on iOS speaks the final sentence the per-sentence announcer never reached", () => {
    // The announcer only fires on "[.?!] " — the last sentence has no trailing space.
    const text = "Eat more beans. Then drink water.";
    expect(getStreamFinishAnnouncement(text, "Eat more beans.", "ios")).toBe(
      "Then drink water.",
    );
  });

  it("on iOS falls back to 'Coach responded' when every sentence was spoken", () => {
    expect(
      getStreamFinishAnnouncement("Eat more beans. ", "Eat more beans.", "ios"),
    ).toBe("Coach responded");
  });

  it("on iOS treats a whitespace-only remainder as nothing left", () => {
    expect(getStreamFinishAnnouncement("Done.  \n ", "Done.", "ios")).toBe(
      "Coach responded",
    );
  });

  it("on iOS speaks a one-sentence reply that never reached a boundary", () => {
    expect(getStreamFinishAnnouncement("Sounds good!", "", "ios")).toBe(
      "Sounds good!",
    );
  });

  // Review finding on #1787: a safety override replaces the reply mid-stream.
  // Offsets into the old text must not slice the safety message mid-word, and
  // an old offset past its end must not silence it.
  it("on iOS speaks a whole safety override even after old sentences were announced", () => {
    expect(
      getStreamFinishAnnouncement(
        "Safe message here. More.",
        "Old text that ran.",
        "ios",
      ),
    ).toBe("Safe message here. More.");
  });

  it("on iOS speaks a short safety override shorter than the announced text", () => {
    expect(
      getStreamFinishAnnouncement(
        "Please talk to a doctor.",
        "A much longer earlier reply that was already announced.",
        "ios",
      ),
    ).toBe("Please talk to a doctor.");
  });

  it("on Android always says 'Coach responded' (sentences are never announced there)", () => {
    expect(
      getStreamFinishAnnouncement(
        "Eat more beans. Then drink water.",
        "Eat more beans.",
        "android",
      ),
    ).toBe("Coach responded");
  });
});

describe("write cards in the chat (spec 2026-11-09)", () => {
  const food = (
    cardId: string,
    status: "live" | "saved" | "replaced" = "live",
    replacesCardId?: string,
  ): CoachBlock => ({
    type: "write_card",
    cardId,
    kind: "food",
    status,
    ...(replacesCardId && { replacesCardId }),
    payload: {
      items: [
        {
          name: "egg",
          unitLabel: "egg",
          perUnit: { calories: 72, protein: 6, carbs: 0, fat: 5 },
          count: 2,
          source: "lookup",
        },
      ],
      mealType: "breakfast",
      day: "today",
    },
  });
  const A = "11111111-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
  const B = "22222222-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
  const C = "33333333-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
  const reply: CoachBlock = {
    type: "quick_replies",
    options: [{ label: "x", message: "x" }],
  };

  it("latestLiveWriteCard ignores saved and replaced cards", () => {
    expect(latestLiveWriteCard([[food(A)], [reply]])).toEqual({
      cardId: A,
      kind: "food",
    });
    expect(latestLiveWriteCard([[food(A)], [food(B, "saved")]])).toBeNull();
    expect(latestLiveWriteCard([[food(A, "replaced")]])).toBeNull();
    expect(latestLiveWriteCard([])).toBeNull();
  });

  it("applyReplacements marks the named card replaced and others expired", () => {
    const out = lockOlderWriteCards([
      [food(A)],
      [food(B)],
      [reply, food(C, "live", B)],
    ]);
    const status = (blocks: CoachBlock[]) =>
      blocks
        .filter((b) => b.type === "write_card")
        .map((b) => (b as { status: string }).status);
    expect(status(out[0])).toEqual(["expired"]);
    expect(status(out[1])).toEqual(["replaced"]);
    expect(status(out[2])).toEqual(["live"]);
    expect(out[2][0]).toBe(reply);
  });

  it("the same card shown twice (footer + saved message) stays live", () => {
    const out = lockOlderWriteCards([[food(A)], [food(A)]]);
    expect(out[0][0]).toMatchObject({ status: "live" });
    expect(out[1][0]).toMatchObject({ status: "live" });
  });

  it("leaves saved cards and lists without a newer card alone", () => {
    const lists = [[food(A, "saved")], [food(B)]];
    const out = lockOlderWriteCards(lists);
    expect(out[0][0]).toMatchObject({ status: "saved" });
    expect(out[1][0]).toMatchObject({ status: "live" });
  });
});

describe("deriveMessageView", () => {
  const msg = (over: Record<string, unknown> = {}) =>
    ({
      id: 7,
      conversationId: 1,
      role: "assistant",
      content: "hi",
      metadata: null,
      createdAt: "2026-01-01T00:00:00Z",
      ...over,
    }) as Parameters<typeof deriveMessageView>[0];
  const ctx = (over: Record<string, unknown> = {}) => ({
    savedBlocks: undefined as CoachBlock[] | undefined,
    heldReplyId: null as number | null,
    showLiveReply: false,
    lastAssistantMessageId: 7 as number | null,
    savedRecipeIds: new Map<number, number>(),
    ...over,
  });
  const quick = { type: "quick_replies", options: [] } as unknown as CoachBlock;
  const finder = {
    type: "recipe_results",
  } as unknown as CoachBlock;
  const memory = { type: "memory_refs", ids: [3, 4] } as unknown as CoachBlock;

  it("plain last assistant message is a retry target with no blocks", () => {
    const v = deriveMessageView(msg(), ctx());
    expect(v).toMatchObject({
      isAssistant: true,
      hasFinderBlock: false,
      isHeld: false,
      isRetryTarget: true,
      memoryRefIds: null,
      savedRecipeId: null,
    });
    expect(v.blocksForMsg).toBeUndefined();
  });

  it("user messages are not assistant and never a retry target", () => {
    const v = deriveMessageView(msg({ role: "user" }), ctx());
    expect(v.isAssistant).toBe(false);
    expect(v.isRetryTarget).toBe(false);
  });

  it("no retry while a live reply shows", () => {
    expect(
      deriveMessageView(msg(), ctx({ showLiveReply: true })).isRetryTarget,
    ).toBe(false);
  });

  it("no retry on a message that is not the last assistant message", () => {
    expect(
      deriveMessageView(msg(), ctx({ lastAssistantMessageId: 9 }))
        .isRetryTarget,
    ).toBe(false);
  });

  // Coach chat audit 2026-11-24 (M21): Regenerate resends the stored text,
  // and a photo turn's stored text is a placeholder with no photo behind it.
  it("no retry under a photo or barcode turn", () => {
    for (const lastUserText of ["Sent a photo", "Scanned a barcode"]) {
      expect(
        deriveMessageView(msg(), ctx({ lastUserText })).isRetryTarget,
      ).toBe(false);
    }
    expect(
      deriveMessageView(msg(), ctx({ lastUserText: "How much protein?" }))
        .isRetryTarget,
    ).toBe(true);
  });

  it("finder block hides the bubble text path and the retry", () => {
    const v = deriveMessageView(msg(), ctx({ savedBlocks: [finder, quick] }));
    expect(v.hasFinderBlock).toBe(true);
    expect(v.isRetryTarget).toBe(false);
    expect(v.blocksForMsg).toEqual([finder, quick]);
  });

  it("a held reply keeps only finder blocks and no retry", () => {
    const v = deriveMessageView(
      msg(),
      ctx({ savedBlocks: [finder, quick], heldReplyId: 7 }),
    );
    expect(v.isHeld).toBe(true);
    expect(v.isRetryTarget).toBe(false);
    expect(v.blocksForMsg).toEqual([finder]);
  });

  it("a held reply with no saved blocks stays undefined", () => {
    const v = deriveMessageView(msg(), ctx({ heldReplyId: 7 }));
    expect(v.isHeld).toBe(true);
    expect(v.blocksForMsg).toBeUndefined();
  });

  it("reads memory ref ids from the memory_refs block", () => {
    expect(
      deriveMessageView(msg(), ctx({ savedBlocks: [quick, memory] }))
        .memoryRefIds,
    ).toEqual([3, 4]);
  });

  it("prefers the in-session saved recipe id over message metadata", () => {
    const m = msg({ metadata: { savedRecipeId: 5 } });
    expect(deriveMessageView(m, ctx()).savedRecipeId).toBe(5);
    expect(
      deriveMessageView(m, ctx({ savedRecipeIds: new Map([[7, 9]]) }))
        .savedRecipeId,
    ).toBe(9);
  });
});

// Coach chat audit 2026-11-24 (M20, M22, M53): every way a turn can start
// asks the same question.
describe("turnStartBlocked", () => {
  const idle = {
    isStreaming: false,
    isSendingPhoto: false,
    photoBusy: false,
    startingTurn: false,
  };

  it("lets a turn start when nothing is in flight", () => {
    expect(turnStartBlocked(idle)).toBe(false);
  });

  it.each([
    ["a reply is streaming", { isStreaming: true }],
    ["a photo is uploading", { isSendingPhoto: true }],
    ["the camera or picker is open", { photoBusy: true }],
    [
      "the first send is still creating the conversation",
      { startingTurn: true },
    ],
  ])("blocks while %s", (_label, over) => {
    expect(turnStartBlocked({ ...idle, ...over })).toBe(true);
  });
});

// Coach chat audit 2026-11-24 (M19): a failed send used to leave the question
// neither on screen nor in the input.
describe("draftToRestore", () => {
  const user = (id: number, content: string) =>
    ({ id, role: "user", content }) as Parameters<
      typeof draftToRestore
    >[0]["messages"][number];
  const reply = (id: number) =>
    ({ id, role: "assistant", content: "ok" }) as Parameters<
      typeof draftToRestore
    >[0]["messages"][number];

  it("gives the text back when the server did not save the turn", () => {
    expect(
      draftToRestore({
        sentText: "How much protein?",
        lastSavedIdAtSend: 8,
        messages: [user(7, "earlier"), reply(8)],
        currentInput: "",
      }),
    ).toBe("How much protein?");
  });

  it("gives it back on a brand-new conversation with no messages", () => {
    expect(
      draftToRestore({
        sentText: "Hello",
        lastSavedIdAtSend: null,
        messages: [],
        currentInput: "",
      }),
    ).toBe("Hello");
  });

  it("gives nothing back when the server saved the question", () => {
    expect(
      draftToRestore({
        sentText: "How much protein?",
        lastSavedIdAtSend: 8,
        messages: [user(7, "earlier"), reply(8), user(9, "How much protein?")],
        currentInput: "",
      }),
    ).toBeNull();
  });

  it("never overwrites what the user has typed since", () => {
    expect(
      draftToRestore({
        sentText: "How much protein?",
        lastSavedIdAtSend: 8,
        messages: [reply(8)],
        currentInput: "something new",
      }),
    ).toBeNull();
  });

  it("gives nothing back for a turn that was not typed text", () => {
    expect(
      draftToRestore({
        sentText: null,
        lastSavedIdAtSend: 8,
        messages: [reply(8)],
        currentInput: "",
      }),
    ).toBeNull();
  });
});
