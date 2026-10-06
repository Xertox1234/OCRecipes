// @vitest-environment jsdom
//
// QuickLogScreen is reachable without passing Home's locked row: Coach's
// navigation, a recent-action tap, and deep links all open it directly. So the
// premium gate lives on the screen itself, reading the server-resolved,
// expiry-aware feature flag (todos/P2-2026-09-26-quick-log-locked-for-free-tier).
import React from "react";
import { screen } from "@testing-library/react";
import { Platform } from "react-native";
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
  mockToastError,
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
    // 0 = no parse yet this screen mount — matches useQuickLogSession's
    // initial value and keeps the generation-keyed announce effect silent
    // by default.
    parseGeneration: 0,
    parseError: null as string | null,
    submitError: null as string | null,
  },
  mockGoBack: vi.fn(),
  mockToastInfo: vi.fn(),
  mockToastError: vi.fn(),
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
    parseGeneration: sessionHolder.parseGeneration,
    parseError: sessionHolder.parseError,
    parseEmpty: sessionHolder.parseEmpty,
    submitError: sessionHolder.submitError,
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
  useToast: () => ({
    success: vi.fn(),
    error: mockToastError,
    info: mockToastInfo,
  }),
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
    sessionHolder.parseGeneration = 0;
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
    sessionHolder.parseGeneration = 0;
    sessionHolder.parseError = null;
    sessionHolder.submitError = null;
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

  // useQuickLogSession already fires the Error haptic when it sets these
  // (QuickLogDrawer shows them inline and relies on it) — a buzzing toast
  // on top would double-buzz.
  it("toasts parse and submit errors without a second haptic", () => {
    sessionHolder.parseError = "Couldn't understand that.";
    sessionHolder.submitError = "Failed to log some items.";
    renderComponent(<QuickLogScreen />);
    expect(mockToastError).toHaveBeenCalledWith("Couldn't understand that.", {
      haptic: false,
    });
    expect(mockToastError).toHaveBeenCalledWith("Failed to log some items.", {
      haptic: false,
    });
    sessionHolder.parseError = null;
    sessionHolder.submitError = null;
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
    sessionHolder.parseGeneration = 1;
    rerender(<QuickLogScreen />);
    rerender(<QuickLogScreen />);
    expect(mockAnnounce).toHaveBeenCalledTimes(1);
    expect(mockAnnounce).toHaveBeenCalledWith("Found 1 item. Log All to save.");
  });

  // P3-2026-09-29: a second parse used to be silent when it replaced the
  // results without the list passing back through empty — the old guard
  // was keyed on `parsedItems.length > 0` (a discriminator), which never
  // flips for this case. It's keyed on the hook's per-parse generation
  // counter now, so every parse announces, same count or not, with no empty
  // state in between (docs/solutions/logic-errors/imperative-announce-must-
  // be-content-keyed-not-variant-keyed-2026-06-24.md, "Second manifestation").
  describe("a second parse with no empty state in between", () => {
    const originalOS = Platform.OS;

    afterEach(() => {
      Platform.OS = originalOS;
    });

    it("announces again, same count, on iOS", () => {
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
      sessionHolder.parseGeneration = 1;
      const { rerender } = renderComponent(<QuickLogScreen />);
      expect(mockAnnounce).toHaveBeenCalledTimes(1);

      sessionHolder.parsedItems = [
        {
          name: "toast",
          quantity: 1,
          unit: "slice",
          calories: 80,
          protein: 3,
          carbs: 14,
          fat: 1,
          servingSize: null,
        },
      ]; // same count (1)
      sessionHolder.parseGeneration = 2;
      rerender(<QuickLogScreen />);
      expect(mockAnnounce).toHaveBeenCalledTimes(2);
      expect(mockAnnounce).toHaveBeenLastCalledWith(
        "Found 1 item. Log All to save.",
      );
    });

    it("announces again, different count, on iOS", () => {
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
      sessionHolder.parseGeneration = 1;
      const { rerender } = renderComponent(<QuickLogScreen />);
      expect(mockAnnounce).toHaveBeenCalledTimes(1);

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
        {
          name: "toast",
          quantity: 1,
          unit: "slice",
          calories: 80,
          protein: 3,
          carbs: 14,
          fat: 1,
          servingSize: null,
        },
      ]; // different count (2)
      sessionHolder.parseGeneration = 2;
      rerender(<QuickLogScreen />);
      expect(mockAnnounce).toHaveBeenCalledTimes(2);
      expect(mockAnnounce).toHaveBeenLastCalledWith(
        "Found 2 items. Log All to save.",
      );
    });

    // Android relies on the live-region note (below) for the first parse.
    // A same-count replace leaves that note's TEXT unchanged, so TalkBack's
    // live region stays silent — the effect must announce it explicitly.
    it("on Android, explicitly announces a same-count replace", () => {
      Platform.OS = "android";
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
      sessionHolder.parseGeneration = 1;
      const { rerender } = renderComponent(<QuickLogScreen />);
      expect(mockAnnounce).not.toHaveBeenCalled(); // first parse — live region covers the mount

      sessionHolder.parsedItems = [
        {
          name: "toast",
          quantity: 1,
          unit: "slice",
          calories: 80,
          protein: 3,
          carbs: 14,
          fat: 1,
          servingSize: null,
        },
      ]; // same count (1)
      sessionHolder.parseGeneration = 2;
      rerender(<QuickLogScreen />);
      expect(mockAnnounce).toHaveBeenCalledTimes(1);
      expect(mockAnnounce).toHaveBeenCalledWith(
        "Found 1 item. Log All to save.",
      );
    });

    // A count-changing replace already re-reads via the live region — an
    // explicit announce here would double it (docs/rules/accessibility.md).
    it("on Android, does not double-announce a count-changing replace", () => {
      Platform.OS = "android";
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
      sessionHolder.parseGeneration = 1;
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
        {
          name: "toast",
          quantity: 1,
          unit: "slice",
          calories: 80,
          protein: 3,
          carbs: 14,
          fat: 1,
          servingSize: null,
        },
      ]; // different count (2)
      sessionHolder.parseGeneration = 2;
      rerender(<QuickLogScreen />);
      expect(mockAnnounce).not.toHaveBeenCalled();
    });

    // code-reviewer (round 1): the "was this covered by the live region?"
    // comparison must track the CURRENTLY RENDERED count, not the count at
    // the last parse — removeItem changes what's rendered without bumping
    // parseGeneration, so a stale reference goes wrong in both directions.
    it("on Android, still announces a same-count replace after a removeItem changed what's rendered", () => {
      Platform.OS = "android";
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
        {
          name: "bacon",
          quantity: 2,
          unit: "slice",
          calories: 90,
          protein: 6,
          carbs: 0,
          fat: 7,
          servingSize: null,
        },
      ];
      sessionHolder.parseGeneration = 1;
      const { rerender } = renderComponent(<QuickLogScreen />);
      expect(mockAnnounce).not.toHaveBeenCalled(); // first parse — live region covers the mount

      // removeItem: 2 -> 1, no generation bump. The live region's own text
      // now reads "Found 1 item" — it just re-announced on its own.
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
      expect(mockAnnounce).not.toHaveBeenCalled();

      // A second parse replaces the remaining item, same count (1) as
      // what's ACTUALLY showing post-removal — needs the explicit announce.
      sessionHolder.parsedItems = [
        {
          name: "toast",
          quantity: 1,
          unit: "slice",
          calories: 80,
          protein: 3,
          carbs: 14,
          fat: 1,
          servingSize: null,
        },
      ];
      sessionHolder.parseGeneration = 2;
      rerender(<QuickLogScreen />);
      expect(mockAnnounce).toHaveBeenCalledTimes(1);
      expect(mockAnnounce).toHaveBeenCalledWith(
        "Found 1 item. Log All to save.",
      );
    });

    it("on Android, does not double-announce when the second parse's count matches the live region's OWN already-changed text", () => {
      Platform.OS = "android";
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
        {
          name: "bacon",
          quantity: 2,
          unit: "slice",
          calories: 90,
          protein: 6,
          carbs: 0,
          fat: 7,
          servingSize: null,
        },
      ];
      sessionHolder.parseGeneration = 1;
      const { rerender } = renderComponent(<QuickLogScreen />);
      expect(mockAnnounce).not.toHaveBeenCalled();

      // removeItem: 2 -> 1 (live region now reads "Found 1 item").
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

      // A second parse yields 2 items again — different from what's showing
      // (1) — the live region re-reads on its own; the explicit announce
      // must stay silent or it double-announces.
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
        {
          name: "toast",
          quantity: 1,
          unit: "slice",
          calories: 80,
          protein: 3,
          carbs: 14,
          fat: 1,
          servingSize: null,
        },
      ];
      sessionHolder.parseGeneration = 2;
      rerender(<QuickLogScreen />);
      expect(mockAnnounce).not.toHaveBeenCalled();
    });
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
    sessionHolder.parseGeneration = 0;
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
