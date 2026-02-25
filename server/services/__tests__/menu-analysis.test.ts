import { analyzeMenuPhoto, MenuAnalysisResult } from "../menu-analysis";

vi.mock("../../lib/openai", () => ({
  openai: {
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  },
}));

vi.mock("../../storage", () => ({
  storage: {
    getUser: vi.fn(),
    getUserProfile: vi.fn(),
  },
}));

import { openai } from "../../lib/openai";
import { storage } from "../../storage";

const mockCreate = vi.mocked(openai.chat.completions.create);
const mockGetUser = vi.mocked(storage.getUser);
const mockGetUserProfile = vi.mocked(storage.getUserProfile);

function makeMenuResponse(
  items: Partial<MenuAnalysisResult> = {},
): MenuAnalysisResult {
  return {
    restaurantName: "Test Restaurant",
    cuisine: "American",
    menuItems: [
      {
        name: "Grilled Chicken Salad",
        description: "Fresh greens with grilled chicken",
        price: "$14.99",
        estimatedCalories: 450,
        estimatedProtein: 38,
        estimatedCarbs: 20,
        estimatedFat: 22,
        tags: ["high-protein", "gluten-free"],
        recommendation: "great",
        recommendationReason: "High protein, low carb",
      },
      {
        name: "Double Bacon Cheeseburger",
        description: "Two patties with bacon and cheddar",
        price: "$18.99",
        estimatedCalories: 1100,
        estimatedProtein: 55,
        estimatedCarbs: 50,
        estimatedFat: 70,
        tags: ["fried"],
        recommendation: "avoid",
        recommendationReason: "Very high calorie",
      },
    ],
    ...items,
  };
}

function mockOpenAIResponse(data: MenuAnalysisResult) {
  mockCreate.mockResolvedValue({
    choices: [{ message: { content: JSON.stringify(data) } }],
  } as any);
}

describe("Menu Analysis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue(null);
    mockGetUserProfile.mockResolvedValue(null);
  });

  describe("analyzeMenuPhoto", () => {
    it("returns parsed menu items from OpenAI", async () => {
      const menuData = makeMenuResponse();
      mockOpenAIResponse(menuData);

      const result = await analyzeMenuPhoto("base64image", "user-1");

      expect(result.restaurantName).toBe("Test Restaurant");
      expect(result.menuItems).toHaveLength(2);
      expect(result.menuItems[0]!.name).toBe("Grilled Chicken Salad");
    });

    it("sends image as base64 data URL to OpenAI", async () => {
      mockOpenAIResponse(makeMenuResponse());

      await analyzeMenuPhoto("abc123data", "user-1");

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "gpt-4o",
          response_format: { type: "json_object" },
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: "user",
              content: expect.arrayContaining([
                expect.objectContaining({
                  type: "image_url",
                  image_url: expect.objectContaining({
                    url: "data:image/jpeg;base64,abc123data",
                  }),
                }),
              ]),
            }),
          ]),
        }),
      );
    });

    it("sorts items by recommendation: great > good > okay > avoid", async () => {
      const menuData = makeMenuResponse({
        menuItems: [
          {
            name: "Fried Chicken",
            estimatedCalories: 800,
            estimatedProtein: 40,
            estimatedCarbs: 40,
            estimatedFat: 45,
            tags: ["fried"],
            recommendation: "avoid",
            recommendationReason: "Very high fat",
          },
          {
            name: "Mixed Salad",
            estimatedCalories: 200,
            estimatedProtein: 5,
            estimatedCarbs: 20,
            estimatedFat: 10,
            tags: ["vegetarian"],
            recommendation: "good",
            recommendationReason: "Low calorie",
          },
          {
            name: "Grilled Fish",
            estimatedCalories: 350,
            estimatedProtein: 35,
            estimatedCarbs: 15,
            estimatedFat: 15,
            tags: ["high-protein", "gluten-free"],
            recommendation: "great",
            recommendationReason: "Perfect for goals",
          },
        ],
      });
      mockOpenAIResponse(menuData);

      const result = await analyzeMenuPhoto("img", "user-1");

      expect(result.menuItems[0]!.name).toBe("Grilled Fish");
      expect(result.menuItems[1]!.name).toBe("Mixed Salad");
      expect(result.menuItems[2]!.name).toBe("Fried Chicken");
    });

    it("includes user context in system prompt when user exists", async () => {
      mockGetUser.mockResolvedValue({
        id: "user-1",
        dailyCalorieGoal: 2000,
        dailyProteinGoal: 150,
      } as any);
      mockGetUserProfile.mockResolvedValue({
        dietType: "keto",
        primaryGoal: "weight_loss",
        allergies: [{ name: "shellfish" }],
        foodDislikes: ["olives"],
      } as any);

      mockOpenAIResponse(makeMenuResponse());

      await analyzeMenuPhoto("img", "user-1");

      const callArgs = mockCreate.mock.calls[0]![0] as any;
      const systemMsg = callArgs.messages[0].content;
      expect(systemMsg).toContain("2000");
      expect(systemMsg).toContain("150g");
      expect(systemMsg).toContain("keto");
      expect(systemMsg).toContain("weight_loss");
      expect(systemMsg).toContain("shellfish");
      expect(systemMsg).toContain("olives");
    });

    it("works without user context (no user found)", async () => {
      mockGetUser.mockResolvedValue(null);
      mockGetUserProfile.mockResolvedValue(null);

      mockOpenAIResponse(makeMenuResponse());

      const result = await analyzeMenuPhoto("img", "unknown-user");

      expect(result.menuItems).toHaveLength(2);
      // System message should not contain personalization
      const callArgs = mockCreate.mock.calls[0]![0] as any;
      const systemMsg = callArgs.messages[0].content;
      expect(systemMsg).not.toContain("Daily calorie goal");
    });

    it("gracefully handles storage errors for user context", async () => {
      mockGetUser.mockRejectedValue(new Error("DB connection failed"));

      mockOpenAIResponse(makeMenuResponse());

      // Should not throw — proceeds without personalization
      const result = await analyzeMenuPhoto("img", "user-1");
      expect(result.menuItems).toHaveLength(2);
    });

    it("throws on empty OpenAI response", async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: null } }],
      } as any);

      await expect(
        analyzeMenuPhoto("img", "user-1"),
      ).rejects.toThrow("No response from menu analysis");
    });

    it("throws on invalid JSON from OpenAI", async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: "not json at all" } }],
      } as any);

      await expect(
        analyzeMenuPhoto("img", "user-1"),
      ).rejects.toThrow();
    });

    it("throws on schema validation failure", async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                menuItems: [{ name: "Test" }], // missing required fields
              }),
            },
          },
        ],
      } as any);

      await expect(
        analyzeMenuPhoto("img", "user-1"),
      ).rejects.toThrow();
    });

    it("handles items without recommendation (defaults to 'okay' sorting)", async () => {
      const menuData = makeMenuResponse({
        menuItems: [
          {
            name: "Plain Rice",
            estimatedCalories: 200,
            estimatedProtein: 4,
            estimatedCarbs: 45,
            estimatedFat: 1,
            tags: ["vegetarian"],
            // no recommendation field
          },
          {
            name: "Steak",
            estimatedCalories: 500,
            estimatedProtein: 50,
            estimatedCarbs: 0,
            estimatedFat: 30,
            tags: ["high-protein"],
            recommendation: "great",
            recommendationReason: "High protein",
          },
        ],
      });
      mockOpenAIResponse(menuData);

      const result = await analyzeMenuPhoto("img", "user-1");

      // "great" should come before items without recommendation
      expect(result.menuItems[0]!.name).toBe("Steak");
      expect(result.menuItems[1]!.name).toBe("Plain Rice");
    });

    it("fetches both user and profile in parallel", async () => {
      mockGetUser.mockResolvedValue({ id: "user-1" } as any);
      mockGetUserProfile.mockResolvedValue(null);
      mockOpenAIResponse(makeMenuResponse());

      await analyzeMenuPhoto("img", "user-1");

      expect(mockGetUser).toHaveBeenCalledWith("user-1");
      expect(mockGetUserProfile).toHaveBeenCalledWith("user-1");
    });
  });
});
