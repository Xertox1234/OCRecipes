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

const {
  messagesHolder,
  mockOpenCoachConversation,
  mockCreate,
  mockDisclaimerDismissed,
  captured,
} = vi.hoisted(() => ({
  messagesHolder: { messages: [] as unknown[] },
  mockOpenCoachConversation: vi.fn(),
  mockCreate: vi.fn(),
  mockDisclaimerDismissed: vi.fn(),
  // Raw Pressable props by accessibilityLabel: the shared mock drops style.
  captured: {} as Record<string, Record<string, unknown>>,
}));

vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native")>();
  const ReactMod = await import("react");
  const Capturing = ReactMod.forwardRef<unknown, Record<string, unknown>>(
    (props, ref) => {
      const label = props.accessibilityLabel as string | undefined;
      if (label) captured[label] = props;
      return ReactMod.createElement(
        actual.Pressable as React.ComponentType<Record<string, unknown>>,
        { ...props, ref },
      );
    },
  );
  Capturing.displayName = "Pressable";
  return { ...actual, Pressable: Capturing };
});

beforeEach(() => {
  mockCreate.mockReset();
  mockCreate.mockResolvedValue({ id: 9 });
  mockDisclaimerDismissed.mockReset();
  mockDisclaimerDismissed.mockResolvedValue(true);
});

vi.mock("@/hooks/useChat", () => ({
  useCreateConversation: () => ({ mutateAsync: mockCreate }),
  useChatMessages: () => ({ data: messagesHolder.messages }),
}));

vi.mock("@/navigation/openCoachConversation", () => ({
  openCoachConversation: mockOpenCoachConversation,
}));

// The plan-based route choice — mutable so a test can be a Coach Pro user.
const mockShowsCoachPro = vi.hoisted(() => ({ value: false }));
vi.mock("@/hooks/useShowsCoachPro", () => ({
  useShowsCoachPro: () => mockShowsCoachPro.value,
}));

const { mockUseAcknowledgeReminders } = vi.hoisted(() => ({
  mockUseAcknowledgeReminders: vi.fn(() => ({ acknowledge: vi.fn() })),
}));
vi.mock("@/hooks/useAcknowledgeReminders", () => ({
  useAcknowledgeReminders: mockUseAcknowledgeReminders,
}));

vi.mock("@/lib/coach-disclaimer-storage", () => ({
  isCoachDisclaimerDismissed: () => mockDisclaimerDismissed(),
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

// The sheet moves screen-reader focus to its title 300ms after opening. The
// shared react-native mock has no findNodeHandle, so any test still mounted
// at 300ms threw an uncaught error after the fact (flaky under load).
describe("CoachOverlayContent — focus on open", () => {
  afterEach(() => vi.useRealTimers());

  it("moves accessibility focus to the title after 300ms", () => {
    vi.useFakeTimers();
    const focus = vi.spyOn(RN.AccessibilityInfo, "setAccessibilityFocus");
    renderComponent(
      <CoachOverlayContent
        question={{ text: "How much protein?", question: "protein_today" }}
        screenContext="home"
        onDismiss={vi.fn()}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(focus).toHaveBeenCalledWith(1);
  });
});

// The sheet never shows why the Coach tab dot is lit, so a send here must
// not clear that reason (opening-brief spec, 2026-11-08).
describe("CoachOverlayContent — reminders", () => {
  it("never wires the reminder clear", async () => {
    renderComponent(
      <CoachOverlayContent
        question={{ text: "How much protein?", question: "protein_today" }}
        screenContext="home"
        onDismiss={vi.fn()}
      />,
    );
    await screen.findByLabelText("Type a follow-up question");
    expect(mockUseAcknowledgeReminders).not.toHaveBeenCalled();
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
    expect(mockOpenCoachConversation).toHaveBeenCalledWith(9, false);
  });

  // The link is offered because the reply has cards; only CoachPro draws
  // them, so a Coach Pro user's plan is passed on to the route.
  it("opens the full reply in CoachPro for a Coach Pro user", async () => {
    mockShowsCoachPro.value = true;
    try {
      messagesHolder.messages = [reply(21, { blocks: [card] })];
      renderComponent(
        <CoachOverlayContent
          question={{ text: "Sides?", question: "sides" }}
          screenContext="recipe"
          onDismiss={vi.fn()}
        />,
      );

      fireEvent.click(
        await screen.findByRole("button", {
          name: "See the full reply in Coach",
        }),
      );

      expect(mockOpenCoachConversation).toHaveBeenCalledWith(9, true);
    } finally {
      mockShowsCoachPro.value = false;
    }
  });

  it("a reply whose only block is the Checked: trail has no link", async () => {
    messagesHolder.messages = [
      reply(23, {
        blocks: [{ type: "checked_trail", items: ["your pantry"] }],
      }),
    ];
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

  // Privacy audit G7: AI replies can be reported from the sheet too.
  it("a saved reply can be reported; the person's own message cannot", async () => {
    messagesHolder.messages = [
      { ...reply(30, null), role: "user", content: "Sides?" },
      reply(31, null),
    ];
    renderComponent(
      <CoachOverlayContent
        question={{ text: "Sides?", question: "sides" }}
        screenContext="recipe"
        onDismiss={vi.fn()}
      />,
    );

    await screen.findByText("Here are some ideas.");
    expect(
      screen.getAllByRole("button", { name: "Report this reply" }),
    ).toHaveLength(1);
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

// Coach chat audit 2026-11-24 (L58).
describe("CoachOverlayContent — the reply and the question are not lost", () => {
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
    stream.startStream.mockClear();
  });

  const renderOverlay = async () => {
    const view = renderComponent(
      <CoachOverlayContent
        question={{ text: "How much protein?", question: "protein_today" }}
        screenContext="home"
        onDismiss={vi.fn()}
      />,
    );
    await waitFor(() => expect(stream.startStream).toHaveBeenCalled());
    return view;
  };
  const savedMessage = (id: number, role: string, content: string) => ({
    id,
    conversationId: 9,
    role,
    content,
    metadata: null,
    createdAt: new Date().toISOString(),
  });

  // The streamed bubble went away when the stream ended, and the saved copy
  // only arrived after a round trip: the answer blinked out in between.
  it("keeps the finished reply on screen until its saved copy arrives", async () => {
    const view = await renderOverlay();
    act(() => {
      stream.setStreaming(false);
      stream.opts.onDone?.("About 80 grams so far.", []);
    });
    expect(screen.getByText("About 80 grams so far.")).toBeDefined();

    messagesHolder.messages = [
      savedMessage(1, "user", "protein_today"),
      savedMessage(2, "assistant", "About 80 grams so far."),
    ];
    view.rerender(
      <CoachOverlayContent
        question={{ text: "How much protein?", question: "protein_today" }}
        screenContext="home"
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getAllByText("About 80 grams so far.")).toHaveLength(1);
  });

  // "Try sending again" pointed at an input that only sends follow-ups.
  it("puts a failed first question back in the input", async () => {
    await renderOverlay();
    await act(async () => {
      stream.setStreaming(false);
      stream.opts.onError?.("Network error");
    });
    const input = await screen.findByLabelText("Type a follow-up question");
    await waitFor(() => expect(reactProps(input).value).toBe("protein_today"));
  });

  // The re-read lands in the query cache before React draws it, so the
  // check must read the cache: the rendered list is still the old one here.
  it("gives nothing back when the saved question is only in the cache yet", async () => {
    await renderOverlay();
    const getData = vi
      .spyOn(QueryClient.prototype, "getQueryData")
      .mockReturnValue([savedMessage(1, "user", "protein_today")]);
    await act(async () => {
      stream.setStreaming(false);
      stream.opts.onError?.("Response interrupted");
    });
    const input = await screen.findByLabelText("Type a follow-up question");
    expect(reactProps(input).value).toBe("");
    getData.mockRestore();
  });

  it("gives nothing back when the server saved the question", async () => {
    const view = await renderOverlay();
    messagesHolder.messages = [savedMessage(1, "user", "protein_today")];
    view.rerender(
      <CoachOverlayContent
        question={{ text: "How much protein?", question: "protein_today" }}
        screenContext="home"
        onDismiss={vi.fn()}
      />,
    );
    await act(async () => {
      stream.setStreaming(false);
      stream.opts.onError?.("Response interrupted");
    });
    const input = await screen.findByLabelText("Type a follow-up question");
    expect(reactProps(input).value).toBe("");
  });
});

function boxOf(label: string): Record<string, unknown> {
  const props = captured[label];
  expect(props, `no Pressable captured for "${label}"`).toBeDefined();
  const style = props.style;
  const list = Array.isArray(style) ? style.flat(3) : [style];
  return Object.assign({}, ...list.filter(Boolean));
}

// Coach chat audit 2026-11-24 L7 and L8.
describe("CoachOverlayContent — failure and dismiss controls", () => {
  const renderIt = () =>
    renderComponent(
      <CoachOverlayContent
        question={{ text: "How much protein?", question: "protein_today" }}
        screenContext="home"
        onDismiss={vi.fn()}
      />,
    );

  // L7: the screen swapped to an error with no announcement; a screen-reader
  // user heard "Starting conversation..." and then nothing.
  it("announces a failed start, and its Retry is a 44pt target", async () => {
    mockCreate.mockRejectedValueOnce(new Error("offline"));
    const announce = vi.spyOn(RN.AccessibilityInfo, "announceForAccessibility");
    renderIt();
    await screen.findByText("Could not start conversation");
    expect(announce).toHaveBeenCalledWith("Could not start conversation");
    expect(
      boxOf("Retry starting conversation").minHeight as number,
    ).toBeGreaterThanOrEqual(44);
    announce.mockRestore();
  });

  it("announces a failed retry too", async () => {
    mockCreate
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("still offline"));
    const announce = vi.spyOn(RN.AccessibilityInfo, "announceForAccessibility");
    renderIt();
    await screen.findByText("Could not start conversation");
    announce.mockClear();
    fireEvent.click(screen.getByLabelText("Retry starting conversation"));
    await waitFor(() =>
      expect(announce).toHaveBeenCalledWith("Could not start conversation"),
    );
    announce.mockRestore();
  });

  // L8: a 16pt icon with hitSlop 12, which Android clips to the banner.
  it("the disclaimer's dismiss is a real 44pt box", async () => {
    mockDisclaimerDismissed.mockResolvedValue(false);
    renderIt();
    await screen.findByLabelText("Dismiss disclaimer");
    const props = captured["Dismiss disclaimer"];
    expect(props.hitSlop).toBeUndefined();
    const box = boxOf("Dismiss disclaimer");
    expect(box.minWidth as number).toBeGreaterThanOrEqual(44);
    expect(box.minHeight as number).toBeGreaterThanOrEqual(44);
  });
});
