import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import { useToast } from "@/context/ToastContext";

export interface UnseenSave {
  id: number;
  type: string;
  content: string;
  label: string | null;
}

/** The coach saves after the reply ends, so look again shortly after. */
const RETRY_DELAYS_MS = [4000, 10_000];
const NOTEBOOK_KEY = ["/api/coach/notebook"] as const;

/**
 * The "Saved to your notebook" moment (visible memory R2, spec 2026-11-08).
 * `checkForSaves()` after a reply ends (and on screen focus) fetches new saves
 * the user hasn't been shown; showing them marks them shown. `confirm()` —
 * the popup closing on its own — makes them memories the coach may mention;
 * `undo()` rejects them so they're never re-saved. Best effort: a failed or
 * missing feed means no popup and no toast.
 */
export function useNotebookSaves(): {
  saves: UnseenSave[];
  checkForSaves: () => void;
  confirm: () => void;
  undo: () => void;
} {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [saves, setSaves] = useState<UnseenSave[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  const fetchOnce = useCallback(async (): Promise<boolean> => {
    try {
      const res = await apiRequest("GET", "/api/coach/notebook/unseen");
      const { entries } = (await res.json()) as { entries: UnseenSave[] };
      if (!entries?.length) return false;
      await apiRequest("POST", "/api/coach/notebook/shown", {
        ids: entries.map((e) => e.id),
      });
      setSaves((prev) => {
        const seen = new Set(prev.map((s) => s.id));
        return [...prev, ...entries.filter((e) => !seen.has(e.id))];
      });
      return true;
    } catch {
      return false;
    }
  }, []);

  const checkForSaves = useCallback(() => {
    clearTimers();
    void fetchOnce().then((found) => {
      if (found) return;
      for (const wait of RETRY_DELAYS_MS) {
        timers.current.push(
          setTimeout(() => {
            void fetchOnce().then((hit) => {
              if (hit) clearTimers();
            });
          }, wait),
        );
      }
    });
  }, [fetchOnce]);

  const settle = useCallback(
    async (path: "confirm" | "reject") => {
      const ids = saves.map((s) => s.id);
      setSaves([]);
      if (ids.length === 0) return;
      try {
        await apiRequest("POST", `/api/coach/notebook/${path}`, { ids });
        void queryClient.invalidateQueries({ queryKey: NOTEBOOK_KEY });
      } catch {
        if (path === "reject") toast.error("Couldn't undo. Try again.");
      }
    },
    [saves, queryClient, toast],
  );

  return {
    saves,
    checkForSaves,
    confirm: useCallback(() => void settle("confirm"), [settle]),
    undo: useCallback(() => void settle("reject"), [settle]),
  };
}
