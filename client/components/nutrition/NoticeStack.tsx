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
  NOTICE_FILL_OPACITY,
  NOTICE_TEXT_COLOR_KEY,
  type NoticeSeverity,
} from "./NoticeStack-utils";

/**
 * There is deliberately NO `suppressAnnounce` here.
 *
 * It shipped in the first revision of this component so the screen could mute
 * the announcer while the log gate was unmet, on the theory that the gate's
 * acknowledge announcement and a notice announcement could collide in one
 * commit. They cannot: `acknowledgedUnverified` is `LogActionBar`-local state,
 * so the acknowledge click re-renders only that component and this effect does
 * not re-run — and if it did, `announcementKey` would be unchanged and
 * `lastAnnouncedRef` would short-circuit it. The acknowledge announce also
 * fires from a click handler, strictly later than any mount-time notice, and
 * the later `post(.announcement)` silences the earlier regardless.
 *
 * What the prop DID buy was a permanent silence on Android for the one screen
 * the label notice exists for — `deriveLogGate` gates iff a label could not be
 * used, which is the same condition that sets `labelReadNotice`. Removed from
 * the type rather than left declared-and-ignored, per
 * docs/solutions/design-patterns/remove-an-inert-prop-from-the-public-type-2026-08-04.md.
 */
interface NoticeStackProps {
  labelReadNotice: string | null;
  correctionNotice: string | null;
  showPer100gInfo: boolean;
  reducedMotion?: boolean;
}

/**
 * Which theme colour token backs each severity's FILL and ICON. A `Record`
 * rather than indexing `theme[notice.severity]` directly — the union happening
 * to spell the same names as the theme's colour keys is incidental, not
 * guaranteed; this makes the coupling explicit, mirroring `NutritionPanel`'s
 * `theme[visuals.colorKey]` (where `colorKey` is its own resolved field, not
 * a re-used discriminator).
 *
 * The TEXT deliberately uses a different token — see `NOTICE_TEXT_COLOR_KEY`
 * in `NoticeStack-utils.ts`. A fill and a body-copy colour take different WCAG
 * criteria, and these display tokens only clear the fill's.
 */
const SEVERITY_FILL_COLOR_KEY: Record<NoticeSeverity, "warning" | "info"> = {
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
 * kind — see that function's docblock.
 *
 * Ungated by platform, and now the ONLY announcer for these notices on either
 * one. `useNutritionLookup` used to carry an iOS-gated duplicate, justified by
 * "React flushes child effects before parent ones, so the hook's utterance is
 * the later post and silences this one." That premise holds only within a
 * single commit, and the two were never in the same commit: the hook sets the
 * notice BEFORE awaiting the barcode fetch, while `isLoading` is still true
 * and this component is not mounted, and mounting waits on the `finally` a
 * full round trip later. Nothing was silenced — iOS spoke the warning twice.
 *
 * The duplicate is gone (see the note where it used to live), which is the
 * removal this ungated announcer was written to survive. Keep it ungated: it
 * speaks when the notice is actually on screen, which is what the hook's could
 * not do. Do NOT add another announcer at a call site or back in the hook —
 * two of them cannot be kept in sync by an argument about effect ordering,
 * which is exactly how the last pair got out of sync.
 *
 * `error` is NOT a notice here — it renders through `InlineError`, which
 * fires its own iOS-gated announce, and `ScanConflictPrompt` is NOT a notice
 * either — it is interactive. See `NoticeStack-utils.ts`.
 */
export function NoticeStack({
  labelReadNotice,
  correctionNotice,
  showPer100gInfo,
  reducedMotion,
}: NoticeStackProps) {
  const { theme } = useTheme();

  const notices = buildNotices({
    labelReadNotice,
    correctionNotice,
    showPer100gInfo,
  });
  const announcementKey = noticeAnnouncementKey(notices);

  // Guarded by a ref, not solely by the effect's dependency array. The deps
  // array alone re-runs the body on any re-render that produces a new key
  // object, and — more to the point — a ref is what lets "already announced"
  // survive a re-render that recomputes an IDENTICAL key, which is every
  // serving adjustment that leaves the notices untouched. Announce once per
  // distinct content, never twice for the same words.
  const lastAnnouncedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!announcementKey) return;
    if (lastAnnouncedRef.current === announcementKey) return;
    lastAnnouncedRef.current = announcementKey;
    AccessibilityInfo.announceForAccessibility(announcementKey);
  }, [announcementKey]);

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
        const fillColor = theme[SEVERITY_FILL_COLOR_KEY[notice.severity]];
        // Not `fillColor`: the title and body are normal text and take WCAG
        // 1.4.3's 4.5:1, which the display tokens miss badly in light mode.
        const textColor = theme[NOTICE_TEXT_COLOR_KEY[notice.severity]];
        return (
          <View
            key={notice.id}
            style={[
              styles.row,
              {
                backgroundColor: withOpacity(
                  fillColor,
                  NOTICE_FILL_OPACITY[notice.severity],
                ),
              },
            ]}
          >
            <Feather
              name={notice.icon}
              size={16}
              color={fillColor}
              accessible={false}
            />
            <View style={styles.textColumn}>
              <ThemedText
                type="small"
                style={{ color: textColor, fontWeight: "600" }}
              >
                {notice.title}
              </ThemedText>
              <ThemedText type="small" style={{ color: textColor }}>
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
