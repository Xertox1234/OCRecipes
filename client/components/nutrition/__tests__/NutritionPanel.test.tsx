// @vitest-environment jsdom
import React from "react";
import { describe, it, expect } from "vitest";

import { renderComponent } from "../../../../test/utils/render-component";
import { NutritionPanel } from "../NutritionPanel";
import { NUTRIENT_ROWS } from "../NutritionPanel-utils";
import type { PanelRowData } from "../nutrition-band-source";

function row(overrides: Partial<PanelRowData> & { row: PanelRowData["row"] }) {
  return {
    displayValue: undefined,
    band: null,
    hasValue: false,
    ...overrides,
  } as PanelRowData;
}

describe("NutritionPanel", () => {
  it("renders a banded row with its value, unit and tag", () => {
    const { queryByText } = renderComponent(
      <NutritionPanel
        rows={[
          row({
            row: NUTRIENT_ROWS.sugar,
            displayValue: 39,
            band: { group: "concern", band: "high" },
            hasValue: true,
          }),
        ]}
      />,
    );
    expect(queryByText("Sugar")).toBeTruthy();
    expect(queryByText("39 g")).toBeTruthy();
    expect(queryByText("HIGH")).toBeTruthy();
  });

  it("renders an UNBANDED row with the value and NO tag and NO indicator", () => {
    // Assert on the indicator and the value, not on the row label: a
    // label-only assertion passes in every row state.
    const { queryByText, container } = renderComponent(
      <NutritionPanel
        rows={[
          row({
            row: NUTRIENT_ROWS.sugar,
            displayValue: 39,
            band: { group: "concern", band: "unknown" },
            hasValue: true,
          }),
        ]}
      />,
    );
    expect(queryByText("39 g")).toBeTruthy();
    expect(queryByText("LOW")).toBeNull();
    expect(queryByText("HIGH")).toBeNull();
    expect(
      container.querySelector('[data-testid="band-indicator-sugar"]'),
    ).toBeNull();
  });

  it("an unbanded row is NOT rendered as a green LOW", () => {
    const { queryByTestId } = renderComponent(
      <NutritionPanel
        rows={[
          row({
            row: NUTRIENT_ROWS.sugar,
            displayValue: 39,
            band: { group: "concern", band: "unknown" },
            hasValue: true,
          }),
          row({
            row: NUTRIENT_ROWS.fat,
            displayValue: 1,
            band: { group: "concern", band: "low" },
            hasValue: true,
          }),
        ]}
      />,
    );
    expect(queryByTestId("band-indicator-sugar")).toBeNull();
    expect(queryByTestId("band-indicator-fat")).toBeTruthy();
  });

  it("renders a ZERO row as NONE, distinct from not-recorded", () => {
    const { queryByText } = renderComponent(
      <NutritionPanel
        rows={[
          row({
            row: NUTRIENT_ROWS.fibre,
            displayValue: 0,
            band: { group: "benefit", band: "none" },
            hasValue: true,
          }),
        ]}
      />,
    );
    expect(queryByText("0 g")).toBeTruthy();
    expect(queryByText("NONE")).toBeTruthy();
    expect(queryByText("Not recorded")).toBeNull();
  });

  it("renders a NOT-RECORDED row with an em dash and no value", () => {
    const { queryByText } = renderComponent(
      <NutritionPanel
        rows={[
          row({
            row: NUTRIENT_ROWS.saturatedFat,
            displayValue: undefined,
            band: { group: "concern", band: "unknown" },
            hasValue: false,
          }),
        ]}
      />,
    );
    expect(queryByText("Not recorded")).toBeTruthy();
    expect(queryByText("0 g")).toBeNull();
  });

  it("gives each row one accessible group carrying the composed label", () => {
    const { container } = renderComponent(
      <NutritionPanel
        rows={[
          row({
            row: NUTRIENT_ROWS.sodium,
            displayValue: 680,
            band: { group: "concern", band: "medium" },
            hasValue: true,
          }),
        ]}
      />,
    );
    expect(
      container.querySelector('[aria-label="Sodium, 680 milligrams, medium"]'),
    ).toBeTruthy();
  });

  it("hides the indicator from the a11y tree on BOTH platforms", () => {
    const { queryByTestId } = renderComponent(
      <NutritionPanel
        rows={[
          row({
            row: NUTRIENT_ROWS.sugar,
            displayValue: 39,
            band: { group: "concern", band: "high" },
            hasValue: true,
          }),
        ]}
      />,
    );
    const dot = queryByTestId("band-indicator-sugar");
    expect(dot?.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders nothing at all when given no rows", () => {
    const { container } = renderComponent(<NutritionPanel rows={[]} />);
    expect(container.textContent).toBe("");
  });
});
