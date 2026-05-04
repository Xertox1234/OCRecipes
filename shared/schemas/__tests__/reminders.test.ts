import { describe, it, expect } from "vitest";
import { coachContextItemSchema } from "../reminders";

describe("coachContextItemSchema", () => {
  describe("meal-log variant", () => {
    it("accepts a valid meal-log item with a date string", () => {
      const input = {
        type: "meal-log",
        lastLoggedAt: "2026-05-02T10:00:00.000Z",
      };
      expect(coachContextItemSchema.parse(input)).toEqual(input);
    });

    it("accepts a valid meal-log item with null lastLoggedAt", () => {
      const input = { type: "meal-log", lastLoggedAt: null };
      expect(coachContextItemSchema.parse(input)).toEqual(input);
    });

    it("rejects meal-log missing lastLoggedAt", () => {
      const result = coachContextItemSchema.safeParse({
        type: "meal-log",
      });
      expect(result.success).toBe(false);
    });

    it("rejects meal-log when lastLoggedAt is a number", () => {
      const result = coachContextItemSchema.safeParse({
        type: "meal-log",
        lastLoggedAt: 1746172800000,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("commitment variant", () => {
    it("accepts a valid commitment item", () => {
      const input = {
        type: "commitment",
        notebookEntryId: 42,
        content: "Meal prep on Sunday",
      };
      expect(coachContextItemSchema.parse(input)).toEqual(input);
    });

    it("rejects commitment missing notebookEntryId", () => {
      const result = coachContextItemSchema.safeParse({
        type: "commitment",
        content: "Meal prep on Sunday",
      });
      expect(result.success).toBe(false);
    });

    it("rejects commitment missing content", () => {
      const result = coachContextItemSchema.safeParse({
        type: "commitment",
        notebookEntryId: 42,
      });
      expect(result.success).toBe(false);
    });

    it("rejects commitment when notebookEntryId is a string", () => {
      const result = coachContextItemSchema.safeParse({
        type: "commitment",
        notebookEntryId: "42",
        content: "Meal prep on Sunday",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("daily-checkin variant", () => {
    it("accepts a valid daily-checkin item", () => {
      const input = { type: "daily-checkin", calories: 1850 };
      expect(coachContextItemSchema.parse(input)).toEqual(input);
    });

    it("rejects daily-checkin missing calories", () => {
      const result = coachContextItemSchema.safeParse({
        type: "daily-checkin",
      });
      expect(result.success).toBe(false);
    });

    it("rejects daily-checkin when calories is a string", () => {
      const result = coachContextItemSchema.safeParse({
        type: "daily-checkin",
        calories: "1850",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("user-set variant", () => {
    it("accepts a valid user-set item", () => {
      const input = {
        type: "user-set",
        message: "Remind me to drink water",
      };
      expect(coachContextItemSchema.parse(input)).toEqual(input);
    });

    it("rejects user-set missing message", () => {
      const result = coachContextItemSchema.safeParse({
        type: "user-set",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("rejection cases", () => {
    it("rejects an object with an unknown type value", () => {
      const result = coachContextItemSchema.safeParse({
        type: "unknown_variant",
      });
      expect(result.success).toBe(false);
    });

    it("rejects an empty object", () => {
      const result = coachContextItemSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });
});
