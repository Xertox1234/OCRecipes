import type { LinkingOptions } from "@react-navigation/native";
// Import the real parser from @react-navigation/core, NOT @react-navigation/native:
// core is the declared dependency (package.json) that owns getStateFromPath, and
// native re-exports the identical function unchanged. Importing from native would
// also load in the Vitest harness (since #1214 inlined @react-navigation/* in
// vitest.config.mts) but would pull native's whole NavigationContainer/Link module
// graph for one function. client/navigation/__tests__/linking.test.ts imports from
// core for the same reason.
import { getStateFromPath as getStateFromPathDefault } from "@react-navigation/core";
import { Linking } from "react-native";
import * as Notifications from "expo-notifications";
import type { RootStackParamList } from "./RootStackNavigator";
import { navigationRef } from "./navigationRef";

function parseIntOrZero(value: string): number {
  const num = parseInt(value, 10);
  return Number.isNaN(num) ? 0 : num;
}

// decode-uri-component 0.5.0 (PR #1054, GHSA-vcc3-ghjq-m6fr) closed the
// repeated-malformed-run shape but is still O(entries * length) on distinct
// malformed percent runs: query-string.parse (used internally by
// getStateFromPath to parse the query string) built a `replaceMap` entry per
// distinct run and re-scanned the whole input once per entry. A ~200 KB link
// with many distinct runs can stall the JS thread for over a second even on
// V8; Hermes is slower. Reject before the real parser ever sees the input.
//
// The real verify-email link (this app's longest legitimate deep link) is
// ~427 chars: a JWT from server/lib/verification-token.ts's
// signVerificationToken, appended by server/services/email.ts as
// `verify-email?token=<token>`. Every other configured path
// (recipe/:id, chat/:id, notebook-entry/:id, scan?mode=...) is far shorter.
// 8 KB leaves >18x headroom over the longest real link while still capping
// the attack payload's cost. Measured on Node's V8 JIT (Hermes is slower):
// a 208,019-char, 16,000-distinct-run payload through this same
// getStateFromPath takes ~1.5-1.8s without this cap; the worst payload the
// cap still lets through (628 distinct runs, 8,183 chars) parses in ~6ms.
// Neither figure is measured on Hermes; expect it slower, but the capped
// bound (~5M character scans) should stay well under a second.
export const MAX_DEEP_LINK_PATH_LENGTH = 8 * 1024;

// Both delivery paths now send `data.url`: the client's own
// scheduleCommitmentReminder (client/hooks/useNotebookNotifications.ts) and
// the server-driven push (server/services/notification-scheduler.ts). This
// entryId fallback remains for notifications already sitting on a device
// from before either path sent `url` (entryId-only payloads), and as
// defense-in-depth for any sender that omits it. Build the equivalent
// full-prefix URL from that shape so those notifications keep opening the
// right entry — `extractPathFromURL` (used internally by React Navigation to
// match a URL against `prefixes`) returns undefined for a string matching
// none of them, so a bare path/id here would silently fail to route.
function extractNotificationUrl(
  data: Record<string, unknown> | undefined,
): string | undefined {
  if (!data) return undefined;
  if (typeof data.url === "string") return data.url;
  // Positive integers only, matching parseIntOrZero's "not a positive
  // integer" convention: notebook-entry/0 would open an entry that can't save.
  const entryId = Number(data.entryId);
  if (Number.isInteger(entryId) && entryId > 0) {
    return `ocrecipes://notebook-entry/${entryId}`;
  }
  return undefined;
}

// expo-notifications keeps the last response in memory for the whole process.
// Once we've turned it into a URL, clear it: otherwise any NavigationContainer
// remount (e.g. ErrorBoundary's "Try Again") re-runs getInitialURL and
// re-opens the same entry — the very screen that may have crashed.
function consumeNotificationUrl(
  data: Record<string, unknown> | undefined,
): string | undefined {
  const url = extractNotificationUrl(data);
  if (url) Notifications.clearLastNotificationResponse();
  return url;
}

// A notification response tapped while the root navigator hasn't mounted yet
// — the window before AuthContext's first checkAuth() resolves
// (client/hooks/useAuth.ts; isLoading is only ever true there, never reset to
// true again on a foreground resume, so this is a boot-only window, not a
// recurring "warm" state) — reaches this module's `subscribe` listener, but
// React Navigation's own dispatch/resetRoot
// (@react-navigation/native useLinking.native.js) silently no-ops (a
// console.error with no retry) when no navigator has registered a focus
// listener yet (@react-navigation/core BaseNavigationContainer.js). There is
// no queueing in React Navigation itself for this case, so we hold the URL
// here and replay it once `navigationRef.isReady()` flips true, via
// NavigationContainer's `onReady` prop (wired in App.tsx). This is a
// deliberate, narrow deviation from the vanilla getInitialURL/subscribe
// example: that pattern alone covers a cold launch (via
// UNSTABLE_routeNamesChangeBehavior="lastUnhandled") but not a live tap
// arriving before the root navigator has mounted.
let pendingNotificationUrl: string | undefined;
let deliverUrl: ((url: string) => void) | undefined;

/** Wired to NavigationContainer's `onReady` prop in App.tsx. */
export function flushPendingNotificationUrl(): void {
  if (pendingNotificationUrl && deliverUrl) {
    const url = pendingNotificationUrl;
    pendingNotificationUrl = undefined;
    deliverUrl(url);
  }
}

// Route params a link must never supply, by screen. RecipeChatScreen and
// ChatScreen auto-send initialMessage as the user's own message; the remix
// params are in-app only (a recipe's Remix button). The `() => undefined`
// parse entries below drop a single occurrence, but a repeated query key
// (`?initialMessage=a&initialMessage=b`) arrives as an array, and the default
// parser only runs `parse` on string values. So strip by key here, on the
// parsed state, whatever the value's type.
const LINK_STRIPPED_PARAMS: Record<string, readonly string[]> = {
  Chat: ["initialMessage"],
  RecipeChat: [
    "initialMessage",
    "remixSourceRecipeId",
    "remixSourceRecipeTitle",
  ],
};

type ParsedLinkState = ReturnType<typeof getStateFromPathDefault>;

function stripLinkOnlyParams(state: ParsedLinkState): ParsedLinkState {
  for (const route of state?.routes ?? []) {
    const stripped = LINK_STRIPPED_PARAMS[route.name];
    if (stripped && route.params) {
      const params = { ...(route.params as Record<string, unknown>) };
      for (const key of stripped) delete params[key];
      (route as { params?: object }).params = params;
    }
    if (route.state) stripLinkOnlyParams(route.state as ParsedLinkState);
  }
  return state;
}

export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ["ocrecipes://", "https://ocrecipes.app"],
  // Every URL source — a real Linking event, a notification's data.url or
  // entryId-derived URL surfaced via getInitialURL, and a held tap replayed
  // by flushPendingNotificationUrl — funnels through this same
  // getStateFromPath: @react-navigation/native's useLinking.native.js calls
  // extractPathFromURL(prefixes, url) then getStateFromPathRef.current(path,
  // config) for BOTH getInitialState and the subscribe listener, so one
  // length check here covers every entry point without touching them
  // individually. extractPathFromURL itself is linear (split + regex, no
  // percent-decoding), so this is the first expensive point in the chain.
  getStateFromPath(path, options) {
    if (path.length > MAX_DEEP_LINK_PATH_LENGTH) {
      return undefined;
    }
    // The default parser calls decodeURIComponent on path params with no
    // try/catch, and useLinking.native.js calls this OUTSIDE its own try on a
    // live Linking event, so a malformed escape (e.g. `nutrition/%C0`) threw
    // an uncaught URIError on a single tap. Ignore such a link, like an
    // over-cap one. Only URIError: a real config bug should still surface.
    try {
      return stripLinkOnlyParams(getStateFromPathDefault(path, options));
    } catch (error) {
      if (error instanceof URIError) return undefined;
      throw error;
    }
  },
  async getInitialURL() {
    // A real deep link wins if both are somehow present — it's the more
    // specific intent.
    const url = await Linking.getInitialURL();
    if (url != null) return url;

    const response = Notifications.getLastNotificationResponse();
    return consumeNotificationUrl(
      response?.notification.request.content.data as
        | Record<string, unknown>
        | undefined,
    );
  },
  subscribe(listener) {
    deliverUrl = listener;

    const onReceiveURL = ({ url }: { url: string }) => listener(url);
    const linkingSubscription = Linking.addEventListener("url", onReceiveURL);

    const notificationSubscription =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const url = consumeNotificationUrl(
          response.notification.request.content.data as
            | Record<string, unknown>
            | undefined,
        );
        if (!url) return;
        if (navigationRef.isReady()) {
          listener(url);
        } else {
          pendingNotificationUrl = url;
        }
      });

    return () => {
      deliverUrl = undefined;
      pendingNotificationUrl = undefined;
      linkingSubscription.remove();
      notificationSubscription.remove();
    };
  },
  config: {
    screens: {
      Main: {
        screens: {
          CoachTab: {
            screens: {
              // initialMessage is auto-sent by ChatScreen: a link must not
              // post text to the AI as the user's own message. This drops a
              // single occurrence; stripLinkOnlyParams drops a repeated one.
              Chat: {
                path: "chat/:conversationId",
                parse: {
                  conversationId: parseIntOrZero,
                  initialMessage: () => undefined,
                },
              },
            },
          },
        },
      },
      FeaturedRecipeDetail: {
        path: "recipe/:recipeId",
        parse: {
          recipeId: parseIntOrZero,
          type: (value: string) =>
            value === "mealPlan" ? "mealPlan" : "community",
          // Same mapping for the recipeType alias: a link must never select
          // "catalog" (a Spoonacular preview spends shared quota on open).
          recipeType: (value: string) =>
            value === "mealPlan" ? "mealPlan" : "community",
        },
      },
      // Same for RecipeChatScreen's auto-sent initialMessage. The remix params
      // are in-app only (a recipe's Remix button), so links drop them too.
      // Single occurrences are dropped here; stripLinkOnlyParams drops
      // repeated ones.
      RecipeChat: {
        path: "recipe-chat/:conversationId?",
        parse: {
          conversationId: parseIntOrZero,
          initialMessage: () => undefined,
          remixSourceRecipeId: () => undefined,
          remixSourceRecipeTitle: () => undefined,
        },
      },
      NotebookEntry: {
        path: "notebook-entry/:entryId",
        parse: { entryId: parseIntOrZero },
      },
      AllConversations: "conversation-list",
      NutritionDetail: "nutrition/:barcode",
      // Query params land in route.params unfiltered unless `parse` handles
      // them. ScanScreen forwards verifyBarcode into FrontLabelConfirm and the
      // verification submit, so a link must not choose the barcode a user's
      // label photo is credited to: drop it. `mode` stays linkable.
      Scan: {
        path: "scan",
        parse: { verifyBarcode: () => undefined },
      },
      // Drives the verify-email landing's success CTA (ocrecipes://login) to the
      // sign-in screen — pure navigation, no auth side effect.
      Login: "login",
      // ?token=… maps to route.params.token automatically (no positional param).
      VerifyEmail: "verify-email",
    },
  },
};
