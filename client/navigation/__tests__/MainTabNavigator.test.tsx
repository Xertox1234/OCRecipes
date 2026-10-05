// @vitest-environment jsdom
import React from "react";
import {
  screen,
  fireEvent,
  render,
  act,
  waitFor,
} from "@testing-library/react";
// @react-navigation/core re-exports the pure router package (CommonActions,
// StackRouter) and is the declared dependency; native re-exports it unchanged
// and also loads in this harness since #1214, but imports far more.
import { CommonActions, StackRouter } from "@react-navigation/core";
import { renderComponent } from "../../../test/utils/render-component";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";
import {
  clearCoachReplyUnread,
  markCoachReplyUnread,
  noteCoachReplyFinished,
  viewCoachConversation,
} from "@/hooks/useCoachUnreadReplies";
import MainTabNavigator from "../MainTabNavigator";
import { getChatRouteId } from "../chatRouteId";

/**
 * Pins the wiring seam a pure `getTabContentA11y` unit test can't cover:
 * that MainTabNavigator actually lifts `menuOpen` state, threads it into the
 * wrapper `View` around `Tab.Navigator`, and threads open/close callbacks
 * into `ScanFAB` — not just that the pure function returns the right value
 * in isolation. See docs/solutions/conventions/
 * pure-utils-extraction-tests-dont-prove-wiring-2026-07-14.md.
 *
 * `@react-navigation/bottom-tabs` and the four tab-stack navigators are
 * mocked to thin doubles (same pattern as ChatStackNavigator.test.tsx) so
 * this asserts the actual wiring, not the navigators' own behavior — each
 * already has its own coverage.
 */

const { mockReminders, mockToast, mockNavigationRef } = vi.hoisted(() => ({
  // The reminders hook's answer — mutable so a test can turn the dot on.
  mockReminders: { hasPending: false },
  // One stable object, like the real useToast() (memoized in ToastProvider).
  mockToast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
  },
  mockNavigationRef: { isReady: vi.fn(() => true), navigate: vi.fn() },
}));

vi.mock("@react-navigation/bottom-tabs", () => ({
  createBottomTabNavigator: () => ({
    Navigator: ({ children }: { children?: React.ReactNode }) => (
      <div data-testid="tab-navigator">{children}</div>
    ),
    // Marker double that exposes the per-screen options this suite pins.
    Screen: ({
      name,
      options,
    }: {
      name: string;
      options?: {
        tabBarAccessibilityLabel?: string;
        tabBarButtonTestID?: string;
        tabBarIcon?: (props: {
          color: string;
          size: number;
          focused: boolean;
        }) => React.ReactNode;
      };
    }) => (
      <div
        data-testid={`tab-screen-${name}`}
        data-a11y-label={options?.tabBarAccessibilityLabel}
        data-button-testid={options?.tabBarButtonTestID}
      >
        {/* Only the Coach tab's icon carries the dot under test. */}
        {name === "CoachTab"
          ? options?.tabBarIcon?.({ color: "#000", size: 24, focused: false })
          : null}
      </div>
    ),
  }),
}));

vi.mock("@/navigation/HomeStackNavigator", () => ({ default: () => null }));
vi.mock("@/navigation/MealPlanStackNavigator", () => ({
  default: () => null,
}));
vi.mock("@/navigation/ChatStackNavigator", () => ({ default: () => null }));
vi.mock("@/navigation/ProfileStackNavigator", () => ({
  default: () => null,
}));

vi.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({
    theme: {
      link: "#000",
      tabIconDefault: "#666",
      backgroundSecondary: "#fff",
      backgroundDefault: "#fff",
    },
    isDark: false,
  }),
}));

vi.mock("@/hooks/useAccessibility", () => ({
  useAccessibility: () => ({ reducedMotion: false }),
}));

vi.mock("@/hooks/usePendingReminders", () => ({
  usePendingReminders: () => ({ hasPending: mockReminders.hasPending }),
}));

// The real ToastContext pulls in Toast.tsx (Reanimated, gesture handler); the
// real navigationRef is never ready without a mounted NavigationContainer, so
// the mock stands in to record the bridge's navigate call. Both are consumed
// by the "Coach replied" bridge below.
vi.mock("@/context/ToastContext", () => ({ useToast: () => mockToast }));
vi.mock("@/navigation/navigationRef", () => ({
  navigationRef: mockNavigationRef,
}));

vi.mock("@/components/ScanFAB", () => ({
  ScanFAB: ({
    onOpen,
    onClose,
  }: {
    menuOpen: boolean;
    onOpen: () => void;
    onClose: () => void;
  }) => (
    <div data-testid="scan-fab-mock">
      <button onClick={onOpen}>open-scan-menu</button>
      <button onClick={onClose}>close-scan-menu</button>
    </div>
  ),
}));

beforeEach(() => {
  mockReminders.hasPending = false;
  mockNavigationRef.isReady.mockReturnValue(true);
});

describe("MainTabNavigator — Android accessibility trap for the tab content behind the scan menu", () => {
  it("hides the tab content from the accessibility tree once the scan menu opens, and restores it on close", () => {
    renderComponent(<MainTabNavigator />);

    const tabContent = screen.getByTestId("tab-content-a11y-wrapper");
    // The mock omits the attribute entirely rather than setting it "false" —
    // absence is the restore/auto state, per test/mocks/react-native.ts's
    // ariaHiddenProps helper.
    expect(tabContent.getAttribute("aria-hidden")).toBeNull();

    fireEvent.click(screen.getByText("open-scan-menu"));
    expect(tabContent.getAttribute("aria-hidden")).toBe("true");

    fireEvent.click(screen.getByText("close-scan-menu"));
    expect(tabContent.getAttribute("aria-hidden")).toBeNull();
  });

  it("keeps ScanFAB outside the hidden wrapper — it must stay reachable to close the menu", () => {
    // Structural guard for the "same-level sibling, not reparented" invariant
    // the wrapper's paint-safety comment in MainTabNavigator.tsx depends on:
    // if ScanFAB ever moved inside the a11y wrapper, it would be hidden from
    // TalkBack along with the tab content it's supposed to let you escape.
    renderComponent(<MainTabNavigator />);

    const tabContent = screen.getByTestId("tab-content-a11y-wrapper");
    const scanFab = screen.getByTestId("scan-fab-mock");
    expect(tabContent.contains(scanFab)).toBe(false);
  });
});

describe("MainTabNavigator — tab button accessibility labels and testIDs", () => {
  // This harness proves one thing: MainTabNavigator wires explicit
  // tabBarAccessibilityLabel/tabBarButtonTestID values into each Tab.Screen's
  // options (bottom-tabs itself is mocked out above). WHY they must be
  // explicit is source-reasoned, not observed here: the custom tabBarLabel
  // render FUNCTION makes bottom-tabs' derived label undefined
  // (BottomTabBar.tsx only synthesizes one from string labels), which on
  // Android surfaced as aggregated ", Plan"-style contentDescriptions with
  // no automation handle — see the E2E todo's evidence chain. The E2E flows
  // tap tabs by these testIDs.
  it.each([
    ["HomeTab", "Home", "tab-home"],
    ["MealPlanTab", "Plan", "tab-plan"],
    ["CoachTab", "Coach", "tab-coach"],
    ["ProfileTab", "Profile", "tab-profile"],
  ])(
    "%s exposes accessibilityLabel %j and testID %j",
    (name, label, testID) => {
      renderComponent(<MainTabNavigator />);

      const marker = screen.getByTestId(`tab-screen-${name}`);
      expect(marker.getAttribute("data-a11y-label")).toBe(label);
      expect(marker.getAttribute("data-button-testid")).toBe(testID);
    },
  );
});

// TanStack batches observer notifications onto a macrotask (notifyManager's
// default scheduler is setTimeout 0), so a cache write reaches React one task
// later. The app is unaffected; a test flushes it before asserting.
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

function renderWithClient() {
  const { queryClient, wrapper } = createQueryWrapper();
  const utils = render(<MainTabNavigator />, { wrapper });
  return { queryClient, ...utils };
}

// P2-2026-09-29: the Coach tab's dot already meant "a reminder is waiting".
// An unread Coach reply composes with it: ONE dot for either, and the tab's
// spoken label carries the reply (the reminder dot never had a label, and its
// behaviour is unchanged).
describe("MainTabNavigator — Coach tab dot", () => {
  const coachTab = () => screen.getByTestId("tab-screen-CoachTab");
  const dots = () => screen.queryAllByTestId("coach-tab-dot");

  it("shows no dot and the plain label when nothing needs attention", () => {
    renderWithClient();

    expect(dots()).toHaveLength(0);
    expect(coachTab().getAttribute("data-a11y-label")).toBe("Coach");
  });

  it("shows the dot for pending reminders alone, with the label unchanged", () => {
    mockReminders.hasPending = true;

    renderWithClient();

    expect(dots()).toHaveLength(1);
    expect(coachTab().getAttribute("data-a11y-label")).toBe("Coach");
  });

  it("shows the dot, and says so in the tab's label, while a Coach reply is unread", async () => {
    const { queryClient } = renderWithClient();

    act(() => {
      markCoachReplyUnread(queryClient, 5);
    });

    await waitFor(() => expect(dots()).toHaveLength(1));
    // "Coach" stays the prefix, so the accessible name still contains the
    // visible label (WCAG 2.5.3 Label in Name).
    expect(coachTab().getAttribute("data-a11y-label")).toBe("Coach, new reply");
  });

  it("shows ONE dot, not two, when a reminder and an unread reply are both pending", async () => {
    mockReminders.hasPending = true;
    const { queryClient } = renderWithClient();

    act(() => {
      markCoachReplyUnread(queryClient, 5);
    });

    await waitFor(() =>
      expect(coachTab().getAttribute("data-a11y-label")).toBe(
        "Coach, new reply",
      ),
    );
    expect(dots()).toHaveLength(1);
  });

  it("drops the dot once the last unread reply is cleared — but not while another is still unread", async () => {
    const { queryClient } = renderWithClient();
    act(() => {
      markCoachReplyUnread(queryClient, 5);
      markCoachReplyUnread(queryClient, 8);
    });
    await waitFor(() => expect(dots()).toHaveLength(1));

    act(() => {
      clearCoachReplyUnread(queryClient, 5);
    });
    await settle();
    expect(dots()).toHaveLength(1);

    act(() => {
      clearCoachReplyUnread(queryClient, 8);
    });
    await waitFor(() => expect(dots()).toHaveLength(0));
    expect(coachTab().getAttribute("data-a11y-label")).toBe("Coach");
  });

  it("leaves a pending reminder's dot up when the last unread reply clears", async () => {
    mockReminders.hasPending = true;
    const { queryClient } = renderWithClient();
    act(() => {
      markCoachReplyUnread(queryClient, 5);
    });
    await waitFor(() =>
      expect(coachTab().getAttribute("data-a11y-label")).toBe(
        "Coach, new reply",
      ),
    );

    act(() => {
      clearCoachReplyUnread(queryClient, 5);
    });
    await waitFor(() =>
      expect(coachTab().getAttribute("data-a11y-label")).toBe("Coach"),
    );

    expect(dots()).toHaveLength(1);
  });
});

// P2-2026-09-29: the toast half. The reply finishes inside a streaming XHR
// callback, outside the React tree, so useSendMessage publishes to a
// module-level emitter and this navigator — mounted only while signed in, so
// the subscription drops on logout — turns it into a toast with an action.
describe("MainTabNavigator — Coach reply ready toast", () => {
  const MESSAGE = "Coach replied — tap to open";

  function openAction() {
    const [, options] = mockToast.info.mock.calls[0] as [
      string,
      { action: { label: string; onPress: () => void } },
    ];
    return options.action;
  }

  it("raises a toast with an Open action when a Coach reply finishes away from its chat", async () => {
    const { queryClient } = renderWithClient();

    act(() => {
      noteCoachReplyFinished(queryClient, 5);
    });
    await settle();

    expect(mockToast.info).toHaveBeenCalledOnce();
    expect(mockToast.info).toHaveBeenCalledWith(MESSAGE, {
      action: { label: "Open", onPress: expect.any(Function) },
    });
  });

  it("raises nothing while the user is on that conversation", async () => {
    const { queryClient } = renderWithClient();
    viewCoachConversation(queryClient, 5);

    act(() => {
      noteCoachReplyFinished(queryClient, 5);
    });
    await settle();

    expect(mockToast.info).not.toHaveBeenCalled();
  });

  it("tapping Open goes to that conversation through the nested route, popping back to the existing Main", async () => {
    const { queryClient } = renderWithClient();
    act(() => {
      noteCoachReplyFinished(queryClient, 5);
    });
    await settle();

    openAction().onPress();

    // Nested form: a bare navigate("Chat") from outside the Coach stack is
    // silently dropped (bare-navigate-cannot-descend-into-an-unrelated-nested-
    // navigator). `pop: true` returns to the existing Main instead of pushing
    // a second one when a root modal is open (next test).
    expect(mockNavigationRef.navigate).toHaveBeenCalledOnce();
    expect(mockNavigationRef.navigate).toHaveBeenCalledWith(
      "Main",
      {
        screen: "CoachTab",
        // The nested `pop` is the one the Coach stack sees (the outer one stops
        // at the root stack); with `getId` on Chat it pops back to an existing
        // Chat for that conversation instead of moving it to the top.
        params: { screen: "Chat", params: { conversationId: 5 }, pop: true },
      },
      { pop: true },
    );
    expect(mockNavigationRef.navigate).not.toHaveBeenCalledWith(
      "Chat",
      expect.anything(),
    );
  });

  // A mocked navigationRef cannot tell "return to the existing Main" from
  // "push a second Main": both are one navigate() call. So run the exact
  // arguments the tap produced through the REAL root StackRouter (a pure
  // reducer), with the modal open and with it closed, plus the no-pop control.
  describe("against the real root StackRouter", () => {
    const routerOptions = {
      routeNames: ["Main", "Scan"],
      routeParamList: {},
      routeGetIdList: {},
    };
    const router = StackRouter({});
    const names = (state: { routes: { name: string }[] }) =>
      state.routes.map((route) => route.name);

    async function tappedArgs() {
      const { queryClient } = renderWithClient();
      act(() => {
        noteCoachReplyFinished(queryClient, 5);
      });
      await settle();
      openAction().onPress();
      return mockNavigationRef.navigate.mock.calls[0] as [
        string,
        Record<string, unknown>,
        { pop?: boolean } | undefined,
      ];
    }

    function rootState(withModal: boolean) {
      const main = router.getInitialState(routerOptions);
      if (!withModal) return main;
      const stacked = router.getStateForAction(
        main,
        CommonActions.navigate("Scan"),
        routerOptions,
      );
      // `getStateForAction` may answer with a partial state; a pushed route is
      // always a full one, so narrow on `stale` for the next dispatch.
      if (!stacked || stacked.stale !== false) {
        throw new Error("expected the modal route to be pushed");
      }
      // Positive control: the modal really is on top of Main.
      expect(names(stacked)).toEqual(["Main", "Scan"]);
      return stacked;
    }

    it("plain case: stays on the one Main and delivers the nested params to it", async () => {
      const [name, params, options] = await tappedArgs();

      const next = router.getStateForAction(
        rootState(false),
        CommonActions.navigate(name, params, options),
        routerOptions,
      )!;

      expect(names(next)).toEqual(["Main"]);
      expect(next.routes[0].params).toEqual(params);
    });

    it("modal open when tapped: pops back to the existing Main instead of pushing a second one", async () => {
      const [name, params, options] = await tappedArgs();

      const next = router.getStateForAction(
        rootState(true),
        CommonActions.navigate(name, params, options),
        routerOptions,
      )!;

      expect(names(next)).toEqual(["Main"]);
      expect(next.routes[0].params).toEqual(params);

      // Control: the same payload WITHOUT pop stacks a second Main on the modal.
      const withoutPop = router.getStateForAction(
        rootState(true),
        CommonActions.navigate(name, params),
        routerOptions,
      )!;
      expect(names(withoutPop)).toEqual(["Main", "Scan", "Main"]);
    });
  });

  // Same recipe one level down: the nested action the Coach stack receives is
  // derived FROM THE TAPPED ARGS the way useNavigationBuilder does (name =
  // params.screen, params = params.params, pop = params.pop). The
  // `routeGetIdList: {}` runs are the denominator: they reproduce the re-point
  // the `getId` fix removes.
  describe("against the real Coach StackRouter", () => {
    const routeNames = ["ChatList", "Chat", "CoachPro", "GroceryLists"];
    const withGetId = {
      routeNames,
      routeParamList: {},
      routeGetIdList: { Chat: getChatRouteId },
    };
    const withoutGetId = { ...withGetId, routeGetIdList: {} };
    const router = StackRouter({});
    const names = (state: { routes: { name: string }[] }) =>
      state.routes.map((route) => route.name);

    async function nestedAction(stripPop = false) {
      const { queryClient } = renderWithClient();
      act(() => {
        noteCoachReplyFinished(queryClient, 5);
      });
      await settle();
      openAction().onPress();
      const [, params] = mockNavigationRef.navigate.mock.calls[0] as [
        string,
        { params: { screen: string; params: object; pop?: boolean } },
      ];
      const nested = params.params;
      return CommonActions.navigate({
        name: nested.screen,
        params: nested.params,
        pop: stripPop ? undefined : nested.pop,
      });
    }

    // Build a Coach stack by dispatching real navigate actions.
    function stackOf(...steps: [string, object | undefined][]) {
      let state = router.getInitialState(withGetId);
      for (const [name, params] of steps) {
        const next = router.getStateForAction(
          state,
          CommonActions.navigate(name, params),
          withGetId,
        );
        // A pushed route is always a full state; narrow on `stale`.
        if (!next || next.stale !== false) {
          throw new Error(`expected ${name} to be pushed`);
        }
        state = next;
      }
      if (state.stale !== false) throw new Error("expected a full state");
      return state;
    }

    it("a different conversation is pushed, leaving the current Chat untouched", async () => {
      const state = stackOf(["Chat", { conversationId: 7 }]);
      const action = await nestedAction();

      const next = router.getStateForAction(state, action, withGetId)!;

      expect(names(next)).toEqual(["ChatList", "Chat", "Chat"]);
      expect(next.routes[1].key).toBe(state.routes[1].key);
      expect(next.routes[1].params).toEqual({ conversationId: 7 });
      expect(next.routes[2].params).toEqual({ conversationId: 5 });
    });

    it("control (no getId): the same action re-points the current Chat in place", async () => {
      const state = stackOf(["Chat", { conversationId: 7 }]);
      const action = await nestedAction();

      const next = router.getStateForAction(state, action, withoutGetId)!;

      expect(names(next)).toEqual(["ChatList", "Chat"]);
      expect(next.routes[1].key).toBe(state.routes[1].key);
      expect(next.routes[1].params).toEqual({ conversationId: 5 });
    });

    it("the same conversation reuses its route (no duplicate)", async () => {
      const state = stackOf(["Chat", { conversationId: 5 }]);
      const action = await nestedAction();

      const next = router.getStateForAction(state, action, withGetId)!;

      expect(names(next)).toEqual(["ChatList", "Chat"]);
      expect(next.routes[1].key).toBe(state.routes[1].key);
      expect(next.routes[1].params).toEqual({ conversationId: 5 });
    });

    it("pop is forwarded: pops back to the existing Chat, discarding what sits above it", async () => {
      const state = stackOf(
        ["Chat", { conversationId: 5 }],
        ["GroceryLists", undefined],
      );
      expect(names(state)).toEqual(["ChatList", "Chat", "GroceryLists"]);
      const action = await nestedAction();

      const next = router.getStateForAction(state, action, withGetId)!;

      expect(names(next)).toEqual(["ChatList", "Chat"]);
      expect(next.routes[1].key).toBe(state.routes[1].key);
      expect(next.routes[1].params).toEqual({ conversationId: 5 });

      // Control: with the nested pop stripped the route is MOVED to the top.
      const stripped = router.getStateForAction(
        state,
        await nestedAction(true),
        withGetId,
      )!;
      expect(names(stripped)).toEqual(["ChatList", "GroceryLists", "Chat"]);
    });
  });

  it("does not navigate before the navigation container is ready", async () => {
    mockNavigationRef.isReady.mockReturnValue(false);
    const { queryClient } = renderWithClient();
    act(() => {
      noteCoachReplyFinished(queryClient, 5);
    });
    await settle();

    openAction().onPress();

    expect(mockNavigationRef.navigate).not.toHaveBeenCalled();
  });

  it("stops listening once the tab navigator unmounts (signing out drops the subscription)", async () => {
    const { queryClient, unmount } = renderWithClient();
    unmount();

    noteCoachReplyFinished(queryClient, 5);
    await settle();

    expect(mockToast.info).not.toHaveBeenCalled();
  });
});
