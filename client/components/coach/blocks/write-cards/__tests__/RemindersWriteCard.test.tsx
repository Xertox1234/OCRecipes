// @vitest-environment jsdom
import React, { useState } from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderComponent } from "../../../../../../test/utils/render-component";
import WriteCard from "../WriteCard";
import type {
  WriteCardBlock,
  WriteCardEdits,
} from "@shared/schemas/coach-write-cards";

const { mockApiRequest } = vi.hoisted(() => ({ mockApiRequest: vi.fn() }));
vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));
vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    selection: vi.fn(),
    impact: vi.fn(),
    notification: vi.fn(),
  }),
}));

const block: WriteCardBlock = {
  type: "write_card",
  cardId: "6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
  kind: "reminders",
  status: "live",
  payload: {
    changes: [
      { key: "meal-log", on: false },
      { key: "daily-checkin", on: true },
    ],
  },
};

function Harness({ b = block }: { b?: WriteCardBlock }) {
  const [edits, setEdits] = useState<WriteCardEdits>({});
  return <WriteCard block={b} edits={edits} onEdit={setEdits} />;
}

const switchOf = (name: string) =>
  screen.getByRole("switch", { name }) as HTMLInputElement;

describe("RemindersWriteCard", () => {
  beforeEach(() => mockApiRequest.mockReset());

  it("shows each reminder with the proposed switch and how it is now", () => {
    renderComponent(<Harness />);
    expect(screen.getByText("Meal logging nudges")).toBeDefined();
    expect(screen.getByText("Now on")).toBeDefined();
    expect(screen.getByText("Daily check-in")).toBeDefined();
    expect(screen.getByText("Now off")).toBeDefined();
    expect(switchOf("Meal logging nudges").checked).toBe(false);
    expect(switchOf("Daily check-in").checked).toBe(true);
    expect(
      screen.getByRole("button", { name: "Update reminders" }),
    ).toBeDefined();
  });

  it("saves the switches as the user left them", async () => {
    mockApiRequest.mockResolvedValue({
      json: async () => ({
        status: "saved",
        receipt: "✓ Reminders updated · Daily check-in on",
      }),
    });
    renderComponent(<Harness />);
    fireEvent.click(switchOf("Meal logging nudges"));
    expect(switchOf("Meal logging nudges").checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Update reminders" }));
    await waitFor(() => expect(mockApiRequest).toHaveBeenCalled());
    expect(mockApiRequest.mock.calls[0][2]).toEqual({
      edits: { on: [true, true] },
    });
    await waitFor(() =>
      expect(
        screen.getByText("✓ Reminders updated · Daily check-in on"),
      ).toBeDefined(),
    );
  });

  it("names the reminders on a replaced card", () => {
    renderComponent(<Harness b={{ ...block, status: "replaced" }} />);
    expect(screen.getByLabelText("Replaced card: 2 reminders")).toBeDefined();
  });
});
