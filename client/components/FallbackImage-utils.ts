/**
 * Pure utility functions for the FallbackImage component.
 */

/**
 * Determines whether an image source has a valid, non-empty URI string.
 * Returns false for null, undefined, or empty-string URIs.
 */
export function hasValidUri(
  source: { uri: string | undefined | null } | undefined | null,
): source is { uri: string } {
  return typeof source?.uri === "string" && source.uri.length > 0;
}
