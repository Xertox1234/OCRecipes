import React, { useEffect } from "react";
import { StyleSheet, ActivityIndicator, View } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import {
  useFonts,
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
} from "@expo-google-fonts/poppins";

import {
  onlineManager,
  defaultShouldDehydrateQuery,
} from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import {
  queryClient,
  asyncStoragePersister,
  markQueryCacheRestored,
} from "@/lib/query-client";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import * as Notifications from "expo-notifications";

import RootStackNavigator from "@/navigation/RootStackNavigator";
import { linking } from "@/navigation/linking";
import { navigationRef } from "@/navigation/navigationRef";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider } from "@/context/AuthContext";
import { PremiumProvider } from "@/context/PremiumContext";
import { ThemeProvider, useThemePreference } from "@/context/ThemeContext";
import { ToastProvider } from "@/context/ToastContext";
import { BatchScanProvider } from "@/context/BatchScanContext";
import { OfflineBanner } from "@/components/OfflineBanner";
import { QueryErrorToastBridge } from "@/components/QueryErrorToastBridge";
import { SessionExpiryBridge } from "@/components/SessionExpiryBridge";
import { OfflineQueueBridge } from "@/components/OfflineQueueBridge";
import { initOfflineQueue } from "@/lib/offline-queue";
import { drainQueue } from "@/lib/offline-queue-drain";
import { QUERY_KEYS } from "@/lib/query-keys";
import { setupNotificationChannel } from "@/lib/notifications";
import { initReporter, reportError } from "@/lib/reporter";
import { logger } from "@/lib/logger";

initReporter();

// Persist ONLY the small, offline-critical reads (food log + daily summary +
// frequent items + dietary profile — the centralized QUERY_KEYS). Large/ephemeral
// payloads (recipe browse/search, chat histories, carousel — all ad-hoc keys) are
// excluded so the single AsyncStorage cache row can't blow the Android
// CursorWindow ~2MB limit (M5). Pairs with defaultShouldDehydrateQuery to keep
// the library's success-only default.
// Invariant: every QUERY_KEYS value is a tuple, so we match on its first element
// (`k[0]`). A future plain-string key would need its own handling here.
const PERSISTED_QUERY_KEYS = new Set<unknown>(
  Object.values(QUERY_KEYS).map((k) => k[0]),
);

// Bump when a persisted query's data SHAPE changes incompatibly, so a stale
// old-shape cache is discarded on restore instead of served as fresh (M6).
const PERSIST_BUSTER = "1";

// Eager init — must be ready before any mutation surface mounts. After the
// persisted queue loads, drain once if already online (M7): onlineManager only
// notifies its subscriber on connectivity *transitions*, so a cold start while
// online synthesizes no event — a queue from a prior session (offline-log →
// force-quit → reopen-online) would otherwise sit unsynced until the next blip.
// drainQueue's isDraining guard makes the cold-start drain and any near-coincident
// transition drain safe to both fire.
void initOfflineQueue().then(() => {
  if (onlineManager.isOnline()) void drainQueue();
});

// Wire drain to fire on every subsequent reconnect transition.
onlineManager.subscribe((isOnline) => {
  if (isOnline) {
    void drainQueue();
  }
});

function AppContent() {
  const { isDark } = useThemePreference();

  return (
    <GestureHandlerRootView style={styles.root}>
      <KeyboardProvider>
        <BottomSheetModalProvider>
          <ToastProvider>
            <BatchScanProvider>
              <NavigationContainer ref={navigationRef} linking={linking}>
                <RootStackNavigator />
              </NavigationContainer>
            </BatchScanProvider>
            <OfflineBanner />
            <QueryErrorToastBridge />
            <SessionExpiryBridge />
            <OfflineQueueBridge />
          </ToastProvider>
        </BottomSheetModalProvider>
        <StatusBar style={isDark ? "light" : "dark"} />
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

export default function App() {
  // Set up Android notification channel once at app startup (no-op on iOS)
  // and register a tap listener that deep-links commitment reminders to
  // the relevant NotebookEntry screen.
  useEffect(() => {
    setupNotificationChannel().catch((err) =>
      logger.error("Failed to set up notification channels:", err),
    );
    const sub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const entryId = response.notification.request.content.data?.entryId as
          | number
          | undefined;
        if (entryId && navigationRef.isReady()) {
          navigationRef.navigate("NotebookEntry", { entryId });
        }
      },
    );
    return () => sub.remove();
  }, []);

  const [fontsLoaded] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
  });

  if (!fontsLoaded) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <ErrorBoundary onError={(err) => reportError(err, "ErrorBoundary")}>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{
            persister: asyncStoragePersister,
            maxAge: 24 * 60 * 60 * 1000,
            buster: PERSIST_BUSTER,
            dehydrateOptions: {
              shouldDehydrateQuery: (query) =>
                defaultShouldDehydrateQuery(query) &&
                PERSISTED_QUERY_KEYS.has(query.queryKey[0]),
            },
          }}
          // Release the durable-sweep restore gate once the persisted cache has
          // settled — on BOTH success and failure. A session teardown awaits this
          // before queryClient.clear() so an in-flight restore can't rehydrate the
          // prior user's data after the clear (cross-user leak on a shared device).
          // onError covers a corrupt/oversized blob so a failed restore can't wedge
          // teardown. (These are provider props, NOT persistOptions fields.)
          onSuccess={markQueryCacheRestored}
          onError={markQueryCacheRestored}
        >
          <AuthProvider>
            <PremiumProvider>
              <ThemeProvider>
                <AppContent />
              </ThemeProvider>
            </PremiumProvider>
          </AuthProvider>
        </PersistQueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
});
