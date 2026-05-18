import { describe, it, expect } from "vitest";
import { calculateChartData, CHART_VIEW_WIDTH } from "../weight-chart-utils";

describe("calculateChartData", () => {
  const makeEntry = (weight: string, loggedAt: string) => ({
    weight,
    loggedAt,
  });

  it("returns null for empty data", () => {
    expect(calculateChartData([], null, 200)).toBeNull();
  });

  it("returns correct structure for single entry", () => {
    const data = [makeEntry("70.0", "2024-01-15T10:00:00Z")];
    const result = calculateChartData(data, null, 200);

    expect(result).not.toBeNull();
    expect(result!.points).toHaveLength(1);
    expect(result!.pathData).toMatch(/^M /);
    expect(result!.goalY).toBeNull();
    expect(result!.padding).toEqual({
      top: 20,
      right: 20,
      bottom: 30,
      left: 45,
    });
    expect(result!.chartWidth).toBe(CHART_VIEW_WIDTH - 45 - 20); // 255
    expect(result!.chartHeight).toBe(200 - 20 - 30); // 150
  });

  it("sorts entries chronologically", () => {
    const data = [
      makeEntry("72.0", "2024-01-17T10:00:00Z"),
      makeEntry("70.0", "2024-01-15T10:00:00Z"),
      makeEntry("71.0", "2024-01-16T10:00:00Z"),
    ];
    const result = calculateChartData(data, null, 200);

    expect(result!.points[0].weight).toBe(70.0);
    expect(result!.points[1].weight).toBe(71.0);
    expect(result!.points[2].weight).toBe(72.0);
  });

  it("limits to last 30 entries", () => {
    const data = Array.from({ length: 35 }, (_, i) => {
      const date = new Date(2024, 0, 1);
      date.setDate(date.getDate() + i);
      return makeEntry("70.0", date.toISOString());
    });
    const result = calculateChartData(data, null, 200);

    expect(result!.points).toHaveLength(30);
  });

  it("includes goal weight in min/max range", () => {
    const data = [
      makeEntry("80.0", "2024-01-15T10:00:00Z"),
      makeEntry("82.0", "2024-01-16T10:00:00Z"),
    ];
    const result = calculateChartData(data, 70, 200);

    // minWeight should be goalWeight - 1 = 69
    expect(result!.minWeight).toBe(69);
    // maxWeight should be max(80,82,70) + 1 = 83
    expect(result!.maxWeight).toBe(83);
  });

  it("calculates goalY when goal weight provided", () => {
    const data = [makeEntry("75.0", "2024-01-15T10:00:00Z")];
    const result = calculateChartData(data, 70, 200);

    expect(result!.goalY).not.toBeNull();
    expect(typeof result!.goalY).toBe("number");
  });

  it("sets goalY to null when no goal weight", () => {
    const data = [makeEntry("75.0", "2024-01-15T10:00:00Z")];
    const result = calculateChartData(data, null, 200);

    expect(result!.goalY).toBeNull();
  });

  it("generates correct path data format", () => {
    const data = [
      makeEntry("70.0", "2024-01-15T10:00:00Z"),
      makeEntry("72.0", "2024-01-16T10:00:00Z"),
      makeEntry("71.0", "2024-01-17T10:00:00Z"),
    ];
    const result = calculateChartData(data, null, 200);

    // Path should start with M and have L segments
    expect(result!.pathData).toMatch(/^M \d+\.?\d* \d+\.?\d*/);
    expect(result!.pathData).toContain(" L ");
  });

  it("places points within chart bounds", () => {
    const data = [
      makeEntry("70.0", "2024-01-15T10:00:00Z"),
      makeEntry("80.0", "2024-01-16T10:00:00Z"),
    ];
    const result = calculateChartData(data, null, 200);

    for (const point of result!.points) {
      expect(point.x).toBeGreaterThanOrEqual(result!.padding.left);
      expect(point.x).toBeLessThanOrEqual(
        CHART_VIEW_WIDTH - result!.padding.right,
      );
      expect(point.y).toBeGreaterThanOrEqual(result!.padding.top);
      expect(point.y).toBeLessThanOrEqual(200 - result!.padding.bottom);
    }
  });

  it("respects custom height parameter", () => {
    const data = [makeEntry("70.0", "2024-01-15T10:00:00Z")];
    const result = calculateChartData(data, null, 300);

    expect(result!.chartHeight).toBe(300 - 20 - 30); // 250
  });

  it("heavier weight appears higher (lower y) on chart", () => {
    const data = [
      makeEntry("70.0", "2024-01-15T10:00:00Z"),
      makeEntry("80.0", "2024-01-16T10:00:00Z"),
    ];
    const result = calculateChartData(data, null, 200);

    // Higher weight should have lower y value (SVG coordinates)
    expect(result!.points[1].y).toBeLessThan(result!.points[0].y);
  });

  it("converts kg weights and goal to lbs when unit is imperial", () => {
    const data = [makeEntry("80.0", "2024-01-15T10:00:00Z")];
    const result = calculateChartData(data, 70, 200, "imperial");

    // 80 kg → ~176.37 lbs; bounds are ±1 around min/max of points + goal.
    expect(result!.points[0].weight).toBeCloseTo(176.37, 1);
    // goal 70 kg → ~154.32 lbs, which is the min → minWeight = goal - 1
    expect(result!.minWeight).toBeCloseTo(153.32, 1);
    expect(result!.maxWeight).toBeCloseTo(177.37, 1);
  });
});
