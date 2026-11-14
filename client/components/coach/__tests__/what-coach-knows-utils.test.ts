import { describe, it, expect } from "vitest";
import { groupForPage } from "../what-coach-knows-utils";

const e = (
  id: number,
  type: string,
  content: string,
  over: { status?: string; confirmedAt?: string | null } = {},
) => ({
  id,
  type,
  content,
  status: over.status ?? "active",
  confirmedAt: over.confirmedAt === undefined ? "2026-11-01" : over.confirmedAt,
});

describe("groupForPage", () => {
  it("groups active entries by meaning, in the user's words", () => {
    const g = groupForPage([
      e(1, "goal", "The user aims for 120 g protein a day"),
      e(2, "preference", "User avoids dairy"),
      e(3, "commitment", "User plans to try pumpkin seeds", {
        confirmedAt: null,
      }),
    ]);
    expect(g.goals).toEqual([
      { id: 1, text: "You aim for 120 g protein a day", confirmed: true },
    ]);
    expect(g.preferences).toEqual([
      { id: 2, text: "You avoid dairy", confirmed: true },
    ]);
    expect(g.trying).toEqual([
      { id: 3, text: "You plan to try pumpkin seeds", confirmed: false },
    ]);
  });

  it("hides interpretations, summaries, feelings and anything not active", () => {
    const g = groupForPage([
      e(1, "insight", "Snacks late"),
      e(2, "motivation", "Wants energy"),
      e(3, "conversation_summary", "Talked about lunch"),
      e(4, "emotional_context", "Stressed"),
      e(5, "goal", "Old goal", { status: "archived" }),
      e(6, "preference", "Undone", { status: "rejected" }),
    ]);
    expect(g).toEqual({
      goals: [],
      preferences: [],
      trying: [],
      howCoachTalks: null,
    });
  });

  it("softens the coaching strategy into one fixed line, never its text", () => {
    const g = groupForPage([
      e(1, "coaching_strategy", "Be blunt; user resists"),
    ]);
    expect(g.howCoachTalks).toBe("Keeps suggestions short and practical.");
  });

  it("knows when there is nothing to show", () => {
    expect(groupForPage([]).goals).toEqual([]);
  });
});
