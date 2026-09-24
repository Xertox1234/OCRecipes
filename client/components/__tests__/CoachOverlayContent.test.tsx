// @vitest-environment jsdom
/**
 * H6: dismissing Ask Coach mid-answer aborts the stream, and the server then
 * settles the turn after the client is gone (refunds the message, or saves
 * the partial reply). Only `onDone` invalidated the conversation before, so
 * reopening it from history within the 5-min staleTime showed the
 * pre-settle cache. The dismissal must mark it stale without refetching.
 */
import React from "react";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderComponent } from "../../../test/utils/render-component";
import { CoachOverlayContent } from "../CoachOverlayContent";

const { stream } = vi.hoisted(() => ({
  stream: { startStream: vi.fn(), abortStream: vi.fn() },
}));

vi.mock("@/hooks/useCoachStream", () => ({
  useCoachStream: () => ({
    startStream: stream.startStream,
    abortStream: stream.abortStream,
    streamingContent: "",
    statusText: "Thinking…",
    isStreaming: true,
  }),
}));

vi.mock("@/hooks/useChat", () => ({
  useCreateConversation: () => ({
    mutateAsync: vi.fn().mockResolvedValue({ id: 9 }),
  }),
  useChatMessages: () => ({ data: [] }),
}));

vi.mock("@/hooks/useAcknowledgeReminders", () => ({
  useAcknowledgeReminders: () => ({ acknowledge: vi.fn() }),
}));

vi.mock("@/lib/coach-disclaimer-storage", () => ({
  isCoachDisclaimerDismissed: vi.fn().mockResolvedValue(true),
  setCoachDisclaimerDismissed: vi.fn().mockResolvedValue(undefined),
}));

describe("CoachOverlayContent — dismiss mid-answer (H6)", () => {
  // The react-native ScrollView mock renders a bare <div>, which has no
  // scrollToEnd — the auto-scroll effect would throw and tear the tree down
  // before the test's own unmount.
  const proto = HTMLElement.prototype as unknown as {
    scrollToEnd?: () => void;
  };
  beforeAll(() => {
    proto.scrollToEnd = vi.fn();
  });
  afterAll(() => {
    delete proto.scrollToEnd;
  });

  it("aborts the stream and marks the conversation stale without refetching", async () => {
    const invalidateSpy = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    const { unmount } = renderComponent(
      <CoachOverlayContent
        question={{ text: "How much protein?", question: "protein_today" }}
        screenContext="home"
        onDismiss={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(stream.startStream).toHaveBeenCalledWith(9, "protein_today", {
        screenContext: "home",
      }),
    );
    invalidateSpy.mockClear();

    unmount();

    expect(stream.abortStream).toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["/api/chat/conversations/9/messages"],
      refetchType: "none",
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["/api/chat/conversations"],
      refetchType: "none",
    });
    invalidateSpy.mockRestore();
  });
});
