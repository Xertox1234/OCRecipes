import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createCookbookFromWizard,
  describeWizardOutcome,
} from "../create-cookbook-from-wizard";
import {
  initialWizardState,
  type WizardRecipe,
  type WizardState,
} from "../cookbook-wizard-utils";

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));

function recipe(id: number): WizardRecipe {
  return {
    recipeId: id,
    recipeType: id % 2 ? "mealPlan" : "community",
    title: `R${id}`,
    imageUrl: null,
  };
}

function makeDeps() {
  return {
    create: vi.fn().mockResolvedValue({ id: 42 }),
    uploadCover: vi.fn().mockResolvedValue(undefined),
    generateCover: vi.fn().mockResolvedValue(undefined),
    addRecipe: vi.fn().mockResolvedValue(undefined),
    onCoverStart: vi.fn(),
  };
}

function stateWith(patch: Partial<WizardState>): WizardState {
  return { ...initialWizardState, name: "Dinners", ...patch };
}

describe("createCookbookFromWizard", () => {
  let deps: ReturnType<typeof makeDeps>;
  beforeEach(() => {
    deps = makeDeps();
  });

  it("trims name and description, sending an empty description as undefined", async () => {
    await createCookbookFromWizard(
      stateWith({ name: "  Dinners  ", description: "  Cozy  " }),
      deps,
    );
    expect(deps.create).toHaveBeenCalledWith({
      name: "Dinners",
      description: "Cozy",
    });

    deps.create.mockClear();
    await createCookbookFromWizard(stateWith({ description: "   " }), deps);
    expect(deps.create).toHaveBeenCalledWith({
      name: "Dinners",
      description: undefined,
    });
  });

  it("makes no cover calls and no onCoverStart with cover none", async () => {
    const result = await createCookbookFromWizard(stateWith({}), deps);
    expect(deps.uploadCover).not.toHaveBeenCalled();
    expect(deps.generateCover).not.toHaveBeenCalled();
    expect(deps.onCoverStart).not.toHaveBeenCalled();
    expect(result).toEqual({
      cookbookId: 42,
      coverFailed: false,
      recipesFailed: 0,
    });
  });

  it("uploads a photo cover against the new id and labels it", async () => {
    await createCookbookFromWizard(
      stateWith({ cover: { kind: "photo", uri: "file:///c.jpg" } }),
      deps,
    );
    expect(deps.onCoverStart).toHaveBeenCalledWith("Adding your cover…");
    expect(deps.uploadCover).toHaveBeenCalledWith({
      cookbookId: 42,
      uri: "file:///c.jpg",
    });
    expect(deps.generateCover).not.toHaveBeenCalled();
  });

  it("generates a cover against the new id and labels it", async () => {
    await createCookbookFromWizard(
      stateWith({ cover: { kind: "generate" } }),
      deps,
    );
    expect(deps.onCoverStart).toHaveBeenCalledWith("Generating your cover…");
    expect(deps.generateCover).toHaveBeenCalledWith(42);
    expect(deps.uploadCover).not.toHaveBeenCalled();
  });

  it("adds recipes in picked order, one at a time", async () => {
    const order: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    deps.addRecipe.mockImplementation(
      async (i: { recipeId: number }): Promise<void> => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        order.push(`start${i.recipeId}`);
        await Promise.resolve();
        order.push(`end${i.recipeId}`);
        inFlight--;
      },
    );
    await createCookbookFromWizard(
      stateWith({ recipes: [recipe(3), recipe(1), recipe(2)] }),
      deps,
    );
    expect(order).toEqual([
      "start3",
      "end3",
      "start1",
      "end1",
      "start2",
      "end2",
    ]);
    expect(maxInFlight).toBe(1);
    expect(deps.addRecipe).toHaveBeenNthCalledWith(1, {
      cookbookId: 42,
      recipeId: 3,
      recipeType: "mealPlan",
    });
  });

  it("reports coverFailed but still adds recipes when the upload rejects", async () => {
    deps.uploadCover.mockRejectedValue(new Error("secret detail"));
    const result = await createCookbookFromWizard(
      stateWith({
        cover: { kind: "photo", uri: "file:///c.jpg" },
        recipes: [recipe(1), recipe(2)],
      }),
      deps,
    );
    expect(result).toEqual({
      cookbookId: 42,
      coverFailed: true,
      recipesFailed: 0,
    });
    expect(deps.addRecipe).toHaveBeenCalledTimes(2);
  });

  it("reports coverFailed when generation rejects", async () => {
    deps.generateCover.mockRejectedValue(new Error("nope"));
    const result = await createCookbookFromWizard(
      stateWith({ cover: { kind: "generate" } }),
      deps,
    );
    expect(result.coverFailed).toBe(true);
  });

  it("lets a throwing onCoverStart propagate instead of reading as a cover failure", async () => {
    deps.onCoverStart.mockImplementation(() => {
      throw new Error("ui callback broke");
    });
    await expect(
      createCookbookFromWizard(
        stateWith({ cover: { kind: "generate" } }),
        deps,
      ),
    ).rejects.toThrow("ui callback broke");
    expect(deps.generateCover).not.toHaveBeenCalled();
  });

  it("counts a failed add and keeps going", async () => {
    deps.addRecipe
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("x"))
      .mockResolvedValueOnce(undefined);
    const result = await createCookbookFromWizard(
      stateWith({ recipes: [recipe(1), recipe(2), recipe(3)] }),
      deps,
    );
    expect(result.recipesFailed).toBe(1);
    expect(deps.addRecipe).toHaveBeenCalledTimes(3);
  });

  it("throws when create fails and attaches nothing", async () => {
    deps.create.mockRejectedValue(new Error("down"));
    await expect(
      createCookbookFromWizard(
        stateWith({ cover: { kind: "generate" }, recipes: [recipe(1)] }),
        deps,
      ),
    ).rejects.toThrow("down");
    expect(deps.generateCover).not.toHaveBeenCalled();
    expect(deps.addRecipe).not.toHaveBeenCalled();
  });
});

describe("describeWizardOutcome", () => {
  it("returns null on full success", () => {
    expect(
      describeWizardOutcome({ coverFailed: false, recipesFailed: 0 }),
    ).toBeNull();
  });

  it("describes a cover failure", () => {
    expect(describeWizardOutcome({ coverFailed: true, recipesFailed: 0 })).toBe(
      "Cookbook created, but the cover couldn't be added. You can add one by editing the cookbook.",
    );
  });

  it("describes one failed recipe", () => {
    expect(
      describeWizardOutcome({ coverFailed: false, recipesFailed: 1 }),
    ).toBe("Cookbook created, but 1 recipe couldn't be added.");
  });

  it("describes several failed recipes", () => {
    expect(
      describeWizardOutcome({ coverFailed: false, recipesFailed: 2 }),
    ).toBe("Cookbook created, but 2 recipes couldn't be added.");
  });

  it("describes cover and recipes failing together", () => {
    expect(describeWizardOutcome({ coverFailed: true, recipesFailed: 2 })).toBe(
      "Cookbook created, but the cover and 2 recipes couldn't be added.",
    );
  });
});
