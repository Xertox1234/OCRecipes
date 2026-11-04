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

const { premium, mockRefreshSubscription, mockToastInfo } = vi.hoisted(() => ({
  premium: { value: { isPremium: true, isPremiumResolved: true } },
  mockRefreshSubscription: vi.fn(),
  mockToastInfo: vi.fn(),
}));

vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => ({
    ...premium.value,
    refreshSubscription: mockRefreshSubscription,
  }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: mockToastInfo }),
}));

// UpgradeModal pulls in the full IAP/premium hook chain, so it's stubbed out
// like other consumers do; it renders a marker only while visible.
vi.mock("@/components/UpgradeModal", () => ({
  UpgradeModal: ({ visible }: { visible: boolean }) =>
    visible ? "upgrade-modal-open" : null,
}));

const questions: readonly CoachQuestion[] = [
  { text: "How much protein today?", question: "protein_today" },
];

describe("AskCoachSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    premium.value = { isPremium: true, isPremiumResolved: true };
  });

  it("opens the upgrade prompt for a user resolved as free", () => {
    premium.value = { isPremium: false, isPremiumResolved: true };
    renderComponent(
      <AskCoachSection questions={questions} screenContext="home" />,
    );
    fireEvent.click(screen.getByLabelText("How much protein today?"));
    expect(screen.getByText("upgrade-modal-open")).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  // A paying user whose status fetch failed must not see the upgrade wall
  // (audit 2026-10-29 M-crel-6): the tap re-checks the plan instead.
  it("re-checks the plan instead of showing the upgrade prompt while status is unknown", () => {
    premium.value = { isPremium: false, isPremiumResolved: false };
    renderComponent(
      <AskCoachSection questions={questions} screenContext="home" />,
    );
    fireEvent.click(screen.getByLabelText("How much protein today?"));

    expect(screen.queryByText("upgrade-modal-open")).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockRefreshSubscription).toHaveBeenCalledTimes(1);
    expect(mockToastInfo).toHaveBeenCalledTimes(1);
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
