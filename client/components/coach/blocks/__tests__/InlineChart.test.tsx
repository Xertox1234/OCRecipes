// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { renderComponent } from "../../../../../test/utils/render-component";
import InlineChart from "../InlineChart";
import type { InlineChart as InlineChartType } from "@shared/schemas/coach-blocks";

const statRowBlock: InlineChartType = {
  type: "inline_chart",
  chartType: "stat_row",
  title: "Nutrition Summary",
  data: [
    { label: "Calories", value: 2300 },
    { label: "Protein", value: 165 },
    { label: "Fat", value: 45 },
    { label: "Carbs", value: 72 },
  ],
};

describe("InlineChart", () => {
  it("stat_row has an accessibilityLabel on the container", () => {
    renderComponent(<InlineChart block={statRowBlock} />);
    // accessibilityLabel maps to aria-label in jsdom; should include "2300"
    expect(
      screen.getByLabelText(
        "Nutrition Summary. Calories: 2300, Protein: 165, Fat: 45, Carbs: 72",
      ),
    ).toBeTruthy();
  });
});
