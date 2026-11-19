import React from "react";
import { View, StyleSheet, Image } from "react-native";

import { ThemedText } from "@/components/ThemedText";
import { MAX_FONT_SCALE_CONSTRAINED, Spacing } from "@/constants/theme";

interface HeaderTitleProps {
  title: string;
  showIcon?: boolean;
}

export function HeaderTitle({ title, showIcon = true }: HeaderTitleProps) {
  return (
    <View style={styles.container}>
      {showIcon ? (
        <Image
          source={require("../../assets/images/icon.png")}
          style={styles.icon}
          resizeMode="contain"
          accessible={false}
        />
      ) : null}
      <ThemedText maxScale={MAX_FONT_SCALE_CONSTRAINED} style={styles.title}>
        {title}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
  },
  icon: {
    width: 28,
    height: 28,
    marginRight: Spacing.sm,
  },
  title: {
    fontSize: 17,
    fontWeight: "600",
  },
});
