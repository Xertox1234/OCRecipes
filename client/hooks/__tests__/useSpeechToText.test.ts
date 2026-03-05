// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";

import { useSpeechToText } from "../useSpeechToText";

const { mockRequestPermissionsAsync, mockStart, mockStop } = vi.hoisted(() => ({
  mockRequestPermissionsAsync: vi.fn(),
  mockStart: vi.fn(),
  mockStop: vi.fn(),
}));

// Collect event listeners registered by useSpeechRecognitionEvent
const eventListeners: Record<string, (event: unknown) => void> = {};

vi.mock("expo-speech-recognition", () => ({
  ExpoSpeechRecognitionModule: {
    requestPermissionsAsync: () => mockRequestPermissionsAsync(),
    start: (opts: unknown) => mockStart(opts),
    stop: () => mockStop(),
  },
  useSpeechRecognitionEvent: (
    eventName: string,
    listener: (event: unknown) => void,
  ) => {
    eventListeners[eventName] = listener;
  },
}));

describe("useSpeechToText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear listeners between tests
    for (const key of Object.keys(eventListeners)) {
      delete eventListeners[key];
    }
  });

  it("starts with default state", () => {
    const { result } = renderHook(() => useSpeechToText());
    expect(result.current.isListening).toBe(false);
    expect(result.current.transcript).toBe("");
    expect(result.current.isFinal).toBe(false);
    expect(result.current.volume).toBe(-2);
    expect(result.current.error).toBeNull();
  });

  it("requests permissions and calls start on startListening", async () => {
    mockRequestPermissionsAsync.mockResolvedValue({ granted: true });

    const { result } = renderHook(() => useSpeechToText());

    await act(async () => {
      await result.current.startListening();
    });

    expect(mockRequestPermissionsAsync).toHaveBeenCalledOnce();
    expect(mockStart).toHaveBeenCalledWith(
      expect.objectContaining({
        lang: "en-US",
        interimResults: true,
        continuous: false,
        addsPunctuation: true,
      }),
    );
  });

  it("sets error when permissions not granted", async () => {
    mockRequestPermissionsAsync.mockResolvedValue({ granted: false });

    const { result } = renderHook(() => useSpeechToText());

    await act(async () => {
      await result.current.startListening();
    });

    expect(mockStart).not.toHaveBeenCalled();
    expect(result.current.error).toBe(
      "Microphone or speech recognition permission not granted.",
    );
  });

  it("updates transcript on result event", () => {
    const { result } = renderHook(() => useSpeechToText());

    // Simulate start event
    act(() => {
      eventListeners["start"]?.(null);
    });
    expect(result.current.isListening).toBe(true);

    // Simulate interim result
    act(() => {
      eventListeners["result"]?.({
        isFinal: false,
        results: [{ transcript: "chicken" }],
      });
    });
    expect(result.current.transcript).toBe("chicken");
    expect(result.current.isFinal).toBe(false);
  });

  it("sets isFinal on final result event", () => {
    const { result } = renderHook(() => useSpeechToText());

    act(() => {
      eventListeners["start"]?.(null);
    });

    act(() => {
      eventListeners["result"]?.({
        isFinal: true,
        results: [{ transcript: "chicken stir fry" }],
      });
    });
    expect(result.current.transcript).toBe("chicken stir fry");
    expect(result.current.isFinal).toBe(true);
  });

  it("resets isListening and volume on end event", () => {
    const { result } = renderHook(() => useSpeechToText());

    act(() => {
      eventListeners["start"]?.(null);
    });
    expect(result.current.isListening).toBe(true);

    act(() => {
      eventListeners["end"]?.(null);
    });
    expect(result.current.isListening).toBe(false);
    expect(result.current.volume).toBe(-2);
  });

  it("maps not-allowed error to permission message", () => {
    const { result } = renderHook(() => useSpeechToText());

    act(() => {
      eventListeners["error"]?.({
        error: "not-allowed",
        message: "Permission denied",
      });
    });
    expect(result.current.error).toBe(
      "Microphone or speech recognition permission not granted.",
    );
    expect(result.current.isListening).toBe(false);
  });

  it("maps no-speech error to friendly message", () => {
    const { result } = renderHook(() => useSpeechToText());

    act(() => {
      eventListeners["error"]?.({
        error: "no-speech",
        message: "No speech detected",
      });
    });
    expect(result.current.error).toBe("No speech detected. Please try again.");
  });

  it("updates volume on volumechange event", () => {
    const { result } = renderHook(() => useSpeechToText());

    act(() => {
      eventListeners["start"]?.(null);
    });

    act(() => {
      eventListeners["volumechange"]?.({ value: 5.5 });
    });
    expect(result.current.volume).toBe(5.5);
  });

  it("calls ExpoSpeechRecognitionModule.stop() on stopListening", () => {
    const { result } = renderHook(() => useSpeechToText());

    act(() => {
      result.current.stopListening();
    });
    expect(mockStop).toHaveBeenCalledOnce();
  });
});
