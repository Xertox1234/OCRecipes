// @vitest-environment jsdom
import React from "react";
import { describe, it, expect } from "vitest";
// Repo convention: renderComponent wraps RTL-for-web + QueryClient (jsdom).
// Do NOT import @testing-library/react-native — the repo does not use it.
import { renderComponent } from "../../../test/utils/render-component";
import { ScanFlagBadge } from "@/components/ScanFlagBadge";
import type { ScanFlag } from "@shared/types/scan-flags";

const flag = (over: Partial<ScanFlag> = {}): ScanFlag => ({
  id: "allergen:peanuts",
  kind: "allergen",
  severity: "danger",
  tier: "safety",
  title: "Contains Peanuts",
  detail: "You listed a severe peanut allergy",
  ...over,
});

describe("ScanFlagBadge", () => {
  it("renders the flag title", () => {
    const { getByText } = renderComponent(<ScanFlagBadge flag={flag()} />);
    expect(getByText("Contains Peanuts")).toBeTruthy();
  });

  it("renders the warn-severity variant title too", () => {
    const { getByText } = renderComponent(
      <ScanFlagBadge
        flag={flag({ severity: "warn", title: "Couldn't verify allergens" })}
      />,
    );
    expect(getByText("Couldn't verify allergens")).toBeTruthy();
  });

  it("composes title + detail into the accessibility label", () => {
    const { getByLabelText } = renderComponent(
      <ScanFlagBadge
        flag={flag({
          title: "Contains Peanuts",
          detail: "You listed a severe peanut allergy",
        })}
      />,
    );
    expect(
      getByLabelText("Contains Peanuts. You listed a severe peanut allergy"),
    ).toBeTruthy();
  });
});
