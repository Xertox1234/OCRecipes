/**
 * Pure formatting utilities for SavedItemCard.
 * Extracted for testability — no React or RN dependencies.
 */
import { parseTimeEstimateMinutes } from "@shared/lib/recipe-time";
import { formatDuration } from "@/lib/format";

interface ShareableItem {
  title: string;
  description: string | null;
  instructions: string | null;
  sourceProductName: string | null;
}

/** Build the share message content for a saved item. */
export function buildShareContent(item: ShareableItem): string {
  let content = `${item.title}\n`;

  if (item.description) {
    content += `\n${item.description}\n`;
  }

  if (item.instructions) {
    content += `\nInstructions:\n${item.instructions}\n`;
  }

  if (item.sourceProductName) {
    content += `\nSuggested for: ${item.sourceProductName}`;
  }

  return content;
}

/**
 * The time estimate as one spelling. The AI writes it as free text ("1 hour
 * 15 min" beside "1 hr 30 min" in the same list — visual QA sweep #82), so a
 * readable estimate is re-spelled through `formatDuration`; text the parser
 * cannot read ("Quick") is shown as written.
 */
export function formatSavedItemTime(
  timeEstimate: string | null | undefined,
): string | null {
  if (!timeEstimate) return null;
  const minutes = parseTimeEstimateMinutes(timeEstimate);
  return minutes === null ? timeEstimate : formatDuration(minutes);
}
