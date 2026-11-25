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

  // Audit 2026-11-24 M2: the chart's one accessible node said only the title
  // and summary; the bars were never spoken, and hit/miss was colour only.
  it("bar chart label speaks every bar and whether it was on target", () => {
    renderComponent(<InlineChart block={barBlock} />);
    expect(
      screen.getByLabelText(
        "Weekly Calories. Mon: 1800, on target. Tue: 2400, missed. 2 of 7 days on target",
      ),
    ).toBeTruthy();
  });

  it("a bar with no hit value is neither on target nor missed", () => {
    renderComponent(
      <InlineChart
        block={{
          type: "inline_chart",
          chartType: "bar",
          title: "Water",
          data: [{ label: "Mon", value: 6 }],
        }}
      />,
    );
    expect(screen.getByLabelText("Water. Mon: 6")).toBeTruthy();
    expect(screen.queryByText("✓")).toBeNull();
    expect(screen.queryByText("✗")).toBeNull();
  });

  it("marks hit and missed bars with a symbol, not colour alone", () => {
    renderComponent(<InlineChart block={barBlock} />);
    expect(screen.getAllByText("✓")).toHaveLength(1);
    expect(screen.getAllByText("✗")).toHaveLength(1);
  });

  // Audit L3: at large text sizes the labels wrapped and overflowed a fixed
  // 80pt row into the summary.
  it("the bar row grows with its labels instead of a fixed height", () => {
    renderComponent(<InlineChart block={barBlock} />);
    const row = screen.getByTestId("inline-chart-bars");
    expect(row.style.height).toBe("");
    expect(row.style.minHeight).toBe("80px");
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
