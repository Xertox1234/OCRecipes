// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";

import { renderComponent } from "../../../../test/utils/render-component";
import { WizardCoverStep } from "../WizardCoverStep";
import {
  initialWizardState,
  type WizardCover,
  type WizardState,
} from "../cookbook-wizard-utils";

const { mockSelection } = vi.hoisted(() => ({ mockSelection: vi.fn() }));

vi.mock("expo-image", () => ({
  Image: () => null,
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: vi.fn(),
    notification: vi.fn(),
    selection: mockSelection,
    disabled: false,
  }),
}));

const dispatch = vi.fn();
const onPickPhoto = vi.fn();
const onRequestUpgrade = vi.fn();
const onGenerate = vi.fn();

const candidates = [
  { id: "a", imageUrl: "https://cdn.test/a.jpg" },
  { id: "b", imageUrl: "https://cdn.test/b.jpg" },
];

function renderStep({
  cover = { kind: "none" },
  canGenerate = true,
  studio = {},
  controls = {},
}: {
  cover?: WizardCover;
  canGenerate?: boolean;
  studio?: Partial<WizardState["studio"]>;
  controls?: Partial<{
    generating: boolean;
    error: string | null;
    promptIgnored: boolean;
  }>;
} = {}) {
  const state: WizardState = {
    ...initialWizardState,
    step: "cover",
    furthest: 1,
    name: "Sunday Suppers",
    cover,
    studio: { ...initialWizardState.studio, ...studio },
  };
  return renderComponent(
    <WizardCoverStep
      state={state}
      dispatch={dispatch}
      canGenerate={canGenerate}
      onRequestUpgrade={onRequestUpgrade}
      onPickPhoto={onPickPhoto}
      coverWidth={232}
      studioControls={{
        generating: false,
        error: null,
        promptIgnored: false,
        onGenerate,
        ...controls,
      }}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("WizardCoverStep", () => {
  it("opens the photo picker when 'Upload a photo' is tapped", () => {
    renderStep();
    fireEvent.click(screen.getByRole("radio", { name: "Upload a photo" }));
    expect(onPickPhoto).toHaveBeenCalledTimes(1);
    // The picker is async and owned by the screen: the card itself never
    // claims a photo cover before one is chosen.
    expect(dispatch).not.toHaveBeenCalled();
    // SelectableTile owns the selection tick — exactly one, never doubled.
    expect(mockSelection).toHaveBeenCalledTimes(1);
  });

  it("asks to upgrade, without arming generate, when the user can't generate", () => {
    renderStep({ canGenerate: false });
    fireEvent.click(
      screen.getByRole("radio", { name: "Generate with AI, premium feature" }),
    );
    expect(onRequestUpgrade).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("opens the studio when the user can generate", () => {
    renderStep({ canGenerate: true });
    fireEvent.click(screen.getByRole("radio", { name: "Generate with AI" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "openStudio" });
    expect(onRequestUpgrade).not.toHaveBeenCalled();
  });

  it("closes the studio when the selected AI card is tapped again", () => {
    renderStep({ studio: { open: true } });
    fireEvent.click(screen.getByRole("radio", { name: "Generate with AI" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "closeStudio" });
  });

  it("marks the AI card selected and shows the studio while it is open", () => {
    renderStep({ studio: { open: true } });
    expect(
      screen
        .getByRole("radio", { name: "Generate with AI" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen
        .getByRole("radio", { name: "Upload a photo" })
        .getAttribute("aria-selected"),
    ).toBe("false");
    expect(screen.getByLabelText("Describe your cover")).toBeTruthy();
  });

  it("hides the studio while it is closed", () => {
    renderStep();
    expect(screen.queryByLabelText("Describe your cover")).toBeNull();
    expect(
      screen.queryByRole("radiogroup", { name: "Cover style" }),
    ).toBeNull();
  });

  it("marks the upload card selected once a photo is chosen", () => {
    renderStep({ cover: { kind: "photo", uri: "file:///cover.jpg" } });
    expect(
      screen
        .getByRole("radio", { name: "Upload a photo" })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("speaks the premium status on the locked generate card, title first", () => {
    renderStep({ canGenerate: false });
    const card = screen.getByRole("radio", { name: /^Generate with AI/ });
    expect(card.getAttribute("aria-label")).toBe(
      "Generate with AI, premium feature",
    );
  });

  it("speaks exactly the title on the generate card when the user can generate", () => {
    renderStep({ canGenerate: true, studio: { open: true } });
    const card = screen.getByRole("radio", { name: /^Generate with AI/ });
    expect(card.getAttribute("aria-label")).toBe("Generate with AI");
  });

  it("names the cover choices as a group", () => {
    renderStep();
    expect(
      screen.getByRole("radiogroup", { name: "Cover source" }),
    ).toBeTruthy();
  });

  it("removes the photo when the selected upload card is tapped again", () => {
    renderStep({ cover: { kind: "photo", uri: "file:///cover.jpg" } });
    const card = screen.getByRole("radio", { name: "Upload a photo" });
    expect(card.getAttribute("aria-hint")).toBe("Removes the photo");

    fireEvent.click(card);

    expect(dispatch).toHaveBeenCalledWith({
      type: "setCover",
      cover: { kind: "none" },
    });
    expect(onPickPhoto).not.toHaveBeenCalled();
  });

  describe("cover studio", () => {
    it("fills the field from an idea chip", () => {
      renderStep({ studio: { open: true } });
      fireEvent.click(
        screen.getByRole("button", {
          name: "Fresh pasta on a floured wooden board",
        }),
      );
      expect(dispatch).toHaveBeenCalledWith({
        type: "setCoverPrompt",
        value: "Fresh pasta on a floured wooden board",
      });
    });

    it("offers the four styles as a radio group, the current one selected", () => {
      renderStep({ studio: { open: true, style: "golden-hour" } });
      const group = screen.getByRole("radiogroup", { name: "Cover style" });
      expect(group).toBeTruthy();
      for (const label of [
        "Rustic terracotta",
        "Botanical parchment",
        "Golden hour",
        "Midnight coral",
      ]) {
        expect(
          screen.getByRole("radio", { name: `${label} style` }),
        ).toBeTruthy();
      }
      expect(
        screen
          .getByRole("radio", { name: "Golden hour style" })
          .getAttribute("aria-selected"),
      ).toBe("true");
    });

    it("picks a style", () => {
      renderStep({ studio: { open: true } });
      fireEvent.click(
        screen.getByRole("radio", { name: "Midnight coral style" }),
      );
      expect(dispatch).toHaveBeenCalledWith({
        type: "setCoverStyle",
        style: "midnight-coral",
      });
    });

    it("generates the first set", () => {
      renderStep({ studio: { open: true } });
      fireEvent.click(
        screen.getByRole("button", { name: "Generate 4 covers" }),
      );
      expect(onGenerate).toHaveBeenCalledTimes(1);
    });

    it("offers 4 more once a set is showing, and lists the set as options", () => {
      renderStep({ studio: { open: true, candidates } });
      expect(
        screen.getByRole("button", { name: "Generate 4 more" }),
      ).toBeTruthy();
      expect(
        screen.getByRole("radiogroup", { name: "Pick a cover" }),
      ).toBeTruthy();
      expect(
        screen.getByRole("radio", { name: "Cover option 1 of 2" }),
      ).toBeTruthy();
      expect(
        screen.getByRole("radio", { name: "Cover option 2 of 2" }),
      ).toBeTruthy();
    });

    it("picks a candidate", () => {
      renderStep({ studio: { open: true, candidates } });
      fireEvent.click(
        screen.getByRole("radio", { name: "Cover option 2 of 2" }),
      );
      expect(dispatch).toHaveBeenCalledWith({
        type: "pickCandidate",
        candidate: candidates[1],
      });
    });

    it("marks the picked candidate selected", () => {
      renderStep({
        studio: { open: true, candidates },
        cover: { kind: "candidate", candidateId: "b", imageUrl: "u" },
      });
      expect(
        screen
          .getByRole("radio", { name: "Cover option 2 of 2" })
          .getAttribute("aria-selected"),
      ).toBe("true");
      expect(
        screen
          .getByRole("radio", { name: "Cover option 1 of 2" })
          .getAttribute("aria-selected"),
      ).toBe("false");
    });

    it("disables the button and hides the old set while generating", () => {
      renderStep({
        studio: { open: true, candidates },
        controls: { generating: true },
      });
      const button = screen.getByRole("button", { name: /Generating/ });
      fireEvent.click(button);
      expect(onGenerate).not.toHaveBeenCalled();
      expect(screen.queryByRole("radio", { name: /Cover option/ })).toBeNull();
    });

    it("shows the error", () => {
      renderStep({
        studio: { open: true },
        controls: { error: "Couldn't make covers right now. Try again." },
      });
      expect(
        screen.getByText("Couldn't make covers right now. Try again."),
      ).toBeTruthy();
    });

    it("says when the request was set aside for food scenes", () => {
      renderStep({
        studio: { open: true, candidates },
        controls: { promptIgnored: true },
      });
      expect(
        screen.getByText("We kept your covers to food scenes."),
      ).toBeTruthy();
    });
  });
});
