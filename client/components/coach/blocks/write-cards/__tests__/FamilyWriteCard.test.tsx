// @vitest-environment jsdom
import React, { useState } from "react";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
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
  kind: "family",
  status: "live",
  payload: { name: "Sam", allergens: ["peanuts", "milk"] },
};

function Harness({ b = block }: { b?: WriteCardBlock }) {
  const [edits, setEdits] = useState<WriteCardEdits>({});
  return <WriteCard block={b} edits={edits} onEdit={setEdits} />;
}

const group = (name: string) => screen.getByRole("radiogroup", { name });

describe("FamilyWriteCard", () => {
  beforeEach(() => mockApiRequest.mockReset());

  it("names the person and asks each allergy's severity, none chosen", () => {
    renderComponent(<Harness />);
    expect(screen.getByText("Add Sam to your family")).toBeDefined();
    for (const allergy of ["Peanuts", "Dairy/Milk"]) {
      const g = group(`How severe is Sam's ${allergy} allergy?`);
      for (const level of ["Mild", "Moderate", "Severe"]) {
        expect(
          (
            within(g).getByRole("radio", {
              name: `${level}, ${allergy} allergy`,
            }) as HTMLElement
          ).getAttribute("aria-checked"),
        ).not.toBe("true");
      }
    }
  });

  it("cannot be saved until every severity is picked, then saves them", async () => {
    mockApiRequest.mockResolvedValue({
      json: async () => ({
        status: "saved",
        receipt: "✓ Sam added to your family",
      }),
    });
    renderComponent(<Harness />);
    fireEvent.click(
      within(group("How severe is Sam's Peanuts allergy?")).getByRole("radio", {
        name: "Severe, Peanuts allergy",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add to your family" }));
    expect(mockApiRequest).not.toHaveBeenCalled();
    fireEvent.click(
      within(group("How severe is Sam's Dairy/Milk allergy?")).getByRole(
        "radio",
        { name: "Mild, Dairy/Milk allergy" },
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add to your family" }));
    await waitFor(() => expect(mockApiRequest).toHaveBeenCalled());
    expect(mockApiRequest.mock.calls[0][2]).toEqual({
      edits: { severities: ["severe", "mild"] },
    });
    await waitFor(() =>
      expect(screen.getByText("✓ Sam added to your family")).toBeDefined(),
    );
  });

  it("names the allergy on each severity, and says how many are left to pick", () => {
    renderComponent(<Harness />);
    expect(
      screen.getAllByRole("radio", { name: "Mild, Peanuts allergy" }),
    ).toHaveLength(1);
    expect(
      screen.getByText("Choose a severity for each allergy (2 left)"),
    ).toBeDefined();
    fireEvent.click(
      screen.getByRole("radio", { name: "Severe, Dairy/Milk allergy" }),
    );
    expect(
      screen.getByText("Choose a severity for each allergy (1 left)"),
    ).toBeDefined();
    fireEvent.click(
      screen.getByRole("radio", { name: "Mild, Peanuts allergy" }),
    );
    expect(screen.queryByText(/Choose a severity/)).toBeNull();
  });

  it("says when the person has no allergies listed", () => {
    renderComponent(
      <Harness b={{ ...block, payload: { name: "Ana", allergens: [] } }} />,
    );
    expect(screen.getByText("No allergies listed")).toBeDefined();
  });

  it("names the person on a replaced card", () => {
    renderComponent(<Harness b={{ ...block, status: "replaced" }} />);
    expect(
      screen.getByLabelText("Replaced card: Sam, family member"),
    ).toBeDefined();
  });
});
