import { describe, it, expect } from "vitest";
import type { ReactElement } from "react";
import {
  LIBRARY_SCREEN_OPTIONS,
  cookbookCreateOptions,
} from "../library-screen-options";

type TitleElement = ReactElement<{ title: string; showIcon?: boolean }>;

function titleOf(headerTitle: unknown): { title: string; showIcon?: boolean } {
  expect(typeof headerTitle).toBe("function");
  const el = (headerTitle as () => TitleElement)();
  return el.props;
}

describe("library screen options (shared by Chat, Profile and Plan stacks)", () => {
  it.each([
    ["GroceryLists", "Grocery Lists"],
    ["GroceryList", "Grocery List"],
    ["Pantry", "Pantry"],
    ["CookbookList", "Cookbooks"],
    ["CookbookDetail", "Cookbook"],
  ] as const)("%s shows the %s title without the icon", (screen, title) => {
    expect(titleOf(LIBRARY_SCREEN_OPTIONS[screen].headerTitle)).toEqual({
      title,
      showIcon: false,
    });
  });

  it("CookbookCreate titles itself by mode", () => {
    const edit = cookbookCreateOptions({
      route: { params: { cookbookId: 4 } },
    });
    const create = cookbookCreateOptions({ route: { params: undefined } });
    expect(titleOf(edit.headerTitle).title).toBe("Edit Cookbook");
    expect(titleOf(create.headerTitle).title).toBe("New Cookbook");
  });
});
