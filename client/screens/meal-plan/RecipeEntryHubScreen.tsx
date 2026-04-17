import React, { useCallback } from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  Pressable,
  Text,
  ActionSheetIOS,
  Platform,
  Alert,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useHeaderHeight } from "@react-navigation/elements";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, FontFamily } from "@/constants/theme";
import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";

type EntryHubNavigationProp = NativeStackNavigationProp<
  MealPlanStackParamList,
  "RecipeEntryHub"
>;
type EntryHubRouteProp = RouteProp<MealPlanStackParamList, "RecipeEntryHub">;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface CardDef {
  id: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  color: string;
  title: string;
  description: string;
}

const CARDS: CardDef[] = [
  {
    id: "write",
    icon: "edit-2",
    color: "#7c6ffa", // hardcoded
    title: "Write from scratch",
    description: "Type your own recipe step by step",
  },
  {
    id: "ai",
    icon: "zap",
    color: "#f59e0b", // hardcoded
    title: "Generate with AI",
    description: "Describe what you want, AI does the rest",
  },
  {
    id: "url",
    icon: "link",
    color: "#22c55e", // hardcoded
    title: "Import from URL",
    description: "Paste a link from any recipe site",
  },
  {
    id: "photo",
    icon: "camera",
    color: "#3b82f6", // hardcoded
    title: "Scan a recipe",
    description: "Take a photo of a cookbook or card",
  },
  {
    id: "browse",
    icon: "search",
    color: "#ec4899", // hardcoded
    title: "Browse recipes",
    description: "Search community & catalog recipes",
  },
];

function ActionCard({ card, onPress }: { card: CardDef; onPress: () => void }) {
  const { theme } = useTheme();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.97, { damping: 15, stiffness: 300 });
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 15, stiffness: 300 });
  };

  const handlePress = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  return (
    <AnimatedPressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[
        styles.card,
        { backgroundColor: theme.backgroundSecondary },
        animatedStyle,
      ]}
      accessibilityRole="button"
      accessibilityLabel={card.title}
      accessibilityHint={card.description}
    >
      <View style={[styles.iconContainer, { backgroundColor: card.color }]}>
        <Feather name={card.icon} size={20} color="#ffffff" /* hardcoded */ />
      </View>
      <View style={styles.cardContent}>
        <Text style={[styles.cardTitle, { color: theme.text }]}>
          {card.title}
        </Text>
        <Text style={[styles.cardDescription, { color: theme.textSecondary }]}>
          {card.description}
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color={theme.textSecondary} />
    </AnimatedPressable>
  );
}

export default function RecipeEntryHubScreen() {
  const navigation = useNavigation<EntryHubNavigationProp>();
  const route = useRoute<EntryHubRouteProp>();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();

  const returnToMealPlan = route.params?.returnToMealPlan;

  const navigateWithPhoto = useCallback(
    (uri: string) => {
      navigation.navigate("RecipePhotoImport", {
        photoUri: uri,
        returnToMealPlan,
      });
    },
    [navigation, returnToMealPlan],
  );

  const launchCamera = useCallback(async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Camera Access",
        "Please enable camera access in Settings to scan recipes.",
      );
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.9,
    });
    if (!result.canceled && result.assets[0]) {
      navigateWithPhoto(result.assets[0].uri);
    }
  }, [navigateWithPhoto]);

  const launchLibrary = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.9,
    });
    if (!result.canceled && result.assets[0]) {
      navigateWithPhoto(result.assets[0].uri);
    }
  }, [navigateWithPhoto]);

  const handlePhotoPress = useCallback(() => {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Cancel", "Take Photo", "Choose from Library"],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) void launchCamera();
          if (buttonIndex === 2) void launchLibrary();
        },
      );
    } else {
      Alert.alert("Scan a recipe", "Choose a source", [
        { text: "Cancel", style: "cancel" },
        { text: "Take Photo", onPress: () => void launchCamera() },
        { text: "Choose from Library", onPress: () => void launchLibrary() },
      ]);
    }
  }, [launchCamera, launchLibrary]);

  const handleCardPress = (id: string) => {
    switch (id) {
      case "write":
        navigation.navigate("RecipeCreate", { returnToMealPlan });
        break;
      case "ai":
        navigation.navigate("RecipeAIGenerate", { returnToMealPlan });
        break;
      case "url":
        navigation.navigate("RecipeImport", { returnToMealPlan });
        break;
      case "photo":
        handlePhotoPress();
        break;
      case "browse":
        navigation.navigate("RecipeBrowser", {});
        break;
    }
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: headerHeight + Spacing.lg,
          paddingBottom: insets.bottom + Spacing.xl,
        },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
        How would you like to start?
      </Text>
      {CARDS.map((card) => (
        <ActionCard
          key={card.id}
          card={card}
          onPress={() => handleCardPress(card.id)}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: FontFamily.regular,
    textAlign: "center",
    marginBottom: Spacing.md,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    gap: Spacing.md,
  },
  iconContainer: {
    width: 42,
    height: 42,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 14,
    fontFamily: FontFamily.semiBold,
    marginBottom: 2,
  },
  cardDescription: {
    fontSize: 11,
    fontFamily: FontFamily.regular,
  },
});
