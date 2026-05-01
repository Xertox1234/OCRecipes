import { useState, useCallback, useEffect } from "react";
import {
  initDiscoveryCache,
  getDismissedCardIds,
  dismissCard,
} from "@/lib/discovery-storage";
import {
  DISCOVERY_CARDS,
  type DiscoveryCard,
} from "@/components/home/discovery-cards-config";

export function useDiscoveryCards(usageCounts: Record<string, number>): {
  cards: DiscoveryCard[];
  dismiss: (id: string) => Promise<void>;
} {
  const [dismissedIds, setDismissedIds] =
    useState<Set<string>>(getDismissedCardIds);

  useEffect(() => {
    initDiscoveryCache().then(() => {
      setDismissedIds(new Set(getDismissedCardIds()));
    });
  }, []);

  const visibleCards = DISCOVERY_CARDS.filter(
    (card) => (usageCounts[card.id] ?? 0) === 0 && !dismissedIds.has(card.id),
  );

  const dismiss = useCallback(async (id: string) => {
    await dismissCard(id);
    setDismissedIds((prev) => new Set([...prev, id]));
  }, []);

  return { cards: visibleCards, dismiss };
}
