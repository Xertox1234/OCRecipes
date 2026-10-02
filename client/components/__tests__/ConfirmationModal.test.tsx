// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { AccessibilityInfo, View, Text } from "react-native";
import { renderComponent } from "../../../test/utils/render-component";
import { useConfirmationModal } from "../ConfirmationModal";
import type { ConfirmOptions } from "../ConfirmationModal";

// useSheetBackHandler calls useIsFocused (@react-navigation/native), which
// needs a NavigationContainer ancestor the plain renderComponent() wrapper
// doesn't provide — mock it directly rather than pull in a real container.
vi.mock("@react-navigation/native", () => ({
  useIsFocused: () => true,
}));

// Test wrapper that exposes the hook API via a trigger button
function TestHarness({ options }: { options: ConfirmOptions }) {
  const { confirm, ConfirmationModal, behindContentA11yProps, isOpen } =
    useConfirmationModal();
  return (
    <>
      <button onClick={() => confirm(options)} data-testid="trigger">
        Open
      </button>
      {/* Stands in for a host screen's own content — spreads
          behindContentA11yProps the same way the 3 real callers that apply
          it to a plain View/Pressable do (5 more apply it to a FlatList/
          SectionList, 1 to an Animated.View; see the describe block below
          for why this harness can't stand in for those). */}
      <View testID="host-content" {...behindContentA11yProps}>
        <Text>Host screen content</Text>
      </View>
      {/* Stands in for a host screen's `navigation.setOptions()` effect,
          driven by the same `isOpen` those screens destructure — see the
          "isOpen (drives navigator header trap)" describe block below. */}
      <Text testID="is-open">{String(isOpen)}</Text>
      <ConfirmationModal />
    </>
  );
}

function triggerModal() {
  fireEvent.click(screen.getByTestId("trigger"));
}

describe("ConfirmationModal", () => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();

  const defaultOptions: ConfirmOptions = {
    title: "Delete Entry",
    message: "Remove this item?",
    onConfirm,
    onCancel,
    destructive: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders title and message after confirm() is called", () => {
    renderComponent(<TestHarness options={defaultOptions} />);
    triggerModal();
    expect(screen.getByText("Delete Entry")).toBeDefined();
    expect(screen.getByText("Remove this item?")).toBeDefined();
  });

  it("renders default destructive labels (Delete / Cancel)", () => {
    renderComponent(<TestHarness options={defaultOptions} />);
    triggerModal();
    expect(screen.getByText("Delete")).toBeDefined();
    expect(screen.getByText("Cancel")).toBeDefined();
  });

  it("renders custom labels when provided", () => {
    const options: ConfirmOptions = {
      ...defaultOptions,
      confirmLabel: "Remove",
      cancelLabel: "Keep",
    };
    renderComponent(<TestHarness options={options} />);
    triggerModal();
    expect(screen.getByText("Remove")).toBeDefined();
    expect(screen.getByText("Keep")).toBeDefined();
  });

  it("renders non-destructive default label (Confirm)", () => {
    const options: ConfirmOptions = {
      ...defaultOptions,
      destructive: false,
      confirmLabel: undefined,
    };
    renderComponent(<TestHarness options={options} />);
    triggerModal();
    expect(screen.getByText("Confirm")).toBeDefined();
  });

  it("calls onConfirm when confirm button is pressed", () => {
    renderComponent(<TestHarness options={defaultOptions} />);
    triggerModal();
    fireEvent.click(screen.getByText("Delete"));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("has accessible button roles on confirm and cancel", () => {
    renderComponent(<TestHarness options={defaultOptions} />);
    triggerModal();
    const buttons = screen.getAllByRole("button");
    // trigger button + cancel + confirm = at least 3
    expect(buttons.length).toBeGreaterThanOrEqual(3);
  });

  it("renders the bottom sheet modal container", () => {
    renderComponent(<TestHarness options={defaultOptions} />);
    const modal = screen.getByTestId("bottom-sheet-modal");
    expect(modal).toBeDefined();
  });

  it("renders empty content before confirm() is called", () => {
    renderComponent(<TestHarness options={defaultOptions} />);
    // Before triggering, options ref is null → empty strings
    expect(screen.queryByText("Delete Entry")).toBeNull();
  });

  describe("screen-reader announcement on open", () => {
    // The sheet replaced native Alert.alert call sites (issue #908), and
    // Alert.alert got its title/message read aloud by the OS for free. The
    // sheet must announce its own purpose — same delayed pattern and
    // rationale as UpgradeModal (the ~500ms delay outlasts the present
    // animation so iOS VoiceOver doesn't swallow it).
    afterEach(() => {
      vi.useRealTimers();
    });

    it("announces title and message after the open delay", () => {
      vi.useFakeTimers();
      const spy = vi.spyOn(AccessibilityInfo, "announceForAccessibility");
      renderComponent(<TestHarness options={defaultOptions} />);
      triggerModal();
      expect(spy).not.toHaveBeenCalled();
      vi.advanceTimersByTime(500);
      expect(spy).toHaveBeenCalledWith("Delete Entry. Remove this item?");
    });

    it("does not announce when the sheet is dismissed before the delay", () => {
      vi.useFakeTimers();
      const spy = vi.spyOn(AccessibilityInfo, "announceForAccessibility");
      renderComponent(<TestHarness options={defaultOptions} />);
      triggerModal();
      fireEvent.click(screen.getByText("Cancel"));
      vi.advanceTimersByTime(1000);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  it("sets accessible={false} on the sheet so its content is not collapsed into one iOS a11y leaf", () => {
    // On new-arch iOS, @gorhom/bottom-sheet's default accessible=true makes the
    // wrapper an accessibility LEAF, hiding the title/message/buttons from
    // VoiceOver AND Maestro (issue #908 — deterministic on device, invisible to
    // jsdom which renders children plainly). This pins the fix: the modal must
    // pass accessible={false} (NOT null — gorhom does `?? undefined`, so null
    // re-defaults to true). See docs/solutions/logic-errors/
    // gorhom-bottomsheetmodal-collapses-a11y-subtree-on-ios-2026-09-05.md.
    renderComponent(<TestHarness options={defaultOptions} />);
    triggerModal();
    expect(
      screen.getByTestId("bottom-sheet-modal").getAttribute("data-accessible"),
    ).toBe("false");
  });

  it("hides the decorative destructive warning icon from the a11y tree", () => {
    // The alert-triangle glyph repeats nothing beyond the title/message that
    // follow it; unmarked it becomes its own screen-reader focus stop. The
    // jsdom RN mock maps the accessibilityElementsHidden +
    // importantForAccessibility="no-hide-descendants" pair to aria-hidden,
    // which is the assertable signal here.
    renderComponent(<TestHarness options={defaultOptions} />);
    triggerModal();
    const icon = screen.getByTestId("confirmation-modal-destructive-icon");
    expect(icon.getAttribute("aria-hidden")).toBe("true");
  });

  describe("behindContentA11yProps (Android TalkBack / iOS VoiceOver focus trap)", () => {
    // jsdom cannot assert Android focus-trap semantics or TalkBack/VoiceOver
    // reachability (docs/solutions/conventions/
    // jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding-2026-07-03.md).
    // These tests only pin that useConfirmationModal() flips the hiding-prop
    // pair on presented/dismissed — the same aria-hidden mapping the
    // destructive-icon test above relies on — never that a screen reader is
    // actually blocked from reaching the content. Real verification is the
    // on-device uiautomator --compressed diff (see the todo's Acceptance
    // Criteria).
    //
    // Further residual: that prop-plumbing signal only reaches this harness
    // for element types whose mock routes through ariaHiddenProps. Counted
    // per SITE, not per screen — the 8 caller screens hold 23 spread sites:
    //
    //   observable here (23): View 11, Pressable 4, ThemedText 1, ScrollView 1,
    //                         FlatList 4, SectionList 1, Animated.View 1
    //
    // All 23 translate at the mock level since #1225: createFlatListMock
    // (FlatList, BottomSheetFlatList), the hand-written SectionList and the
    // reanimated mock's mapA11yProps route the pair through ariaHiddenProps
    // too, pinned by the contract test at
    // test/mocks/__tests__/a11y-hiding-props.test.tsx. "Observable" means a
    // test CAN see the flip, not that one does: whether each site has a
    // screen-level assertion was not audited.
    it("does not hide the host screen's content before the sheet is presented", () => {
      renderComponent(<TestHarness options={defaultOptions} />);
      const hostContent = screen.getByTestId("host-content");
      expect(hostContent.getAttribute("aria-hidden")).toBeNull();
    });

    it("hides the host screen's content once the sheet is presented", () => {
      renderComponent(<TestHarness options={defaultOptions} />);
      triggerModal();
      const hostContent = screen.getByTestId("host-content");
      expect(hostContent.getAttribute("aria-hidden")).toBe("true");
    });

    it("unhides the host screen's content once the sheet is dismissed", () => {
      renderComponent(<TestHarness options={defaultOptions} />);
      triggerModal();
      fireEvent.click(screen.getByText("Cancel"));
      const hostContent = screen.getByTestId("host-content");
      expect(hostContent.getAttribute("aria-hidden")).toBeNull();
    });
  });

  describe("isOpen (drives navigator header trap)", () => {
    // `useConfirmationModal()` also returns `isOpen` so a host screen whose
    // header is rendered by React Navigation (a sibling
    // `behindContentA11yProps` structurally cannot reach) can drive
    // `navigation.setOptions()` from it — see
    // todos/archive/P2-2026-09-14-confirmation-modal-navigator-header-escapes-talkback-trap.md
    // and the 5 screens that consume it that way (Settings, SavedItems,
    // GroceryLists, Pantry, CookSessionReview). This only pins that the
    // signal flips true/false on presented/dismissed, the same jsdom-visible
    // level the `behindContentA11yProps` tests above pin it at — it does NOT
    // observe any screen's `navigation.setOptions()` call itself. That is a
    // separate, jsdom-observable gap (see
    // client/screens/meal-plan/__tests__/CookbookCreateScreen.test.tsx for
    // the in-repo pattern that asserts a `setOptions` call's payload
    // directly), not something only a device pass could ever verify —
    // closing it needs the 5 screens' own test files. TWO of the five now
    // exist: GroceryListsScreen.header.test.tsx and
    // PantryScreen.header.test.tsx (same directory as the CookbookCreate
    // precedent above) assert that payload for both dual-mounted screens.
    // The gap remains open only for Settings, SavedItems and
    // CookSessionReview.
    it("is false before the sheet is presented", () => {
      renderComponent(<TestHarness options={defaultOptions} />);
      expect(screen.getByTestId("is-open").textContent).toBe("false");
    });

    it("flips true once the sheet is presented", () => {
      renderComponent(<TestHarness options={defaultOptions} />);
      triggerModal();
      expect(screen.getByTestId("is-open").textContent).toBe("true");
    });

    it("flips back to false once the sheet is dismissed", () => {
      renderComponent(<TestHarness options={defaultOptions} />);
      triggerModal();
      fireEvent.click(screen.getByText("Cancel"));
      expect(screen.getByTestId("is-open").textContent).toBe("false");
    });
  });

  // A host compiled by React Compiler caches `<ConfirmationModal />` keyed on
  // the component's (stable) identity, so a host re-render never re-renders
  // the sheet. Vitest doesn't run the compiler, so this harness does the same
  // caching by hand. The uncached TestHarness tests above are the control:
  // same mocks, same hook, only the caching differs.
  describe("inside a host that caches the element (compiled host)", () => {
    function CachedHostHarness({
      first,
      second,
    }: {
      first: ConfirmOptions;
      second: ConfirmOptions;
    }) {
      const { confirm, ConfirmationModal } = useConfirmationModal();
      const sheet = React.useMemo(
        () => <ConfirmationModal />,
        [ConfirmationModal],
      );
      return (
        <>
          <button onClick={() => confirm(first)} data-testid="trigger">
            Open
          </button>
          <button onClick={() => confirm(second)} data-testid="trigger-2">
            Open again
          </button>
          {sheet}
        </>
      );
    }

    const secondOptions: ConfirmOptions = {
      title: "Sign Out",
      message: "Are you sure you want to sign out?",
      confirmLabel: "Yes, Sign Out",
      onConfirm,
    };

    it("shows the title, message and destructive label after confirm()", () => {
      renderComponent(
        <CachedHostHarness first={defaultOptions} second={secondOptions} />,
      );
      triggerModal();
      expect(screen.getByText("Delete Entry")).toBeDefined();
      expect(screen.getByText("Remove this item?")).toBeDefined();
      expect(screen.getByText("Delete")).toBeDefined();
    });

    it("shows the new text when confirm() is called again with other options", () => {
      renderComponent(
        <CachedHostHarness first={defaultOptions} second={secondOptions} />,
      );
      triggerModal();
      fireEvent.click(screen.getByText("Cancel"));
      fireEvent.click(screen.getByTestId("trigger-2"));
      expect(screen.getByText("Sign Out")).toBeDefined();
      expect(
        screen.getByText("Are you sure you want to sign out?"),
      ).toBeDefined();
      expect(screen.getByText("Yes, Sign Out")).toBeDefined();
      expect(screen.queryByText("Delete Entry")).toBeNull();
    });
  });
});
