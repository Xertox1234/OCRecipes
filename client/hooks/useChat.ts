import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { tokenStorage } from "@/lib/token-storage";
import { useCallback, useState } from "react";

export interface ChatConversation {
  id: number;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface ChatMessage {
  id: number;
  conversationId: number;
  role: "user" | "assistant" | "system";
  content: string;
  metadata: unknown;
  createdAt: string;
}

export function useChatConversations() {
  return useQuery<ChatConversation[]>({
    queryKey: ["/api/chat/conversations"],
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
    mutationFn: async (title?: string) => {
      const res = await apiRequest("POST", "/api/chat/conversations", {
        title,
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
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState(false);

  const sendMessage = useCallback(
    async (content: string, screenContext?: string) => {
      if (!conversationId) return;
      setIsStreaming(true);
      setStreamingContent("");
      setStreamError(false);

      let receivedDone = false;

      try {
        const baseUrl = getApiUrl();
        const url = new URL(
          `/api/chat/conversations/${conversationId}/messages`,
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
        let accumulated = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          const lines = text.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.content) {
                  accumulated += data.content;
                  setStreamingContent(accumulated);
                }
                if (data.done) {
                  receivedDone = true;
                  // Refresh messages
                  queryClient.invalidateQueries({
                    queryKey: [
                      `/api/chat/conversations/${conversationId}/messages`,
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
                // Re-throw actual errors, ignore parse errors for incomplete chunks
                if (
                  e instanceof Error &&
                  e.message !== "Unexpected end of JSON input"
                ) {
                  // Only throw application-level errors, not JSON parse issues
                  if (!String(e).includes("JSON")) {
                    throw e;
                  }
                }
              }
            }
          }
        }

        // Stream ended — check if it completed normally
        if (!receivedDone && accumulated.length > 0) {
          setStreamError(true);
          queryClient.invalidateQueries({
            queryKey: [`/api/chat/conversations/${conversationId}/messages`],
          });
          queryClient.invalidateQueries({
            queryKey: ["/api/chat/conversations"],
          });
        }
      } finally {
        setIsStreaming(false);
        setStreamingContent("");
      }
    },
    [conversationId, queryClient],
  );

  return { sendMessage, streamingContent, isStreaming, streamError };
}
