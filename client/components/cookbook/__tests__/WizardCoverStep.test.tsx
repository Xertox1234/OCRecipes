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

function renderStep({
  cover = { kind: "none" },
  canGenerate = true,
}: { cover?: WizardCover; canGenerate?: boolean } = {}) {
  const state: WizardState = {
    ...initialWizardState,
    step: "cover",
    furthest: 1,
    name: "Sunday Suppers",
    cover,
  };
  return renderComponent(
    <WizardCoverStep
      state={state}
      dispatch={dispatch}
      canGenerate={canGenerate}
      onRequestUpgrade={onRequestUpgrade}
      onPickPhoto={onPickPhoto}
      coverWidth={232}
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

  it("arms generate when the user can generate", () => {
    renderStep({ canGenerate: true });
    fireEvent.click(screen.getByRole("radio", { name: "Generate with AI" }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "setCover",
      cover: { kind: "generate" },
    });
    expect(onRequestUpgrade).not.toHaveBeenCalled();
  });

  it("turns generate off when the armed card is tapped again", () => {
    renderStep({ cover: { kind: "generate" }, canGenerate: true });
    fireEvent.click(screen.getByRole("radio", { name: "Generate with AI" }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "setCover",
      cover: { kind: "none" },
    });
    expect(dispatch).not.toHaveBeenCalledWith({
      type: "setCover",
      cover: { kind: "generate" },
    });
  });

  it("marks the generate card selected when generate is armed", () => {
    renderStep({ cover: { kind: "generate" } });
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
    expect(
      screen.getByText(
        "Your cover is made from the name and description when you create the book.",
      ),
    ).toBeTruthy();
  });

  it("marks the upload card selected once a photo is chosen", () => {
    renderStep({ cover: { kind: "photo", uri: "file:///cover.jpg" } });
    expect(
      screen
        .getByRole("radio", { name: "Upload a photo" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen.queryByText(
        "Your cover is made from the name and description when you create the book.",
      ),
    ).toBeNull();
  });

  it("speaks the premium status on the locked generate card, title first", () => {
    renderStep({ canGenerate: false });
    const card = screen.getByRole("radio", { name: /^Generate with AI/ });
    expect(card.getAttribute("aria-label")).toBe(
      "Generate with AI, premium feature",
    );
  });

  it("speaks exactly the title on the generate card when the user can generate", () => {
    renderStep({ canGenerate: true, cover: { kind: "generate" } });
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
});
