import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import { getDeviceTimezone } from "@/lib/timezone";

export interface NotebookEntry {
  id: number;
  userId: string;
  type: string;
  content: string;
  status: string;
  followUpDate: string | null;
  sourceConversationId: number | null;
  dedupeKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export function useNotebookEntries(opts?: {
  type?: string;
  status?: string;
  page?: number;
}) {
  const params = new URLSearchParams();
  if (opts?.type) params.set("type", opts.type);
  if (opts?.status) params.set("status", opts.status);
  if (opts?.page) params.set("page", String(opts.page));
  const query = params.toString();
  return useQuery<NotebookEntry[]>({
    queryKey: ["/api/coach/notebook", opts],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/coach/notebook${query ? `?${query}` : ""}`,
      );
      return res.json();
    },
  });
}

export function useCreateNotebookEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      type: string;
      content: string;
      followUpDate?: string | null;
    }) => {
      // X-Timezone is required here, not decorative: the server anchors
      // `followUpDate` (a calendar day) at local midnight in THIS zone, the
      // same basis the chat-extraction writer uses. `apiRequest` does not
      // add the header automatically, so omitting it silently anchors at
      // UTC midnight and the reminder fires early for UTC-negative users.
      const res = await apiRequest("POST", "/api/coach/notebook", data, {
        headers: { "X-Timezone": getDeviceTimezone() },
      });
      return (await res.json()) as NotebookEntry;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/coach/notebook"] });
    },
    // Its one call site (NotebookEntryScreen) already toasts on failure.
    meta: { silentError: true },
  });
}

export function useUpdateNotebookEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: {
      id: number;
      content?: string;
      type?: string;
      followUpDate?: string | null;
      status?: string;
    }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/coach/notebook/${id}`,
        updates,
        // Same reason as useCreateNotebookEntry: the server anchors an edited
        // `followUpDate` in this zone.
        { headers: { "X-Timezone": getDeviceTimezone() } },
      );
      return (await res.json()) as NotebookEntry;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/coach/notebook"] });
    },
    // Every call site (NotebookEntryScreen x3, NotebookScreen) already
    // toasts on failure.
    meta: { silentError: true },
  });
}

export function useDeleteNotebookEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/coach/notebook/${id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/coach/notebook"] });
    },
    // Its one call site (NotebookScreen) already toasts on failure.
    meta: { silentError: true },
  });
}
