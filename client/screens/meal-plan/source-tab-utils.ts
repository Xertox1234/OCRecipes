/**
 * Which non-Plan tab hosts the current RecipeBrowser, so "+ Add" (which jumps
 * to the Plan stack) can offer a Back that returns there (QA sweep #10).
 * Pure + structural so Vitest covers it without a navigator.
 */
export type ReturnTab = "ProfileTab" | "CoachTab";

interface TabStateLike {
  index: number;
  routes: { name: string }[];
}

export function getSourceTab(navigation: {
  getParent: () => { getState: () => TabStateLike } | undefined;
}): ReturnTab | undefined {
  const state = navigation.getParent()?.getState();
  const name = state?.routes[state.index]?.name;
  return name === "ProfileTab" || name === "CoachTab" ? name : undefined;
}
