import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import { getDeviceTimezone } from "@/lib/timezone";
import { GOALS_QUERY_KEY } from "@/hooks/useCalorieGoal";
import { QUERY_KEYS } from "@/lib/query-keys";
import type {
  WriteCardKind,
  WriteCardStatus,
} from "@shared/schemas/coach-write-cards";

/**
 * Save and Undo for one Coach write card (spec 2026-11-09). The server saves
 * from the card it stored; this sends only the user's edits. On success the
 * chat's messages are refetched so every card shows its current state, and a
 * goals card also refreshes what the rest of the app reads the goals from.
 */
export function useWriteCard(cardId: string, kind?: WriteCardKind) {
  const queryClient = useQueryClient();

  // The chat's messages query is keyed `/api/chat/conversations/<id>/messages`
  // (one string), so a prefix key would miss it.
  const refresh = () => {
    if (kind === "goals") {
      // The same three GoalSetupScreen refreshes after its own save.
      void queryClient.invalidateQueries({ queryKey: GOALS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dailySummary });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dailyBudget });
    }
    return queryClient.invalidateQueries({
      predicate: (q) =>
        typeof q.queryKey[0] === "string" &&
        q.queryKey[0].startsWith("/api/chat/conversations/") &&
        q.queryKey[0].endsWith("/messages"),
    });
  };

  async function save(
    edits: Record<string, unknown>,
  ): Promise<{ receipt: string }> {
    const res = await apiRequest(
      "POST",
      `/api/coach/cards/${cardId}/save`,
      { edits },
      { headers: { "X-Timezone": getDeviceTimezone() } },
    );
    const body = (await res.json()) as { receipt: string };
    void refresh();
    return { receipt: body.receipt };
  }

  async function undo(): Promise<{
    status: Extract<WriteCardStatus, "live" | "expired">;
  }> {
    const res = await apiRequest("POST", `/api/coach/cards/${cardId}/undo`);
    const body = (await res.json()) as { status: "live" | "expired" };
    void refresh();
    return body;
  }

  return { save, undo };
}
