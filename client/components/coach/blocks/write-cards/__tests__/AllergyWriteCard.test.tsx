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
  kind: "allergy",
  status: "live",
  payload: { allergen: "tree_nuts" },
};

function Harness({ b = block }: { b?: WriteCardBlock }) {
  const [edits, setEdits] = useState<WriteCardEdits>({});
  return <WriteCard block={b} edits={edits} onEdit={setEdits} />;
}

describe("AllergyWriteCard", () => {
  beforeEach(() => mockApiRequest.mockReset());

  it("names the allergen and offers the three severities, none chosen", () => {
    renderComponent(<Harness />);
    expect(screen.getByText("Add tree nuts to your allergies")).toBeDefined();
    for (const name of ["Mild", "Moderate", "Severe"]) {
      expect(screen.getByRole("radio", { name })).toBeDefined();
    }
  });

  it("cannot be saved until a severity is picked", () => {
    renderComponent(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Add to allergies" }));
    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it("saves the severity the user picked, and only that", async () => {
    mockApiRequest.mockResolvedValue({
      json: async () => ({
        status: "saved",
        receipt: "✓ Tree nuts added to your allergies · severe",
      }),
    });
    renderComponent(<Harness />);
    fireEvent.click(screen.getByRole("radio", { name: "Moderate" }));
    fireEvent.click(screen.getByRole("radio", { name: "Severe" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to allergies" }));
    await waitFor(() => expect(mockApiRequest).toHaveBeenCalled());
    expect(mockApiRequest.mock.calls[0][2]).toEqual({
      edits: { severity: "severe" },
    });
    await waitFor(() =>
      expect(
        screen.getByText("✓ Tree nuts added to your allergies · severe"),
      ).toBeDefined(),
    );
  });

  it("names the allergy on a replaced card", () => {
    renderComponent(<Harness b={{ ...block, status: "replaced" }} />);
    expect(
      screen.getByLabelText("Replaced card: tree nuts allergy"),
    ).toBeDefined();
  });
});
