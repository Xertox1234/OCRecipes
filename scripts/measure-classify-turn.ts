/**
 * Spec §7: measure classifyTurn against the gold set with the REAL model.
 *   set -a; source .env; set +a; NODE_ENV=development npx tsx scripts/measure-classify-turn.ts
 * Needs AI_INTEGRATIONS_OPENAI_API_KEY (and _BASE_URL if used). Prints
 * accuracy and every miss; paste the output into the PR body.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  classifyTurn,
  type TurnClass,
} from "../server/services/recipe-finder/classify-turn";

interface Case {
  message: string;
  recipeTitle: string;
  expected: TurnClass;
}

async function main(): Promise<void> {
  const cases: Case[] = JSON.parse(
    readFileSync(
      path.resolve(
        process.cwd(),
        "server/services/recipe-finder/__tests__/fixtures/classify-turn-gold-set.json",
      ),
      "utf8",
    ),
  );
  let correct = 0;
  const misses: string[] = [];
  for (const c of cases) {
    const got = await classifyTurn(c.message, c.recipeTitle);
    if (got === c.expected) correct++;
    else
      misses.push(
        `  "${c.message}" (${c.recipeTitle}): expected ${c.expected}, got ${got}`,
      );
  }
  console.log(
    `classifyTurn accuracy: ${correct}/${cases.length} (${((100 * correct) / cases.length).toFixed(1)}%)`,
  );
  // The dangerous direction: anything classified refine_current that is not.
  if (misses.length > 0) console.log(`misses:\n${misses.join("\n")}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
