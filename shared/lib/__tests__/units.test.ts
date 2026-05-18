import { describe, it, expect } from "vitest";
import {
  kgToLbs,
  lbsToKg,
  cmToInches,
  inchesToCm,
  weightFromKg,
  weightToKg,
  heightFromCm,
  heightToCm,
  weightUnitLabel,
  heightUnitLabel,
  measurementUnitSchema,
  DEFAULT_MEASUREMENT_UNIT,
} from "../units";

describe("units conversion", () => {
  it("converts kg to lbs and back without drift", () => {
    expect(kgToLbs(80)).toBeCloseTo(176.37, 2);
    expect(lbsToKg(kgToLbs(80))).toBeCloseTo(80, 6);
  });

  it("converts cm to inches and back without drift", () => {
    expect(cmToInches(180)).toBeCloseTo(70.866, 2);
    expect(inchesToCm(cmToInches(180))).toBeCloseTo(180, 6);
  });

  it("weightFromKg returns kg unchanged for metric", () => {
    expect(weightFromKg(75, "metric")).toBe(75);
  });

  it("weightFromKg converts to lbs for imperial", () => {
    expect(weightFromKg(75, "imperial")).toBeCloseTo(165.35, 2);
  });

  it("weightToKg returns the value unchanged for metric", () => {
    expect(weightToKg(75, "metric")).toBe(75);
  });

  it("weightToKg converts lbs back to kg for imperial", () => {
    expect(weightToKg(165, "imperial")).toBeCloseTo(74.84, 2);
  });

  it("round-trips weight through display and storage units", () => {
    const enteredLbs = 154.3;
    const storedKg = weightToKg(enteredLbs, "imperial");
    expect(weightFromKg(storedKg, "imperial")).toBeCloseTo(enteredLbs, 6);
  });

  it("heightFromCm / heightToCm round-trip for imperial", () => {
    const cm = heightToCm(67, "imperial");
    expect(heightFromCm(cm, "imperial")).toBeCloseTo(67, 6);
  });

  it("returns the correct unit labels", () => {
    expect(weightUnitLabel("metric")).toBe("kg");
    expect(weightUnitLabel("imperial")).toBe("lbs");
    expect(heightUnitLabel("metric")).toBe("cm");
    expect(heightUnitLabel("imperial")).toBe("in");
  });

  it("defaults to metric", () => {
    expect(DEFAULT_MEASUREMENT_UNIT).toBe("metric");
  });

  it("measurementUnitSchema accepts valid units and rejects others", () => {
    expect(measurementUnitSchema.parse("metric")).toBe("metric");
    expect(measurementUnitSchema.parse("imperial")).toBe("imperial");
    expect(measurementUnitSchema.safeParse("stones").success).toBe(false);
  });
});
