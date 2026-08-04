import React, { useEffect, useRef } from "react";
import { StyleSheet, View, AccessibilityInfo } from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated, { FadeInUp } from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
import {
  buildNotices,
  noticeAnnouncementKey,
  type NoticeSeverity,
} from "./NoticeStack-utils";

interface NoticeStackProps {
  labelReadNotice: string | null;
  correctionNotice: string | null;
  showPer100gInfo: boolean;
  suppressAnnounce?: boolean;
  reducedMotion?: boolean;
}

/**
 * The two fills that ship today — background opacity per severity. Consulted
 * against `theme.warning` / `theme.info` in the component, not stored here,
 * since the actual colour is only known once `useTheme()` runs.
 */
const SEVERITY_BACKGROUND_OPACITY: Record<NoticeSeverity, number> = {
  warning: 0.1,
  info: 0.08,
};

/**
 * Which theme colour token backs each severity. A `Record` rather than
 * indexing `theme[notice.severity]` directly — the union happening to spell
 * the same names as the theme's colour keys is incidental, not guaranteed;
 * this makes the coupling explicit, mirroring `NutritionPanel`'s
 * `theme[visuals.colorKey]` (where `colorKey` is its own resolved field, not
 * a re-used discriminator).
 */
const SEVERITY_COLOR_KEY: Record<NoticeSeverity, "warning" | "info"> = {
  warning: "warning",
  info: "info",
};

/**
 * The single collapsed advisory surface for the nutrition detail screen: a
 * label-not-used warning, a serving-correction warning, and the per-100g info
 * notice, in one row treatment (icon + title + body), ordered warnings-first.
 *
 * Deliberately carries NO `accessibilityLiveRegion` anywhere — on the
 * container or on any row. A "polite" region on a container wrapping multiple
 * variants makes TalkBack recompose the whole subtree (including the
 * always-present medical-advice disclaimer elsewhere on the screen) on any
 * single descendant change, and `correctionNotice` mutates on every serving
 * adjustment. Instead this owns ONE edge-guarded imperative announcer, keyed
 * on the notices' composed CONTENT (`noticeAnnouncementKey`) rather than their
 * kind — see that function's docblock. Ungated by platform: with no live
 * region anywhere there is no double-announce risk on Android, and this is
 * iOS's only signal.
 *
 * `error` is NOT a notice here — it renders through `InlineError`, which
 * fires its own iOS-gated announce, and `ScanConflictPrompt` is NOT a notice
 * either — it is interactive. See `NoticeStack-utils.ts`.
 */
export function NoticeStack({
  labelReadNotice,
  correctionNotice,
  showPer100gInfo,
  suppressAnnounce = false,
  reducedMotion,
}: NoticeStackProps) {
  const { theme } = useTheme();

  const notices = buildNotices({
    labelReadNotice,
    correctionNotice,
    showPer100gInfo,
  });
  const announcementKey = noticeAnnouncementKey(notices);

  // Guarded by a ref, not solely by the effect's dependency array: "changed"
  // must mean the CONTENT changed, independent of `suppressAnnounce` also
  // being a dependency. A bare `[announcementKey, suppressAnnounce]` deps
  // array re-runs the effect body whenever EITHER value flips — so if Task 8
  // flips `suppressAnnounce` true→false while the key is unchanged (the
  // acknowledge announcement finishing), a deps-only guard would re-announce
  // stale content right as the acknowledge announce lands, defeating the
  // mutual exclusion Task 8 exists to establish.
  //
  // The ref is updated to the current key BEFORE the suppress check, not
  // after — so content seen while suppressed is marked "already handled" even
  // though it was never actually spoken. That is what makes lifting
  // `suppressAnnounce` on unchanged content silent rather than retroactive:
  // the ref already matches, so the second effect run (triggered by
  // `suppressAnnounce` alone changing) short-circuits before reaching the
  // announce call.
  const lastAnnouncedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!announcementKey) return;
    if (lastAnnouncedRef.current === announcementKey) return;
    lastAnnouncedRef.current = announcementKey;
    if (suppressAnnounce) return;
    AccessibilityInfo.announceForAccessibility(announcementKey);
  }, [announcementKey, suppressAnnounce]);

  if (notices.length === 0) return null;

  // 150 is this component's position in the screen's entrance ladder, not an
  // independent guess: NoticeStack replaces the labelReadNotice/
  // correctionNotice blocks at NutritionDetailScreen.tsx:326-370, which sit
  // between ProductHero and the calorie card — so it leads NutritionSummaryCard
  // (200) the same way every sibling's delay tracks its own final rendered
  // position (NutritionPanel 300, "For you" 400, "Heads up" 450,
  // micronutrients 500). duration(400) matches every sibling unconditionally.
  return (
    <Animated.View
      entering={reducedMotion ? undefined : FadeInUp.delay(150).duration(400)}
    >
      {notices.map((notice) => {
        const color = theme[SEVERITY_COLOR_KEY[notice.severity]];
        return (
          <View
            key={notice.id}
            style={[
              styles.row,
              {
                backgroundColor: withOpacity(
                  color,
                  SEVERITY_BACKGROUND_OPACITY[notice.severity],
                ),
              },
            ]}
          >
            <Feather
              name={notice.icon}
              size={16}
              color={color}
              accessible={false}
            />
            <View style={styles.textColumn}>
              <ThemedText type="small" style={{ color, fontWeight: "600" }}>
                {notice.title}
              </ThemedText>
              <ThemedText type="small" style={{ color }}>
                {notice.body}
              </ThemedText>
            </View>
          </View>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Moved from NutritionDetailScreen.tsx:884-891 (`correctionContainer`) —
  // one row treatment now covers what used to be two separately-styled
  // containers (`correctionContainer` for warnings, `infoContainer` for
  // info), consolidating rather than restyling.
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.xs,
    marginBottom: Spacing.lg,
  },
  textColumn: {
    flex: 1,
  },
});
