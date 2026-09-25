import type { LinkingOptions } from "@react-navigation/native";
import { Linking } from "react-native";
import * as Notifications from "expo-notifications";
import type { RootStackParamList } from "./RootStackNavigator";
import { navigationRef } from "./navigationRef";

function parseIntOrZero(value: string): number {
  const num = parseInt(value, 10);
  return Number.isNaN(num) ? 0 : num;
}

// The client's own scheduleCommitmentReminder (client/hooks/
// useNotebookNotifications.ts) sends `data.url` going forward, but this
// fallback is NOT a time-bounded migration bridge that can be deleted once
// old on-device notifications age out: the server-driven push path
// (server/services/notification-scheduler.ts, the primary delivery path —
// the client scheduler is only a fallback for undelivered push) sends
// `data: { entryId }` only and is out of this todo's scope, so it will keep
// emitting entryId-only payloads indefinitely. Build the equivalent
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

export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ["ocrecipes://", "https://ocrecipes.app"],
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
              Chat: {
                path: "chat/:conversationId",
                parse: { conversationId: parseIntOrZero },
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
        },
      },
      RecipeChat: {
        path: "recipe-chat/:conversationId?",
        parse: { conversationId: parseIntOrZero },
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
