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
let pending: { slot: PlanSlot; choice: PlanAudienceChoice } | null = null;

function sameSlot(a: PlanSlot, b: PlanSlot): boolean {
  return a.plannedDate === b.plannedDate && a.mealType === b.mealType;
}

export function setPendingAudience(
  slot: PlanSlot,
  choice: PlanAudienceChoice,
): void {
  pending = { slot: { ...slot }, choice: { ...choice } };
}

/** The choice for this slot, once. Another slot's call leaves it in place. */
export function takePendingAudience(slot: PlanSlot): PlanAudienceChoice | null {
  if (!pending || !sameSlot(pending.slot, slot)) return null;
  const { choice } = pending;
  pending = null;
  return choice;
}

export function clearPendingAudience(): void {
  pending = null;
}
