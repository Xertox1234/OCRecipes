// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { AskCoachSection } from "../AskCoachSection";
import type { CoachQuestion } from "../CoachOverlayContent";
import { impactAsync as rawImpactAsync } from "expo-haptics";

const { mockImpact, mockNotification, mockSelection } = vi.hoisted(() => ({
  mockImpact: vi.fn(),
  mockNotification: vi.fn(),
  mockSelection: vi.fn(),
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: mockImpact,
    notification: mockNotification,
    selection: mockSelection,
    disabled: false,
  }),
}));

const mockNavigate = vi.fn();
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => ({ isPremium: true }),
}));

// UpgradeModal pulls in the full IAP/premium hook chain; it's irrelevant to
// this component's own behavior (isPremium is mocked true, so it never
// becomes visible) so it's stubbed out like other consumers do.
vi.mock("@/components/UpgradeModal", () => ({
  UpgradeModal: () => null,
}));

const questions: readonly CoachQuestion[] = [
  { text: "How much protein today?", question: "protein_today" },
];

describe("AskCoachSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders each question", () => {
    renderComponent(
      <AskCoachSection questions={questions} screenContext="home" />,
    );
    expect(screen.getByText("How much protein today?")).toBeTruthy();
  });

  it("triggers haptics via useHaptics (not raw expo-haptics) and navigates on press", () => {
    renderComponent(
      <AskCoachSection questions={questions} screenContext="home" />,
    );

    fireEvent.click(screen.getByLabelText("How much protein today?"));

    expect(mockImpact).toHaveBeenCalledTimes(1);
    expect(rawImpactAsync).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("CoachChat", {
      question: "protein_today",
      questionText: "How much protein today?",
      screenContext: "home",
    });
  });
});
