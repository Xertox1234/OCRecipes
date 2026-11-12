import { useMutation } from "@tanstack/react-query";
import type { ChatMessageReportReason } from "@shared/constants/chat-message-report";
import { apiRequest } from "@/lib/query-client";

/**
 * Report an AI reply (privacy audit 2026-11-10, G7). Sends the reply's id and
 * a reason from the fixed list — never the text.
 */
export function useReportChatMessage() {
  return useMutation({
    mutationFn: async ({
      messageId,
      reason,
    }: {
      messageId: number;
      reason: ChatMessageReportReason;
    }) => {
      await apiRequest("POST", `/api/chat/messages/${messageId}/report`, {
        reason,
      });
    },
    // ReportReplyButton shows its own error under the menu — the global net
    // would double it.
    meta: { silentError: true },
  });
}
