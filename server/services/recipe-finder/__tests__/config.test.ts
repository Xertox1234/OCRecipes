import { describe, it, expect, afterEach, vi } from "vitest";
import {
  isRecipeFinderEnabled,
  getSpoonacularDailyCap,
  isOnlineCatalogConfigured,
  DEFAULT_SPOONACULAR_DAILY_CAP,
} from "../config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("recipe finder config", () => {
  it("is off unless RECIPE_FINDER_ENABLED is exactly 'true'", () => {
    vi.stubEnv("RECIPE_FINDER_ENABLED", "");
    expect(isRecipeFinderEnabled()).toBe(false);
    vi.stubEnv("RECIPE_FINDER_ENABLED", "1");
    expect(isRecipeFinderEnabled()).toBe(false);
    vi.stubEnv("RECIPE_FINDER_ENABLED", "true");
    expect(isRecipeFinderEnabled()).toBe(true);
  });

  it("defaults the Spoonacular cap to 10 and honours a valid override", () => {
    vi.stubEnv("RECIPE_FINDER_SPOONACULAR_DAILY_CAP", "");
    expect(getSpoonacularDailyCap()).toBe(DEFAULT_SPOONACULAR_DAILY_CAP);
    expect(DEFAULT_SPOONACULAR_DAILY_CAP).toBe(10);
    vi.stubEnv("RECIPE_FINDER_SPOONACULAR_DAILY_CAP", "25");
    expect(getSpoonacularDailyCap()).toBe(25);
    vi.stubEnv("RECIPE_FINDER_SPOONACULAR_DAILY_CAP", "0");
    expect(getSpoonacularDailyCap()).toBe(0);
  });

  it("ignores a garbage cap value", () => {
    vi.stubEnv("RECIPE_FINDER_SPOONACULAR_DAILY_CAP", "lots");
    expect(getSpoonacularDailyCap()).toBe(10);
    vi.stubEnv("RECIPE_FINDER_SPOONACULAR_DAILY_CAP", "-3");
    expect(getSpoonacularDailyCap()).toBe(10);
  });

  it("reports the online catalog configured only with a key (same check as /catalog/config)", () => {
    vi.stubEnv("SPOONACULAR_API_KEY", "");
    expect(isOnlineCatalogConfigured()).toBe(false);
    vi.stubEnv("SPOONACULAR_API_KEY", "k");
    expect(isOnlineCatalogConfigured()).toBe(true);
  });
});
