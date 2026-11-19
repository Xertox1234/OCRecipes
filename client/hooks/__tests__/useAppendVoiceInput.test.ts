// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";

import { useAppendVoiceInput } from "../useAppendVoiceInput";

const { field, mockToggle, mockRelease, mockImpact, mockToastError } =
  vi.hoisted(() => ({
    field: {
      isListening: false,
      volume: -2,
      error: null as string | null,
      onTranscript: null as ((t: string) => void) | null,
    },
    mockToggle: vi.fn(),
    mockRelease: vi.fn(),
    mockImpact: vi.fn(),
    mockToastError: vi.fn(),
  }));

vi.mock("../useVoiceField", () => ({
  useVoiceField: ({ onTranscript }: { onTranscript: (t: string) => void }) => {
    field.onTranscript = onTranscript;
    return {
      isListening: field.isListening,
      volume: field.volume,
      error: field.error,
      toggle: mockToggle,
      release: mockRelease,
    };
  },
}));

vi.mock("../useHaptics", () => ({
  useHaptics: () => ({ impact: mockImpact }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ error: mockToastError }),
}));

describe("useAppendVoiceInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    field.isListening = false;
    field.error = null;
    field.onTranscript = null;
  });

  function setup(initial: {
    text: string;
    maxLength?: number;
    stopWhen?: boolean;
  }) {
    const setText = vi.fn();
    const hook = renderHook<
      ReturnType<typeof useAppendVoiceInput>,
      { text: string; stopWhen?: boolean }
    >(
      (props) =>
        useAppendVoiceInput({
          text: props.text,
          setText,
          maxLength: initial.maxLength ?? 100,
          stopWhen: props.stopWhen,
        }),
      { initialProps: { text: initial.text, stopWhen: initial.stopWhen } },
    );
    return { setText, ...hook };
  }

  it("appends the transcript to what was typed when the mic was tapped", () => {
    const { result, setText } = setup({ text: "  two eggs  " });
    act(() => result.current.onPress());
    expect(mockToggle).toHaveBeenCalledOnce();
    act(() => field.onTranscript!("and toast"));
    expect(setText).toHaveBeenLastCalledWith("two eggs and toast");
  });

  it("writes the transcript alone when nothing was typed", () => {
    const { result, setText } = setup({ text: "   " });
    act(() => result.current.onPress());
    act(() => field.onTranscript!("oatmeal"));
    expect(setText).toHaveBeenLastCalledWith("oatmeal");
  });

  it("caps the combined text at maxLength", () => {
    const { result, setText } = setup({ text: "abc", maxLength: 6 });
    act(() => result.current.onPress());
    act(() => field.onTranscript!("defgh"));
    expect(setText).toHaveBeenLastCalledWith("abc de");
  });

  it("keeps the original base when tapped again while listening", () => {
    const { result, setText, rerender } = setup({ text: "base" });
    act(() => result.current.onPress());
    field.isListening = true;
    rerender({ text: "base live words" });
    act(() => result.current.onPress());
    act(() => field.onTranscript!("live words"));
    expect(setText).toHaveBeenLastCalledWith("base live words");
  });

  it("gives a medium haptic on each tap", () => {
    const { result } = setup({ text: "" });
    act(() => result.current.onPress());
    expect(mockImpact).toHaveBeenCalledWith("medium");
  });

  it("shows a speech error as a toast", () => {
    field.error = "Microphone unavailable";
    setup({ text: "" });
    expect(mockToastError).toHaveBeenCalledWith("Microphone unavailable");
  });

  it("ends the capture once stopWhen turns true", () => {
    const { rerender } = setup({ text: "", stopWhen: false });
    expect(mockRelease).not.toHaveBeenCalled();
    rerender({ text: "", stopWhen: true });
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it("exposes release for callers that end capture themselves", () => {
    const { result } = setup({ text: "" });
    result.current.release();
    expect(mockRelease).toHaveBeenCalledOnce();
  });
});
