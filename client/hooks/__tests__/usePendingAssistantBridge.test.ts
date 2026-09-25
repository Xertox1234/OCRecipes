// @vitest-environment jsdom
/**
 * Unit tests for the shared stream-end → message-refetch bridge extracted
 * from ChatScreen and RecipeChatScreen (P2-2026-09-23). Per
 * docs/solutions/conventions/pure-utils-extraction-tests-dont-prove-wiring-2026-07-14.md,
 * these hook-level tests prove the derivation logic only — ChatScreen.test.tsx
 * and RecipeChatScreen.test.tsx cover that each screen is actually wired to it.
 */
import { renderHook } from "@testing-library/react";
import * as RN from "react-native";
import {
  usePendingAssistantBridge,
  type UsePendingAssistantBridgeOptions,
} from "../usePendingAssistantBridge";

function makeProps<T>(
  overrides: Partial<UsePendingAssistantBridgeOptions<T>> & {
    streamingValue: T;
  },
): UsePendingAssistantBridgeOptions<T> {
  return {
    isStreaming: false,
    hasStreamingValue: false,
    hasError: false,
    assistantMessageCount: 0,
    announce: { message: "Response received" },
    ...overrides,
  };
}

describe("usePendingAssistantBridge", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null before any stream has run", () => {
    const { result } = renderHook(() =>
      usePendingAssistantBridge(makeProps({ streamingValue: "" })),
    );
    expect(result.current).toBeNull();
  });

  it("stays null while streaming, then surfaces the captured value once streaming ends", () => {
    const { result, rerender } = renderHook(
      (props: UsePendingAssistantBridgeOptions<string>) =>
        usePendingAssistantBridge(props),
      {
        initialProps: makeProps({
          isStreaming: true,
          streamingValue: "Hello",
          hasStreamingValue: true,
          assistantMessageCount: 2,
        }),
      },
    );
    expect(result.current).toBeNull();

    rerender(
      makeProps({
        isStreaming: false,
        streamingValue: "",
        hasStreamingValue: false,
        assistantMessageCount: 2,
      }),
    );

    expect(result.current).toBe("Hello");
  });

  it("captures the latest value across multiple streaming ticks", () => {
    const { result, rerender } = renderHook(
      (props: UsePendingAssistantBridgeOptions<string>) =>
        usePendingAssistantBridge(props),
      {
        initialProps: makeProps({
          isStreaming: true,
          streamingValue: "Hel",
          hasStreamingValue: true,
        }),
      },
    );
    rerender(
      makeProps({
        isStreaming: true,
        streamingValue: "Hello wor",
        hasStreamingValue: true,
      }),
    );
    rerender(
      makeProps({
        isStreaming: true,
        streamingValue: "Hello world",
        hasStreamingValue: true,
      }),
    );
    rerender(
      makeProps({
        isStreaming: false,
        streamingValue: "",
        hasStreamingValue: false,
      }),
    );

    expect(result.current).toBe("Hello world");
  });

  it("keeps the last captured value even if a later streaming tick reports nothing new", () => {
    const { result, rerender } = renderHook(
      (props: UsePendingAssistantBridgeOptions<string>) =>
        usePendingAssistantBridge(props),
      {
        initialProps: makeProps({
          isStreaming: true,
          streamingValue: "Hello",
          hasStreamingValue: true,
        }),
      },
    );
    rerender(
      makeProps({
        isStreaming: true,
        streamingValue: "",
        hasStreamingValue: false,
      }),
    );
    rerender(
      makeProps({
        isStreaming: false,
        streamingValue: "",
        hasStreamingValue: false,
      }),
    );

    expect(result.current).toBe("Hello");
  });

  it("clears once the assistant message count rises past the pre-completion baseline", () => {
    const { result, rerender } = renderHook(
      (props: UsePendingAssistantBridgeOptions<string>) =>
        usePendingAssistantBridge(props),
      {
        initialProps: makeProps({
          isStreaming: true,
          streamingValue: "Hi",
          hasStreamingValue: true,
          assistantMessageCount: 2,
        }),
      },
    );
    rerender(
      makeProps({
        isStreaming: false,
        streamingValue: "",
        hasStreamingValue: false,
        assistantMessageCount: 2,
      }),
    );
    expect(result.current).toBe("Hi");

    // Count unchanged — a new message hasn't landed yet, so it stays pending.
    rerender(
      makeProps({
        isStreaming: false,
        streamingValue: "",
        hasStreamingValue: false,
        assistantMessageCount: 2,
      }),
    );
    expect(result.current).toBe("Hi");

    // Count rises past the baseline captured at stream end — clears.
    rerender(
      makeProps({
        isStreaming: false,
        streamingValue: "",
        hasStreamingValue: false,
        assistantMessageCount: 3,
      }),
    );
    expect(result.current).toBeNull();
  });

  it("never surfaces a pending bubble when the stream ended in error", () => {
    const { result, rerender } = renderHook(
      (props: UsePendingAssistantBridgeOptions<string>) =>
        usePendingAssistantBridge(props),
      {
        initialProps: makeProps({
          isStreaming: true,
          streamingValue: "partial reply",
          hasStreamingValue: true,
        }),
      },
    );
    rerender(
      makeProps({
        isStreaming: false,
        streamingValue: "",
        hasStreamingValue: false,
        hasError: true,
      }),
    );

    expect(result.current).toBeNull();
  });

  it("supports an object payload — captures the latest full snapshot across independent fields", () => {
    type Snapshot = { content: string; recipe: { title: string } | null };
    const { result, rerender } = renderHook(
      (props: UsePendingAssistantBridgeOptions<Snapshot>) =>
        usePendingAssistantBridge(props),
      {
        initialProps: makeProps<Snapshot>({
          isStreaming: true,
          streamingValue: { content: "Here's a recipe", recipe: null },
          hasStreamingValue: true,
        }),
      },
    );
    rerender(
      makeProps<Snapshot>({
        isStreaming: true,
        streamingValue: {
          content: "Here's a recipe",
          recipe: { title: "Pasta" },
        },
        hasStreamingValue: true,
      }),
    );
    rerender(
      makeProps<Snapshot>({
        isStreaming: false,
        streamingValue: { content: "", recipe: null },
        hasStreamingValue: false,
      }),
    );

    expect(result.current).toEqual({
      content: "Here's a recipe",
      recipe: { title: "Pasta" },
    });
  });

  describe("accessibility announcement", () => {
    it("announces unconditionally on stream end when announce.always is true, even on error", () => {
      const announceSpy = vi.spyOn(
        RN.AccessibilityInfo,
        "announceForAccessibility",
      );
      const { rerender } = renderHook(
        (props: UsePendingAssistantBridgeOptions<string>) =>
          usePendingAssistantBridge(props),
        {
          initialProps: makeProps({
            isStreaming: true,
            streamingValue: "hi",
            hasStreamingValue: true,
            announce: { message: "Coach response received", always: true },
          }),
        },
      );

      rerender(
        makeProps({
          isStreaming: false,
          streamingValue: "",
          hasStreamingValue: false,
          hasError: true,
          announce: { message: "Coach response received", always: true },
        }),
      );

      expect(announceSpy).toHaveBeenCalledWith("Coach response received");
      expect(announceSpy).toHaveBeenCalledTimes(1);
    });

    it("does not announce on the error path when announce.always is false", () => {
      const announceSpy = vi.spyOn(
        RN.AccessibilityInfo,
        "announceForAccessibility",
      );
      const { rerender } = renderHook(
        (props: UsePendingAssistantBridgeOptions<string>) =>
          usePendingAssistantBridge(props),
        {
          initialProps: makeProps({
            isStreaming: true,
            streamingValue: "hi",
            hasStreamingValue: true,
            announce: { message: "Recipe response received", always: false },
          }),
        },
      );

      rerender(
        makeProps({
          isStreaming: false,
          streamingValue: "",
          hasStreamingValue: false,
          hasError: true,
          announce: { message: "Recipe response received", always: false },
        }),
      );

      expect(announceSpy).not.toHaveBeenCalled();
    });

    it("announces exactly once on the success path when announce.always is false", () => {
      const announceSpy = vi.spyOn(
        RN.AccessibilityInfo,
        "announceForAccessibility",
      );
      const { rerender } = renderHook(
        (props: UsePendingAssistantBridgeOptions<string>) =>
          usePendingAssistantBridge(props),
        {
          initialProps: makeProps({
            isStreaming: true,
            streamingValue: "hi",
            hasStreamingValue: true,
            announce: { message: "Recipe response received", always: false },
          }),
        },
      );

      rerender(
        makeProps({
          isStreaming: false,
          streamingValue: "",
          hasStreamingValue: false,
          announce: { message: "Recipe response received", always: false },
        }),
      );

      expect(announceSpy).toHaveBeenCalledWith("Recipe response received");
      expect(announceSpy).toHaveBeenCalledTimes(1);
    });
  });
});
