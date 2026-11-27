import type { MealAudience } from "@shared/types/family";

export interface PlanSlot {
  plannedDate: string;
  mealType: string;
}

export interface PlanAudienceChoice {
  audience: MealAudience;
  familyProfileId: number | null;
}

/**
 * Who the next meal added to a slot is for, chosen in the add menu. In memory
 * only, never persisted: a stale choice must not survive an app restart, and
 * it holds a family member's id.
 */
let pending: {
  slot: PlanSlot;
  choice: PlanAudienceChoice;
  setAt: number;
} | null = null;

/**
 * How long an unused choice lasts. The menu closes when it hands off to Quick
 * Add or Import, so the choice cannot be cleared on dismiss; without a limit,
 * an abandoned "for Ivy" would be applied to a meal added to that slot much
 * later by a route that never shows the menu.
 */
export const PENDING_AUDIENCE_TTL_MS = 10 * 60 * 1000;

function sameSlot(a: PlanSlot, b: PlanSlot): boolean {
  return a.plannedDate === b.plannedDate && a.mealType === b.mealType;
}

export function setPendingAudience(
  slot: PlanSlot,
  choice: PlanAudienceChoice,
): void {
  pending = { slot: { ...slot }, choice: { ...choice }, setAt: Date.now() };
}

/**
 * The choice for this slot, once, if it is recent enough. Another slot's call
 * leaves it in place.
 */
export function takePendingAudience(slot: PlanSlot): PlanAudienceChoice | null {
  if (!pending || !sameSlot(pending.slot, slot)) return null;
  const { choice, setAt } = pending;
  pending = null;
  return Date.now() - setAt > PENDING_AUDIENCE_TTL_MS ? null : choice;
}

/**
 * The choice the next add to this slot will use, without taking it: the
 * allergen check reads it before the add, which then takes it.
 */
export function peekPendingAudience(slot: PlanSlot): PlanAudienceChoice | null {
  if (!pending || !sameSlot(pending.slot, slot)) return null;
  return Date.now() - pending.setAt > PENDING_AUDIENCE_TTL_MS
    ? null
    : { ...pending.choice };
}

export function clearPendingAudience(): void {
  pending = null;
}
