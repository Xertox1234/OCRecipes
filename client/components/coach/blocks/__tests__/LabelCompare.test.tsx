// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { renderComponent } from "../../../../../test/utils/render-component";
import BlockRenderer from "../index";
import type { LabelCompareBlock } from "@shared/schemas/coach-blocks";

const block: LabelCompareBlock = {
  type: "label_compare",
  items: [
    {
      scanId: 4,
      name: "Oat bar",
      brand: "Acme",
      servingSize: "1 bar (40 g)",
      calories: 180,
      protein: 4,
      carbs: 24,
      fat: 7,
      fiber: null,
      sugar: 9,
      sodium: 95,
    },
    {
      scanId: 9,
      name: "Nut bar",
      brand: null,
      servingSize: "1 bar (35 g)",
      calories: 190,
      protein: 6,
      carbs: 14,
      fat: 13,
      fiber: null,
      sugar: 5,
      sodium: null,
    },
  ],
};

describe("LabelCompare", () => {
  it("shows both products, each with its own serving, and a row per nutrient", () => {
    renderComponent(<BlockRenderer block={block} />);
    expect(screen.getByText("Oat bar")).toBeTruthy();
    expect(screen.getByText("Acme")).toBeTruthy();
    expect(screen.getByText("per 1 bar (40 g)")).toBeTruthy();
    expect(screen.getByText("per 1 bar (35 g)")).toBeTruthy();
    expect(screen.getByText("180")).toBeTruthy();
    expect(screen.getByText("95 mg")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
    // Neither label listed fiber.
    expect(screen.queryByText("Fiber")).toBeNull();
    expect(screen.getByText("Each per its own serving")).toBeTruthy();
  });

  it("is one accessible element that speaks everything", () => {
    renderComponent(<BlockRenderer block={block} />);
    const node = screen.getByTestId("label-compare");
    expect(node.getAttribute("aria-label")).toMatch(
      /^Comparing Oat bar by Acme, per 1 bar \(40 g\), and Nut bar, per 1 bar \(35 g\)\. Calories: 180 for Oat bar, 190 for Nut bar\./,
    );
    // The "—" cell is heard as not listed.
    expect(node.getAttribute("aria-label")).toContain(
      "Sodium: 95 milligrams for Oat bar, not listed for Nut bar",
    );
  });
});
