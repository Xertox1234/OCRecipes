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

import { onlineManager } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { queryClient, asyncStoragePersister } from "@/lib/query-client";
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
import { setupNotificationChannel } from "@/lib/notifications";
import { initReporter, reportError } from "@/lib/reporter";
import { logger } from "@/lib/logger";

initReporter();

// Eager init — must be ready before any mutation surface mounts
void initOfflineQueue();

// Wire drain to fire on every reconnect event
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
          }}
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
