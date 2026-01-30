import React, { useState, useEffect } from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, { FadeInUp, FadeIn } from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { useAuthContext } from "@/context/AuthContext";
import { apiRequest } from "@/lib/query-client";
import { Spacing, BorderRadius, Colors, Shadows } from "@/constants/theme";

type RouteParams = {
  barcode?: string;
  imageUri?: string;
  itemId?: number;
};

interface NutritionData {
  id?: number;
  productName: string;
  brandName?: string;
  servingSize?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
  imageUrl?: string;
  barcode?: string;
}

function MacroCard({
  label,
  value,
  unit,
  color,
  index,
}: {
  label: string;
  value?: number;
  unit: string;
  color: string;
  index: number;
}) {
  const { theme } = useTheme();

  return (
    <Animated.View
      entering={FadeInUp.delay(index * 100).duration(400)}
      style={styles.macroCardWrapper}
    >
      <Card elevation={1} style={styles.macroCard}>
        <View style={[styles.macroAccent, { backgroundColor: color }]} />
        <View style={styles.macroContent}>
          <ThemedText type="h3" style={{ color }}>
            {value !== undefined ? Math.round(value) : "--"}
          </ThemedText>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            {unit}
          </ThemedText>
        </View>
        <ThemedText type="small" style={styles.macroLabel}>
          {label}
        </ThemedText>
      </Card>
    </Animated.View>
  );
}

export default function NutritionDetailScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<{ params: RouteParams }, "params">>();
  const queryClient = useQueryClient();
  const { user } = useAuthContext();

  const { barcode, imageUri, itemId } = route.params || {};

  const [nutrition, setNutrition] = useState<NutritionData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { data: existingItem } = useQuery<NutritionData>({
    queryKey: ["/api/scanned-items", itemId],
    enabled: !!itemId,
  });

  useEffect(() => {
    if (existingItem) {
      setNutrition(existingItem);
      setIsLoading(false);
      return;
    }

    if (barcode) {
      fetchBarcodeData(barcode);
    } else if (imageUri) {
      setNutrition({
        productName: "Manual Entry",
        servingSize: "1 serving",
      });
      setIsLoading(false);
    } else if (!itemId) {
      setError("No scan data provided");
      setIsLoading(false);
    }
  }, [barcode, imageUri, itemId, existingItem]);

  const fetchBarcodeData = async (code: string) => {
    try {
      const response = await fetch(
        `https://world.openfoodfacts.org/api/v0/product/${code}.json`,
      );
      const data = await response.json();

      if (data.status === 1 && data.product) {
        const product = data.product;
        const nutriments = product.nutriments || {};

        setNutrition({
          productName: product.product_name || "Unknown Product",
          brandName: product.brands,
          servingSize: product.serving_size || product.quantity || "100g",
          calories: nutriments["energy-kcal_100g"] || nutriments.energy_value,
          protein: nutriments.proteins_100g,
          carbs: nutriments.carbohydrates_100g,
          fat: nutriments.fat_100g,
          fiber: nutriments.fiber_100g,
          sugar: nutriments.sugars_100g,
          sodium: nutriments.sodium_100g
            ? nutriments.sodium_100g * 1000
            : undefined,
          imageUrl: product.image_url || product.image_front_url,
          barcode: code,
        });
      } else {
        setError("Product not found in database");
        setNutrition({
          productName: "Unknown Product",
          barcode: code,
        });
      }
    } catch (err) {
      setError("Failed to fetch product data");
      setNutrition({
        productName: "Unknown Product",
        barcode: code,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const addToLogMutation = useMutation({
    mutationFn: async () => {
      if (!nutrition) return;

      const response = await apiRequest("POST", "/api/scanned-items", {
        ...nutrition,
        userId: user?.id,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scanned-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daily-summary"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      navigation.goBack();
    },
    onError: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    },
  });

  const handleAddToLog = () => {
    addToLogMutation.mutate();
  };

  if (isLoading) {
    return (
      <ThemedView style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={Colors.light.success} />
        <ThemedText
          type="body"
          style={[styles.loadingText, { color: theme.textSecondary }]}
        >
          Looking up product...
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: headerHeight + Spacing.xl,
            paddingBottom: insets.bottom + Spacing["3xl"],
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {nutrition?.imageUrl ? (
          <Animated.View
            entering={FadeIn.duration(400)}
            style={styles.imageContainer}
          >
            <Image
              source={{ uri: nutrition.imageUrl }}
              style={styles.productImage}
              resizeMode="contain"
            />
          </Animated.View>
        ) : null}

        <Animated.View entering={FadeInUp.delay(100).duration(400)}>
          <ThemedText type="h2" style={styles.productName}>
            {nutrition?.productName || "Unknown Product"}
          </ThemedText>
          {nutrition?.brandName ? (
            <ThemedText
              type="body"
              style={[styles.brandName, { color: theme.textSecondary }]}
            >
              {nutrition.brandName}
            </ThemedText>
          ) : null}
          {nutrition?.servingSize ? (
            <ThemedText
              type="small"
              style={[styles.servingSize, { color: theme.textSecondary }]}
            >
              Serving size: {nutrition.servingSize}
            </ThemedText>
          ) : null}
        </Animated.View>

        {error ? (
          <View
            style={[
              styles.warningContainer,
              { backgroundColor: Colors.light.warning + "20" },
            ]}
          >
            <Feather
              name="alert-triangle"
              size={20}
              color={Colors.light.warning}
            />
            <ThemedText
              type="small"
              style={{ color: Colors.light.warning, flex: 1 }}
            >
              {error}
            </ThemedText>
          </View>
        ) : null}

        <Animated.View
          entering={FadeInUp.delay(200).duration(400)}
          style={styles.calorieCard}
        >
          <Card
            elevation={2}
            style={[
              styles.heroCalorieCard,
              { borderColor: Colors.light.calorieAccent, borderWidth: 2 },
            ]}
          >
            <ThemedText
              type="h1"
              style={[
                styles.calorieValue,
                { color: Colors.light.calorieAccent },
              ]}
            >
              {nutrition?.calories !== undefined
                ? Math.round(nutrition.calories)
                : "--"}
            </ThemedText>
            <ThemedText type="body" style={{ color: theme.textSecondary }}>
              Calories
            </ThemedText>
          </Card>
        </Animated.View>

        <View style={styles.macrosGrid}>
          <MacroCard
            label="Protein"
            value={nutrition?.protein}
            unit="g"
            color={Colors.light.proteinAccent}
            index={0}
          />
          <MacroCard
            label="Carbs"
            value={nutrition?.carbs}
            unit="g"
            color={Colors.light.carbsAccent}
            index={1}
          />
          <MacroCard
            label="Fat"
            value={nutrition?.fat}
            unit="g"
            color={Colors.light.fatAccent}
            index={2}
          />
        </View>

        {nutrition?.fiber !== undefined ||
        nutrition?.sugar !== undefined ||
        nutrition?.sodium !== undefined ? (
          <Animated.View
            entering={FadeInUp.delay(500).duration(400)}
            style={styles.additionalNutrients}
          >
            <ThemedText type="h4" style={styles.sectionTitle}>
              Additional Nutrients
            </ThemedText>
            <Card elevation={1} style={styles.nutrientsList}>
              {nutrition?.fiber !== undefined ? (
                <View style={styles.nutrientRow}>
                  <ThemedText type="body">Fiber</ThemedText>
                  <ThemedText type="body" style={{ fontWeight: "600" }}>
                    {Math.round(nutrition.fiber)}g
                  </ThemedText>
                </View>
              ) : null}
              {nutrition?.sugar !== undefined ? (
                <View style={styles.nutrientRow}>
                  <ThemedText type="body">Sugar</ThemedText>
                  <ThemedText type="body" style={{ fontWeight: "600" }}>
                    {Math.round(nutrition.sugar)}g
                  </ThemedText>
                </View>
              ) : null}
              {nutrition?.sodium !== undefined ? (
                <View style={styles.nutrientRow}>
                  <ThemedText type="body">Sodium</ThemedText>
                  <ThemedText type="body" style={{ fontWeight: "600" }}>
                    {Math.round(nutrition.sodium)}mg
                  </ThemedText>
                </View>
              ) : null}
            </Card>
          </Animated.View>
        ) : null}

        {!itemId ? (
          <View style={styles.buttonContainer}>
            <Button
              onPress={handleAddToLog}
              disabled={addToLogMutation.isPending}
              style={[
                styles.addButton,
                { backgroundColor: Colors.light.success },
              ]}
            >
              {addToLogMutation.isPending ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                "Add to Today"
              )}
            </Button>
          </View>
        ) : null}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: Spacing.lg,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
  },
  imageContainer: {
    alignItems: "center",
    marginBottom: Spacing["2xl"],
  },
  productImage: {
    width: 160,
    height: 160,
    borderRadius: BorderRadius.lg,
  },
  productName: {
    textAlign: "center",
    marginBottom: Spacing.xs,
  },
  brandName: {
    textAlign: "center",
    marginBottom: Spacing.xs,
  },
  servingSize: {
    textAlign: "center",
    marginBottom: Spacing.lg,
  },
  warningContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.xs,
    marginBottom: Spacing.lg,
  },
  calorieCard: {
    marginBottom: Spacing["2xl"],
  },
  heroCalorieCard: {
    alignItems: "center",
    padding: Spacing["2xl"],
    borderRadius: BorderRadius.lg,
  },
  calorieValue: {
    fontSize: 56,
    lineHeight: 64,
    fontWeight: "700",
  },
  macrosGrid: {
    flexDirection: "row",
    gap: Spacing.md,
    marginBottom: Spacing["2xl"],
  },
  macroCardWrapper: {
    flex: 1,
  },
  macroCard: {
    padding: Spacing.lg,
    alignItems: "center",
    position: "relative",
    overflow: "hidden",
  },
  macroAccent: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    borderTopLeftRadius: BorderRadius["2xl"],
    borderBottomLeftRadius: BorderRadius["2xl"],
  },
  macroContent: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 2,
    marginBottom: Spacing.xs,
  },
  macroLabel: {
    fontWeight: "500",
  },
  additionalNutrients: {
    marginBottom: Spacing["2xl"],
  },
  sectionTitle: {
    marginBottom: Spacing.md,
  },
  nutrientsList: {
    padding: 0,
  },
  nutrientRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.05)",
  },
  buttonContainer: {
    marginTop: Spacing.lg,
  },
  addButton: {
    marginBottom: Spacing.md,
  },
});
