// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { DiscoveryCarousel } from "../DiscoveryCarousel";
import type { DiscoveryCard } from "../discovery-cards-config";

const mockCards: DiscoveryCard[] = [
  {
    id: "scan-receipt",
    eyebrow: "✨ Try this",
    headline: "Scan receipts to fill your pantry instantly",
    subtitle: "Point your camera at any grocery receipt.",
    emoji: "📷",
    ctaLabel: "Scan Now",
  },
  {
    id: "photo-food-log",
    eyebrow: "✨ Try this",
    headline: "Log food by snapping a photo",
    subtitle: "No searching — just point and shoot.",
    emoji: "📷",
    ctaLabel: "Try Photo Log",
  },
];

const { mockUseDiscoveryCards } = vi.hoisted(() => ({
  mockUseDiscoveryCards: vi.fn(),
}));

vi.mock("@/hooks/useDiscoveryCards", () => ({
  useDiscoveryCards: mockUseDiscoveryCards,
}));

describe("DiscoveryCarousel", () => {
  const onActionPress = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when cards array is empty", () => {
    mockUseDiscoveryCards.mockReturnValue({ cards: [], dismiss: vi.fn() });
    const { container } = renderComponent(
      <DiscoveryCarousel onActionPress={onActionPress} usageCounts={{}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders a card item for each card in the list", () => {
    mockUseDiscoveryCards.mockReturnValue({
      cards: mockCards,
      dismiss: vi.fn(),
    });
    renderComponent(
      <DiscoveryCarousel onActionPress={onActionPress} usageCounts={{}} />,
    );
    expect(
      screen.getByText("Scan receipts to fill your pantry instantly"),
    ).toBeDefined();
    expect(screen.getByText("Log food by snapping a photo")).toBeDefined();
  });
});
