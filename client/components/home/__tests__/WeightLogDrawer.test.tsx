import {
  formatWeightSubtitle,
  formatWeightDelta,
  computeGoalProgress,
  formatGoalLabel,
} from "../weight-log-drawer-utils";
import type { ApiWeightLog } from "@shared/types/weight";

const log = (weight: string): ApiWeightLog => ({
  id: 1,
  userId: "u1",
  weight,
  source: "manual",
  note: null,
  loggedAt: "2024-01-15T10:00:00Z",
});

describe("formatWeightSubtitle", () => {
  it("shows just-logged subtitle transiently", () => {
    const result = formatWeightSubtitle([], null, true, 78.2);
    expect(result).toBe("✓ Logged 78.2 kg");
  });

  it("shows weight + delta when entries and weekly rate exist", () => {
    const logs = [log("78.4")];
    const result = formatWeightSubtitle(
      logs,
      { weeklyRateOfChange: -1.2 },
      false,
      undefined,
    );
    expect(result).toBe("78.4 kg · ▼ 1.2 kg/wk");
  });

  it("shows weight only when no weekly rate", () => {
    const logs = [log("78.4")];
    const result = formatWeightSubtitle(logs, null, false, undefined);
    expect(result).toBe("78.4 kg");
  });

  it("shows first-entry prompt when no logs", () => {
    const result = formatWeightSubtitle([], null, false, undefined);
    expect(result).toBe("Log your first weight");
  });
});

describe("formatWeightDelta", () => {
  it("formats a negative rate as downward arrow (losing weight)", () => {
    expect(formatWeightDelta(-1.2)).toBe("▼ 1.2");
  });

  it("formats a positive rate as upward arrow (gaining weight)", () => {
    expect(formatWeightDelta(0.5)).toBe("▲ 0.5");
  });

  it("returns — for null", () => {
    expect(formatWeightDelta(null)).toBe("—");
  });

  it("returns — for undefined", () => {
    expect(formatWeightDelta(undefined)).toBe("—");
  });

  it("returns — for zero (no meaningful trend)", () => {
    expect(formatWeightDelta(0)).toBe("—");
  });
});

describe("computeGoalProgress", () => {
  it("computes progress made toward goal (weight loss)", () => {
    // startWeight=80, currentWeight=78, goalWeight=75 → (80-78)/(80-75) = 0.4
    expect(computeGoalProgress(78, 75, 80)).toBeCloseTo(0.4);
  });

  it("returns 1 when goal is reached", () => {
    expect(computeGoalProgress(75, 75, 80)).toBeCloseTo(1);
  });

  it("clamps to 1 when past goal", () => {
    expect(computeGoalProgress(74, 75, 80)).toBe(1);
  });

  it("returns 0 when no progress made", () => {
    expect(computeGoalProgress(80, 75, 80)).toBeCloseTo(0);
  });

  it("returns 0 when any required value is null", () => {
    expect(computeGoalProgress(null, 75, 80)).toBe(0);
    expect(computeGoalProgress(78, null, 80)).toBe(0);
    expect(computeGoalProgress(78, 75, null)).toBe(0);
  });

  it("returns 0 when startWeight equals goalWeight", () => {
    expect(computeGoalProgress(75, 75, 75)).toBe(0);
  });
});

describe("formatGoalLabel", () => {
  it("formats remaining kg to goal", () => {
    expect(formatGoalLabel(78.4, 75.0)).toBe("3.4 kg to goal");
  });

  it("returns Goal reached! when at goal", () => {
    expect(formatGoalLabel(75.0, 75.0)).toBe("Goal reached!");
  });

  it("handles weight gain goals", () => {
    expect(formatGoalLabel(68.0, 70.0)).toBe("2.0 kg to goal");
  });
});
