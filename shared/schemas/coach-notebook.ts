import { z } from "zod";

export const notebookEntryTypes = [
  "insight",
  "commitment",
  "preference",
  "goal",
  "motivation",
  "emotional_context",
  "conversation_summary",
  "coaching_strategy",
] as const;

export type NotebookEntryType = (typeof notebookEntryTypes)[number];

export const notebookEntryStatusValues = [
  "active",
  "completed",
  "expired",
  "archived",
] as const;

export type NotebookEntryStatus = (typeof notebookEntryStatusValues)[number];

export const notebookEntrySchema = z.object({
  type: z.enum(notebookEntryTypes),
  content: z.string().min(1).max(500),
  followUpDate: z.string().nullable().optional(),
});

export const extractionResultSchema = z.object({
  entries: z.array(notebookEntrySchema).max(10),
});

export type ExtractionResult = z.infer<typeof extractionResultSchema>;
