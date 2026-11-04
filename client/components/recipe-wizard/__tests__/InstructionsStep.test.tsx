// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, act } from "@testing-library/react";
import { reactProps } from "../../../../test/utils/react-props";
import * as Haptics from "expo-haptics";
import { renderComponent } from "../../../../test/utils/render-component";
import InstructionsStep from "../InstructionsStep";
import {
  canMoveStepDown,
  canMoveStepUp,
  shouldShowStepDelete,
} from "../instructions-step-utils";

const { mockImpact, mockNotification, mockSelection } = vi.hoisted(() => ({
  mockImpact: vi.fn(),
  mockNotification: vi.fn(),
  mockSelection: vi.fn(),
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: mockImpact,
    notification: mockNotification,
    selection: mockSelection,
    disabled: false,
  }),
}));

// ── Pure helpers ─────────────────────────────────────────────────────────────

describe("shouldShowStepDelete", () => {
  it("returns false when there is one step", () => {
    expect(shouldShowStepDelete(1)).toBe(false);
  });

  it("returns true when there are two steps", () => {
    expect(shouldShowStepDelete(2)).toBe(true);
  });
});

describe("canMoveStepUp", () => {
  it("returns false for the first row (index 0)", () => {
    expect(canMoveStepUp(0)).toBe(false);
  });

  it("returns true for any non-first row", () => {
    expect(canMoveStepUp(1)).toBe(true);
    expect(canMoveStepUp(5)).toBe(true);
  });
});

describe("canMoveStepDown", () => {
  it("returns false for the last row", () => {
    expect(canMoveStepDown(2, 3)).toBe(false);
  });

  it("returns true for a row before the last", () => {
    expect(canMoveStepDown(0, 3)).toBe(true);
    expect(canMoveStepDown(1, 3)).toBe(true);
  });

  it("returns false for a single-row list", () => {
    expect(canMoveStepDown(0, 1)).toBe(false);
  });
});

// ── Rendered InstructionsStep ────────────────────────────────────────────────

function step(key: string, text: string) {
  return { key, text };
}

describe("InstructionsStep — render", () => {
  it("disables move-up on the first row and move-down on the last row", () => {
    renderComponent(
      <InstructionsStep
        steps={[step("s_1", "Mix"), step("s_2", "Bake")]}
        addStep={vi.fn()}
        removeStep={vi.fn()}
        updateStep={vi.fn()}
        moveStep={vi.fn()}
      />,
    );
    const upButtons = screen.getAllByLabelText("Move step up");
    const downButtons = screen.getAllByLabelText("Move step down");
    expect(upButtons[0]).toHaveProperty("disabled", true);
    expect(upButtons[1]).toHaveProperty("disabled", false);
    expect(downButtons[0]).toHaveProperty("disabled", false);
    expect(downButtons[1]).toHaveProperty("disabled", true);
  });

  it("hides the delete button when there is only one step", () => {
    renderComponent(
      <InstructionsStep
        steps={[step("s_1", "Mix")]}
        addStep={vi.fn()}
        removeStep={vi.fn()}
        updateStep={vi.fn()}
        moveStep={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("Remove step")).toBeNull();
  });

  it("calls moveStep(key, 'down') when the down arrow is pressed", () => {
    const moveStep = vi.fn();
    renderComponent(
      <InstructionsStep
        steps={[step("s_1", "Mix"), step("s_2", "Bake")]}
        addStep={vi.fn()}
        removeStep={vi.fn()}
        updateStep={vi.fn()}
        moveStep={moveStep}
      />,
    );
    const downButtons = screen.getAllByLabelText("Move step down");
    fireEvent.click(downButtons[0]);
    expect(moveStep).toHaveBeenCalledWith("s_1", "down");
  });

  it("triggers haptic feedback via the centralized useHaptics hook when a step is moved", () => {
    renderComponent(
      <InstructionsStep
        steps={[step("s_1", "Mix"), step("s_2", "Bake")]}
        addStep={vi.fn()}
        removeStep={vi.fn()}
        updateStep={vi.fn()}
        moveStep={vi.fn()}
      />,
    );
    const downButtons = screen.getAllByLabelText("Move step down");
    fireEvent.click(downButtons[0]);
    expect(mockImpact).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  it("calls addStep when the Add row is pressed", () => {
    const addStep = vi.fn();
    renderComponent(
      <InstructionsStep
        steps={[step("s_1", "")]}
        addStep={addStep}
        removeStep={vi.fn()}
        updateStep={vi.fn()}
        moveStep={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("Add step"));
    expect(addStep).toHaveBeenCalledTimes(1);
  });

  it("triggers haptic feedback via the centralized useHaptics hook when Add step is pressed", () => {
    renderComponent(
      <InstructionsStep
        steps={[step("s_1", "")]}
        addStep={vi.fn()}
        removeStep={vi.fn()}
        updateStep={vi.fn()}
        moveStep={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("Add step"));
    expect(mockImpact).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  it("triggers haptic feedback via the centralized useHaptics hook when a step is removed", () => {
    const removeStep = vi.fn();
    renderComponent(
      <InstructionsStep
        steps={[step("s_1", "Mix"), step("s_2", "Bake")]}
        addStep={vi.fn()}
        removeStep={removeStep}
        updateStep={vi.fn()}
        moveStep={vi.fn()}
      />,
    );
    fireEvent.click(screen.getAllByLabelText("Remove step")[0]);
    expect(removeStep).toHaveBeenCalledWith("s_1");
    expect(mockImpact).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  it("calls updateStep when a step's text is edited", () => {
    const updateStep = vi.fn();
    renderComponent(
      <InstructionsStep
        steps={[step("s_1", "Mix")]}
        addStep={vi.fn()}
        removeStep={vi.fn()}
        updateStep={updateStep}
        moveStep={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("Step 1 instruction");
    fireEvent.change(input, { target: { value: "Mix well" } });
    expect(updateStep).toHaveBeenCalledWith("s_1", "Mix well");
  });
});

describe("InstructionsStep — Return key", () => {
  it("Return on a step adds a new step instead of a line break", () => {
    const addStep = vi.fn();
    renderComponent(
      <InstructionsStep
        steps={[step("s_1", "Mix")]}
        addStep={addStep}
        removeStep={vi.fn()}
        updateStep={vi.fn()}
        moveStep={vi.fn()}
      />,
    );
    const props = reactProps(screen.getByLabelText("Step 1 instruction"));
    expect(props.returnKeyType).toBe("next");
    expect(props.submitBehavior).toBe("submit");
    act(() => {
      (props.onSubmitEditing as () => void)();
    });
    expect(addStep).toHaveBeenCalledTimes(1);
  });

  it("focuses the step that Return added", () => {
    const steps = [step("s_1", "Mix")];
    const { rerender } = renderComponent(
      <InstructionsStep
        steps={steps}
        addStep={vi.fn()}
        removeStep={vi.fn()}
        updateStep={vi.fn()}
        moveStep={vi.fn()}
      />,
    );
    const props = reactProps(screen.getByLabelText("Step 1 instruction"));
    act(() => {
      (props.onSubmitEditing as () => void)();
    });
    rerender(
      <InstructionsStep
        steps={[...steps, step("s_2", "")]}
        addStep={vi.fn()}
        removeStep={vi.fn()}
        updateStep={vi.fn()}
        moveStep={vi.fn()}
      />,
    );
    expect(document.activeElement).toBe(
      screen.getByLabelText("Step 2 instruction"),
    );

    // One-shot: a row added later another way (the Add step button) does
    // not take focus.
    rerender(
      <InstructionsStep
        steps={[...steps, step("s_2", ""), step("s_3", "")]}
        addStep={vi.fn()}
        removeStep={vi.fn()}
        updateStep={vi.fn()}
        moveStep={vi.fn()}
      />,
    );
    expect(document.activeElement).toBe(
      screen.getByLabelText("Step 2 instruction"),
    );
  });
});

// --- Voice input: ownership ends with the session ---------------------------
// useSpeechToText is mocked with a mutable state object so a test can play the
// recognizer's side (the real one is one recognizer shared by every field).
const { mockSpeech, mockStartListening, mockStopListening } = vi.hoisted(
  () => ({
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
    mockStopListening: vi.fn(),
  }),
);

vi.mock("@/hooks/useSpeechToText", () => ({
  useSpeechToText: () => ({
    ...mockSpeech.value,
    startListening: mockStartListening,
    stopListening: mockStopListening,
  }),
}));

function resetSpeech() {
  mockSpeech.value = {
    isListening: false,
    transcript: "",
    isFinal: false,
    volume: 0,
    error: null,
  };
  mockStartListening.mockClear();
  mockStopListening.mockClear();
}

describe("InstructionsStep — voice ownership", () => {
  beforeEach(resetSpeech);

  it("does not write a transcript that arrives after the session ended", () => {
    const updateStep = vi.fn();
    const ui = () => (
      <InstructionsStep
        steps={[{ key: "step_1", text: "Boil water" }]}
        addStep={vi.fn()}
        removeStep={vi.fn()}
        updateStep={updateStep}
        moveStep={vi.fn()}
      />
    );
    const { rerender } = renderComponent(ui());
    fireEvent.click(screen.getByLabelText("Start voice input"));

    mockSpeech.value = {
      ...mockSpeech.value,
      isListening: true,
      transcript: "then salt it",
    };
    rerender(ui());
    expect(updateStep).toHaveBeenLastCalledWith(
      "step_1",
      "Boil water then salt it",
    );

    // The session times out on its own...
    mockSpeech.value = { ...mockSpeech.value, isListening: false };
    rerender(ui());
    updateStep.mockClear();
    // ...then the shared recognizer is used by another field.
    mockSpeech.value = {
      ...mockSpeech.value,
      isListening: true,
      transcript: "stray words",
    };
    rerender(ui());
    expect(updateStep).not.toHaveBeenCalled();
  });
});
