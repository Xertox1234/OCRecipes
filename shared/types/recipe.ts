/**
 * Recipe types shared between client and server.
 */

export interface RecipeContent {
  title: string;
  description: string;
  difficulty: "Easy" | "Medium" | "Hard";
  timeEstimate: string;
  instructions: string;
  dietTags: string[];
}
