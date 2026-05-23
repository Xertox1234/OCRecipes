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

const barBlock: InlineChartType = {
  type: "inline_chart",
  chartType: "bar",
  title: "Weekly Calories",
  data: [
    { label: "Mon", value: 1800, hit: true },
    { label: "Tue", value: 2400, hit: false },
  ],
  summary: "2 of 7 days on target",
};

const progressBlock: InlineChartType = {
  type: "inline_chart",
  chartType: "progress",
  title: "Protein Goal",
  data: [{ label: "Protein", value: 90, target: 120 }],
  summary: "75% of target",
};

const progressNoTargetBlock: InlineChartType = {
  type: "inline_chart",
  chartType: "progress",
  title: "Steps",
  data: [{ label: "Steps", value: 5000 }],
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

  it("renders a bar chart with title, bars, and summary", () => {
    renderComponent(<InlineChart block={barBlock} />);
    expect(screen.getByText("Weekly Calories")).toBeTruthy();
    expect(screen.getByText("Mon")).toBeTruthy();
    expect(screen.getByText("2 of 7 days on target")).toBeTruthy();
  });

  it("renders a progress chart, computing percent from value/target", () => {
    renderComponent(<InlineChart block={progressBlock} />);
    expect(
      screen.getByLabelText("Protein Goal. 90 of 120. 75% of target"),
    ).toBeTruthy();
  });

  it("renders a progress chart with no target (pct=0 branch)", () => {
    renderComponent(<InlineChart block={progressNoTargetBlock} />);
    // datum.target is undefined → label uses "?" and no summary appended.
    expect(screen.getByLabelText("Steps. 5000 of ?")).toBeTruthy();
  });
});
