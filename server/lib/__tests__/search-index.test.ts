// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import MiniSearch from "minisearch";
import type { SearchableRecipe } from "@shared/types/recipe-search";

import {
  addToIndex,
  getDocumentStore,
  getIndex,
  removeFromIndex,
  resetSearchIndex,
} from "../search-index";

const { mockWarn } = vi.hoisted(() => ({ mockWarn: vi.fn() }));
vi.mock("../logger", () => ({
  logger: { warn: mockWarn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
  toError: (e: unknown) => (e instanceof Error ? e : new Error(String(e))),
}));

const doc = (title: string): SearchableRecipe =>
  ({
    id: "personal:1",
    source: "personal",
    userId: "u1",
    title,
    description: null,
    ingredients: [],
  }) as unknown as SearchableRecipe;

// Reliability audit 2026-11-19 L-obs-1: the index's remove failures were
// swallowed by empty catches, so a systematic fault was invisible forever
// (docs/solutions/conventions/server-log-level-is-the-sentry-routing-decision-2026-10-30.md).
describe("search index remove failures are logged, not silent", () => {
  beforeEach(() => {
    resetSearchIndex();
    mockWarn.mockClear();
    getIndex();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("warns when the old entry cannot be removed on an update", () => {
    addToIndex(doc("chicken soup"));
    vi.spyOn(MiniSearch.prototype, "remove").mockImplementationOnce(() => {
      throw new Error("stale entry");
    });
    vi.spyOn(MiniSearch.prototype, "add").mockImplementationOnce(() => {});
    addToIndex(doc("beef stew"));
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ id: "personal:1", err: expect.any(Error) }),
      expect.stringContaining("search index"),
    );
  });

  it("warns and still drops the document when remove throws", () => {
    addToIndex(doc("chicken soup"));
    vi.spyOn(MiniSearch.prototype, "remove").mockImplementationOnce(() => {
      throw new Error("stale entry");
    });
    removeFromIndex("personal:1");
    expect(getDocumentStore().has("personal:1")).toBe(false);
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ id: "personal:1" }),
      expect.stringContaining("search index"),
    );
  });

  it("logs nothing on an ordinary update (control)", () => {
    addToIndex(doc("chicken soup"));
    addToIndex(doc("beef stew"));
    expect(mockWarn).not.toHaveBeenCalled();
    expect(getIndex().search("beef")).toHaveLength(1);
  });
});
