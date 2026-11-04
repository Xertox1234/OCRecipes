// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";

import { useVoiceField } from "../useVoiceField";

const { speech, mockStart, mockStop } = vi.hoisted(() => ({
  speech: {
    isListening: false,
    transcript: "",
    isFinal: false,
    volume: -2,
    error: null as string | null,
  },
  mockStart: vi.fn(),
  mockStop: vi.fn(),
}));

vi.mock("../useSpeechToText", () => ({
  useSpeechToText: () => ({
    ...speech,
    startListening: mockStart,
    stopListening: mockStop,
  }),
}));

function setSpeech(next: Partial<typeof speech>) {
  Object.assign(speech, next);
}

describe("useVoiceField", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSpeech({
      isListening: false,
      transcript: "",
      isFinal: false,
      error: null,
    });
  });

  function setup(enabled = true) {
    const onTranscript = vi.fn();
    const hook = renderHook(
      ({ enabled: e }) => useVoiceField({ onTranscript, enabled: e }),
      { initialProps: { enabled } },
    );
    return { onTranscript, ...hook };
  }

  it("writes the live transcript into the field that started the session", () => {
    const { onTranscript, result, rerender } = setup();
    act(() => result.current.toggle());
    expect(mockStart).toHaveBeenCalledOnce();

    setSpeech({ isListening: true, transcript: "two eggs" });
    rerender({ enabled: true });
    expect(onTranscript).toHaveBeenLastCalledWith("two eggs");
  });

  it("ignores a transcript when another field started the session", () => {
    const { onTranscript, rerender } = setup();
    setSpeech({ isListening: true, transcript: "not mine" });
    rerender({ enabled: true });
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("still writes a final result that lands in the same render as the end", () => {
    const { onTranscript, result, rerender } = setup();
    act(() => result.current.toggle());
    setSpeech({ isListening: true, transcript: "ra" });
    rerender({ enabled: true });
    setSpeech({ isListening: false, isFinal: true, transcript: "rice" });
    rerender({ enabled: true });
    expect(onTranscript).toHaveBeenLastCalledWith("rice");
  });

  it("does not write a transcript that arrives after the session ended", () => {
    const { onTranscript, result, rerender } = setup();
    act(() => result.current.toggle());
    setSpeech({ isListening: true, transcript: "ra" });
    rerender({ enabled: true });
    // Silence timeout: the session ends with no final result.
    setSpeech({ isListening: false });
    rerender({ enabled: true });
    onTranscript.mockClear();

    setSpeech({ isFinal: true, transcript: "stale words" });
    rerender({ enabled: true });
    setSpeech({ isListening: true });
    rerender({ enabled: true });
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("drops ownership when the session errors before it ever listens", () => {
    const { onTranscript, result, rerender } = setup();
    act(() => result.current.toggle());
    setSpeech({ error: "Speech recognition failed. Please try again." });
    rerender({ enabled: true });

    setSpeech({ isFinal: true, transcript: "late" });
    rerender({ enabled: true });
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("keeps ownership across a restart that clears an old error", () => {
    setSpeech({ error: "old error" });
    const { onTranscript, result, rerender } = setup();
    act(() => result.current.toggle());
    setSpeech({ error: null });
    rerender({ enabled: true });
    setSpeech({ isListening: true, transcript: "again" });
    rerender({ enabled: true });
    expect(onTranscript).toHaveBeenLastCalledWith("again");
  });

  it("stops the recognizer when the field is disabled mid-session", () => {
    const { onTranscript, result, rerender } = setup();
    act(() => result.current.toggle());
    setSpeech({ isListening: true, transcript: "hi" });
    rerender({ enabled: true });

    rerender({ enabled: false });
    expect(mockStop).toHaveBeenCalledOnce();

    setSpeech({ transcript: "hi there", isFinal: true });
    onTranscript.mockClear();
    rerender({ enabled: false });
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("never stops a session another field started when disabled", () => {
    const { rerender } = setup();
    setSpeech({ isListening: true });
    rerender({ enabled: true });
    rerender({ enabled: false });
    expect(mockStop).not.toHaveBeenCalled();
  });

  it("release() stops an owned session and clears the flag", () => {
    const { onTranscript, result, rerender } = setup();
    act(() => result.current.toggle());
    setSpeech({ isListening: true, transcript: "x" });
    rerender({ enabled: true });

    act(() => result.current.release());
    expect(mockStop).toHaveBeenCalledOnce();

    onTranscript.mockClear();
    setSpeech({ transcript: "xy" });
    rerender({ enabled: true });
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("toggle() while listening stops instead of restarting", () => {
    const { result, rerender } = setup();
    act(() => result.current.toggle());
    setSpeech({ isListening: true });
    rerender({ enabled: true });
    act(() => result.current.toggle());
    expect(mockStop).toHaveBeenCalledOnce();
    expect(mockStart).toHaveBeenCalledOnce();
  });
});
