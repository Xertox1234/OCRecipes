/**
 * Shared types for the coach tool registry.
 *
 * A tool is ONE entry: its model-facing definition, its args schema, whether
 * it is offered for this turn, and its handler. `getToolDefinitions` and
 * `executeToolCall` (../coach-tools.ts) both read `available`, so "offered"
 * and "executable" are the same rule and cannot drift apart.
 */

import { MEAL_TYPES } from "@shared/constants/meal-types";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { z } from "zod";
import { isValidCalendarDate } from "../../utils/date-validation";
import type {
  WriteCardOutcome,
  WriteCardProposal,
} from "../write-cards/tool-args";

// ---------------------------------------------------------------------------
// Structured error type returned by all tool call paths.
// The `code` field lets the model distinguish arg errors from service failures.
// ---------------------------------------------------------------------------

export type ToolErrorResult = {
  error: true;
  code: "INVALID_ARGS" | "NOT_FOUND" | "SERVICE_UNAVAILABLE";
  message: string;
};

export function invalidArgs(
  toolName: string,
  message: string,
): ToolErrorResult {
  return {
    error: true,
    code: "INVALID_ARGS",
    message: `${toolName}: ${message}`,
  };
}

export function notFound(message: string): ToolErrorResult {
  return { error: true, code: "NOT_FOUND", message };
}

export function serviceUnavailable(toolName: string): ToolErrorResult {
  return {
    error: true,
    code: "SERVICE_UNAVAILABLE",
    message: `${toolName} is temporarily unavailable`,
  };
}

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
  .refine(isValidCalendarDate, "Must be a real calendar date");

export interface ExecuteToolOptions {
  /** The app can show write cards (it sent `writeCards: true`). */
  writeCards?: boolean;
  /**
   * The pantry card is on for this turn: the app listed the kind and the
   * user's plan includes the pantry. update_pantry is refused without it,
   * because a model can call a tool name it was never offered.
   */
  pantryCard?: boolean;
  /**
   * The goals card is on for this turn: the app listed the kind.
   * set_nutrition_goals is refused without it.
   */
  goalsCard?: boolean;
  /**
   * The reminders card is on for this turn (Coach roadmap A3): the app listed
   * the kind. set_reminders is refused without it.
   */
  remindersCard?: boolean;
  /** Receives each validated write-tool call in write-card mode. */
  onWriteCardProposal?: (
    p: WriteCardProposal,
  ) => void | WriteCardOutcome | Promise<void | WriteCardOutcome>;
  /**
   * One array per turn: find_plan_recipes adds the ids it returns, and the
   * plan card offers them as Swap choices when the model gives too few.
   */
  planRecipePool?: number[];
}

/** What a handler needs besides its validated args. */
export interface ToolContext {
  userId: string;
  /** IANA timezone of the requesting user — day-buckets "today" tool data. */
  tz: string;
  opts: ExecuteToolOptions;
}

export interface CoachToolEntry {
  name: string;
  /** Whether this tool is offered AND executable for this turn. */
  available: (opts: ExecuteToolOptions) => boolean;
  /** The model-facing definition; write-card mode swaps some of them. */
  definition: (opts: ExecuteToolOptions) => ChatCompletionTool;
  /** Validates the raw args; may differ per mode (write-card variants). */
  argsSchema: (opts: ExecuteToolOptions) => z.ZodType;
  run: (args: unknown, ctx: ToolContext) => Promise<ToolErrorResult | object>;
}

interface ToolSpec<S extends z.ZodType> {
  name: string;
  available?: (opts: ExecuteToolOptions) => boolean;
  definition: (opts: ExecuteToolOptions) => ChatCompletionTool;
  argsSchema: S | ((opts: ExecuteToolOptions) => S);
  run: (
    args: z.infer<S>,
    ctx: ToolContext,
  ) => Promise<ToolErrorResult | object>;
}

/** Builds an entry; `run` is typed against the schema it is paired with. */
export function defineTool<S extends z.ZodType>(
  spec: ToolSpec<S>,
): CoachToolEntry {
  const schemaFor = (opts: ExecuteToolOptions): S =>
    typeof spec.argsSchema === "function"
      ? (spec.argsSchema as (opts: ExecuteToolOptions) => S)(opts)
      : spec.argsSchema;
  return {
    name: spec.name,
    available: spec.available ?? (() => true),
    definition: spec.definition,
    argsSchema: schemaFor,
    run: spec.run as CoachToolEntry["run"],
  };
}

// One source for the meal types (shared/constants/meal-types.ts). The plan
// tool's Zod schema and its JSON tool definitions (legacy and write-card) all
// read it, as do the coach and finder schemas. (Further copies live in the
// meal-plan and recipe schemas, server/routes/meal-plan.ts and
// client/components/meal-plan/meal-plan-utils.ts.)
export { MEAL_TYPES };

export const MEAL_TYPE_PARAM = {
  type: "string",
  enum: [...MEAL_TYPES],
} as const;
