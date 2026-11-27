// @vitest-environment jsdom
/**
 * Coach chat audit 2026-11-24, L37: while a reply streams, the Ask Coach
 * sheet re-renders about 20 times a second. Saved messages must not re-parse
 * their markdown on each tick, and the list must not run an animated scroll
 * on each tick (it fought the user's own scrolling).
 */
import React from "react";
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  beforeAll,
  afterAll,
} from "vitest";
import { act, waitFor } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { CoachOverlayContent } from "../CoachOverlayContent";

const { stream, markdownRenders, messagesHolder } = vi.hoisted(() => ({
  stream: {
    startStream: vi.fn(),
    abortStream: vi.fn(),
    setContent: (_v: string) => {},
  },
  markdownRenders: new Map<string, number>(),
  messagesHolder: { messages: [] as unknown[] },
}));

vi.mock("@/hooks/useCoachStream", async () => {
  const R = await import("react");
  return {
    useCoachStream: () => {
      const [content, setContent] = R.useState("");
      stream.setContent = setContent;
      return {
        startStream: stream.startStream,
        abortStream: stream.abortStream,
        streamingContent: content,
        statusText: "Thinking…",
        isStreaming: true,
      };
    },
  };
});

vi.mock("@/components/MarkdownText", async () => {
  const R = await import("react");
  return {
    MarkdownText: ({ children }: { children: string }) => {
      markdownRenders.set(children, (markdownRenders.get(children) ?? 0) + 1);
      return R.createElement("span", null, children);
    },
  };
});

vi.mock("@/hooks/useChat", () => ({
  useCreateConversation: () => ({
    mutateAsync: vi.fn().mockResolvedValue({ id: 9 }),
  }),
  useChatMessages: () => ({ data: messagesHolder.messages }),
}));
vi.mock("@/navigation/openCoachConversation", () => ({
  openCoachConversation: vi.fn(),
}));
vi.mock("@/hooks/useShowsCoachPro", () => ({ useShowsCoachPro: () => false }));
vi.mock("@/hooks/useAcknowledgeReminders", () => ({
  useAcknowledgeReminders: () => ({ acknowledge: vi.fn() }),
}));
vi.mock("@/lib/coach-disclaimer-storage", () => ({
  isCoachDisclaimerDismissed: () => Promise.resolve(true),
  setCoachDisclaimerDismissed: vi.fn().mockResolvedValue(undefined),
}));

const scrollToEnd = vi.fn();
const proto = HTMLElement.prototype as unknown as {
  scrollToEnd?: (opts?: { animated?: boolean }) => void;
};

describe("CoachOverlayContent while a reply streams (L37)", () => {
  beforeAll(() => {
    proto.scrollToEnd = scrollToEnd;
  });
  afterAll(() => {
    delete proto.scrollToEnd;
  });
  beforeEach(() => {
    markdownRenders.clear();
    scrollToEnd.mockClear();
    messagesHolder.messages = [
      {
        id: 3,
        conversationId: 9,
        role: "assistant",
        content: "An earlier saved reply.",
        metadata: null,
        createdAt: "2026-11-26T10:00:00.000Z",
      },
    ];
  });

  async function mountAndStream(ticks: number) {
    renderComponent(
      <CoachOverlayContent
        question={{ text: "How much protein?", question: "protein_today" }}
        screenContext="home"
        onDismiss={vi.fn()}
      />,
    );
    await waitFor(() => expect(stream.startStream).toHaveBeenCalled());
    const before = markdownRenders.get("An earlier saved reply.") ?? 0;
    scrollToEnd.mockClear();
    let text = "";
    for (let i = 0; i < ticks; i++) {
      text += `word${i} `;
      await act(async () => {
        stream.setContent(text);
      });
    }
    return before;
  }

  it("does not re-parse a saved reply on each streamed tick", async () => {
    const before = await mountAndStream(10);
    expect(before).toBeGreaterThan(0);
    expect(markdownRenders.get("An earlier saved reply.")).toBe(before);
  });

  it("follows the reply without an animated scroll per tick", async () => {
    await mountAndStream(10);
    const animated = scrollToEnd.mock.calls.filter(
      ([opts]) => opts?.animated === true,
    );
    expect(animated.length).toBeLessThanOrEqual(1);
  });
});
