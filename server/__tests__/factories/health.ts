import type {
  WeightLog,
  HealthKitSyncEntry,
  FastingSchedule,
  FastingLog,
} from "@shared/schema";

const weightLogDefaults: WeightLog = {
  id: 1,
  userId: "1",
  weight: "75.00",
  unit: "kg",
  source: "manual",
  note: null,
  loggedAt: new Date("2024-01-01"),
};

export function createMockWeightLog(
  overrides: Partial<WeightLog> = {},
): WeightLog {
  return { ...weightLogDefaults, ...overrides };
}

const healthKitSyncDefaults: HealthKitSyncEntry = {
  id: 1,
  userId: "1",
  dataType: "weight",
  enabled: false,
  lastSyncAt: null,
  syncDirection: "read",
};

export function createMockHealthKitSync(
  overrides: Partial<HealthKitSyncEntry> = {},
): HealthKitSyncEntry {
  return { ...healthKitSyncDefaults, ...overrides };
}

const fastingScheduleDefaults: FastingSchedule = {
  id: 1,
  userId: "1",
  protocol: "16:8",
  fastingHours: 16,
  eatingHours: 8,
  eatingWindowStart: "12:00",
  eatingWindowEnd: "20:00",
  isActive: true,
  notifyEatingWindow: true,
  notifyMilestones: true,
  notifyCheckIns: true,
};

export function createMockFastingSchedule(
  overrides: Partial<FastingSchedule> = {},
): FastingSchedule {
  return { ...fastingScheduleDefaults, ...overrides };
}

const fastingLogDefaults: FastingLog = {
  id: 1,
  userId: "1",
  startedAt: new Date("2024-01-01T00:00:00Z"),
  endedAt: null,
  targetDurationHours: 16,
  actualDurationMinutes: null,
  completed: null,
  note: null,
};

export function createMockFastingLog(
  overrides: Partial<FastingLog> = {},
): FastingLog {
  return { ...fastingLogDefaults, ...overrides };
}
