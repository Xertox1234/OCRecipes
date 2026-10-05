// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import * as RN from "react-native";
import { PRIVACY_POLICY_URL, TERMS_URL } from "@/constants/legal";
import { renderComponent } from "../../../test/utils/render-component";
import { LegalConsentCaption } from "../LegalConsentCaption";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LegalConsentCaption", () => {
  it("says what continuing agrees to", () => {
    renderComponent(<LegalConsentCaption onLinkError={vi.fn()} />);
    expect(screen.getByText(/By continuing, you agree to our/)).toBeTruthy();
  });

  it("opens the Terms and Privacy pages", () => {
    const openSpy = vi
      .spyOn(RN.Linking, "openURL")
      .mockResolvedValue(undefined);
    renderComponent(<LegalConsentCaption onLinkError={vi.fn()} />);
    fireEvent.click(screen.getByRole("link", { name: "Terms of Service" }));
    fireEvent.click(screen.getByRole("link", { name: "Privacy Policy" }));
    expect(openSpy).toHaveBeenCalledWith(TERMS_URL);
    expect(openSpy).toHaveBeenCalledWith(PRIVACY_POLICY_URL);
  });

  it("reports a link that cannot open", async () => {
    vi.spyOn(RN.Linking, "openURL").mockRejectedValue(new Error("no"));
    const onLinkError = vi.fn();
    renderComponent(<LegalConsentCaption onLinkError={onLinkError} />);
    fireEvent.click(screen.getByRole("link", { name: "Terms of Service" }));
    await waitFor(() => expect(onLinkError).toHaveBeenCalledTimes(1));
  });
});
