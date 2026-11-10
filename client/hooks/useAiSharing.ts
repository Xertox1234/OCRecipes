import { useCallback } from "react";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AiSharingStatus } from "@shared/lib/ai-sharing";

import { apiRequest } from "@/lib/query-client";
import { QUERY_KEYS } from "@/lib/query-keys";

/**
 * How long a read of the AI-sharing status may take. An unknown status is
 * safe: the server refuses AI requests until the answer is yes.
 */
export const AI_SHARING_READ_TIMEOUT_MS = 8000;

/** The one owner of the AI-sharing query (see dietaryProfileQueryOptions). */
export const aiSharingQueryOptions = queryOptions({
  queryKey: QUERY_KEYS.aiSharing,
  // One short attempt, not the default retries (two more, 60 s each): the
  // Settings row waits on this read.
  retry: false,
  queryFn: async ({ signal }): Promise<AiSharingStatus> => {
    const deadline = new AbortController();
    const abort = () => deadline.abort();
    signal.addEventListener("abort", abort);
    const timer = setTimeout(abort, AI_SHARING_READ_TIMEOUT_MS);
    try {
      const res = await apiRequest("GET", "/api/user/ai-sharing", undefined, {
        signal: deadline.signal,
      });
      return (await res.json()) as AiSharingStatus;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  },
});

/**
 * The user's AI-sharing permission (privacy audit H3): whether they have been
 * asked, whether it is on, and the way to answer. The server keeps the
 * record and refuses AI requests without it; `status` is undefined until the
 * first read lands; `loading` is true only while that first read is in flight.
 */
export function useAiSharing(enabled = true) {
  const queryClient = useQueryClient();
  const { data: status, isLoading: loading } = useQuery({
    ...aiSharingQueryOptions,
    enabled,
  });

  /** Records the answer. Rejects when the request fails. */
  const answer = useCallback(
    async (allowed: boolean) => {
      const res = await apiRequest("PUT", "/api/user/ai-sharing", { allowed });
      const next = (await res.json()) as AiSharingStatus;
      queryClient.setQueryData(QUERY_KEYS.aiSharing, next);
      // Turning it on unblocks every AI-backed query that failed while off.
      if (next.allowed) void queryClient.invalidateQueries();
    },
    [queryClient],
  );

  return { status, loading, answer };
}
