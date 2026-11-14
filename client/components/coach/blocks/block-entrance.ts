import type { CoachBlock } from "@shared/schemas/coach-blocks";
import { chatBlockEntrance } from "@/constants/animations";

/** How many beats of the entrance a block takes: a quick-reply row brings
 *  its chips in one at a time, every other block arrives as one piece. */
function beats(block: CoachBlock): number {
  return block.type === "quick_replies" ? Math.max(1, block.options.length) : 1;
}

/**
 * When each of a finished reply's blocks starts its entrance, in
 * milliseconds: one stagger beat after the item before it, where a
 * quick-reply row's chips each count as an item.
 */
export function blockEntranceDelays(blocks: readonly CoachBlock[]): number[] {
  let beat = 0;
  return blocks.map((block) => {
    const delay = beat * chatBlockEntrance.staggerMs;
    beat += beats(block);
    return delay;
  });
}

/** How long the whole entrance takes: until the last item has finished
 *  fading in. Zero with nothing to show. */
export function blockEntranceTotalMs(blocks: readonly CoachBlock[]): number {
  const total = blocks.reduce((sum, block) => sum + beats(block), 0);
  if (total === 0) return 0;
  return (total - 1) * chatBlockEntrance.staggerMs + chatBlockEntrance.duration;
}
