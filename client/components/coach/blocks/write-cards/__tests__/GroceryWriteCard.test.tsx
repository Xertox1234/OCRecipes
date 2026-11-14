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

const CARD_ID = "6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const item = (name: string, ticked = true) => ({
  name,
  quantity: "1",
  unit: null,
  ticked,
});
const block: WriteCardBlock = {
  type: "write_card",
  cardId: CARD_ID,
  kind: "grocery",
  status: "live",
  payload: {
    items: [
      item("Red lentils"),
      item("Canned tomatoes"),
      item("Ginger", false),
      item("Spinach"),
      item("Coconut milk"),
    ],
    lists: [{ id: 7, title: "Weekly shop" }],
    defaultListId: 7,
    newListName: "Lentil stew",
  },
};

function Harness() {
  const [edits, setEdits] = useState<WriteCardEdits>({});
  return <WriteCard block={block} edits={edits} onEdit={setEdits} />;
}

describe("GroceryWriteCard", () => {
  beforeEach(() => mockApiRequest.mockReset());

  it('unticking an item changes "Add 4 items" to "Add 3 items"', () => {
    renderComponent(<Harness />);
    expect(screen.getByRole("button", { name: "Add 4 items" })).toBeDefined();
    const spinach = screen.getByRole("checkbox", { name: "Spinach, 1" });
    expect(spinach.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(spinach);
    expect(spinach.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("button", { name: "Add 3 items" })).toBeDefined();
  });

  it('New list chip sends listId "new"', async () => {
    mockApiRequest.mockResolvedValue({
      json: async () => ({
        status: "saved",
        receipt: "✓ Added 4 items to Lentil stew",
      }),
    });
    renderComponent(<Harness />);
    expect(
      screen
        .getByRole("radio", { name: "Weekly shop" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(
      screen.getByRole("radio", { name: "New list (Lentil stew)" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add 4 items" }));
    await waitFor(() => expect(mockApiRequest).toHaveBeenCalled());
    expect(mockApiRequest.mock.calls[0][2]).toEqual({
      edits: { listId: "new" },
    });
  });
});
