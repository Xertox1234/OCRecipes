// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import * as Haptics from "expo-haptics";
import { renderComponent } from "../../../test/utils/render-component";
import { TastePicksGrid } from "../TastePicksGrid";
import { resolveImageUrl } from "@/lib/query-client";
import type { RecipeCandidate } from "@shared/types/taste-picks";

const candidates = [
  {
    id: 1,
    title: "Pad Thai",
    imageUrl: "https://x/1.jpg",
    cuisineOrigin: "Thai",
  },
  { id: 2, title: "Tacos", imageUrl: "https://x/2.jpg", cuisineOrigin: null },
] as unknown as RecipeCandidate[];

describe("TastePicksGrid", () => {
  it("picking a recipe ticks once and toggles it", () => {
    const onToggle = vi.fn();
    renderComponent(
      <TastePicksGrid
        candidates={candidates}
        selectedIds={new Set([2])}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Pad Thai, Thai cuisine" }),
    );
    expect(onToggle).toHaveBeenCalledWith(1);
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
    expect(
      screen
        .getByRole("checkbox", { name: "Tacos" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  // React Native's core Image has no controllable disk cache, so every
  // re-entry re-downloaded full-size photos (audit 2026-10-29 L-perf-1).
  it("renders recipe photos with a memory-and-disk cached image", () => {
    const one = [
      {
        id: 4,
        title: "Pho",
        imageUrl: "/api/recipe-images/4.jpg",
        cuisineOrigin: null,
      },
    ] as unknown as RecipeCandidate[];
    const { container } = renderComponent(
      <TastePicksGrid
        candidates={one}
        selectedIds={new Set()}
        onToggle={vi.fn()}
      />,
    );
    expect(
      container.querySelector("img")?.getAttribute("data-cache-policy"),
    ).toBe("memory-disk");
  });

  it("resolves server-relative image URLs against the API base", () => {
    const relative = [
      {
        id: 3,
        title: "Dal",
        imageUrl: "/api/recipe-images/3.jpg",
        cuisineOrigin: null,
      },
    ] as unknown as RecipeCandidate[];
    const { container } = renderComponent(
      <TastePicksGrid
        candidates={relative}
        selectedIds={new Set()}
        onToggle={vi.fn()}
      />,
    );
    const src = container.querySelector("img")?.getAttribute("src");
    expect(src).toBe(resolveImageUrl("/api/recipe-images/3.jpg"));
    expect(src).toMatch(/^https?:\/\/.+\/api\/recipe-images\/3\.jpg$/);
  });
});
