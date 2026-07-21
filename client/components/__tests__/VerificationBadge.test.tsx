// @vitest-environment jsdom
import React from "react";
import { describe, it, expect } from "vitest";
// Repo convention: renderComponent wraps RTL-for-web + QueryClient (jsdom).
// Do NOT import @testing-library/react-native — the repo does not use it.
import { renderComponent } from "../../../test/utils/render-component";
import { VerificationBadge } from "@/components/VerificationBadge";

describe("VerificationBadge", () => {
  it("renders the unverified label", () => {
    const { getByText } = renderComponent(
      <VerificationBadge level="unverified" />,
    );
    expect(getByText("Unverified")).toBeTruthy();
  });

  it("composes the unverified accessibility label", () => {
    const { getByLabelText } = renderComponent(
      <VerificationBadge level="unverified" />,
    );
    expect(
      getByLabelText(
        "Verification: Unverified. Nutrition from database, not confirmed by label scans.",
      ),
    ).toBeTruthy();
  });

  it("composes the single_verified accessibility label", () => {
    const { getByLabelText } = renderComponent(
      <VerificationBadge level="single_verified" />,
    );
    expect(
      getByLabelText(
        "Verification: Partly verified. Confirmed by 1-2 label scans, needs more for full verification.",
      ),
    ).toBeTruthy();
  });

  it("composes the verified accessibility label", () => {
    const { getByLabelText } = renderComponent(
      <VerificationBadge level="verified" />,
    );
    expect(
      getByLabelText(
        "Verification: Community Verified. Confirmed by 3+ independent label scans.",
      ),
    ).toBeTruthy();
  });

  // The container also sets `accessible={true}` (mirroring the ScanFlagBadge
  // fix) so VoiceOver/TalkBack announce the composed label as one unit
  // instead of drilling into the icon + text children individually. jsdom
  // cannot model this — react-native's `accessible` prop never reaches the
  // rendered DOM for either `true` or `false` (verified empirically: no
  // `accessible` attribute appears regardless of value), so there is no
  // in-harness way to assert the grouping itself. The exact-label-composition
  // tests above are the harness-appropriate proxy per
  // docs/solutions/conventions/jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding-2026-07-03.md;
  // verify the actual grouping on-device (TalkBack/VoiceOver).
});
