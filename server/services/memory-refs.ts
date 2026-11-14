import type { CoachBlock } from "@shared/schemas/coach-blocks";

/**
 * Keep a reply's memory_refs honest (visible memory R1): only ids from the
 * user's confirmed notebook set given to the prompt survive, deduped; a block
 * with none left is dropped. The model's claim alone never reaches the screen.
 */
export function filterMemoryRefs(
  blocks: CoachBlock[],
  confirmedIds: ReadonlySet<number>,
): CoachBlock[] {
  const out: CoachBlock[] = [];
  for (const block of blocks) {
    if (block.type !== "memory_refs") {
      out.push(block);
      continue;
    }
    const ids = [...new Set(block.ids)].filter((id) => confirmedIds.has(id));
    if (ids.length > 0) out.push({ type: "memory_refs", ids });
  }
  return out;
}
