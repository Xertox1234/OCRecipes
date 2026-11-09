import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import { getDeviceTimezone } from "@/lib/timezone";
import type { WriteCardStatus } from "@shared/schemas/coach-write-cards";

/**
 * Save and Undo for one Coach write card (spec 2026-11-09). The server saves
 * from the card it stored; this sends only the user's edits. On success the
 * chat's messages are refetched so every card shows its current state.
 */
export function useWriteCard(cardId: string) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  // The chat's messages query is keyed `/api/chat/conversations/<id>/messages`
  // (one string), so a prefix key would miss it.
  const refresh = () =>
    queryClient.invalidateQueries({
      predicate: (q) =>
        typeof q.queryKey[0] === "string" &&
        q.queryKey[0].startsWith("/api/chat/conversations/") &&
        q.queryKey[0].endsWith("/messages"),
    });

  async function save(
    edits: Record<string, unknown>,
  ): Promise<{ receipt: string }> {
    setBusy(true);
    try {
      const res = await apiRequest(
        "POST",
        `/api/coach/cards/${cardId}/save`,
        { edits },
        { headers: { "X-Timezone": getDeviceTimezone() } },
      );
      const body = (await res.json()) as { receipt: string };
      void refresh();
      return { receipt: body.receipt };
    } finally {
      setBusy(false);
    }
  }

  async function undo(): Promise<{
    status: Extract<WriteCardStatus, "live" | "expired">;
  }> {
    setBusy(true);
    try {
      const res = await apiRequest("POST", `/api/coach/cards/${cardId}/undo`);
      const body = (await res.json()) as { status: "live" | "expired" };
      void refresh();
      return body;
    } finally {
      setBusy(false);
    }
  }

  return { save, undo, busy };
}
