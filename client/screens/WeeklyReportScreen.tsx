import React, { useCallback, useEffect } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useBottomBudget } from "@/hooks/useBottomBudget";
import { useHeaderContentInset } from "@/hooks/useHeaderContentInset";
import { useToast } from "@/context/ToastContext";
import { useAddMealPlanItem, useRemoveMealPlanItem } from "@/hooks/useMealPlan";
import {
  useMarkCelebrationShown,
  useMarkWeeklyReportSeen,
  useUpdateWeeklyReportSettings,
  useWeeklyReport,
} from "@/hooks/useWeeklyReports";
import { navigationRef } from "@/navigation/navigationRef";
import { openCoachWithMessage } from "@/navigation/openCoachConversation";
import type { ProfileStackParamList } from "@/navigation/ProfileStackNavigator";
import { FontFamily, Spacing } from "@/constants/theme";
import { FEATURE_TIPS } from "@shared/constants/feature-tips";
import { formatPlanAddSuccess } from "@/components/meal-plan/plan-add-copy";
import type { WeeklyRecipe } from "@shared/schemas/coach-weekly-report";
import { HeadlineCard } from "@/components/weekly-report/HeadlineCard";
import { WeekNumbers } from "@/components/weekly-report/WeekNumbers";
import { KitchenRow } from "@/components/weekly-report/KitchenRow";
import { GoalChart } from "@/components/weekly-report/GoalChart";
import { DidYouKnowCard } from "@/components/weekly-report/DidYouKnowCard";
import {
  featureTipRoute,
  formatWeekRange,
  shouldPlayCelebration,
  tomorrowLocalDate,
  weekChatMessage,
} from "@/components/weekly-report/weekly-report-utils";

type Nav = NativeStackNavigationProp<ProfileStackParamList, "WeeklyReport">;

const PLAN_MEAL = "dinner";

function Section({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: "win" | "accent";
  children: React.ReactNode;
}) {
  const { theme } = useTheme();
  const color =
    tone === "win"
      ? theme.success
      : tone === "accent"
        ? theme.link
        : theme.textSecondary;
  return (
    <View style={styles.section}>
      <ThemedText
        accessibilityRole="header"
        style={[styles.heading, { color }]}
      >
        {title}
      </ThemedText>
      {children}
    </View>
  );
}

function Sentence({ children }: { children: string }) {
  return <ThemedText style={styles.sentence}>{children}</ThemedText>;
}

export default function WeeklyReportScreen() {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const toast = useToast();
  const navigation = useNavigation<Nav>();
  const { params } =
    useRoute<RouteProp<ProfileStackParamList, "WeeklyReport">>();
  const headerInset = useHeaderContentInset(Spacing.lg);
  const bottomBudget = useBottomBudget();
  const { data: report, isError, refetch } = useWeeklyReport(params.id);
  const { mutate: markSeen } = useMarkWeeklyReportSeen();
  const { mutate: markCelebration } = useMarkCelebrationShown();
  const { mutate: updateSettings } = useUpdateWeeklyReportSettings();
  const { mutateAsync: addToPlan } = useAddMealPlanItem();
  const { mutate: removeFromPlan } = useRemoveMealPlanItem();

  useEffect(() => {
    if (report && report.seenAt === null) markSeen(report.id);
  }, [report, markSeen]);

  const openRecipe = useCallback(
    (r: Pick<WeeklyRecipe, "recipeId" | "recipeType">) => {
      haptics.selection();
      if (!navigationRef.isReady()) return;
      navigationRef.navigate("FeaturedRecipeDetail", {
        recipeId: r.recipeId,
        recipeType: r.recipeType,
      });
    },
    [haptics],
  );

  const openTip = useCallback(
    (target: Parameters<typeof featureTipRoute>[0]) => {
      if (!navigationRef.isReady()) return;
      const [name, routeParams] = featureTipRoute(target);
      // Root-spelled routes typed as data (featureTipRoute is unit-tested).
      (navigationRef.navigate as (n: string, p?: object) => void)(
        name,
        routeParams,
      );
    },
    [],
  );

  const handleAddToPlan = useCallback(async () => {
    const next = report?.content.next;
    if (!next?.recipeId || next.recipeType !== "mealPlan") return;
    const plannedDate = tomorrowLocalDate(new Date());
    try {
      const item = await addToPlan({
        recipeId: next.recipeId,
        plannedDate,
        mealType: PLAN_MEAL,
      });
      toast.success(formatPlanAddSuccess(plannedDate, PLAN_MEAL), {
        action: { label: "Undo", onPress: () => removeFromPlan(item.id) },
      });
    } catch {
      toast.error("Couldn't add it to your plan. Please try again.");
    }
  }, [report, addToPlan, removeFromPlan, toast]);

  const handleFewer = useCallback(() => {
    haptics.selection();
    updateSettings(
      { pushEnabled: false },
      {
        onSuccess: () =>
          toast.success(
            "Got it, no more weekly pushes. Reports still save here.",
            {
              action: {
                label: "Undo",
                onPress: () => updateSettings({ pushEnabled: true }),
              },
            },
          ),
        onError: () => toast.error("Couldn't change that. Please try again."),
      },
    );
  }, [haptics, updateSettings, toast]);

  if (!report) {
    // A link whose id didn't parse arrives as 0 and never loads: show the error.
    const failed = isError || params.id <= 0;
    return (
      <View
        style={[
          styles.center,
          { backgroundColor: theme.backgroundDefault, paddingTop: headerInset },
        ]}
      >
        {!failed && (
          <ActivityIndicator
            color={theme.link}
            accessibilityLabel="Loading your report"
          />
        )}
        {failed ? (
          <>
            <ThemedText style={{ color: theme.textSecondary }}>
              {"Couldn't load this report."}
            </ThemedText>
            <Pressable
              onPress={() => void refetch()}
              accessibilityRole="button"
              accessibilityLabel="Retry loading the report"
              style={styles.link}
            >
              <ThemedText style={[styles.linkText, { color: theme.link }]}>
                Retry
              </ThemedText>
            </Pressable>
          </>
        ) : null}
      </View>
    );
  }

  const { facts, content } = report;
  const range = formatWeekRange(report.weekStart, report.weekEnd);
  const empty = facts.daysActive === 0;
  const tips = facts.tipIds.map((id) => FEATURE_TIPS[id]);
  const tryTips = facts.quiet ? tips.slice(0, -1).slice(0, 2) : [];
  const didYouKnow = tips[tips.length - 1];
  const canAddToPlan =
    content.next?.recipeId != null && content.next.recipeType === "mealPlan";

  return (
    <ScrollView
      style={{ backgroundColor: theme.backgroundDefault }}
      contentContainerStyle={[
        styles.container,
        { paddingTop: headerInset, paddingBottom: bottomBudget + Spacing.xl },
      ]}
    >
      <ThemedText style={[styles.eyebrow, { color: theme.textSecondary }]}>
        Week of {range}
      </ThemedText>

      <HeadlineCard
        headline={content.headline}
        subline={facts.quiet || facts.safetySignal ? content.fromLogged : null}
        celebrate={shouldPlayCelebration(report)}
        onCelebrated={() => markCelebration(report.id)}
      />

      <WeekNumbers facts={facts} />

      {!facts.quiet && content.wins.length > 0 && (
        <Section title="Wins" tone="win">
          {content.wins.map((w) => (
            <Sentence key={w}>{w}</Sentence>
          ))}
        </Section>
      )}

      {!empty && facts.recipes.length > 0 && (
        <Section title="New in your kitchen">
          <KitchenRow recipes={facts.recipes} onOpen={openRecipe} />
        </Section>
      )}

      {!facts.quiet && <GoalChart facts={facts} />}

      {!facts.quiet && content.watch.length > 0 && (
        <Section title="Watch">
          {content.watch.map((w) => (
            <Sentence key={w}>{w}</Sentence>
          ))}
        </Section>
      )}

      {facts.quiet &&
        !empty &&
        content.fromLogged === null &&
        content.wins.length > 0 && (
          <Section title="From what you logged" tone="win">
            {content.wins.map((w) => (
              <Sentence key={w}>{w}</Sentence>
            ))}
          </Section>
        )}

      {tryTips.length > 0 && (
        <Section title="Try this week" tone="accent">
          <ThemedText style={[styles.note, { color: theme.textSecondary }]}>
            {
              "Part of your Coach Pro plan, picked from the things you haven't used yet."
            }
          </ThemedText>
          {tryTips.map((t) => (
            <DidYouKnowCard
              key={t.target}
              tip={t}
              variant="try"
              onAction={() => openTip(t.target)}
            />
          ))}
        </Section>
      )}

      {!facts.quiet && (
        <Section title="Next week" tone="accent">
          {content.next ? <Sentence>{content.next.text}</Sentence> : null}
          <View style={styles.actions}>
            {canAddToPlan && (
              <Button onPress={() => void handleAddToPlan()}>
                Add to my plan
              </Button>
            )}
            <Button
              variant="secondary"
              onPress={() =>
                openCoachWithMessage(
                  weekChatMessage(report.weekStart, report.weekEnd),
                )
              }
            >
              Ask Coach about this week
            </Button>
          </View>
        </Section>
      )}

      {didYouKnow && (
        <DidYouKnowCard
          tip={didYouKnow}
          variant="didYouKnow"
          onAction={() => openTip(didYouKnow.target)}
        />
      )}

      <View style={styles.footer}>
        <Pressable
          onPress={handleFewer}
          accessibilityRole="button"
          accessibilityLabel="Fewer like this: turn off weekly pushes"
          style={styles.link}
        >
          <ThemedText style={[styles.linkText, { color: theme.link }]}>
            Fewer like this
          </ThemedText>
        </Pressable>
        <Pressable
          onPress={() => navigation.navigate("WeeklyReports")}
          accessibilityRole="button"
          accessibilityLabel="Report settings"
          style={styles.link}
        >
          <ThemedText style={[styles.linkText, { color: theme.link }]}>
            Report settings
          </ThemedText>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, gap: Spacing.xl },
  center: { flex: 1, alignItems: "center", gap: Spacing.sm },
  eyebrow: {
    fontFamily: FontFamily.semiBold,
    fontSize: 13,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  section: { gap: Spacing.sm },
  heading: {
    fontFamily: FontFamily.semiBold,
    fontSize: 13,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  sentence: { fontSize: 15, lineHeight: 23 },
  note: { fontSize: 14, lineHeight: 21 },
  actions: { gap: Spacing.sm, marginTop: Spacing.xs },
  footer: { flexDirection: "row", justifyContent: "space-between" },
  link: { minHeight: 44, minWidth: 44, justifyContent: "center" },
  linkText: { fontFamily: FontFamily.semiBold, fontSize: 14 },
});
