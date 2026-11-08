// @vitest-environment jsdom
/**
 * H6: dismissing Ask Coach mid-answer aborts the stream, and the server then
 * settles the turn after the client is gone (refunds the message, or saves
 * the partial reply). Only `onDone` invalidated the conversation before, so
 * reopening it from history within the 5-min staleTime showed the
 * pre-settle cache. The dismissal must mark it stale without refetching.
 */
import React from "react";
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import * as RN from "react-native";
import { QueryClient } from "@tanstack/react-query";
import { renderComponent } from "../../../test/utils/render-component";
import { reactProps } from "../../../test/utils/react-props";
import { CoachOverlayContent } from "../CoachOverlayContent";

type StreamOpts = {
  onDone?: (fullText: string, blocks: unknown[]) => void;
  onError?: (msg: string) => void;
};

const { stream } = vi.hoisted(() => ({
  stream: {
    startStream: vi.fn(),
    abortStream: vi.fn(),
    opts: {} as StreamOpts,
    setStreaming: (_v: boolean) => {},
  },
}));

// isStreaming lives in real React state so a test can end the stream the way
// useCoachStream does: setIsStreaming(false) in the same tick as the callback.
vi.mock("@/hooks/useCoachStream", async () => {
  const R = await import("react");
  return {
    useCoachStream: (opts: StreamOpts) => {
      const [isStreaming, setIsStreaming] = R.useState(true);
      stream.opts = opts;
      stream.setStreaming = setIsStreaming;
      return {
        startStream: stream.startStream,
        abortStream: stream.abortStream,
        streamingContent: "",
        statusText: "Thinking…",
        isStreaming,
      };
    },
  };
});

const { messagesHolder, mockOpenCoachConversation } = vi.hoisted(() => ({
  messagesHolder: { messages: [] as unknown[] },
  mockOpenCoachConversation: vi.fn(),
}));

vi.mock("@/hooks/useChat", () => ({
  useCreateConversation: () => ({
    mutateAsync: vi.fn().mockResolvedValue({ id: 9 }),
  }),
  useChatMessages: () => ({ data: messagesHolder.messages }),
}));

vi.mock("@/navigation/openCoachConversation", () => ({
  openCoachConversation: mockOpenCoachConversation,
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

  // Restored in afterEach so a failed assertion can't leave the prototype
  // spied for later tests in this worker.
  let invalidateSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    invalidateSpy = vi.spyOn(QueryClient.prototype, "invalidateQueries");
  });
  afterEach(() => {
    invalidateSpy.mockRestore();
  });

  it("aborts the stream and marks the conversation stale without refetching", async () => {
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
  });
});

// Spec §5.6: the follow-up composer's "send" key sends, as the Coach tab's
// composer does — never a line break.
describe("CoachOverlayContent — Return sends", () => {
  const proto = HTMLElement.prototype as unknown as {
    scrollToEnd?: () => void;
  };
  beforeAll(() => {
    proto.scrollToEnd = vi.fn();
  });
  afterAll(() => {
    delete proto.scrollToEnd;
  });

  it("the composer submits on Return instead of adding a line", async () => {
    renderComponent(
      <CoachOverlayContent
        question={{ text: "How much protein?", question: "protein_today" }}
        screenContext="home"
        onDismiss={vi.fn()}
      />,
    );
    const input = await screen.findByLabelText("Type a follow-up question");
    const props = reactProps(input);
    expect(props.returnKeyType).toBe("send");
    expect(props.blurOnSubmit).toBe(true);
  });
});

// A11y follow-up to the 2026-11-06 audit: a failed reply must not be
// announced as a success, and the error must not be read twice on Android
// (the banner's live region already speaks it there).
describe("CoachOverlayContent — stream end announcements", () => {
  const proto = HTMLElement.prototype as unknown as {
    scrollToEnd?: () => void;
  };
  const originalOS = RN.Platform.OS;
  let announceSpy: ReturnType<typeof vi.spyOn>;
  beforeAll(() => {
    proto.scrollToEnd = vi.fn();
  });
  afterAll(() => {
    delete proto.scrollToEnd;
  });
  beforeEach(() => {
    announceSpy = vi.spyOn(RN.AccessibilityInfo, "announceForAccessibility");
  });
  afterEach(() => {
    announceSpy.mockRestore();
    RN.Platform.OS = originalOS;
  });

  const renderOverlay = async () => {
    renderComponent(
      <CoachOverlayContent
        question={{ text: "How much protein?", question: "protein_today" }}
        screenContext="home"
        onDismiss={vi.fn()}
      />,
    );
    await waitFor(() => expect(stream.startStream).toHaveBeenCalled());
    announceSpy.mockClear();
  };

  const announced = (): unknown[] =>
    announceSpy.mock.calls.map((c: unknown[]) => c[0]);

  it("a failed reply announces the error and not 'response received' (iOS)", async () => {
    RN.Platform.OS = "ios";
    await renderOverlay();
    act(() => {
      stream.setStreaming(false);
      stream.opts.onError?.("boom");
    });
    await waitFor(() =>
      expect(announced()).toContain("Response interrupted. Try sending again."),
    );
    expect(announced()).not.toContain("Coach response received");
  });

  it("on Android the error is left to the banner's live region", async () => {
    RN.Platform.OS = "android";
    await renderOverlay();
    act(() => {
      stream.setStreaming(false);
      stream.opts.onError?.("boom");
    });
    await screen.findByText(/interrupted/i);
    expect(announced()).not.toContain(
      "Response interrupted. Try sending again.",
    );
    expect(announced()).not.toContain("Coach response received");
  });

  it("a successful reply still announces 'response received'", async () => {
    RN.Platform.OS = "ios";
    await renderOverlay();
    act(() => {
      stream.setStreaming(false);
      stream.opts.onDone?.("Here you go.", []);
    });
    await waitFor(() =>
      expect(announced()).toContain("Coach response received"),
    );
  });

  it("a dead-socket abort that received nothing is not 'received'", async () => {
    RN.Platform.OS = "ios";
    await renderOverlay();
    act(() => {
      stream.setStreaming(false);
      stream.opts.onDone?.("", []);
    });
    await waitFor(() => expect(stream.opts.onDone).toBeDefined());
    expect(announced()).not.toContain("Coach response received");
  });
});

// The sheet draws a reply's text only; its cards (recipe results, charts,
// "Log this") were dropped without a trace. A reply with cards now offers the
// full reply in the Coach tab, where cards work (owner choice, 2026-11-08).
describe("CoachOverlayContent — replies with cards", () => {
  const proto = HTMLElement.prototype as unknown as {
    scrollToEnd?: () => void;
  };
  beforeAll(() => {
    proto.scrollToEnd = vi.fn();
  });
  afterAll(() => {
    delete proto.scrollToEnd;
  });
  afterEach(() => {
    messagesHolder.messages = [];
    mockOpenCoachConversation.mockClear();
  });

  const reply = (id: number, metadata: unknown) => ({
    id,
    conversationId: 9,
    role: "assistant",
    content: "Here are some ideas.",
    metadata,
    createdAt: new Date().toISOString(),
  });

  const card = {
    type: "action_card",
    title: "Log an apple",
    subtitle: "95 kcal",
    actionLabel: "Log",
    action: { type: "navigate", screen: "QuickLog" },
  };

  it("offers the full reply in Coach, closing the sheet first", async () => {
    messagesHolder.messages = [reply(21, { blocks: [card] })];
    const onDismiss = vi.fn();
    renderComponent(
      <CoachOverlayContent
        question={{ text: "Sides?", question: "sides" }}
        screenContext="recipe"
        onDismiss={onDismiss}
      />,
    );

    const link = await screen.findByRole("button", {
      name: "See the full reply in Coach",
    });
    fireEvent.click(link);

    expect(onDismiss).toHaveBeenCalled();
    expect(mockOpenCoachConversation).toHaveBeenCalledWith(9);
  });

  it("a reply without cards has no link", async () => {
    messagesHolder.messages = [reply(22, null)];
    renderComponent(
      <CoachOverlayContent
        question={{ text: "Sides?", question: "sides" }}
        screenContext="recipe"
        onDismiss={vi.fn()}
      />,
    );

    await screen.findByText("Here are some ideas.");
    expect(
      screen.queryByRole("button", { name: "See the full reply in Coach" }),
    ).toBeNull();
  });
});
