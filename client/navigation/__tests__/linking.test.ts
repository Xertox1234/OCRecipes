import { describe, it, expect, vi, beforeEach } from "vitest";
// @react-navigation/core is a hard dependency of @react-navigation/native;
// importing native itself pulls React Native sources the node env cannot load.
import { getStateFromPath } from "@react-navigation/core";

// linking.ts now imports react-native's `Linking` for getInitialURL/subscribe.
// The globally-aliased RN mock (test/mocks/react-native.ts) only exports
// `Linking.openURL`/`openSettings` (no `getInitialURL`/`addEventListener`), so
// a local override is required here — see
// docs/solutions/conventions/inline-vi-mock-globally-aliased-modules-2026-05-13.md
// item 3 ("missing exports").
const mockGetInitialURL = vi.fn();
const mockAddEventListener = vi.fn();
vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native")>();
  return {
    ...actual,
    Linking: {
      ...actual.Linking,
      getInitialURL: (...args: unknown[]) => mockGetInitialURL(...args),
      addEventListener: (...args: unknown[]) => mockAddEventListener(...args),
    },
  };
});

const mockGetLastNotificationResponse = vi.fn();
const mockAddNotificationResponseReceivedListener = vi.fn();
vi.mock("expo-notifications", () => ({
  getLastNotificationResponse: () => mockGetLastNotificationResponse(),
  addNotificationResponseReceivedListener: (
    ...args: [(response: unknown) => void]
  ) => mockAddNotificationResponseReceivedListener(...args),
}));

// linking.ts also imports navigationRef to decide whether a live notification
// tap can be delivered immediately or must be held for onReady to flush —
// see client/navigation/linking.ts for why (React Navigation's own
// dispatch/resetRoot silently no-ops, with no retry, before a navigator has
// mounted).
const mockIsReady = vi.fn();
vi.mock("../navigationRef", () => ({
  navigationRef: { isReady: () => mockIsReady() },
}));

const { linking, flushPendingNotificationUrl } = await import("../linking");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("linking config", () => {
  it("includes both custom scheme and universal link prefixes", () => {
    expect(linking.prefixes).toContain("ocrecipes://");
    expect(linking.prefixes).toContain("https://ocrecipes.app");
  });

  it("configures FeaturedRecipeDetail path with numeric parse", () => {
    // Cast: React Navigation's linking config types screen entries as a
    // discriminated union of `string | { path; parse?; screens? }`; narrow to
    // the object variant to read `.path` and `.parse`.
    const recipeDetail = linking.config!.screens
      .FeaturedRecipeDetail as unknown as {
      path: string;
      parse: Record<string, (v: string) => number>;
    };

    expect(recipeDetail.path).toBe("recipe/:recipeId");
    expect(recipeDetail.parse.recipeId("42")).toBe(42);
  });

  it("configures Chat path with numeric parse", () => {
    const chat =
      // @ts-expect-error — nested screen config typing is loosely indexed
      linking.config!.screens.Main.screens.CoachTab.screens.Chat;

    expect(chat.path).toBe("chat/:conversationId");
    expect(chat.parse.conversationId("7")).toBe(7);
  });

  it("configures NutritionDetail as a path string", () => {
    expect(linking.config!.screens.NutritionDetail).toBe("nutrition/:barcode");
  });

  // Query params on a deep link land in route.params unfiltered unless the
  // screen's `parse` config transforms them. ScanScreen forwards
  // verifyBarcode into FrontLabelConfirm and the verification submit, so a
  // link must not be able to pick the barcode a user's label photo is
  // credited to. Run through React Navigation's own parser, not the config
  // shape, so the assertion is on what the app actually receives.
  it("opens Scan from a deep link but drops a link-supplied verifyBarcode", () => {
    const state = getStateFromPath(
      "scan?mode=label&verifyBarcode=0778918011332",
      linking.config,
    );
    const route = state?.routes[0];
    expect(route?.name).toBe("Scan");
    expect(route?.params).toMatchObject({ mode: "label" });
    expect(
      (route?.params as Record<string, unknown> | undefined)?.verifyBarcode,
    ).toBeUndefined();
  });

  // Query values are decoded by query-string → decode-uri-component. Its
  // fallback decoder for malformed input (GHSA-vcc3-ghjq-m6fr, <= 0.4.2) is
  // super-linear: 400 invalid `%C0` tokens took ~2.4s under Node's JIT, so a
  // crafted link could freeze the app. Pin both the fix and that ordinary
  // percent-encoding still decodes after the ESM-only 0.5.0 bump.
  it("decodes a percent-encoded query param from a deep link", () => {
    const state = getStateFromPath(
      "verify-email?token=caf%C3%A9%20au%20lait",
      linking.config,
    );
    expect(state?.routes[0]?.params).toMatchObject({ token: "café au lait" });
  });

  it("parses a deep link with a long malformed percent-encoded query quickly", () => {
    const start = performance.now();
    const state = getStateFromPath(
      `verify-email?token=${"%C0".repeat(400)}`,
      linking.config,
    );
    const elapsedMs = performance.now() - start;
    expect(state?.routes[0]?.name).toBe("VerifyEmail");
    expect(elapsedMs).toBeLessThan(250);
  });

  it("configures AllConversations as a path string", () => {
    expect(linking.config!.screens.AllConversations).toBe("conversation-list");
  });

  it("configures Login as a path string so ocrecipes://login routes to sign-in", () => {
    // Drives the verify-email landing's "Open OCRecipes" success CTA
    // (ocrecipes://login) straight to the Login screen instead of foregrounding
    // the app onto the dead-end "Check your inbox" screen.
    expect(linking.config!.screens.Login).toBe("login");
  });

  it("returns 0 when recipeId parse receives a non-numeric string", () => {
    // Cast: see above — narrow union to the object variant for `.parse`.
    const recipeDetail = linking.config!.screens
      .FeaturedRecipeDetail as unknown as {
      path: string;
      parse: Record<string, (v: string) => number>;
    };

    expect(recipeDetail.parse.recipeId("abc")).toBe(0);
  });

  it("returns 0 when conversationId parse receives a non-numeric string", () => {
    const chat =
      // @ts-expect-error — nested screen config typing is loosely indexed
      linking.config!.screens.Main.screens.CoachTab.screens.Chat;

    expect(chat.parse.conversationId("abc")).toBe(0);
  });
});

// Cold-launch: a tap that launches the app never reaches
// addNotificationResponseReceivedListener in time, so getInitialURL is the
// only path that can see it. Falls back to the notification response when
// there is no real deep link, per the React Navigation 7 +
// expo-notifications integration doc (Context7 "Handle push notifications
// with React Navigation").
describe("getInitialURL", () => {
  it("prefers a real deep link over a notification response — the more specific intent", async () => {
    mockGetInitialURL.mockResolvedValue("ocrecipes://recipe/42");
    mockGetLastNotificationResponse.mockReturnValue({
      notification: { request: { content: { data: { entryId: 7 } } } },
    });

    const url = await linking.getInitialURL!();

    expect(url).toBe("ocrecipes://recipe/42");
    expect(mockGetLastNotificationResponse).not.toHaveBeenCalled();
  });

  it("falls back to the notification response's url when there is no real link", async () => {
    mockGetInitialURL.mockResolvedValue(null);
    mockGetLastNotificationResponse.mockReturnValue({
      notification: {
        request: {
          content: { data: { url: "ocrecipes://notebook-entry/12" } },
        },
      },
    });

    const url = await linking.getInitialURL!();

    expect(url).toBe("ocrecipes://notebook-entry/12");
  });

  // Reminders scheduled before this change carry only `data.entryId` (see
  // client/hooks/useNotebookNotifications.ts) — already-scheduled on-device
  // notifications must keep opening the right entry after this ships.
  it("constructs a notebook-entry URL from a legacy entryId-only payload", async () => {
    mockGetInitialURL.mockResolvedValue(null);
    mockGetLastNotificationResponse.mockReturnValue({
      notification: { request: { content: { data: { entryId: 99 } } } },
    });

    const url = await linking.getInitialURL!();

    expect(url).toBe("ocrecipes://notebook-entry/99");
  });

  it("returns undefined when there is no real link and no notification response", async () => {
    mockGetInitialURL.mockResolvedValue(null);
    mockGetLastNotificationResponse.mockReturnValue(null);

    const url = await linking.getInitialURL!();

    expect(url).toBeUndefined();
  });
});

// These tests assert URL FORWARDING into React Navigation's own `listener`
// callback — the boundary this module owns. They cannot observe whether
// React Navigation subsequently routes to the target screen (e.g. replaying
// after login via UNSTABLE_routeNamesChangeBehavior="lastUnhandled" in
// node_modules/@react-navigation/core/lib/module/useNavigationBuilder.js) —
// that was verified by reading that source, not exercised here. The todo's
// "verify on a simulator" step was not run.
describe("subscribe", () => {
  beforeEach(() => {
    mockAddEventListener.mockReturnValue({ remove: vi.fn() });
    mockAddNotificationResponseReceivedListener.mockReturnValue({
      remove: vi.fn(),
    });
  });

  it("forwards a real deep link URL to the listener", () => {
    const listener = vi.fn();
    linking.subscribe!(listener);

    const onReceiveURL = mockAddEventListener.mock.calls[0][1] as (event: {
      url: string;
    }) => void;
    onReceiveURL({ url: "ocrecipes://recipe/5" });

    expect(listener).toHaveBeenCalledWith("ocrecipes://recipe/5");
  });

  it("forwards a notification response's url to the listener when the navigator is ready", () => {
    mockIsReady.mockReturnValue(true);
    const listener = vi.fn();
    linking.subscribe!(listener);

    const onResponse = mockAddNotificationResponseReceivedListener.mock
      .calls[0][0] as (response: unknown) => void;
    onResponse({
      notification: {
        request: {
          content: { data: { url: "ocrecipes://notebook-entry/3" } },
        },
      },
    });

    expect(listener).toHaveBeenCalledWith("ocrecipes://notebook-entry/3");
  });

  // The failure mode this closes: React Navigation's own subscribe-driven
  // dispatch/resetRoot (useLinking.native.js lines 118-143) silently no-ops —
  // a console.error with no retry — when no navigator has registered a focus
  // listener yet (BaseNavigationContainer.js dispatch/resetRoot, lines
  // 106-137). That window is real but boot-only: client/hooks/useAuth.ts's
  // `isLoading: true` (line 120) is the only place it's ever set — the
  // foreground AppState recheck never sets it back to true, so this is not a
  // recurring "warm, backgrounded" state. A tap arriving in that window must
  // be held rather than hitting the no-op path.
  it("holds a notification url when the navigator is not ready, and flushes it exactly once", () => {
    mockIsReady.mockReturnValue(false);
    const listener = vi.fn();
    linking.subscribe!(listener);

    const onResponse = mockAddNotificationResponseReceivedListener.mock
      .calls[0][0] as (response: unknown) => void;
    onResponse({
      notification: {
        request: {
          content: { data: { url: "ocrecipes://notebook-entry/8" } },
        },
      },
    });

    expect(listener).not.toHaveBeenCalled();

    flushPendingNotificationUrl();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("ocrecipes://notebook-entry/8");

    // A second flush with nothing pending is a no-op, not a re-delivery.
    flushPendingNotificationUrl();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("falls back to a legacy entryId-only payload when holding for a not-ready navigator", () => {
    mockIsReady.mockReturnValue(false);
    const listener = vi.fn();
    linking.subscribe!(listener);

    const onResponse = mockAddNotificationResponseReceivedListener.mock
      .calls[0][0] as (response: unknown) => void;
    onResponse({
      notification: { request: { content: { data: { entryId: 21 } } } },
    });

    flushPendingNotificationUrl();
    expect(listener).toHaveBeenCalledWith("ocrecipes://notebook-entry/21");
  });

  it("removes both the linking and notification subscriptions on cleanup", () => {
    const removeLinking = vi.fn();
    const removeNotification = vi.fn();
    mockAddEventListener.mockReturnValue({ remove: removeLinking });
    mockAddNotificationResponseReceivedListener.mockReturnValue({
      remove: removeNotification,
    });

    const cleanup = linking.subscribe!(vi.fn());
    cleanup!();

    expect(removeLinking).toHaveBeenCalledTimes(1);
    expect(removeNotification).toHaveBeenCalledTimes(1);
  });
});
