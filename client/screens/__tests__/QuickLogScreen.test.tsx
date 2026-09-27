// @vitest-environment jsdom
//
// QuickLogScreen is reachable without passing Home's locked row: Coach's
// navigation, a recent-action tap, and deep links all open it directly. So the
// premium gate lives on the screen itself, reading the server-resolved,
// expiry-aware feature flag (todos/P2-2026-09-26-quick-log-locked-for-free-tier).
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import QuickLogScreen from "../QuickLogScreen";
import { UpgradeModal } from "@/components/UpgradeModal";

const { premiumHolder, sessionHolder, mockGoBack, mockToastInfo } = vi.hoisted(
  () => ({
    premiumHolder: {
      isPremium: false,
      textFoodParsing: false,
      isPremiumResolved: true,
    },
    sessionHolder: { parseEmpty: false },
    mockGoBack: vi.fn(),
    mockToastInfo: vi.fn(),
  }),
);

vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => ({
    isPremium: premiumHolder.isPremium,
    features: { textFoodParsing: premiumHolder.textFoodParsing },
    isPremiumResolved: premiumHolder.isPremiumResolved,
  }),
}));

vi.mock("@/hooks/useQuickLogSession", () => ({
  EMPTY_PARSE_MESSAGE: "Couldn't find any food in that.",
  useQuickLogSession: () => ({
    inputText: "",
    setInputText: vi.fn(),
    isListening: false,
    volume: -2,
    isParsing: false,
    parsedItems: [],
    parseError: null,
    parseEmpty: sessionHolder.parseEmpty,
    submitError: null,
    capWarning: null,
    isSubmitting: false,
    speechError: null,
    handleTextSubmit: vi.fn(),
    handleVoicePress: vi.fn(),
    removeItem: vi.fn(),
    handleChipPress: vi.fn(),
    submitLog: vi.fn(),
    reset: vi.fn(),
    frequentItems: [],
  }),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ goBack: mockGoBack, navigate: vi.fn() }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: mockToastInfo }),
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({ impact: vi.fn(), notification: vi.fn() }),
}));

vi.mock("@/hooks/useOfflineGuard", () => ({
  useOfflineGuard: () => ({ isOffline: false, offlineLabel: (l: string) => l }),
}));

vi.mock("@/components/UpgradeModal", () => ({
  UpgradeModal: vi.fn(() => null),
}));
vi.mock("@/components/VoiceLogButton", () => ({ VoiceLogButton: () => null }));
vi.mock("@/components/ParsedFoodPreview", () => ({
  ParsedFoodPreview: () => null,
}));
vi.mock("@/components/AnimatedCheckmark", () => ({
  AnimatedCheckmark: () => null,
}));

const upgradeCalls = () => vi.mocked(UpgradeModal).mock.calls;
const foodInput = () => screen.queryByLabelText("Food description");

describe("QuickLogScreen — premium guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    premiumHolder.isPremium = false;
    premiumHolder.textFoodParsing = false;
    premiumHolder.isPremiumResolved = true;
    sessionHolder.parseEmpty = false;
  });

  it("shows the upgrade flow, not the input, for a free account", () => {
    renderComponent(<QuickLogScreen />);
    expect(upgradeCalls().at(-1)?.[0].visible).toBe(true);
    expect(foodInput()).toBeNull();
  });

  it("gates on the feature flag, so a lapsed subscriber gets the upgrade flow", () => {
    // isPremium can lag a lapse; the server-resolved feature is authoritative.
    premiumHolder.isPremium = true;
    premiumHolder.textFoodParsing = false;
    renderComponent(<QuickLogScreen />);
    expect(upgradeCalls().at(-1)?.[0].visible).toBe(true);
    expect(foodInput()).toBeNull();
  });

  it("closing the upgrade flow leaves the screen", () => {
    renderComponent(<QuickLogScreen />);
    upgradeCalls().at(-1)![0].onClose();
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it("shows the input for premium (control)", () => {
    premiumHolder.isPremium = true;
    premiumHolder.textFoodParsing = true;
    renderComponent(<QuickLogScreen />);
    expect(foodInput()).not.toBeNull();
    expect(upgradeCalls()).toHaveLength(0);
  });

  it("does not flash the upgrade flow before the subscription has loaded", () => {
    premiumHolder.isPremiumResolved = false;
    renderComponent(<QuickLogScreen />);
    expect(foodInput()).not.toBeNull();
    expect(upgradeCalls()).toHaveLength(0);
  });
});

describe("QuickLogScreen — submit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    premiumHolder.isPremium = true;
    premiumHolder.textFoodParsing = true;
    premiumHolder.isPremiumResolved = true;
    sessionHolder.parseEmpty = false;
  });

  // The input is multiline, and RN defaults a multiline input to
  // submitBehavior "newline": the return key would insert a line break and
  // never submit, whatever returnKeyType says.
  it("makes the return key submit, and labels it as submitting", () => {
    renderComponent(<QuickLogScreen />);
    const input = foodInput()!;
    expect(input.getAttribute("submitBehavior")).toBe("blurAndSubmit");
    expect(input.getAttribute("returnKeyType")).toBe("done");
  });

  it("tells the user when a parse found no food", () => {
    sessionHolder.parseEmpty = true;
    renderComponent(<QuickLogScreen />);
    expect(mockToastInfo).toHaveBeenCalledWith(
      "Couldn't find any food in that.",
    );
  });
});
