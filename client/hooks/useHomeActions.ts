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

export function useHomeActions() {
  const [sections, setSections] = useState(getSectionState);
  const [recentActions, setRecentActions] =
    useState<string[]>(getRecentActions);
  const [usageCounts, setUsageCounts] =
    useState<Record<string, number>>(getActionUsageCounts);

  useEffect(() => {
    initHomeActionsCache().then(() => {
      setSections(getSectionState());
      setRecentActions(getRecentActions());
      setUsageCounts(getActionUsageCounts());
    });
  }, []);

  const toggleSection = useCallback((key: SectionKey) => {
    setSections((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      setSectionExpanded(key, next[key]);
      return next;
    });
  }, []);

  const recordAction = useCallback((actionId: string) => {
    pushRecentAction(actionId)
      .then(() => setRecentActions(getRecentActions()))
      .catch(console.error);
    incrementActionUsage(actionId)
      .then(() => setUsageCounts(getActionUsageCounts()))
      .catch(console.error);
  }, []);

  return { sections, toggleSection, recentActions, recordAction, usageCounts };
}
