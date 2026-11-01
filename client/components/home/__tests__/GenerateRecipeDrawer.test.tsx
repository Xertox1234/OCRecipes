// @vitest-environment jsdom
import React from "react";
import { act, screen, fireEvent } from "@testing-library/react";

import { renderComponent } from "../../../../test/utils/render-component";
import { reactProps } from "../../../../test/utils/react-props";
import { GenerateRecipeDrawer } from "../GenerateRecipeDrawer";

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

const { mockSpeech, mockStartListening } = vi.hoisted(() => ({
  mockSpeech: {
    value: {
      isListening: false,
      transcript: "",
      isFinal: false,
      volume: 0,
      error: null as string | null,
    },
  },
  mockStartListening: vi.fn(),
}));

vi.mock("@/hooks/useSpeechToText", () => ({
  useSpeechToText: () => ({
    ...mockSpeech.value,
    startListening: mockStartListening,
    stopListening: vi.fn(),
  }),
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({ selection: vi.fn(), impact: vi.fn() }),
}));

describe("GenerateRecipeDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("names the prompt input by its visible floating label", () => {
    renderComponent(<GenerateRecipeDrawer onUsed={vi.fn()} />);
    // The floating label is drawn hidden from screen readers; the input's
    // accessible name must contain it (label-in-name).
    expect(screen.getByText("Recipe idea")).toBeTruthy();
    const input = screen.getByLabelText("Recipe idea");
    expect(input.tagName).toBe("INPUT");
  });

  it("sends the typed idea to recipe chat on Return", () => {
    const onUsed = vi.fn();
    renderComponent(<GenerateRecipeDrawer onUsed={onUsed} />);
    const input = screen.getByLabelText("Recipe idea");
    fireEvent.change(input, { target: { value: "quick curry" } });
    act(() => {
      (reactProps(input).onSubmitEditing as () => void)();
    });
    expect(onUsed).toHaveBeenCalledOnce();
    expect(mockNavigate).toHaveBeenCalledWith("RecipeChat", {
      initialMessage: "quick curry",
    });
  });

  describe("voice input", () => {
    beforeEach(() => {
      mockSpeech.value = {
        isListening: false,
        transcript: "",
        isFinal: false,
        volume: 0,
        error: null,
      };
    });

    it("replaces the typed idea with the dictation", () => {
      const { rerender } = renderComponent(
        <GenerateRecipeDrawer onUsed={vi.fn()} />,
      );
      fireEvent.change(screen.getByLabelText("Recipe idea"), {
        target: { value: "old idea" },
      });
      fireEvent.click(screen.getByLabelText("Start voice input"));
      expect(mockStartListening).toHaveBeenCalledOnce();

      mockSpeech.value = {
        ...mockSpeech.value,
        isListening: true,
        transcript: "a quick curry",
      };
      rerender(<GenerateRecipeDrawer onUsed={vi.fn()} />);

      expect(
        (screen.getByLabelText("Recipe idea") as HTMLInputElement).value,
      ).toBe("a quick curry");
    });

    it("ignores a late final result after the idea was submitted", () => {
      const { rerender } = renderComponent(
        <GenerateRecipeDrawer onUsed={vi.fn()} />,
      );
      fireEvent.click(screen.getByLabelText("Start voice input"));
      mockSpeech.value = {
        ...mockSpeech.value,
        isListening: true,
        transcript: "a quick curry",
      };
      rerender(<GenerateRecipeDrawer onUsed={vi.fn()} />);
      const input = screen.getByLabelText("Recipe idea");
      expect((input as HTMLInputElement).value).toBe("a quick curry");

      act(() => {
        (reactProps(input).onSubmitEditing as () => void)();
      });
      // Recognition ends and its final result lands after the submit.
      fireEvent.change(input, { target: { value: "typed after" } });
      mockSpeech.value = {
        ...mockSpeech.value,
        isListening: false,
        isFinal: true,
        transcript: "a quick curry now final",
      };
      rerender(<GenerateRecipeDrawer onUsed={vi.fn()} />);

      expect(
        (screen.getByLabelText("Recipe idea") as HTMLInputElement).value,
      ).toBe("typed after");
    });

    it("shows a speech error and leaves the typed text untouched", () => {
      const { rerender } = renderComponent(
        <GenerateRecipeDrawer onUsed={vi.fn()} />,
      );
      fireEvent.change(screen.getByLabelText("Recipe idea"), {
        target: { value: "keep me" },
      });
      mockSpeech.value = {
        ...mockSpeech.value,
        error: "Microphone or speech recognition permission not granted.",
      };
      rerender(<GenerateRecipeDrawer onUsed={vi.fn()} />);

      expect(
        screen.getByText(
          "Microphone or speech recognition permission not granted.",
        ),
      ).toBeTruthy();
      expect(
        (screen.getByLabelText("Recipe idea") as HTMLInputElement).value,
      ).toBe("keep me");
    });
  });
});
