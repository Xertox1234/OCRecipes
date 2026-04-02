import React from "react";
import { StyleSheet, View, Pressable, Image } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, FontFamily, withOpacity } from "@/constants/theme";
import { resolveImageUrl } from "@/lib/query-client";
import { getTierLabel } from "@/components/verification-badge-utils";

interface ProfileCardProps {
  displayName: string;
  username: string;
  avatarUrl: string | null;
  compositeScore: number;
  isUploadingAvatar: boolean;
  onAvatarPress: () => void;
  onGearPress: () => void;
}

export const ProfileCard = React.memo(function ProfileCard({
  displayName,
  username,
  avatarUrl,
  compositeScore,
  isUploadingAvatar,
  onAvatarPress,
  onGearPress,
}: ProfileCardProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const tierLabel = getTierLabel(compositeScore);

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: theme.backgroundSecondary,
          paddingTop: insets.top + Spacing.md,
          borderColor: withOpacity(theme.border, 0.5),
        },
      ]}
    >
      {/* Gear button — floating top-right */}
      <Pressable
        onPress={onGearPress}
        accessibilityLabel="Settings"
        accessibilityRole="button"
        style={[
          styles.gearButton,
          {
            top: insets.top + Spacing.sm,
            backgroundColor: withOpacity(theme.textSecondary, 0.08),
          },
        ]}
        hitSlop={8}
      >
        <Feather name="settings" size={20} color={theme.textSecondary} />
      </Pressable>

      <View style={styles.row}>
        {/* Avatar */}
        <Pressable
          onPress={onAvatarPress}
          accessibilityLabel="Profile photo. Tap to change"
          accessibilityRole="button"
          accessibilityHint="Opens photo picker"
          style={[styles.avatar, { backgroundColor: theme.backgroundTertiary }]}
        >
          {avatarUrl && resolveImageUrl(avatarUrl) ? (
            <Image
              source={{ uri: resolveImageUrl(avatarUrl)! }}
              style={styles.avatarImage}
            />
          ) : (
            <Feather name="user" size={24} color={theme.textSecondary} />
          )}
          {isUploadingAvatar && (
            <View
              style={[
                styles.avatarOverlay,
                { backgroundColor: withOpacity(theme.text, 0.3) },
              ]}
            >
              <Feather name="loader" size={16} color={theme.buttonText} />
            </View>
          )}
        </Pressable>

        {/* Name + badge */}
        <View style={styles.info}>
          <ThemedText
            numberOfLines={1}
            style={styles.name}
            accessibilityLabel={
              compositeScore > 0
                ? `${displayName || username}, ${tierLabel}`
                : displayName || username
            }
          >
            {displayName || username}
            {compositeScore > 0 && (
              <ThemedText style={[styles.badge, { color: theme.link }]}>
                {" "}
                {tierLabel}
              </ThemedText>
            )}
          </ThemedText>
        </View>
      </View>
    </View>
  );
});

const AVATAR_SIZE = 48;

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  gearButton: {
    position: "absolute",
    right: Spacing.lg,
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginRight: 48, // Clear gear button
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  avatarImage: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  avatarOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  info: {
    flex: 1,
    gap: Spacing.sm,
  },
  name: {
    fontSize: 17,
    fontFamily: FontFamily.semiBold,
  },
  badge: {
    fontSize: 13,
    fontFamily: FontFamily.regular,
  },
});
