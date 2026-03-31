import React from "react";
import { AccessibilityInfo, View } from "react-native";
import { SkeletonBox } from "@/components/SkeletonLoader";
import { Spacing, BorderRadius } from "@/constants/theme";

const HERO_IMAGE_HEIGHT = 250;

export function RecipeDetailSkeleton() {
  React.useEffect(() => {
    AccessibilityInfo.announceForAccessibility("Loading");
  }, []);

  return (
    <View accessibilityElementsHidden>
      <SkeletonBox width="100%" height={HERO_IMAGE_HEIGHT} borderRadius={0} />
      <View style={{ padding: Spacing.lg, gap: Spacing.md }}>
        <SkeletonBox width="75%" height={22} />
        <SkeletonBox width="100%" height={15} />
        <SkeletonBox width="85%" height={15} />
        <View
          style={{
            flexDirection: "row",
            gap: Spacing.sm,
            marginTop: Spacing.xs,
          }}
        >
          <SkeletonBox
            width={80}
            height={28}
            borderRadius={BorderRadius.chip}
          />
          <SkeletonBox
            width={70}
            height={28}
            borderRadius={BorderRadius.chip}
          />
          <SkeletonBox
            width={90}
            height={28}
            borderRadius={BorderRadius.chip}
          />
        </View>
        <SkeletonBox
          width={140}
          height={36}
          borderRadius={BorderRadius.full}
          style={{ marginTop: Spacing.xs }}
        />
        <SkeletonBox
          width={120}
          height={20}
          style={{ marginTop: Spacing.md }}
        />
        <SkeletonBox width="100%" height={15} />
        <SkeletonBox width="90%" height={15} />
        <SkeletonBox width="95%" height={15} />
        <SkeletonBox width="70%" height={15} />
      </View>
    </View>
  );
}
