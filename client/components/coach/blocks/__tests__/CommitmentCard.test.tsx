// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderComponent } from "../../../../../test/utils/render-component";
import CommitmentCard from "../CommitmentCard";
import type { CommitmentCard as CommitmentCardType } from "@shared/schemas/coach-blocks";

const { mockTriggerPop, mockNotesOff } = vi.hoisted(() => ({
  mockTriggerPop: vi.fn(),
  mockNotesOff: vi.fn(() => false),
}));

const { mockAccept, notes, mockToastError } = vi.hoisted(() => ({
  mockAccept: vi.fn(),
  notes: {
    data: [] as {
      type: string;
      content: string;
      status: string;
      confirmedAt: string | null;
    }[],
  },
  mockToastError: vi.fn(),
}));

vi.mock("@/hooks/useNotebook", async () => {
  const { useMutation } = await import("@tanstack/react-query");
  return {
    useNotebookEntries: () => ({ data: notes.data }),
    useAcceptCommitment: (options?: { onError?: () => void }) =>
      useMutation({ mutationFn: (v: unknown) => mockAccept(v), ...options }),
  };
});

// The shared reanimated double drops array styles, so the fill is exposed here.
vi.mock("@/components/PressableScale", () => ({
  PressableScale: ({
    style,
    onPress,
    disabled,
    accessibilityLabel,
    children,
  }: {
    style?: unknown;
    onPress?: () => void;
    disabled?: boolean;
    accessibilityLabel?: string;
    children?: React.ReactNode;
  }) => (
    <button
      aria-label={accessibilityLabel}
      data-style={JSON.stringify(style)}
      disabled={disabled}
      onClick={onPress}
    >
      {children}
    </button>
  ),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ error: mockToastError }),
}));

beforeEach(() => {
  mockAccept.mockReset().mockResolvedValue(undefined);
  mockToastError.mockReset();
  notes.data = [];
});

const savedNote = {
  type: "commitment",
  content: "walk 10k steps.",
  status: "active",
  confirmedAt: "2026-05-01T00:00:00Z",
};
const acceptButton = () =>
  screen.queryByRole("button", { name: /accept commitment/i });

vi.mock("@/hooks/useHealthConsent", () => ({
  useCoachNotesOff: () => mockNotesOff(),
}));

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

  it("saves the commitment, then shows it accepted", async () => {
    renderComponent(<CommitmentCard block={baseBlock} />);
    fireEvent.click(acceptButton()!);
    await waitFor(() =>
      expect(screen.getByLabelText(/accepted commitment/i)).toBeTruthy(),
    );
    expect(mockAccept).toHaveBeenCalledWith({
      title: "Walk 10k steps",
      followUpDate: "2026-06-01",
    });
    expect(acceptButton()).toBeNull();
  });

  it("is not accepted until the save is done, and sends once", async () => {
    let finish = () => {};
    mockAccept.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    renderComponent(<CommitmentCard block={baseBlock} />);
    fireEvent.click(acceptButton()!);
    fireEvent.click(acceptButton()!);
    expect(screen.queryByLabelText(/accepted commitment/i)).toBeNull();
    finish();
    await waitFor(() => expect(acceptButton()).toBeNull());
    expect(mockAccept).toHaveBeenCalledTimes(1);
  });

  it("says so and offers Accept again when the save fails", async () => {
    mockAccept.mockRejectedValue(new Error("offline"));
    renderComponent(<CommitmentCard block={baseBlock} />);
    fireEvent.click(acceptButton()!);
    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
    expect(acceptButton()).toBeTruthy();
    expect(mockTriggerPop).not.toHaveBeenCalled();
  });

  // The streamed card is replaced by the saved row when the reply is stored.
  it("says the save failed even when the card is gone by then", async () => {
    let fail = () => {};
    mockAccept.mockReturnValue(
      new Promise<void>((_resolve, reject) => {
        fail = () => reject(new Error("offline"));
      }),
    );
    const { unmount } = renderComponent(<CommitmentCard block={baseBlock} />);
    fireEvent.click(acceptButton()!);
    await waitFor(() => expect(mockAccept).toHaveBeenCalled());
    unmount();
    fail();
    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
  });

  it.each(["active", "completed"])(
    "reopened, reads as accepted from a saved %s commitment",
    (status) => {
      notes.data = [{ ...savedNote, status }];
      renderComponent(<CommitmentCard block={baseBlock} />);
      expect(screen.getByLabelText(/accepted commitment/i)).toBeTruthy();
      expect(acceptButton()).toBeNull();
    },
  );

  it.each([
    ["unconfirmed", { confirmedAt: null }],
    ["another note", { content: "Drink water" }],
    ["another type", { type: "goal" }],
  ])("still offers Accept for a note that is %s", (_label, over) => {
    notes.data = [{ ...savedNote, ...over }];
    renderComponent(<CommitmentCard block={baseBlock} />);
    expect(acceptButton()).toBeTruthy();
  });

  it("Accept is white on the solid accent fill (M1)", () => {
    renderComponent(<CommitmentCard block={baseBlock} />);
    expect(acceptButton()!.dataset.style).toContain(
      '"backgroundColor":"#B5451C"',
    );
    expect(getComputedStyle(screen.getByText("Accept")).color).toBe(
      "rgb(255, 255, 255)",
    );
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

  // Coach chat audit 2026-11-24: a card drawn before the health consent was
  // withdrawn must not offer a check-in that nothing will save.
  describe("while Coach's notes are off", () => {
    afterEach(() => mockNotesOff.mockReturnValue(false));

    it("shows no Accept or Dismiss, and says why", () => {
      mockNotesOff.mockReturnValue(true);
      renderComponent(<CommitmentCard block={baseBlock} />);
      expect(
        screen.queryByRole("button", { name: /accept commitment/i }),
      ).toBeNull();
      expect(
        screen.queryByRole("button", { name: /dismiss commitment/i }),
      ).toBeNull();
      expect(screen.getByText(/Coach's notes are off/)).toBeTruthy();
      expect(screen.getByLabelText(/Coach's notes are off/)).toBeTruthy();
    });

    it("leaves an already accepted card as it is", () => {
      mockNotesOff.mockReturnValue(true);
      notes.data = [savedNote];
      renderComponent(<CommitmentCard block={baseBlock} />);
      expect(screen.getByLabelText(/accepted commitment/i)).toBeTruthy();
      expect(screen.queryByText(/Coach's notes are off/)).toBeNull();
    });
  });

  describe("accept pop", () => {
    beforeEach(() => {
      mockTriggerPop.mockClear();
    });

    it("a saved Accept pops the checkbox once", async () => {
      renderComponent(<CommitmentCard block={baseBlock} />);
      fireEvent.click(acceptButton()!);
      await waitFor(() => expect(mockTriggerPop).toHaveBeenCalledOnce());
    });

    it("an already-accepted card does not pop on mount", () => {
      notes.data = [savedNote];
      renderComponent(<CommitmentCard block={baseBlock} />);
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
