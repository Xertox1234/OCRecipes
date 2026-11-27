// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { renderComponent } from "../../../../../test/utils/render-component";
import InlineChart from "../InlineChart";
import type { InlineChart as InlineChartType } from "@shared/schemas/coach-blocks";
import { Colors } from "@/constants/theme";

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

  // Review of #2054: the 10pt marks in the success/error tones were 4.43:1
  // and 4.02:1 on the chart's light background, under AA. The bar carries
  // the colour; the mark carries the shape, in the text colour.
  it("draws the marks in the text colour", () => {
    renderComponent(<InlineChart block={barBlock} />);
    expect(screen.getByText("✓").style.color).toBe(hexToRgb(Colors.light.text));
    expect(screen.getByText("✗").style.color).toBe(hexToRgb(Colors.light.text));
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

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

describe("InlineChart, the T4 kinds", () => {
  const ringBlock: InlineChartType = {
    type: "inline_chart",
    chartType: "ring",
    title: "This week's averages",
    data: [
      { label: "Protein", value: 160, target: 150, hit: true },
      { label: "Carbs", value: 125, target: 250 },
      { label: "Fibre", value: 20 },
    ],
  };

  it("draws one ring per value with a target, its number and its goal", () => {
    renderComponent(<InlineChart block={ringBlock} />);
    expect(screen.getAllByTestId("inline-chart-ring")).toHaveLength(2);
    expect(screen.getByText("160")).toBeTruthy();
    expect(screen.getByText("of 150")).toBeTruthy();
    expect(screen.queryByText("Fibre")).toBeNull();
    expect(
      screen.getByLabelText(
        "This week's averages. Protein: 160 of 150, on target. Carbs: 125 of 250",
      ),
    ).toBeTruthy();
  });

  it("marks a met ring with a symbol, not colour alone", () => {
    renderComponent(<InlineChart block={ringBlock} />);
    expect(screen.getByText("Protein ✓")).toBeTruthy();
    expect(screen.getByText("Carbs")).toBeTruthy();
    renderComponent(
      <InlineChart
        block={{
          ...ringBlock,
          data: [{ label: "Fat", value: 90, target: 70, hit: false }],
        }}
      />,
    );
    expect(screen.getByText("Fat ✗")).toBeTruthy();
  });

  const sparkBlock: InlineChartType = {
    type: "inline_chart",
    chartType: "sparkline",
    title: "Weight",
    data: [
      { label: "Nov 1", value: 84 },
      { label: "Nov 8", value: 83 },
      { label: "Nov 15", value: 82, target: 80 },
    ],
    summary: "Down 2 kg",
  };

  it("draws the line with its first and last day and the latest number", () => {
    const { container } = renderComponent(<InlineChart block={sparkBlock} />);
    expect(container.querySelector("polyline")).toBeTruthy();
    // The goal line, dashed.
    expect(container.querySelector("line")).toBeTruthy();
    expect(screen.getByText("Nov 1")).toBeTruthy();
    expect(screen.getByText("Nov 15 · 82 · goal 80")).toBeTruthy();
    expect(screen.getByText("Down 2 kg")).toBeTruthy();
    expect(
      screen.getByLabelText(
        "Weight. From 84 on Nov 1 to 82 on Nov 15, down 2. Goal 80. Down 2 kg",
      ),
    ).toBeTruthy();
  });

  it("shows only its words when there are too few points for a line", () => {
    const { container } = renderComponent(
      <InlineChart block={{ ...sparkBlock, data: [sparkBlock.data[0]] }} />,
    );
    expect(container.querySelector("polyline")).toBeNull();
    expect(screen.getByText("Weight")).toBeTruthy();
  });

  const heatBlock: InlineChartType = {
    type: "inline_chart",
    chartType: "heatmap",
    title: "Protein goal",
    data: [
      { label: "Mon", value: 160, hit: true },
      { label: "Tue", value: 90, hit: false },
      { label: "Wed", value: 155, hit: true },
    ],
  };

  it("draws a square per day, the met days marked with a symbol", () => {
    renderComponent(<InlineChart block={heatBlock} />);
    expect(screen.getAllByTestId("inline-chart-cell")).toHaveLength(3);
    expect(screen.getAllByText("✓")).toHaveLength(2);
    // A missed day is marked too, not left as a faint square.
    expect(screen.getAllByText("✗")).toHaveLength(1);
    expect(screen.getByText("Mon")).toBeTruthy();
    expect(screen.getByText("Wed")).toBeTruthy();
    expect(
      screen.getByLabelText(
        "Protein goal. 2 of 3 days met. Mon: 160, met. Tue: 90, missed. Wed: 155, met",
      ),
    ).toBeTruthy();
  });
});
