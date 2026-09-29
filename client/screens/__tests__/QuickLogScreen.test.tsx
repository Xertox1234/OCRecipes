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
import * as useQuickLogSessionModule from "@/hooks/useQuickLogSession";
import type { ParsedFoodItem } from "@/hooks/useFoodParse";

const {
  premiumHolder,
  sessionHolder,
  mockGoBack,
  mockToastInfo,
  mockAnnounce,
} = vi.hoisted(() => ({
  premiumHolder: {
    isPremium: false,
    textFoodParsing: false,
    isPremiumResolved: true,
  },
  sessionHolder: {
    parseEmpty: false,
    parsedItems: [] as ParsedFoodItem[],
  },
  mockGoBack: vi.fn(),
  mockToastInfo: vi.fn(),
  mockAnnounce: vi.fn(),
}));

// AccessibilityInfo is spied on for the iOS parse-success announcement.
// Other members (isScreenReaderEnabled, addEventListener) are preserved —
// useAccessibility (a real collaborator in this tree) calls them too.
vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    AccessibilityInfo: {
      ...(actual.AccessibilityInfo as object),
      announceForAccessibility: mockAnnounce,
    },
  };
});

vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => ({
    isPremium: premiumHolder.isPremium,
    features: { textFoodParsing: premiumHolder.textFoodParsing },
    isPremiumResolved: premiumHolder.isPremiumResolved,
  }),
}));

vi.mock("@/hooks/useQuickLogSession", () => ({
  EMPTY_PARSE_MESSAGE: "Couldn't find any food in that.",
  useQuickLogSession: vi.fn(() => ({
    inputText: "",
    setInputText: vi.fn(),
    isListening: false,
    volume: -2,
    isParsing: false,
    parsedItems: sessionHolder.parsedItems,
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
  })),
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
    sessionHolder.parsedItems = [];
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
    sessionHolder.parsedItems = [];
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

  // A successful parse fired no announce at all before this — VoiceOver
  // users heard nothing (only the toast covers the empty-result outcome).
  it("announces the item count once when a parse succeeds", () => {
    const { rerender } = renderComponent(<QuickLogScreen />);
    expect(mockAnnounce).not.toHaveBeenCalled();

    sessionHolder.parsedItems = [
      {
        name: "egg",
        quantity: 1,
        unit: "large",
        calories: 72,
        protein: 6,
        carbs: 0,
        fat: 5,
        servingSize: null,
      },
    ];
    rerender(<QuickLogScreen />);
    rerender(<QuickLogScreen />);
    expect(mockAnnounce).toHaveBeenCalledTimes(1);
    expect(mockAnnounce).toHaveBeenCalledWith("Found 1 item. Log All to save.");
  });

  // Android has no imperative announce — the note itself must carry the
  // live region (mirrors QuickLogDrawer's equivalent assertion).
  it("shows the item count as a live-region note", () => {
    sessionHolder.parsedItems = [
      {
        name: "egg",
        quantity: 1,
        unit: "large",
        calories: 72,
        protein: 6,
        carbs: 0,
        fat: 5,
        servingSize: null,
      },
    ];
    renderComponent(<QuickLogScreen />);
    const note = screen.getByText("Found 1 item. Log All to save.");
    expect(note.closest('[aria-live="polite"]')).not.toBeNull();
  });
});

describe("QuickLogScreen — idle query gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionHolder.parseEmpty = false;
    sessionHolder.parsedItems = [];
  });

  // The hook call happens before the isLocked early return, so a locked
  // render must not enable the frequent-items query it gates on `isOpen`.
  it("does not enable the frequent-items query on a locked render", () => {
    premiumHolder.isPremium = false;
    premiumHolder.textFoodParsing = false;
    premiumHolder.isPremiumResolved = true; // locked
    renderComponent(<QuickLogScreen />);
    const lastCall = vi
      .mocked(useQuickLogSessionModule.useQuickLogSession)
      .mock.calls.at(-1)![0];
    expect(lastCall!.isOpen).toBe(false);
  });

  it("enables the frequent-items query on an unlocked render (control)", () => {
    premiumHolder.isPremium = true;
    premiumHolder.textFoodParsing = true;
    premiumHolder.isPremiumResolved = true;
    renderComponent(<QuickLogScreen />);
    const lastCall = vi
      .mocked(useQuickLogSessionModule.useQuickLogSession)
      .mock.calls.at(-1)![0];
    expect(lastCall!.isOpen).toBe(true);
  });
});
