import type {
  WeightLog,
  HealthKitSyncEntry,
  FastingSchedule,
  FastingLog,
  MedicationLog,
  GoalAdjustmentLog,
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

const medicationLogDefaults: MedicationLog = {
  id: 1,
  userId: "1",
  medicationName: "semaglutide",
  brandName: null,
  dosage: "0.25mg",
  takenAt: new Date("2024-01-01"),
  sideEffects: [],
  appetiteLevel: null,
  notes: null,
};

export function createMockMedicationLog(
  overrides: Partial<MedicationLog> = {},
): MedicationLog {
  return { ...medicationLogDefaults, ...overrides };
}

const goalAdjustmentLogDefaults: GoalAdjustmentLog = {
  id: 1,
  userId: "1",
  previousCalories: 2000,
  newCalories: 1800,
  previousProtein: 150,
  newProtein: 140,
  previousCarbs: 200,
  newCarbs: 180,
  previousFat: 65,
  newFat: 60,
  reason: "weight_trend",
  weightTrendRate: null,
  appliedAt: new Date("2024-01-01"),
  acceptedByUser: false,
};

export function createMockGoalAdjustmentLog(
  overrides: Partial<GoalAdjustmentLog> = {},
): GoalAdjustmentLog {
  return { ...goalAdjustmentLogDefaults, ...overrides };
}
