/**
 * Static notification category registry. Declares, per category, its lane,
 * default channel(s), and whether it counts against the (Phase 1) discretionary
 * daily cap. Phase 0 registers only the categories today's producers emit; later
 * phases add value-delivery + reframed categories.
 */
export type NotificationLane = "transactional" | "governed";
export type NotificationChannel = "push" | "in-app" | "local";

export interface NotificationCategoryDef {
  lane: NotificationLane;
  channels: NotificationChannel[];
  /** Discretionary nudges count against the Phase 1 daily cap; dated/explicit ones don't. */
  countsAgainstCap: boolean;
}

export const NOTIFICATION_REGISTRY = {
  commitment: {
    lane: "governed",
    channels: ["in-app", "push"],
    countsAgainstCap: false, // dated coach follow-up, not discretionary
  },
  "daily-checkin": {
    lane: "governed",
    channels: ["in-app"],
    countsAgainstCap: true,
  },
  "meal-log": {
    lane: "governed",
    channels: ["in-app"],
    countsAgainstCap: true,
  },
} satisfies Record<string, NotificationCategoryDef>;

export type NotificationCategoryKey = keyof typeof NOTIFICATION_REGISTRY;

export function getCategoryDef(
  category: NotificationCategoryKey,
): NotificationCategoryDef {
  return NOTIFICATION_REGISTRY[category];
}
