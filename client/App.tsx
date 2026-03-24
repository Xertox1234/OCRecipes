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

import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";

import RootStackNavigator from "@/navigation/RootStackNavigator";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider } from "@/context/AuthContext";
import { PremiumProvider } from "@/context/PremiumContext";
import { ThemeProvider, useThemePreference } from "@/context/ThemeContext";
import { ToastProvider } from "@/context/ToastContext";
import { BatchScanProvider } from "@/context/BatchScanContext";
import { OfflineBanner } from "@/components/OfflineBanner";
import { setupNotificationChannel } from "@/lib/notifications";

function AppContent() {
  const { isDark } = useThemePreference();

  return (
    <GestureHandlerRootView style={styles.root}>
      <KeyboardProvider>
        <BottomSheetModalProvider>
          <ToastProvider>
            <BatchScanProvider>
              <NavigationContainer>
                <RootStackNavigator />
              </NavigationContainer>
            </BatchScanProvider>
            <OfflineBanner />
          </ToastProvider>
        </BottomSheetModalProvider>
        <StatusBar style={isDark ? "light" : "dark"} />
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

export default function App() {
  // Set up Android notification channel once at app startup (no-op on iOS)
  useEffect(() => {
    setupNotificationChannel();
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
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <PremiumProvider>
              <ThemeProvider>
                <AppContent />
              </ThemeProvider>
            </PremiumProvider>
          </AuthProvider>
        </QueryClientProvider>
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
