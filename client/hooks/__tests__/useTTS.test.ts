// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { useTTS, splitSentences } from "../useTTS";

// Mock expo-speech
const mockSpeak = vi.fn();
const mockStop = vi.fn(() => Promise.resolve());

vi.mock("expo-speech", () => ({
  speak: (text: string, options?: Record<string, unknown>) =>
    mockSpeak(text, options),
  stop: () => mockStop(),
}));

// ─── splitSentences pure function tests ───────────────────────────────────────

describe("splitSentences", () => {
  it("splits on periods followed by space", () => {
    const result = splitSentences("Hello world. How are you? Fine!");
    expect(result).toEqual(["Hello world.", "How are you?", "Fine!"]);
  });

  it("handles single sentence", () => {
    expect(splitSentences("Just one sentence.")).toEqual([
      "Just one sentence.",
    ]);
  });

  it("returns empty array for empty string", () => {
    expect(splitSentences("")).toEqual([]);
  });

  it("returns empty array for whitespace-only string", () => {
    expect(splitSentences("   ")).toEqual([]);
  });

  it("handles multiple spaces between sentences", () => {
    const result = splitSentences("First.  Second.");
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("First.");
    expect(result[1]).toBe("Second.");
  });

  it("does not split mid-word abbreviations without space after period", () => {
    // "Dr.Smith" has no space after period — stays as one token
    const result = splitSentences("Dr.Smith walked in. He sat down.");
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("Dr.Smith walked in.");
  });
});

// ─── useTTS hook tests ────────────────────────────────────────────────────────

describe("useTTS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStop.mockResolvedValue(undefined);
  });

  it("starts with isSpeaking false and no speakingMessageId", () => {
    const { result } = renderHook(() => useTTS());
    expect(result.current.isSpeaking).toBe(false);
    expect(result.current.speakingMessageId).toBeNull();
  });

  it("calls expo-speech speak when speak() is called", () => {
    const { result } = renderHook(() => useTTS());

    act(() => {
      result.current.speak(1, "Hello world.");
    });

    expect(mockSpeak).toHaveBeenCalledWith(
      "Hello world.",
      expect.objectContaining({ language: "en-US" }),
    );
    expect(result.current.isSpeaking).toBe(true);
    expect(result.current.speakingMessageId).toBe(1);
  });

  it("strips markdown before speaking", () => {
    const { result } = renderHook(() => useTTS());

    act(() => {
      result.current.speak(1, "**Bold text** and *italic*.");
    });

    expect(mockSpeak).toHaveBeenCalledWith(
      "Bold text and italic.",
      expect.anything(),
    );
  });

  it("strips coach_blocks fence before speaking", () => {
    const { result } = renderHook(() => useTTS());

    const text =
      'Here is your plan.\n```coach_blocks\n[{"type":"action_card"}]\n```\nEnjoy!';
    act(() => {
      result.current.speak(1, text);
    });

    // Should only speak prose, not the fence content
    const calledWith = mockSpeak.mock.calls[0][0] as string;
    expect(calledWith).not.toContain("coach_blocks");
    expect(calledWith).not.toContain("action_card");
  });

  it("stops speech and resets state when stop() is called", async () => {
    const { result } = renderHook(() => useTTS());

    act(() => {
      result.current.speak(1, "Hello world.");
    });
    expect(result.current.isSpeaking).toBe(true);

    await act(async () => {
      result.current.stop();
      await Promise.resolve();
    });

    expect(mockStop).toHaveBeenCalled();
    expect(result.current.isSpeaking).toBe(false);
    expect(result.current.speakingMessageId).toBeNull();
  });

  it("toggles off when speak() is called for the same message again", async () => {
    const { result } = renderHook(() => useTTS());

    act(() => {
      result.current.speak(1, "Hello.");
    });
    expect(result.current.isSpeaking).toBe(true);

    // Calling speak() on same message again should stop
    await act(async () => {
      result.current.speak(1, "Hello.");
      await Promise.resolve();
    });

    expect(mockStop).toHaveBeenCalled();
  });

  it("does nothing when text is empty after stripping", () => {
    const { result } = renderHook(() => useTTS());

    act(() => {
      result.current.speak(1, "```coach_blocks\n[]\n```");
    });

    expect(mockSpeak).not.toHaveBeenCalled();
    expect(result.current.isSpeaking).toBe(false);
  });

  it("speaks multiple sentences sequentially via onDone chain", () => {
    const { result } = renderHook(() => useTTS());

    act(() => {
      result.current.speak(1, "First sentence. Second sentence. Third.");
    });

    // First sentence spoken
    expect(mockSpeak).toHaveBeenCalledTimes(1);
    expect(mockSpeak.mock.calls[0][0]).toBe("First sentence.");

    // Simulate onDone for first sentence
    const firstOptions = mockSpeak.mock.calls[0][1] as { onDone?: () => void };
    act(() => {
      firstOptions.onDone?.();
    });

    // Second sentence should now be spoken
    expect(mockSpeak).toHaveBeenCalledTimes(2);
    expect(mockSpeak.mock.calls[1][0]).toBe("Second sentence.");
  });
});
