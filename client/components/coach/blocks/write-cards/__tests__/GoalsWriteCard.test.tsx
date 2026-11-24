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
  kind: "goals",
  status: "live",
  payload: {
    rows: [
      { key: "calories", current: 1800, proposed: 2000 },
      { key: "protein", current: null, proposed: 150 },
    ],
  },
};

function Harness({ b = block }: { b?: WriteCardBlock }) {
  const [edits, setEdits] = useState<WriteCardEdits>({});
  return <WriteCard block={b} edits={edits} onEdit={setEdits} />;
}

describe("GoalsWriteCard", () => {
  beforeEach(() => mockApiRequest.mockReset());

  it("shows each goal with the proposed value and what it is now", () => {
    renderComponent(<Harness />);
    expect(screen.getByText("Calories")).toBeDefined();
    expect(screen.getByText("Now 1,800 cal")).toBeDefined();
    expect(screen.getByText("2,000 cal")).toBeDefined();
    expect(screen.getByText("Protein")).toBeDefined();
    expect(screen.getByText("Not set yet")).toBeDefined();
    expect(screen.getByText("150 g")).toBeDefined();
    expect(screen.getByRole("button", { name: "Update goals" })).toBeDefined();
  });

  it("steps a goal by its own step and saves the values", async () => {
    mockApiRequest.mockResolvedValue({
      json: async () => ({
        status: "saved",
        receipt: "✓ Goals updated · 2,050 cal · 145 g protein",
      }),
    });
    renderComponent(<Harness />);
    fireEvent.click(screen.getByLabelText("More Calories"));
    fireEvent.click(screen.getByLabelText("Fewer Protein"));
    expect(screen.getByText("2,050 cal")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Update goals" }));
    await waitFor(() => expect(mockApiRequest).toHaveBeenCalled());
    expect(mockApiRequest.mock.calls[0][2]).toEqual({
      edits: { values: [2050, 145] },
    });
    await waitFor(() =>
      expect(
        screen.getByText("✓ Goals updated · 2,050 cal · 145 g protein"),
      ).toBeDefined(),
    );
  });

  it("stops calories at the 1,200 floor", () => {
    renderComponent(
      <Harness
        b={{
          ...block,
          payload: {
            rows: [{ key: "calories", current: 1800, proposed: 1200 }],
          },
        }}
      />,
    );
    fireEvent.click(screen.getByLabelText("Fewer Calories"));
    expect(screen.getByText("1,200 cal")).toBeDefined();
  });

  it("names the goals on a replaced card", () => {
    renderComponent(<Harness b={{ ...block, status: "replaced" }} />);
    expect(screen.getByLabelText("Replaced card: 2 daily goals")).toBeDefined();
  });
});
