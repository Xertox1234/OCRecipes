import { useState, useCallback, useEffect } from "react";
import {
  getSectionState,
  setSectionExpanded,
  getRecentActions,
  pushRecentAction,
  getActionUsageCounts,
  incrementActionUsage,
  initHomeActionsCache,
  type SectionKey,
} from "@/lib/home-actions-storage";
import { useAuthContext } from "@/context/AuthContext";
import { logger } from "@/lib/logger";

export function useHomeActions() {
  const { user } = useAuthContext();
  const [sections, setSections] = useState(getSectionState);
  const [recentActions, setRecentActions] =
    useState<string[]>(getRecentActions);
  const [usageCounts, setUsageCounts] =
    useState<Record<string, number>>(getActionUsageCounts);

  // Pass the active user id so the cache only loads history this device's
  // durable-owner marker confirms belongs to them — re-running on a user switch.
  const userId = user?.id != null ? String(user.id) : null;
  useEffect(() => {
    // Guard against an out-of-order resolution: if userId changes (user switch)
    // while a prior init is in flight, its late .then must not pull the stale
    // user's getters into state. The cleanup flips `cancelled` for the old effect.
    let cancelled = false;
    initHomeActionsCache(userId)
      .then(() => {
        if (cancelled) return;
        setSections(getSectionState());
        setRecentActions(getRecentActions());
        setUsageCounts(getActionUsageCounts());
      })
      .catch((err) => logger.error("initHomeActionsCache failed", err));
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const toggleSection = useCallback((key: SectionKey) => {
    setSections((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      void setSectionExpanded(key, next[key]);
      return next;
    });
  }, []);

  const recordAction = useCallback((actionId: string) => {
    pushRecentAction(actionId)
      .then(() => setRecentActions(getRecentActions()))
      .catch((err) => logger.error("pushRecentAction failed", err));
    incrementActionUsage(actionId)
      .then(() => setUsageCounts(getActionUsageCounts()))
      .catch((err) => logger.error("incrementActionUsage failed", err));
  }, []);

  return { sections, toggleSection, recentActions, recordAction, usageCounts };
}
