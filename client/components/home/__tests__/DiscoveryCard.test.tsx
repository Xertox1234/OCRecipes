// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { DiscoveryCard } from "../DiscoveryCard";
import type { DiscoveryCard as DiscoveryCardType } from "../discovery-cards-config";

const mockCard: DiscoveryCardType = {
  id: "scan-receipt",
  eyebrow: "✨ Try this",
  headline: "Scan receipts to fill your pantry instantly",
  subtitle: "Point your camera at any grocery receipt.",
  emoji: "📷",
  ctaLabel: "Scan Now",
};

describe("DiscoveryCard", () => {
  const onPress = vi.fn();
  const onDismiss = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the headline", () => {
    renderComponent(
      <DiscoveryCard
        card={mockCard}
        onPress={onPress}
        onDismiss={onDismiss}
        reducedMotion={true}
        width={300}
      />,
    );
    expect(
      screen.getByText("Scan receipts to fill your pantry instantly"),
    ).toBeDefined();
  });

  it("renders the subtitle", () => {
    renderComponent(
      <DiscoveryCard
        card={mockCard}
        onPress={onPress}
        onDismiss={onDismiss}
        reducedMotion={true}
        width={300}
      />,
    );
    expect(
      screen.getByText("Point your camera at any grocery receipt."),
    ).toBeDefined();
  });

  it("renders the CTA label", () => {
    renderComponent(
      <DiscoveryCard
        card={mockCard}
        onPress={onPress}
        onDismiss={onDismiss}
        reducedMotion={true}
        width={300}
      />,
    );
    expect(screen.getByLabelText("Scan Now")).toBeDefined();
  });

  it("calls onDismiss when the dismiss button is pressed", () => {
    renderComponent(
      <DiscoveryCard
        card={mockCard}
        onPress={onPress}
        onDismiss={onDismiss}
        reducedMotion={true}
        width={300}
      />,
    );
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("calls onPress when the CTA button is pressed", () => {
    renderComponent(
      <DiscoveryCard
        card={mockCard}
        onPress={onPress}
        onDismiss={onDismiss}
        reducedMotion={true}
        width={300}
      />,
    );
    fireEvent.click(screen.getByLabelText("Scan Now"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
