import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { tokenStorage } from "@/lib/token-storage";
import { useCallback, useState, useRef } from "react";

export interface ChatConversation {
  id: number;
  userId: string;
  title: string;
  type: string; // 'coach' | 'recipe'
  isPinned: boolean;
  pinnedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: number;
  conversationId: number;
  role: "user" | "assistant" | "system";
  content: string;
  metadata: unknown;
  createdAt: string;
}

/** Recipe data from SSE recipe card event */
export interface StreamingRecipe {
  title: string;
  description: string;
  difficulty: string;
  timeEstimate: string;
  servings: number;
  ingredients: { name: string; quantity: string; unit: string }[];
  instructions: string[];
  dietTags: string[];
  imageUrl?: string | null;
}

export function useChatConversations(
  type?: "coach" | "recipe",
  opts?: { search?: string; page?: number },
) {
  const queryKey = type
    ? ["/api/chat/conversations", { type, ...opts }]
    : ["/api/chat/conversations", opts];

  return useQuery<ChatConversation[]>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (type) params.set("type", type);
      if (opts?.search) params.set("search", opts.search);
      if (opts?.page) params.set("page", String(opts.page));
      const query = params.toString();
      const url = `/api/chat/conversations${query ? `?${query}` : ""}`;
      const res = await apiRequest("GET", url);
      return res.json();
    },
  });
}

export function useChatMessages(conversationId: number | null) {
  return useQuery<ChatMessage[]>({
    queryKey: [`/api/chat/conversations/${conversationId}/messages`],
    enabled: !!conversationId,
  });
}

export function useCreateConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data?: {
      title?: string;
      type?: "coach" | "recipe" | "remix";
      sourceRecipeId?: number;
    }) => {
      const res = await apiRequest("POST", "/api/chat/conversations", {
        title: data?.title,
        type: data?.type,
        ...(data?.sourceRecipeId && { sourceRecipeId: data.sourceRecipeId }),
      });
      return (await res.json()) as ChatConversation;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
    },
  });
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/chat/conversations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
    },
  });
}

export function useSendMessage(conversationId: number | null) {
  const queryClient = useQueryClient();
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingRecipe, setStreamingRecipe] =
    useState<StreamingRecipe | null>(null);
  const [allergenWarning, setAllergenWarning] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState(false);

  // Refs for stale-closure-safe access inside streaming callbacks
  const isStreamingRef = useRef(false);
  const streamingContentRef = useRef("");

  const sendMessage = useCallback(
    async (
      content: string,
      screenContext?: string,
      conversationIdOverride?: number,
    ) => {
      const effectiveId = conversationIdOverride ?? conversationId;
      if (!effectiveId) return;
      isStreamingRef.current = true;
      streamingContentRef.current = "";
      setIsStreaming(true);
      setStreamingContent("");
      setStreamingRecipe(null);
      setAllergenWarning(null);
      setStreamError(false);

      let receivedDone = false;

      try {
        const baseUrl = getApiUrl();
        const url = new URL(
          `/api/chat/conversations/${effectiveId}/messages`,
          baseUrl,
        );
        const token = await tokenStorage.get();
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            content,
            ...(screenContext && { screenContext }),
          }),
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`${res.status}: ${text}`);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body");
        const decoder = new TextDecoder();

        // Throttle streaming content updates to 16ms (frame-aligned)
        let pendingFlush = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          const lines = text.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));

                // Recipe card event (additive protocol extension)
                if (data.recipe) {
                  setStreamingRecipe(data.recipe);
                  if (data.allergenWarning) {
                    setAllergenWarning(data.allergenWarning);
                  }
                }

                // Image ready event
                if (data.imageUrl) {
                  setStreamingRecipe((prev) =>
                    prev ? { ...prev, imageUrl: data.imageUrl } : null,
                  );
                }

                // Image unavailable — server confirmed no image will arrive
                if (data.imageUnavailable) {
                  setStreamingRecipe((prev) =>
                    prev ? { ...prev, imageUrl: null } : null,
                  );
                }

                // Text content chunk
                if (data.content) {
                  streamingContentRef.current += data.content;
                  // Throttle UI updates to 16ms intervals
                  if (!pendingFlush) {
                    pendingFlush = true;
                    setTimeout(() => {
                      if (isStreamingRef.current) {
                        setStreamingContent(streamingContentRef.current);
                      }
                      pendingFlush = false;
                    }, 16);
                  }
                }

                if (data.done) {
                  receivedDone = true;
                  queryClient.invalidateQueries({
                    queryKey: [
                      `/api/chat/conversations/${effectiveId}/messages`,
                    ],
                  });
                  queryClient.invalidateQueries({
                    queryKey: ["/api/chat/conversations"],
                  });
                }

                if (data.error) {
                  throw new Error(data.error);
                }
              } catch (e) {
                if (
                  e instanceof Error &&
                  e.message !== "Unexpected end of JSON input"
                ) {
                  if (!String(e).includes("JSON")) {
                    throw e;
                  }
                }
              }
            }
          }
        }

        // Stream ended — check if it completed normally
        if (!receivedDone && streamingContentRef.current.length > 0) {
          setStreamError(true);
          queryClient.invalidateQueries({
            queryKey: [`/api/chat/conversations/${effectiveId}/messages`],
          });
          queryClient.invalidateQueries({
            queryKey: ["/api/chat/conversations"],
          });
        }
      } finally {
        isStreamingRef.current = false;
        setIsStreaming(false);
        setStreamingContent("");
        setStreamingRecipe(null);
        setAllergenWarning(null);
      }
    },
    [conversationId, queryClient],
  );

  return {
    sendMessage,
    streamingContent,
    streamingRecipe,
    allergenWarning,
    isStreaming,
    streamError,
  };
}

export function useDeleteChatMessage() {
  return useMutation({
    mutationFn: async (messageId: number) => {
      await apiRequest("DELETE", `/api/chat/messages/${messageId}`);
    },
    onSuccess: () => {
      // Intentionally no cache invalidation — CoachChat manages
      // message state directly during retry to avoid UI flicker.
    },
  });
}

export function usePinConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isPinned }: { id: number; isPinned: boolean }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/chat/conversations/${id}/pin`,
        { isPinned },
      );
      return (await res.json()) as ChatConversation;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
    },
  });
}

/** Save a recipe from a chat message to the user's library */
export function useSaveRecipeFromChat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      conversationId,
      messageId,
    }: {
      conversationId: number;
      messageId: number;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/chat/conversations/${conversationId}/save-recipe`,
        { messageId },
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
    },
  });
}

// ---- NOTEBOOK ----

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
      const res = await apiRequest("POST", "/api/coach/notebook", data);
      return (await res.json()) as NotebookEntry;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/coach/notebook"] });
    },
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
      );
      return (await res.json()) as NotebookEntry;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/coach/notebook"] });
    },
  });
}

export function useDeleteNotebookEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/coach/notebook/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/coach/notebook"] });
    },
  });
}
