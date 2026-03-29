import type { User, UserProfile } from "@shared/schema";

const userDefaults: User = {
  id: "1",
  username: "testuser",
  password: "$2b$10$hashedpassword",
  displayName: null,
  avatarUrl: null,
  dailyCalorieGoal: 2000,
  dailyProteinGoal: null,
  dailyCarbsGoal: null,
  dailyFatGoal: null,
  weight: null,
  height: null,
  age: null,
  gender: null,
  goalWeight: null,
  goalsCalculatedAt: null,
  adaptiveGoalsEnabled: false,
  lastGoalAdjustmentAt: null,
  onboardingCompleted: false,
  tokenVersion: 0,
  subscriptionTier: "free",
  subscriptionExpiresAt: null,
  createdAt: new Date("2024-01-01"),
};

export function createMockUser(overrides: Partial<User> = {}): User {
  return { ...userDefaults, ...overrides };
}

const userProfileDefaults: UserProfile = {
  id: 1,
  userId: "1",
  allergies: [],
  healthConditions: [],
  dietType: null,
  foodDislikes: [],
  primaryGoal: null,
  activityLevel: null,
  householdSize: 1,
  cuisinePreferences: [],
  cookingSkillLevel: null,
  cookingTimeAvailable: null,
  glp1Mode: false,
  glp1Medication: null,
  glp1StartDate: null,
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

export function createMockUserProfile(
  overrides: Partial<UserProfile> = {},
): UserProfile {
  return { ...userProfileDefaults, ...overrides };
}
