import { describe, it, expect, vi, beforeEach } from "vitest";
import { cookbookRecipes, savedItems } from "@shared/schema";
import { eq } from "drizzle-orm";

// A transaction runs on ONE pg connection. pg 8.x queues a query issued while
// another is in flight and prints a DeprecationWarning; pg@9 removes that
// queue. These tests pin that each storage function awaits its `tx` queries
// one after another, by counting how many fake queries are in flight at once.
//
// The fake `tx` is a chainable Proxy: every method call returns another link
// of the chain, and awaiting a link (its `then`) is "the query runs". The run
// resolves on a macrotask, so queries started together are measured together.

type Row = {
  id: number;
  imageUrl: string | null;
  tokenVersion: number;
  count: number;
};
type Chain = PromiseLike<Row[]> & {
  [method: string]: (...args: unknown[]) => Chain;
};

const { gauge, fakeTx } = vi.hoisted(() => {
  const gauge = {
    inFlight: 0,
    max: 0,
    reset() {
      this.inFlight = 0;
      this.max = 0;
    },
  };
  const row = (): Row => ({ id: 1, imageUrl: null, tokenVersion: 1, count: 0 });
  function link(): Chain {
    return new Proxy({} as Chain, {
      get(_target, prop) {
        if (typeof prop === "symbol" || prop === "toJSON") return undefined;
        if (prop === "then") {
          return (resolve: (rows: Row[]) => void) => {
            gauge.inFlight += 1;
            gauge.max = Math.max(gauge.max, gauge.inFlight);
            setTimeout(() => {
              gauge.inFlight -= 1;
              resolve([row()]);
            }, 0);
          };
        }
        return () => link();
      },
    });
  }
  return { gauge, fakeTx: link() };
});

vi.mock("../../db", () => ({
  db: {
    transaction: <T>(cb: (tx: Chain) => Promise<T>) => cb(fakeTx),
  },
}));
vi.mock("../../lib/search-index", () => ({
  addToIndex: vi.fn(),
  removeFromIndex: vi.fn(),
  mealPlanToSearchable: vi.fn(),
  communityToSearchable: vi.fn(),
}));
vi.mock("../account-images", () => ({
  deleteImagesIfUnreferenced: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../lib/image-store", () => ({
  deleteImage: vi.fn().mockResolvedValue(undefined),
}));

const { disableMfa } = await import("../mfa");
const { deleteMealPlanRecipe } = await import("../meal-plan-recipes-crud");
const { deleteCommunityRecipe } = await import("../community-recipes");
const { countRecipeGenerationsToday } = await import("../chat-quota");
type ChatTx = Parameters<typeof countRecipeGenerationsToday>[0];

describe("queries on one transaction client run one after another", () => {
  beforeEach(() => gauge.reset());

  // Positive control: the same builder shape the storage code uses, under
  // Promise.all, must read as overlapping — otherwise a 1 below proves nothing.
  it("control: Promise.all over two tx builders overlaps", async () => {
    await Promise.all([
      fakeTx.delete(cookbookRecipes).where(eq(cookbookRecipes.recipeId, 1)),
      fakeTx.delete(savedItems).where(eq(savedItems.recipeId, 1)),
    ]);
    expect(gauge.max).toBe(2);
  });

  it("disableMfa", async () => {
    expect(await disableMfa("user-1")).toBe(1);
    expect(gauge.max).toBe(1);
  });

  it("deleteMealPlanRecipe", async () => {
    expect(await deleteMealPlanRecipe(1, "user-1")).toBe(true);
    expect(gauge.max).toBe(1);
  });

  it("deleteCommunityRecipe", async () => {
    expect(await deleteCommunityRecipe(1, "user-1")).toBe(true);
    expect(gauge.max).toBe(1);
  });

  it("countRecipeGenerationsToday", async () => {
    expect(
      await countRecipeGenerationsToday(fakeTx as unknown as ChatTx, "user-1"),
    ).toBe(0);
    expect(gauge.max).toBe(1);
  });
});
