// @vitest-environment jsdom
import React from "react";
import { describe, it, expect } from "vitest";

import { renderComponent } from "../../../../test/utils/render-component";
import { NutritionSummaryCard } from "../NutritionSummaryCard";

const twoStandouts = [
  { group: "concern", nutrient: "sugar", band: "high", hasValue: true },
  { group: "benefit", nutrient: "fibre", band: "good", hasValue: true },
] as const;

describe("NutritionSummaryCard", () => {
  it("renders the calorie figure and the fixed macro strip", () => {
    const { queryByText } = renderComponent(
      <NutritionSummaryCard
        standouts={[...twoStandouts]}
        calories={156}
        protein={2}
        carbs={39}
        fat={0}
      />,
    );
    expect(queryByText("156")).toBeTruthy();
    expect(queryByText("Protein")).toBeTruthy();
    expect(queryByText("Carbs")).toBeTruthy();
    expect(queryByText("Fat")).toBeTruthy();
  });

  it("renders both promoted standouts with their copy", () => {
    const { queryByText } = renderComponent(
      <NutritionSummaryCard
        standouts={[...twoStandouts]}
        calories={156}
        protein={2}
        carbs={39}
        fat={0}
      />,
    );
    expect(queryByText("High in sugar")).toBeTruthy();
    expect(queryByText("Good source of fibre")).toBeTruthy();
  });

  it("shows an em dash for an absent calorie value, never a zero", () => {
    const { queryByText } = renderComponent(
      <NutritionSummaryCard standouts={[]} calories={undefined} />,
    );
    expect(queryByText("—")).toBeTruthy();
    expect(queryByText("0")).toBeNull();
  });

  it("renders the Nutri-Score ring OUTSIDE the card's accessible group", () => {
    // Same reasoning the chip shipped with: a collapsed subtree announces only
    // the group label, and the grade letter is not in it.
    const { queryByTestId } = renderComponent(
      <NutritionSummaryCard
        standouts={[]}
        calories={156}
        nutriScoreGrade="b"
      />,
    );
    const ring = queryByTestId("nutri-score-ring");
    expect(ring).toBeTruthy();
    expect(ring?.closest("[aria-label]")).toBeNull();
  });

  it("renders without a ring when there is no grade (the saved-item path)", () => {
    const { queryByTestId } = renderComponent(
      <NutritionSummaryCard standouts={[]} calories={156} />,
    );
    expect(queryByTestId("nutri-score-ring")).toBeNull();
  });

  it("renders a promoted fibre row with no recorded value distinctly, with no dot or pill", () => {
    // Rule 4 promotes fibre regardless of band, so an "unknown"-band, no-value
    // standout is a reachable, load-bearing state (see
    // NutritionSummaryCard-utils.ts's docblock) — it must read as "not
    // recorded", never as "no fibre", and it carries no resolvable band so no
    // colour indicator is shown at all (safety invariant 1).
    const { queryByText, queryByTestId } = renderComponent(
      <NutritionSummaryCard
        standouts={[
          {
            group: "benefit",
            nutrient: "fibre",
            band: "unknown",
            hasValue: false,
          },
        ]}
        calories={156}
      />,
    );
    expect(queryByText("Fibre not recorded")).toBeTruthy();
    expect(queryByTestId("standout-indicator-fibre")).toBeNull();
  });

  it("renders the serving context caption only when one is supplied", () => {
    const withCaption = renderComponent(
      <NutritionSummaryCard
        standouts={[]}
        calories={156}
        servingContextLabel="1 can (355 mL)"
      />,
    );
    expect(withCaption.queryByText("Per 1 can (355 mL)")).toBeTruthy();

    const without = renderComponent(
      <NutritionSummaryCard standouts={[]} calories={156} />,
    );
    expect(without.container.textContent).not.toContain("Per ");
  });
});
