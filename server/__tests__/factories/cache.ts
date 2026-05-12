import type {
  SuggestionCache,
  InstructionCache,
  MealSuggestionCacheEntry,
  CoachResponseCacheEntry,
  CarouselSuggestionCacheEntry,
} from "@shared/schema";

const suggestionCacheDefaults: SuggestionCache = {
  id: 1,
  scannedItemId: 1,
  userId: "1",
  profileHash: "abc123",
  suggestions: [],
  hitCount: 0,
  createdAt: new Date("2024-01-01"),
  expiresAt: new Date("2025-01-01"),
};

export function createMockSuggestionCache(
  overrides: Partial<SuggestionCache> = {},
): SuggestionCache {
  return { ...suggestionCacheDefaults, ...overrides };
}

const instructionCacheDefaults: InstructionCache = {
  id: 1,
  suggestionCacheId: 1,
  suggestionIndex: 0,
  suggestionTitle: "Test Suggestion",
  suggestionType: "recipe",
  instructions: "Test instructions",
  hitCount: 0,
  createdAt: new Date("2024-01-01"),
};

export function createMockInstructionCache(
  overrides: Partial<InstructionCache> = {},
): InstructionCache {
  return { ...instructionCacheDefaults, ...overrides };
}

const mealSuggestionCacheDefaults: MealSuggestionCacheEntry = {
  id: 1,
  userId: "1",
  cacheKey: "test-cache-key",
  suggestions: [],
  hitCount: 0,
  createdAt: new Date("2024-01-01"),
  expiresAt: new Date("2025-01-01"),
};

export function createMockMealSuggestionCache(
  overrides: Partial<MealSuggestionCacheEntry> = {},
): MealSuggestionCacheEntry {
  return { ...mealSuggestionCacheDefaults, ...overrides };
}

const coachResponseCacheDefaults: CoachResponseCacheEntry = {
  id: 1,
  userId: "1",
  questionHash: "a".repeat(64),
  question: "Test question",
  response: "Test response",
  hitCount: 0,
  createdAt: new Date("2024-01-01"),
  expiresAt: new Date("2025-01-01"),
};

export function createMockCoachResponseCache(
  overrides: Partial<CoachResponseCacheEntry> = {},
): CoachResponseCacheEntry {
  return { ...coachResponseCacheDefaults, ...overrides };
}

const carouselSuggestionCacheDefaults: CarouselSuggestionCacheEntry = {
  id: 1,
  userId: "1",
  profileHash: "test-profile-hash",
  mealType: "breakfast",
  suggestions: [],
  expiresAt: new Date("2025-01-01"),
  createdAt: new Date("2024-01-01"),
};

export function createMockCarouselSuggestionCache(
  overrides: Partial<CarouselSuggestionCacheEntry> = {},
): CarouselSuggestionCacheEntry {
  return { ...carouselSuggestionCacheDefaults, ...overrides };
}
