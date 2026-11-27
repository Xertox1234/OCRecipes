import {
  chartNumber,
  heatmapCells,
  heatmapSpoken,
  ringItems,
  ringSpoken,
  sparklineData,
  sparklineGeometry,
  sparklineSpoken,
} from "../inline-chart-utils";

describe("chartNumber", () => {
  it("rounds to one decimal and groups thousands", () => {
    expect(chartNumber(82.44)).toBe("82.4");
    expect(chartNumber(1850)).toBe("1,850");
    expect(chartNumber(120)).toBe("120");
  });
});

describe("ringItems", () => {
  it("keeps the values with a target, at most four, and caps the fill at full", () => {
    const items = ringItems([
      { label: "Protein", value: 180, target: 150, hit: true },
      { label: "Fibre", value: 20 },
      { label: "Carbs", value: 125, target: 250 },
      { label: "Fat", value: 60, target: 70, hit: false },
      { label: "Sugar", value: 30, target: 50 },
      { label: "Salt", value: 2, target: 6 },
    ]);
    expect(items.map((i) => i.label)).toEqual([
      "Protein",
      "Carbs",
      "Fat",
      "Sugar",
    ]);
    expect(items[0]).toMatchObject({ progress: 1, text: "180", of: "of 150" });
    expect(items[1].progress).toBe(0.5);
    expect(items[2].hit).toBe(false);
  });

  it("drops a value whose target is zero or less", () => {
    expect(ringItems([{ label: "X", value: 1, target: 0 }])).toEqual([]);
  });

  it("speaks each ring and whether it met its target", () => {
    const items = ringItems([
      { label: "Protein", value: 180, target: 150, hit: true },
      { label: "Fat", value: 60, target: 70, hit: false },
      { label: "Carbs", value: 125, target: 250 },
    ]);
    expect(ringSpoken("Week averages", items, "A good week")).toBe(
      "Week averages. Protein: 180 of 150, on target. Fat: 60 of 70, missed. Carbs: 125 of 250. A good week",
    );
  });
});

describe("sparklineGeometry", () => {
  const data = [
    { label: "Nov 1", value: 84 },
    { label: "Nov 8", value: 83 },
    { label: "Nov 15", value: 82, target: 80 },
  ];

  it("spreads the points across the width, highest value at the top", () => {
    const g = sparklineGeometry(data, 200, 60);
    expect(g?.points).toHaveLength(3);
    expect(g?.points[0].x).toBe(g?.pad);
    expect(g?.points[2].x).toBe(200 - (g?.pad ?? 0));
    // 84 is the highest, so it sits highest (smallest y).
    expect(g?.points[0].y).toBeLessThan(g?.points[2].y ?? 0);
  });

  it("puts the goal line in range when there is a target", () => {
    const g = sparklineGeometry(data, 200, 60);
    expect(g?.targetY).toBeDefined();
    // 80 is below every point, so the line is under all of them.
    for (const p of g?.points ?? []) {
      expect(g?.targetY ?? 0).toBeGreaterThan(p.y);
    }
  });

  it("draws a flat line across the middle when every value is the same", () => {
    const g = sparklineGeometry(
      [
        { label: "a", value: 5 },
        { label: "b", value: 5 },
      ],
      100,
      60,
    );
    expect(g?.points.map((p) => p.y)).toEqual([30, 30]);
  });

  it("draws only the latest 60 points", () => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      label: `d${i}`,
      value: i,
    }));
    const shown = sparklineData(many);
    expect(shown).toHaveLength(60);
    expect(shown[0].label).toBe("d20");
  });

  it("needs two points and some width", () => {
    expect(sparklineGeometry([{ label: "a", value: 1 }], 100, 60)).toBeNull();
    expect(sparklineGeometry(data, 0, 60)).toBeNull();
  });

  it("speaks the start, the end and the change", () => {
    expect(sparklineSpoken("Weight", data, undefined)).toBe(
      "Weight. From 84 on Nov 1 to 82 on Nov 15, down 2. Goal 80",
    );
    expect(
      sparklineSpoken(
        "Steps",
        [
          { label: "Mon", value: 4000 },
          { label: "Tue", value: 4000 },
        ],
        "Steady",
      ),
    ).toBe("Steps. From 4,000 on Mon to 4,000 on Tue, no change. Steady");
  });
});

describe("heatmapCells", () => {
  it("keeps the last 35 days, oldest first", () => {
    const data = Array.from({ length: 40 }, (_, i) => ({
      label: `d${i}`,
      value: i,
    }));
    const cells = heatmapCells(data);
    expect(cells).toHaveLength(35);
    expect(cells[0].label).toBe("d5");
    expect(cells[34].label).toBe("d39");
  });

  it("shades a day by its share of the highest value when hit is not given", () => {
    const cells = heatmapCells([
      { label: "a", value: 0 },
      { label: "b", value: 50 },
      { label: "c", value: 100 },
    ]);
    expect(cells.map((c) => c.strength)).toEqual([0, 0.5, 1]);
    expect(cells.every((c) => c.hit === undefined)).toBe(true);
  });

  it("speaks the met days and every day", () => {
    const cells = heatmapCells([
      { label: "Mon", value: 160, hit: true },
      { label: "Tue", value: 90, hit: false },
      { label: "Wed", value: 155, hit: true },
    ]);
    expect(heatmapSpoken("Protein goal", cells, undefined)).toBe(
      "Protein goal. 2 of 3 days met. Mon: 160, met. Tue: 90, missed. Wed: 155, met",
    );
    expect(
      heatmapSpoken("Logged", heatmapCells([{ label: "Mon", value: 3 }]), "x"),
    ).toBe("Logged. Mon: 3. x");
  });
});
