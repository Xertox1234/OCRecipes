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
import { logger } from "@/lib/logger";

export function useHomeActions() {
  const [sections, setSections] = useState(getSectionState);
  const [recentActions, setRecentActions] =
    useState<string[]>(getRecentActions);
  const [usageCounts, setUsageCounts] =
    useState<Record<string, number>>(getActionUsageCounts);

  useEffect(() => {
    initHomeActionsCache()
      .then(() => {
        setSections(getSectionState());
        setRecentActions(getRecentActions());
        setUsageCounts(getActionUsageCounts());
      })
      .catch((err) => logger.error("initHomeActionsCache failed", err));
  }, []);

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
