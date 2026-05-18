/**
 * Measurement-unit conversion helpers.
 *
 * Body weight and height are ALWAYS stored in metric (kg / cm). Conversion to
 * imperial happens only at the display/input boundary based on the user's
 * `measurementUnit` preference — never in storage. Keep all conversion factors
 * here so there is a single source of truth (no scattered magic numbers).
 */

import { z } from "zod";

/** Zod enum for validating a measurement-unit value at API boundaries. */
export const measurementUnitSchema = z.enum(["metric", "imperial"]);

/** A user's preferred measurement system for body weight/height display. */
export type MeasurementUnit = z.infer<typeof measurementUnitSchema>;

/** Default unit for all users (existing rows are already stored/displayed in kg). */
export const DEFAULT_MEASUREMENT_UNIT: MeasurementUnit = "metric";

/** Exact conversion factor: kilograms → pounds. */
export const LBS_PER_KG = 2.2046226218;
/** Exact conversion factor: pounds → kilograms. */
export const KG_PER_LB = 0.45359237;
/** Exact conversion factor: centimetres → inches. */
export const INCHES_PER_CM = 0.3937007874;
/** Exact conversion factor: inches → centimetres. */
export const CM_PER_INCH = 2.54;

/** Convert a weight in kilograms to pounds. */
export function kgToLbs(kg: number): number {
  return kg * LBS_PER_KG;
}

/** Convert a weight in pounds to kilograms. */
export function lbsToKg(lbs: number): number {
  return lbs * KG_PER_LB;
}

/** Convert a height in centimetres to inches. */
export function cmToInches(cm: number): number {
  return cm * INCHES_PER_CM;
}

/** Convert a height in inches to centimetres. */
export function inchesToCm(inches: number): number {
  return inches * CM_PER_INCH;
}

/** Short weight-unit label for the given preference. */
export function weightUnitLabel(unit: MeasurementUnit): "kg" | "lbs" {
  return unit === "imperial" ? "lbs" : "kg";
}

/** Short height-unit label for the given preference. */
export function heightUnitLabel(unit: MeasurementUnit): "cm" | "in" {
  return unit === "imperial" ? "in" : "cm";
}

/**
 * Convert a stored kg weight into the user's preferred display unit.
 * Returns the raw converted number — round only at the leaf render site.
 */
export function weightFromKg(kg: number, unit: MeasurementUnit): number {
  return unit === "imperial" ? kgToLbs(kg) : kg;
}

/**
 * Convert a user-entered weight (in their preferred unit) back to kg for storage.
 * Returns the raw converted number with full precision — never pre-round.
 */
export function weightToKg(value: number, unit: MeasurementUnit): number {
  return unit === "imperial" ? lbsToKg(value) : value;
}

/** Convert a stored cm height into the user's preferred display unit. */
export function heightFromCm(cm: number, unit: MeasurementUnit): number {
  return unit === "imperial" ? cmToInches(cm) : cm;
}

/** Convert a user-entered height (in their preferred unit) back to cm for storage. */
export function heightToCm(value: number, unit: MeasurementUnit): number {
  return unit === "imperial" ? inchesToCm(value) : value;
}
