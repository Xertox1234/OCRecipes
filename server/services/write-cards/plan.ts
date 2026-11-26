import { categorizeIngredient } from "@shared/lib/grocery-categories";
import type {
  CoachWriteCard,
  CoachWriteCardSavedRefs,
  CommunityRecipe,
  MealPlanRecipe,
} from "@shared/schema";
import {
  planEditsSchema,
  type PlanCardEdits,
  type PlanCardPayload,
  type PlanRecipeRef,
} from "@shared/schemas/coach-write-cards";
import { planRecipeKey } from "@shared/schemas/coach-write-cards";
import {
  planKept,
  planShoppingOn,
  writeCardReceipt,
} from "@shared/lib/coach-write-card-math";
import { isRecipeSafeForAllergies } from "@shared/constants/allergens";
import {
  getProfileAllergies,
  getUserProfile,
} from "../../storage/user-profiles";
import { getVisibleCommunityRecipesByIds } from "../../storage/community-recipes";
import {
  type AfterCommit,
  createMealPlanFromSuggestions,
  deleteMealPlanRecipe,
  getMealPlanRecipe,
  getMealPlanRecipeWithIngredients,
  getMealPlanRecipesByIds,
} from "../../storage/meal-plan-recipes-crud";
import {
  addMealPlanItem,
  getMealPlanItems,
  removeMealPlanItem,
} from "../../storage/meal-plan-items";
import {
  insertGroceryListItemsUnderCap,
  createGroceryListWithLimitCheck,
  deleteGroceryList,
  deleteGroceryListItem,
  getGroceryLists,
  getUncheckedGroceryListItems,
  verifyGroceryListOwnership,
} from "../../storage/grocery-lists";
import { getPantryItems } from "../../storage/pantry";
import type { WriteCardTx } from "../../storage/coach-write-cards";
import { generateGroceryItems } from "../grocery-generation";
import { groupPantryByKey, matchKey, pantryVerdict } from "../pantry-deduction";
import { autoGenerateRecipeImage } from "../recipe-auto-image";
import { fireAndForget } from "../../lib/fire-and-forget";
import { LISTS_OFFERED, MAX_GROCERY_LISTS, lineKey } from "./grocery";
import { WriteCardEditError } from "./errors";
import {
  readCardPayload,
  savableCardPayload,
  STALE_CARD_RECEIPT,
} from "./payload";
import type { AddMealPlanCardArgs, RecipeRefArg } from "./tool-args";

export {
  addMealPlanCardArgsSchema,
  type AddMealPlanCardArgs,
} from "./tool-args";

/**
 * Meal plan write card (spec 2026-11-09). Coach names recipes by id (from
 * search_recipes or get_my_recipes); the server resolves every id itself and
 * drops any it can't — a model-invented id never reaches the card. Saving
 * plans each kept row, copying a community recipe into the user's library
 * first; Undo removes the plan rows, the copies this save made and any
 * shopping it added.
 */

const refKey = planRecipeKey;

/** The new list a combined card (A1) makes when the user picks none. */
const SHOPPING_LIST_NAME = "Meal plan shopping";
/** The preview's caps (planShoppingSchema). */
const PREVIEW_NAMES = 30;
const PREVIEW_NAME_LENGTH = 80;
const previewNames = (ingredients: { name: string }[]) =>
  ingredients
    .slice(0, PREVIEW_NAMES)
    .map((i) => i.name.trim().slice(0, PREVIEW_NAME_LENGTH))
    .filter(Boolean);

function toRef(
  source: "community" | "mine",
  r: Pick<
    CommunityRecipe | MealPlanRecipe,
    "id" | "title" | "caloriesPerServing" | "proteinPerServing"
  >,
): PlanRecipeRef {
  return {
    source,
    id: r.id,
    title: r.title,
    calories: Math.round(Number(r.caloriesPerServing ?? 0)),
    protein: Math.round(Number(r.proteinPerServing ?? 0)),
  };
}

/**
 * The same "safe for me" rule recipe search applies (recipe-search.ts): a
 * community recipe with no ingredient data, or one unsafe for the user's
 * allergies (an underived cache fails closed), never reaches the card — even
 * if the model names its id from earlier in the chat. The user's own recipes
 * are theirs to plan, as on the Plan tab.
 */
function isSafeCommunityRecipe(
  r: CommunityRecipe,
  allergies: Parameters<typeof isRecipeSafeForAllergies>[1],
): boolean {
  if (allergies.length === 0) return true;
  return (
    r.ingredients.length > 0 && isRecipeSafeForAllergies(r.allergens, allergies)
  );
}

/** Swap shows two or three choices (owner decision 2026-11-09). */
const MIN_SWAP_CHOICES = 2;
const MAX_SWAP_CHOICES = 3;

/**
 * Fills each short row from the pool, never offering any row's main recipe
 * or a choice the row already has. Each row starts at a different point in
 * the pool, so neighbouring days lead with a different choice.
 */
function topUpSwapChoices(
  rows: PlanCardPayload["rows"],
  pool: PlanRecipeRef[],
): void {
  const mains = new Set(rows.map((r) => refKey(r.recipe)));
  const candidates = pool.filter((r) => !mains.has(refKey(r)));
  if (candidates.length === 0) return;
  rows.forEach((row, i) => {
    if (row.alternatives.length >= MIN_SWAP_CHOICES) return;
    const have = new Set(row.alternatives.map(refKey));
    for (let k = 0; k < candidates.length; k++) {
      if (row.alternatives.length >= MAX_SWAP_CHOICES) break;
      const c = candidates[(i + k) % candidates.length];
      if (have.has(refKey(c))) continue;
      have.add(refKey(c));
      row.alternatives.push(c);
    }
  });
}

/**
 * `pool` is the community ids find_plan_recipes returned this turn. A row
 * the model gave fewer than two alternatives is topped up from it, so Swap
 * doesn't depend on the model remembering the optional field. Pool ids go
 * through the same resolve-and-safety check as the model's own.
 */
export async function buildPlanPayload(
  args: AddMealPlanCardArgs,
  userId: string,
  pool: number[] = [],
  /** `shopping`: the app can draw the shopping section (A1). */
  opts: { shopping?: boolean } = {},
): Promise<PlanCardPayload> {
  const withShopping = !!opts.shopping && args.withGroceryList === true;
  const poolRefs: RecipeRefArg[] = [...new Set(pool)].map((id) => ({
    source: "community",
    id,
  }));
  const all: RecipeRefArg[] = [
    ...args.rows.flatMap((r) => [r.recipe, ...r.alternatives]),
    ...poolRefs,
  ];
  const ids = (source: "community" | "mine") =>
    all.filter((r) => r.source === source).map((r) => r.id);
  const dates = args.rows.map((r) => r.plannedDate).sort();

  const [communityRows, mineRows, existing, lists, profile] = await Promise.all(
    [
      getVisibleCommunityRecipesByIds(ids("community"), userId),
      getMealPlanRecipesByIds(ids("mine"), userId),
      getMealPlanItems(userId, dates[0], dates[dates.length - 1]),
      getGroceryLists(userId, withShopping ? LISTS_OFFERED : 1),
      getUserProfile(userId),
    ],
  );
  const resolved = new Map<string, PlanRecipeRef>();
  for (const r of communityRows.filter((c) =>
    isSafeCommunityRecipe(c, profile?.allergies ?? []),
  )) {
    resolved.set(
      refKey({ source: "community", id: r.id }),
      toRef("community", r),
    );
  }
  for (const r of mineRows)
    resolved.set(refKey({ source: "mine", id: r.id }), toRef("mine", r));

  const planned = new Map<string, string>();
  for (const item of existing) {
    const title = item.recipe?.title ?? item.scannedItem?.productName;
    const key = `${item.plannedDate}|${item.mealType}`;
    if (title && !planned.has(key)) planned.set(key, title);
  }

  const poolResolved = poolRefs
    .map((r) => resolved.get(refKey(r)))
    .filter((r): r is PlanRecipeRef => r !== undefined);
  const rows: PlanCardPayload["rows"] = [];
  for (const row of args.rows) {
    const candidates = [row.recipe, ...row.alternatives]
      .map((r) => resolved.get(refKey(r)))
      .filter((r): r is PlanRecipeRef => r !== undefined);
    const [recipe, ...rest] = candidates;
    if (!recipe) continue;
    const seen = new Set([refKey(recipe)]);
    const alternatives = rest.filter((r) => {
      if (seen.has(refKey(r))) return false;
      seen.add(refKey(r));
      return true;
    });
    rows.push({
      plannedDate: row.plannedDate,
      mealType: row.mealType,
      recipe,
      alternatives: alternatives.slice(0, MAX_SWAP_CHOICES),
      alreadyPlanned: planned.get(`${row.plannedDate}|${row.mealType}`) ?? null,
    });
  }
  if (rows.length === 0) {
    throw new WriteCardEditError("None of those recipes could be found.");
  }
  topUpSwapChoices(rows, poolResolved);
  const payload: PlanCardPayload = {
    rows,
    shoppingListId: lists[0]?.id ?? null,
  };
  if (!withShopping) return payload;

  // Ingredient names for every recipe the card can end up planning, so the
  // preview follows a Swap. Names only: the save reads the amounts itself.
  const onCard = new Map(
    rows
      .flatMap((r) => [r.recipe, ...r.alternatives])
      .map((r) => [refKey(r), r]),
  );
  const ingredients: Record<string, string[]> = {};
  for (const c of communityRows) {
    const key = refKey({ source: "community", id: c.id });
    if (onCard.has(key)) ingredients[key] = previewNames(c.ingredients);
  }
  await Promise.all(
    [...onCard.values()]
      .filter((r) => r.source === "mine")
      .map(async (r) => {
        const full = await getMealPlanRecipeWithIngredients(r.id, userId);
        ingredients[refKey(r)] = previewNames(full?.ingredients ?? []);
      }),
  );
  return {
    ...payload,
    shopping: {
      lists: lists.map((l) => ({ id: l.id, title: l.title })),
      defaultListId: lists[0]?.id ?? null,
      newListName: SHOPPING_LIST_NAME,
      ingredients,
    },
  };
}

function parsePlanEdits(p: PlanCardPayload, raw: unknown): PlanCardEdits {
  const parsed = planEditsSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new WriteCardEditError("These changes can't be saved.");
  }
  const { removed, chosen } = parsed.data;
  if (
    (removed && removed.length !== p.rows.length) ||
    (chosen && chosen.length !== p.rows.length) ||
    chosen?.some((c, i) => c != null && !p.rows[i].alternatives[c]) ||
    // A list choice needs the shopping section, and one of its lists.
    (parsed.data.shoppingListId !== undefined &&
      (!p.shopping ||
        (parsed.data.shoppingListId !== "new" &&
          !p.shopping.lists.some((l) => l.id === parsed.data.shoppingListId))))
  ) {
    throw new WriteCardEditError("These changes can't be saved.");
  }
  return parsed.data;
}

type ShoppingIngredient = {
  name: string;
  quantity: string | null;
  unit: string | null;
  category: string | null;
};

export async function performPlanSave(
  tx: WriteCardTx,
  card: CoachWriteCard,
  rawEdits: unknown,
  ctx: { userId: string; afterCommit?: AfterCommit },
): Promise<CoachWriteCardSavedRefs> {
  const payload = savableCardPayload(card, "plan");
  const edits = parsePlanEdits(payload, rawEdits);
  const kept = planKept(payload, edits);
  if (kept.length === 0) throw new WriteCardEditError("Nothing to plan.");
  const addShopping = planShoppingOn(payload, edits);

  // Re-read the recipes now: a copy is made from the server's row, never from
  // anything the card or the app carried.
  const communityIds = kept
    .filter((r) => r.recipe.source === "community")
    .map((r) => r.recipe.id);
  const mineIds = kept
    .filter((r) => r.recipe.source === "mine")
    .map((r) => r.recipe.id);
  // Every read in a save goes through `tx`, one after the other: a read
  // through the pool needs a second connection while the save holds one, and
  // enough parallel saves then hold the whole pool (audit 2026-11-24, M47).
  const communityRows = await getVisibleCommunityRecipesByIds(
    communityIds,
    ctx.userId,
    tx,
  );
  const mineRows = await getMealPlanRecipesByIds(mineIds, ctx.userId, tx);
  // No row lock: the allergy card takes that lock, and this is only a read.
  const profile = await getProfileAllergies(ctx.userId, tx);
  // Re-checked at save: allergies can change between showing and saving.
  const community = new Map(
    communityRows
      .filter((r) => isSafeCommunityRecipe(r, profile?.allergies ?? []))
      .map((r) => [r.id, r]),
  );
  const mine = new Map(mineRows.map((r) => [r.id, r]));

  const mealPlanItemIds: number[] = [];
  const copiedRecipeIds: number[] = [];
  const shopping: ShoppingIngredient[] = [];

  for (const row of kept) {
    const planItem = {
      userId: ctx.userId,
      plannedDate: row.plannedDate,
      mealType: row.mealType,
    };
    if (row.recipe.source === "mine") {
      if (!mine.has(row.recipe.id)) {
        throw new WriteCardEditError("A recipe on this plan is gone.");
      }
      const item = await addMealPlanItem(
        { ...planItem, recipeId: row.recipe.id },
        tx,
      );
      // The recipe was deleted between the check above and the write.
      if (!item) {
        throw new WriteCardEditError("A recipe on this plan is gone.");
      }
      mealPlanItemIds.push(item.id);
      if (addShopping) {
        const full = await getMealPlanRecipeWithIngredients(
          row.recipe.id,
          ctx.userId,
          tx,
        );
        shopping.push(...(full?.ingredients ?? []));
      }
      continue;
    }

    const src = community.get(row.recipe.id);
    if (!src) throw new WriteCardEditError("A recipe on this plan is gone.");
    const ingredients = src.ingredients.map((ing, idx) => ({
      name: ing.name,
      quantity: ing.quantity || null,
      unit: ing.unit || null,
      category: categorizeIngredient(ing.name),
      displayOrder: idx,
    }));
    const [created] = await createMealPlanFromSuggestions(
      [
        {
          recipe: {
            userId: ctx.userId,
            title: src.title,
            description: src.description,
            difficulty: src.difficulty,
            servings: src.servings ?? 2,
            instructions: src.instructions,
            imageUrl: src.imageUrl,
            caloriesPerServing: src.caloriesPerServing,
            proteinPerServing: src.proteinPerServing,
            carbsPerServing: src.carbsPerServing,
            fatPerServing: src.fatPerServing,
            dietTags: src.dietTags,
            mealTypes:
              src.mealTypes.length > 0 ? src.mealTypes : [row.mealType],
            sourceType: "community_copy",
          },
          ingredients,
          planItem,
        },
      ],
      tx,
      ctx.afterCommit,
    );
    copiedRecipeIds.push(created.recipeId);
    mealPlanItemIds.push(created.mealPlanItemId);
    if (addShopping) shopping.push(...ingredients);
  }

  const refs: CoachWriteCardSavedRefs = { mealPlanItemIds, copiedRecipeIds };
  // A combined card (A1) names its list, or makes one; the older tick adds
  // to the user's latest list and is hidden when they have none.
  const choice = payload.shopping
    ? (edits.shoppingListId ?? payload.shopping.defaultListId ?? "new")
    : payload.shoppingListId;
  if (!addShopping || choice === null || shopping.length === 0) return refs;

  if (
    choice !== "new" &&
    !(await verifyGroceryListOwnership(choice, ctx.userId, tx))
  ) {
    throw new WriteCardEditError("That grocery list isn't available.");
  }
  const pantry = await getPantryItems(ctx.userId, undefined, tx);
  // Same rule as the grocery card. The plan card has no per-item ticks, so
  // only "covered" leaves an item off; "unsure" is bought.
  const byKey = groupPantryByKey(pantry, new Date());
  const items = generateGroceryItems(shopping)
    .filter(
      (i) =>
        pantryVerdict(
          {
            quantity: i.quantity === null ? null : String(i.quantity),
            unit: i.unit,
          },
          byKey.get(matchKey(i.name)) ?? [],
        ) !== "covered",
    )
    .map((i) => ({
      name: i.name,
      quantity: i.quantity === null ? null : String(i.quantity),
      unit: i.unit,
      category: i.category,
    }));

  if (choice === "new") {
    // Nothing to buy: no empty list is made.
    if (items.length === 0) return refs;
    const days = kept.map((r) => r.plannedDate).sort();
    const made = await createGroceryListWithLimitCheck(
      {
        userId: ctx.userId,
        title: payload.shopping?.newListName ?? SHOPPING_LIST_NAME,
        dateRangeStart: days[0],
        dateRangeEnd: days[days.length - 1],
      },
      items,
      MAX_GROCERY_LISTS,
      tx,
    );
    if (!made) throw new WriteCardEditError("You have too many grocery lists.");
    refs.createdListId = made.list.id;
    refs.listId = made.list.id;
    refs.groceryItemIds = made.items.map((r) => r.id);
    if (made.skipped > 0) refs.groceryListFull = made.skipped;
    return refs;
  }

  // As on the grocery card: a line still waiting on the list, with the same
  // amount, is not added again.
  const waiting = new Set(
    (await getUncheckedGroceryListItems(choice, ctx.userId, tx)).map(lineKey),
  );
  // A full list takes what fits; the meals are still planned.
  const { created, skipped } = await insertGroceryListItemsUnderCap(
    choice,
    ctx.userId,
    items.filter((row) => !waiting.has(lineKey(row))),
    tx,
  );
  refs.listId = choice;
  refs.groceryItemIds = created.map((r) => r.id);
  if (skipped > 0) refs.groceryListFull = skipped;
  return refs;
}

export async function revertPlanSave(
  tx: WriteCardTx,
  card: CoachWriteCard,
  afterCommit?: AfterCommit,
): Promise<void> {
  const refs = card.savedRefs;
  if (!refs) return;
  for (const id of refs.mealPlanItemIds ?? []) {
    await removeMealPlanItem(id, card.userId, tx);
  }
  for (const id of refs.copiedRecipeIds ?? []) {
    await deleteMealPlanRecipe(id, card.userId, tx, afterCommit);
  }
  if (refs.createdListId) {
    // Items cascade with the list this save created.
    await deleteGroceryList(refs.createdListId, card.userId, tx);
  } else if (refs.listId) {
    for (const id of refs.groceryItemIds ?? []) {
      await deleteGroceryListItem(id, refs.listId, card.userId, tx);
    }
  }
}

/** The list a combined card's shopping goes to, as the user sees it. */
export function planShoppingList(
  p: PlanCardPayload,
  e: PlanCardEdits,
): string | null {
  if (!p.shopping) return null;
  const choice = e.shoppingListId ?? p.shopping.defaultListId ?? "new";
  if (choice === "new") return `a new list "${p.shopping.newListName}"`;
  return p.shopping.lists.find((l) => l.id === choice)?.title ?? "a list";
}

/**
 * The saved card's one line: the meals, then what the shopping really added
 * (fewer than the ingredients when the pantry or the list already had some).
 */
export function planReceipt(
  card: CoachWriteCard,
  edits: PlanCardEdits = {},
): string {
  const payload = readCardPayload(card, "plan");
  if (!payload) return STALE_CARD_RECEIPT;
  const base = writeCardReceipt("plan", payload, edits);
  if (!planShoppingOn(payload, edits)) return base;
  const refs = card.savedRefs;
  const added = refs?.groceryItemIds?.length ?? 0;
  const full = refs?.groceryListFull ?? 0;
  if (added === 0) {
    return `${base} · ${full > 0 ? "your list is full" : "nothing new to buy"}`;
  }
  const list = !payload.shopping
    ? "your grocery list"
    : refs?.createdListId
      ? payload.shopping.newListName
      : (payload.shopping.lists.find((l) => l.id === refs?.listId)?.title ??
        "your grocery list");
  const fullNote = full > 0 ? ` · ${full} didn't fit (list full)` : "";
  return `${base} · ${added} ${added === 1 ? "item" : "items"} added to ${list}${fullNote}`;
}

/**
 * After the save commits: ask for a cover for each copy that has no image —
 * the Plan tab's rule. `autoGenerateRecipeImage` applies the tier and daily
 * cap itself.
 */
export async function startPlanImageJobs(card: CoachWriteCard): Promise<void> {
  for (const id of card.savedRefs?.copiedRecipeIds ?? []) {
    const recipe = await getMealPlanRecipe(id, card.userId);
    if (!recipe || recipe.imageUrl) continue;
    fireAndForget(
      "coach-plan-recipe-image",
      autoGenerateRecipeImage(
        {
          id: recipe.id,
          title: recipe.title,
          cuisine: recipe.cuisine ?? null,
          mealTypes: recipe.mealTypes,
        },
        card.userId,
      ),
    );
  }
}
