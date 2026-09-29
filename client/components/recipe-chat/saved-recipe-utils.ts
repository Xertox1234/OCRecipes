// The chat save route merges { savedRecipeId } into the assistant message's
// metadata (server/storage/recipe-from-chat.ts, step 7), so a reopened chat
// can still tell which community recipe a card was saved as.
export function savedRecipeIdFromMetadata(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== "object") return null;
  const id = (metadata as Record<string, unknown>).savedRecipeId;
  return typeof id === "number" && Number.isInteger(id) && id > 0 ? id : null;
}
