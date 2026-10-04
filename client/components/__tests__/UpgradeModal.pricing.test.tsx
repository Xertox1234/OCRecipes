// @vitest-environment jsdom
/**
 * The paywall's App Store guideline 3.1.2 disclosure: price per period, the
 * free trial only when the store reports one, auto-renewal terms, and links to
 * the Terms and Privacy Policy — all from the store's live product.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import * as RN from "react-native";
import type { IAPProduct } from "@/lib/iap/types";
import { PRIVACY_POLICY_URL, TERMS_URL } from "@/constants/legal";
import { renderComponent } from "../../../test/utils/render-component";
import { UpgradeModal } from "../UpgradeModal";

const ANNUAL: IAPProduct = {
  productId: "com.ocrecipes.premium.annual",
  displayPrice: "$29.99",
  period: { count: 1, unit: "year" },
  introOffer: null,
  androidOfferToken: null,
};

const { holder, purchase, refreshProduct } = vi.hoisted(() => ({
  holder: { product: null as IAPProduct | null },
  purchase: vi.fn(),
  refreshProduct: vi.fn(),
}));

vi.mock("@/lib/iap/usePurchase", () => ({
  usePurchase: () => ({
    state: { status: "idle" },
    purchase,
    restore: vi.fn(),
    reset: vi.fn(),
    product: holder.product,
    refreshProduct,
  }),
}));

function renderModal() {
  return renderComponent(<UpgradeModal visible onClose={vi.fn()} />);
}

describe("UpgradeModal — pricing disclosure", () => {
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    purchase.mockClear();
    refreshProduct.mockClear();
    openSpy = vi
      .spyOn(RN.Linking, "openURL")
      .mockImplementation(() => Promise.resolve(true));
  });

  afterEach(() => {
    openSpy.mockRestore();
  });

  it("shows the trial, the price after it, and the renewal terms", () => {
    holder.product = {
      ...ANNUAL,
      introOffer: { kind: "free-trial", length: { count: 3, unit: "day" } },
    };
    renderModal();

    expect(screen.getByText("$29.99 per year")).toBeTruthy();
    expect(
      screen.getByText("Free for 3 days, then $29.99 per year."),
    ).toBeTruthy();
    expect(
      screen.getByText(/renews automatically at \$29\.99 per year/),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Start 3-Day Free Trial" }),
    ).toBeTruthy();
  });

  it("offers a plain subscription when the store reports no trial", () => {
    holder.product = ANNUAL;
    renderModal();

    expect(screen.getByRole("button", { name: "Subscribe" })).toBeTruthy();
    expect(screen.queryByText(/Free for/)).toBeNull();
  });

  it("opens the Terms and the Privacy Policy", () => {
    holder.product = ANNUAL;
    renderModal();

    fireEvent.click(screen.getByRole("link", { name: "Terms of Service" }));
    fireEvent.click(screen.getByRole("link", { name: "Privacy Policy" }));

    expect(openSpy).toHaveBeenCalledWith(TERMS_URL);
    expect(openSpy).toHaveBeenCalledWith(PRIVACY_POLICY_URL);
  });

  it("asks the store again when it opens without a price", () => {
    holder.product = null;
    renderModal();

    expect(refreshProduct).toHaveBeenCalledTimes(1);
  });

  it("does not ask again when the price has loaded", () => {
    holder.product = ANNUAL;
    renderModal();

    expect(refreshProduct).not.toHaveBeenCalled();
  });

  it("shows no price and blocks the purchase until the store answers", () => {
    holder.product = null;
    renderModal();

    expect(screen.getByText("Price unavailable")).toBeTruthy();
    expect(screen.queryByText(/renews automatically/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Subscribe" }));
    expect(purchase).not.toHaveBeenCalled();
  });
});
