import { useEffect } from "react";
import { AccessibilityInfo } from "react-native";

// Cards already announced in this app session, by `${kind}:${flowId}`. Lives
// outside any component on purpose: a card row remounts (a FlatList row
// scrolled out and back, RecipeChef's pending bubble → saved row, reopening
// the chat) and must not be announced again. flowIds are server-minted and
// unique per flow, so the set only grows by one entry per card shown live.
const announced = new Set<string>();

/**
 * Announce a finder card once, when it first shows up live. No live region
 * covers a card's arrival, so this is ungated on both platforms (same as
 * RecipeResultsList). Off while `enabled` is false (RecipeChef's pending
 * bubble, whose saved row announces instead) and for an inert old card.
 */
export function useCardArrivalAnnouncement(
  key: string,
  message: string,
  { enabled, isActive }: { enabled: boolean; isActive: boolean },
): void {
  useEffect(() => {
    if (!enabled || !isActive || announced.has(key)) return;
    announced.add(key);
    AccessibilityInfo.announceForAccessibility(message);
  }, [key, message, enabled, isActive]);
}
