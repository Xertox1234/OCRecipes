import type { MealPlanItemWithRelations } from "@shared/types/meal-plan";
// Device-LOCAL basis, like the rest of the Plan tab: `planned_date` is the
// day the user tapped, so every key here comes from local getters.
import { toLocalDateString } from "@shared/lib/date";

import { type MealType, computeItemMacros } from "./meal-plan-utils";

/** Row order of the week grid. The day screen keeps its own order. */
export const GRID_MEAL_TYPES: readonly MealType[] = [
  "breakfast",
  "lunch",
  "snack",
  "dinner",
];

/** Seven days by four meals. */
export const SLOTS_PER_WEEK = 28;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface GridCell {
  /** Sorted by sortOrder, then id. */
  items: MealPlanItemWithRelations[];
  /** The first item's title; null when the slot is empty. */
  title: string | null;
  /** The first item's recipe image; null otherwise. */
  imageUrl: string | null;
  /** How many items sit behind the first one. */
  extraCount: number;
  /** The user's portion; items with no nutrition source count as 0. */
  calories: number;
}

export interface GridDay {
  date: Date;
  dateStr: string;
  isToday: boolean;
  cells: Record<MealType, GridCell>;
  /** Sum of the day's four cells. */
  calories: number;
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/** The seven local midnights of `anchor`'s week, Sunday first. */
export function getWeekDates(anchor: Date): Date[] {
  const weekStart = new Date(anchor);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

const LOCAL_DATE_FORMAT = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Reads a YYYY-MM-DD string as that LOCAL calendar day (`new Date(string)`
 * would read it as UTC). Returns null for anything else, including a
 * well-formed string that is not a real day (2026-02-30).
 */
export function parseLocalDateString(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const match = LOCAL_DATE_FORMAT.exec(value);
  if (!match) return null;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  return toLocalDateString(date) === value ? date : null;
}

function emptyCell(): GridCell {
  return { items: [], title: null, imageUrl: null, extraCount: 0, calories: 0 };
}

function isGridMealType(value: string): value is MealType {
  return (GRID_MEAL_TYPES as readonly string[]).includes(value);
}

/** Same rule as the day screen's rows (MealSlotSection). */
function itemTitle(item: MealPlanItemWithRelations): string {
  return item.recipe?.title || item.scannedItem?.productName || "Unknown item";
}

function buildCell(items: MealPlanItemWithRelations[]): GridCell {
  if (items.length === 0) return emptyCell();
  const sorted = [...items].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id,
  );
  const first = sorted[0];
  return {
    items: sorted,
    title: itemTitle(first),
    imageUrl: first.recipe?.imageUrl ?? null,
    extraCount: sorted.length - 1,
    calories: sorted.reduce(
      (sum, item) => sum + (computeItemMacros(item)?.calories ?? 0),
      0,
    ),
  };
}

/**
 * Lays the week's items out as seven days of four slots. Items dated outside
 * `weekDates`, or with a meal type the grid has no row for, are left out.
 */
export function buildWeekGrid(
  items: MealPlanItemWithRelations[] | undefined,
  weekDates: Date[],
  today: Date,
): GridDay[] {
  const todayStr = toLocalDateString(today);
  const bySlot = new Map<string, MealPlanItemWithRelations[]>();
  for (const item of items ?? []) {
    if (!isGridMealType(item.mealType)) continue;
    const key = `${item.plannedDate}|${item.mealType}`;
    const slot = bySlot.get(key);
    if (slot) slot.push(item);
    else bySlot.set(key, [item]);
  }

  return weekDates.map((date) => {
    const dateStr = toLocalDateString(date);
    const cells = {} as Record<MealType, GridCell>;
    let calories = 0;
    for (const mealType of GRID_MEAL_TYPES) {
      const cell = buildCell(bySlot.get(`${dateStr}|${mealType}`) ?? []);
      cells[mealType] = cell;
      calories += cell.calories;
    }
    return { date, dateStr, isToday: dateStr === todayStr, cells, calories };
  });
}

/** Slots with at least one item, 0 to 28. */
export function countPlannedSlots(days: GridDay[]): number {
  let count = 0;
  for (const day of days) {
    for (const mealType of GRID_MEAL_TYPES) {
      if (day.cells[mealType].items.length > 0) count += 1;
    }
  }
  return count;
}

/**
 * Whether moving the week to `nextAnchor` goes past the plan's forward limit.
 * Same rounding as the limit the Plan tab has always used.
 */
export function isBeyondForwardLimit(
  nextAnchor: Date,
  today: Date,
  maxDaysForward: number,
): boolean {
  const daysForward = Math.round(
    (nextAnchor.getTime() - today.getTime()) / DAY_MS,
  );
  return daysForward > maxDaysForward;
}

/** The column the grid opens on: today's when it is in the week, else the first. */
export function getInitialColumnIndex(days: GridDay[]): number {
  const index = days.findIndex((day) => day.isToday);
  return index === -1 ? 0 : index;
}

function weekdayName(date: Date): string {
  return date.toLocaleDateString("en-US", { weekday: "long" });
}

function formatCalories(calories: number): string {
  return calories.toLocaleString("en-US");
}

export function getCellAccessibilityLabel(
  day: GridDay,
  mealType: MealType,
): string {
  const cell = day.cells[mealType];
  const slot = `${weekdayName(day.date)} ${mealType}`;
  if (cell.title === null) return `${slot}, empty, add a meal`;
  const what =
    cell.extraCount > 0
      ? `${cell.title} and ${cell.extraCount} more`
      : cell.title;
  return `${slot}, ${what}, ${formatCalories(cell.calories)} calories`;
}

export function getDayHeaderAccessibilityLabel(day: GridDay): string {
  const monthDay = day.date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });
  const name = `${weekdayName(day.date)} ${monthDay}`;
  return `${day.isToday ? "Today, " : ""}${name}, ${formatCalories(day.calories)} calories planned`;
}

/**
 * Start date to hand the pantry plan screen: a future week starts on its
 * first day; the current week and past weeks leave the screen's own default
 * (tomorrow) in place.
 */
export function getPantryPlanStartDate(
  weekDates: Date[],
  today: Date,
): string | undefined {
  const first = weekDates[0];
  if (!first) return undefined;
  const firstStr = toLocalDateString(first);
  return firstStr > toLocalDateString(today) ? firstStr : undefined;
}

/** Width of the fixed meal-label column, including the screen's left gutter. */
export const GRID_LABEL_COLUMN_WIDTH = 76;
/** Space between day columns. */
export const GRID_COLUMN_GAP = 6;
/** How much of the fourth column shows, so the grid reads as scrollable. */
export const GRID_COLUMN_PEEK = 20;
/** Day columns visible at once. */
export const GRID_VISIBLE_COLUMNS = 3;

/** Width of one day column: three fit beside the labels, plus a peek of the next. */
export function getGridColumnWidth(windowWidth: number): number {
  const available =
    windowWidth -
    GRID_LABEL_COLUMN_WIDTH -
    GRID_COLUMN_PEEK -
    GRID_COLUMN_GAP * GRID_VISIBLE_COLUMNS;
  return Math.floor(available / GRID_VISIBLE_COLUMNS);
}
