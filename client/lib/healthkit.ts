import { Platform } from "react-native";

// Stub implementation -- actual HealthKit native module (react-native-health or
// expo-health-connect) must be installed separately. This provides the interface.
export const healthKitAvailable = Platform.OS === "ios";

export interface HealthKitPermissions {
  weight: boolean;
  steps: boolean;
  workouts: boolean;
  activeEnergy: boolean;
}

export async function requestPermissions(): Promise<HealthKitPermissions> {
  // In production, this would call the native HealthKit APIs
  // For now, return a stub indicating the feature is available but not connected
  console.warn(
    "HealthKit: native module not yet installed. Install react-native-health for full support.",
  );
  return { weight: false, steps: false, workouts: false, activeEnergy: false };
}

export async function readWeightSamples(
  _startDate: Date,
  _endDate: Date,
): Promise<{ weight: number; date: string }[]> {
  return [];
}

export async function readWorkouts(
  _startDate: Date,
  _endDate: Date,
): Promise<
  {
    name: string;
    type: string;
    durationMinutes: number;
    caloriesBurned: number;
    date: string;
  }[]
> {
  return [];
}

export async function readSteps(
  _startDate: Date,
  _endDate: Date,
): Promise<{ date: string; count: number }[]> {
  return [];
}
