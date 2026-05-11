import { z } from "zod";
import type {
  RecipeCandidate,
  TastePickEntry,
  TastePickCandidatesResponse,
  TastePicksResponse,
} from "../types/taste-picks";

/**
 * Runtime validators for taste-picks API responses. Client screens use these
 * to `safeParse` server replies before treating them as typed payloads.
 *
 * `z.infer<>` shapes are pinned to the `shared/types/taste-picks.ts`
 * interfaces via the `Equals<>` compile-time assertions at the bottom of
 * this file — any drift between the schemas and the types causes a build
 * failure.
 */

export const recipeCandidateSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  imageUrl: z.string(),
  cuisineOrigin: z.string().nullable(),
});

export const tastePickEntrySchema = z.object({
  recipeId: z.number().int().positive(),
  title: z.string(),
  imageUrl: z.string(),
  cuisineOrigin: z.string().nullable(),
});

export const tastePickCandidatesResponseSchema = z.object({
  candidates: z.array(recipeCandidateSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
});

export const tastePicksResponseSchema = z.object({
  picks: z.array(tastePickEntrySchema),
});

// Compile-time guard: each Equals<A, B> reduces to a type that only the
// literal `true` can satisfy when A and B are mutually assignable. If the
// schemas drift from the hand-written interfaces, tsc fails on these lines.
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

const _recipeCandidateAligned: Equals<
  RecipeCandidate,
  z.infer<typeof recipeCandidateSchema>
> = true;
const _tastePickEntryAligned: Equals<
  TastePickEntry,
  z.infer<typeof tastePickEntrySchema>
> = true;
const _candidatesResponseAligned: Equals<
  TastePickCandidatesResponse,
  z.infer<typeof tastePickCandidatesResponseSchema>
> = true;
const _picksResponseAligned: Equals<
  TastePicksResponse,
  z.infer<typeof tastePicksResponseSchema>
> = true;

// Silence unused-variable warnings — assertions exist only for tsc.
void _recipeCandidateAligned;
void _tastePickEntryAligned;
void _candidatesResponseAligned;
void _picksResponseAligned;
