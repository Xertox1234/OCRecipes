// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { renderComponent } from "../../../../../test/utils/render-component";
import CommitmentCard from "../CommitmentCard";
import type { CommitmentCard as CommitmentCardType } from "@shared/schemas/coach-blocks";

const { mockTriggerPop } = vi.hoisted(() => ({ mockTriggerPop: vi.fn() }));

// The pop fires its own Success haptic, so the trigger spy stands for both.
vi.mock("@/hooks/useSuccessAnimation", () => ({
  useSuccessPop: () => ({ trigger: mockTriggerPop, animatedStyle: {} }),
}));

const baseBlock: CommitmentCardType = {
  type: "commitment_card",
  title: "Walk 10k steps",
  followUpText: "How did your walking go?",
  followUpDate: "2026-06-01",
  notebookEntryId: 7,
};

describe("CommitmentCard", () => {
  it("renders Accept/Dismiss actions when not accepted", () => {
    renderComponent(<CommitmentCard block={baseBlock} />);
    expect(
      screen.getByRole("button", { name: /accept commitment/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /dismiss commitment/i }),
    ).toBeTruthy();
  });

  it("calls onAccept with the entry id and hides actions after Accept", () => {
    const onAccept = vi.fn();
    renderComponent(<CommitmentCard block={baseBlock} onAccept={onAccept} />);
    fireEvent.click(screen.getByRole("button", { name: /accept commitment/i }));
    expect(onAccept).toHaveBeenCalledWith(7, "Walk 10k steps", "2026-06-01");
    // After local accept, the Accept button is gone (the !accepted branch).
    expect(
      screen.queryByRole("button", { name: /accept commitment/i }),
    ).toBeNull();
  });

  it("treats the card as accepted when isAccepted prop is true (controlled)", () => {
    renderComponent(<CommitmentCard block={baseBlock} isAccepted />);
    expect(
      screen.queryByRole("button", { name: /accept commitment/i }),
    ).toBeNull();
    // Accepted state surfaces in the group's accessibility label.
    expect(screen.getByLabelText(/accepted commitment/i)).toBeTruthy();
  });

  it("shows the Dismissed state after Dismiss is pressed", () => {
    renderComponent(<CommitmentCard block={baseBlock} />);
    fireEvent.click(
      screen.getByRole("button", { name: /dismiss commitment/i }),
    );
    expect(screen.getByText("Dismissed")).toBeTruthy();
    // The Accept action is unmounted once dismissed.
    expect(
      screen.queryByRole("button", { name: /accept commitment/i }),
    ).toBeNull();
  });

  // Accept flips the card locally and the POST failure is non-fatal, so the
  // tap itself is the success moment.
  describe("accept pop", () => {
    beforeEach(() => {
      mockTriggerPop.mockClear();
    });

    it("Accept pops the checkbox once", () => {
      const onAccept = vi.fn();
      renderComponent(<CommitmentCard block={baseBlock} onAccept={onAccept} />);
      fireEvent.click(
        screen.getByRole("button", { name: /accept commitment/i }),
      );
      expect(mockTriggerPop).toHaveBeenCalledOnce();
      expect(onAccept).toHaveBeenCalledWith(7, "Walk 10k steps", "2026-06-01");
    });

    it("an already-accepted card does not pop on mount", () => {
      renderComponent(<CommitmentCard block={baseBlock} isAccepted />);
      expect(mockTriggerPop).not.toHaveBeenCalled();
    });

    it("Dismiss does not pop", () => {
      renderComponent(<CommitmentCard block={baseBlock} />);
      fireEvent.click(
        screen.getByRole("button", { name: /dismiss commitment/i }),
      );
      expect(mockTriggerPop).not.toHaveBeenCalled();
    });
  });
});
