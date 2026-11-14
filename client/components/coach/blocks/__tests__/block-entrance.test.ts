import { describe, it, expect, vi, afterEach } from "vitest";
import { FadeInUp } from "react-native-reanimated";
import type { CoachBlock } from "@shared/schemas/coach-blocks";
import {
  chatBlockEntrance,
  chatBlockRiseEntrance,
} from "@/constants/animations";
import { blockEntranceDelays, blockEntranceTotalMs } from "../block-entrance";

const card = {
  type: "action_card",
  title: "t",
  subtitle: "s",
  actionLabel: "go",
  action: { type: "set_goal", goalType: "calories" },
} as unknown as CoachBlock;

function replies(n: number): CoachBlock {
  return {
    type: "quick_replies",
    options: Array.from({ length: n }, (_, i) => ({
      label: `o${i}`,
      message: `m${i}`,
    })),
  } as CoachBlock;
}

const STAGGER = chatBlockEntrance.staggerMs;

describe("blockEntranceDelays", () => {
  it("staggers each block after the one before", () => {
    expect(blockEntranceDelays([card, card, card])).toEqual([
      0,
      STAGGER,
      2 * STAGGER,
    ]);
  });

  // Each chip enters on its own beat, so a row of chips takes a slot per
  // chip and the block after it waits for the last one.
  it("gives a quick-reply row one beat per chip", () => {
    expect(blockEntranceDelays([card, replies(3), card])).toEqual([
      0,
      STAGGER,
      4 * STAGGER,
    ]);
  });

  it("treats an empty quick-reply row as one beat", () => {
    expect(blockEntranceDelays([replies(0), card])).toEqual([0, STAGGER]);
  });
});

describe("blockEntranceTotalMs", () => {
  it("is zero with nothing to show", () => {
    expect(blockEntranceTotalMs([])).toBe(0);
  });

  it("lasts until the last item has finished fading in", () => {
    // card at 0, three chips at 1–3 beats: the last starts at 3 beats.
    expect(blockEntranceTotalMs([card, replies(3)])).toBe(
      3 * STAGGER + chatBlockEntrance.duration,
    );
  });
});

describe("chatBlockRiseEntrance", () => {
  afterEach(() => vi.restoreAllMocks());

  it("fades in with a small rise after the given delay", () => {
    const anim = FadeInUp as unknown as Record<string, () => unknown>;
    const duration = vi.spyOn(anim, "duration");
    const delay = vi.spyOn(anim, "delay");
    const initial = vi.spyOn(anim, "withInitialValues");

    chatBlockRiseEntrance(90);

    expect(duration).toHaveBeenCalledWith(chatBlockEntrance.duration);
    expect(delay).toHaveBeenCalledWith(90);
    expect(initial).toHaveBeenCalledWith({
      opacity: 0,
      transform: [{ translateY: chatBlockEntrance.rise }],
    });
  });
});
