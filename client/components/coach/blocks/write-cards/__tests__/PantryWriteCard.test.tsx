// @vitest-environment jsdom
import React, { useState } from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderComponent } from "../../../../../../test/utils/render-component";
import WriteCard from "../WriteCard";
import type {
  PantryCardPayload,
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

const CARD_ID = "6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const row = (
  over: Partial<PantryCardPayload["rows"][number]>,
): PantryCardPayload["rows"][number] => ({
  action: "add",
  name: "Eggs",
  quantity: null,
  unit: null,
  itemId: null,
  held: null,
  all: false,
  expiresInDays: null,
  ...over,
});
const block: WriteCardBlock = {
  type: "write_card",
  cardId: CARD_ID,
  kind: "pantry",
  status: "live",
  payload: {
    rows: [
      row({ quantity: "12" }),
      row({
        action: "use",
        name: "Milk",
        quantity: "1",
        unit: "L",
        itemId: 7,
        held: "2.00",
      }),
      row({
        action: "remove",
        name: "Spinach",
        unit: "bag",
        itemId: 9,
        held: "1.00",
      }),
    ],
  },
};

function Harness({ b = block }: { b?: WriteCardBlock }) {
  const [edits, setEdits] = useState<WriteCardEdits>({});
  return <WriteCard block={b} edits={edits} onEdit={setEdits} />;
}

describe("PantryWriteCard", () => {
  beforeEach(() => mockApiRequest.mockReset());

  it("shows one ticked row per change, with the action as a word", () => {
    renderComponent(<Harness />);
    for (const name of [
      "Add, Eggs, 12",
      "Use, Milk, 1 L of 2 L",
      "Remove, Spinach, 1 bag",
    ]) {
      expect(
        screen.getByRole("checkbox", { name }).getAttribute("aria-checked"),
      ).toBe("true");
    }
    expect(screen.getByText("Add")).toBeDefined();
    expect(screen.getByText("Use")).toBeDefined();
    expect(screen.getByText("Remove")).toBeDefined();
    expect(screen.getByRole("button", { name: "Update pantry" })).toBeDefined();
  });

  it("saves only the ticks", async () => {
    mockApiRequest.mockResolvedValue({
      json: async () => ({
        status: "saved",
        receipt: "✓ Pantry updated · 1 added, 1 removed",
      }),
    });
    renderComponent(<Harness />);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Use, Milk, 1 L of 2 L" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Update pantry" }));
    await waitFor(() => expect(mockApiRequest).toHaveBeenCalled());
    expect(mockApiRequest.mock.calls[0][2]).toEqual({
      edits: { ticked: [true, false, true] },
    });
    await waitFor(() =>
      expect(
        screen.getByText("✓ Pantry updated · 1 added, 1 removed"),
      ).toBeDefined(),
    );
  });

  it("cannot save with every row unticked", () => {
    renderComponent(<Harness />);
    for (const box of screen.getAllByRole("checkbox")) fireEvent.click(box);
    const button = screen.getByRole("button", { name: "Update pantry" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
  });

  it("a replaced pantry card is summed up as pantry changes, not meals", () => {
    renderComponent(<Harness b={{ ...block, status: "replaced" }} />);
    expect(screen.getByText(/3 pantry changes/)).toBeDefined();
    expect(screen.queryByText(/planned meal/)).toBeNull();
  });
});
