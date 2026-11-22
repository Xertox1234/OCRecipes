import React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { SkeletonBox, SkeletonProvider } from "@/components/SkeletonLoader";
import { useConfirmationModal } from "@/components/ConfirmationModal";
import { summarizeAllergies } from "@/components/family-profile-utils";
import { useTheme } from "@/hooks/useTheme";
import { useHeaderContentInset } from "@/hooks/useHeaderContentInset";
import { usePlanCheck } from "@/hooks/usePlanCheck";
import { usePremiumFeature } from "@/hooks/usePremiumFeatures";
import {
  useDeleteFamilyProfile,
  useFamilyProfilesList,
} from "@/hooks/useFamily";
import { useToast } from "@/context/ToastContext";
import { Spacing, BorderRadius } from "@/constants/theme";
import { MAX_FAMILY_PROFILES } from "@shared/types/family";
import type { FamilyProfilesScreenNavigationProp } from "@/types/navigation";

/**
 * The people you plan for. Reached from the Profile tab's "Family" row (shown
 * whenever the switch is on, so a lapsed-premium user lands here too). It
 * loads the list itself, whatever the plan: GET is not premium-gated, and a
 * lapsed user can only remove people (the server refuses their writes).
 */
export default function FamilyProfilesScreen() {
  const navigation = useNavigation<FamilyProfilesScreenNavigationProp>();
  const insets = useSafeAreaInsets();
  const headerInset = useHeaderContentInset(Spacing.lg);
  const { theme } = useTheme();
  const toast = useToast();
  const { confirm, ConfirmationModal, behindContentA11yProps } =
    useConfirmationModal();

  const { profiles, isLoading, isError, refetch } = useFamilyProfilesList();
  const deleteMutation = useDeleteFamilyProfile();
  const premium = usePremiumFeature("familyProfiles");
  const { planUnknown } = usePlanCheck();
  // An unknown plan is neutral: keep the controls, the server decides.
  const canEdit = premium || planUnknown;

  const removing = deleteMutation.isPending ? deleteMutation.variables : null;
  const atLimit = profiles.length >= MAX_FAMILY_PROFILES;

  const openForm = (profileId?: number) =>
    navigation.navigate(
      "FamilyProfileEdit",
      profileId === undefined ? {} : { profileId },
    );

  const askToRemove = (id: number, name: string) => {
    if (removing !== null) return;
    confirm({
      title: `Remove ${name}?`,
      message: `This removes ${name} and the meals planned just for them. Meals for everyone stay.`,
      confirmLabel: "Remove",
      destructive: true,
      onConfirm: () =>
        deleteMutation.mutate(id, {
          onSuccess: () => toast.success(`Removed ${name}`),
          onError: () =>
            toast.error(`Couldn't remove ${name}. Please try again.`),
        }),
    });
  };

  const renderBody = () => {
    if (isLoading) {
      return (
        <SkeletonProvider>
          <View accessibilityElementsHidden style={{ gap: Spacing.sm }}>
            <SkeletonBox width="100%" height={64} />
            <SkeletonBox width="100%" height={64} />
          </View>
        </SkeletonProvider>
      );
    }
    if (isError) {
      return (
        <EmptyState
          variant="temporary"
          icon="alert-circle"
          title="Couldn't load your family"
          description="Check your connection and try again."
          actionLabel="Try Again"
          onAction={refetch}
        />
      );
    }
    if (profiles.length === 0) {
      return (
        <EmptyState
          variant="firstTime"
          icon="users"
          title="No one added yet"
          description={
            canEdit
              ? "Add the people you cook for, with any allergies, and plan meals for them."
              : "Your plan no longer includes family profiles."
          }
          actionLabel={canEdit ? "Add a family member" : undefined}
          onAction={canEdit ? () => openForm() : undefined}
        />
      );
    }
    return (
      <View style={{ gap: Spacing.sm }}>
        {!canEdit ? (
          <ThemedText
            type="small"
            style={{ color: theme.textSecondary, marginBottom: Spacing.sm }}
          >
            Your plan no longer includes family profiles. You can still remove
            people here.
          </ThemedText>
        ) : null}
        {profiles.map((profile) => {
          const summary = summarizeAllergies(profile.allergies);
          const busy = removing === profile.id;
          const rowContent = (
            <View style={styles.rowText}>
              <ThemedText type="body" style={{ fontWeight: "600" }}>
                {profile.name}
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                {summary}
              </ThemedText>
            </View>
          );
          return (
            <View
              key={profile.id}
              style={[
                styles.row,
                {
                  backgroundColor: theme.backgroundDefault,
                  borderColor: theme.border,
                  opacity: busy ? 0.5 : 1,
                },
              ]}
            >
              {canEdit ? (
                <Pressable
                  onPress={() => openForm(profile.id)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={`${profile.name}. ${summary}`}
                  accessibilityHint="Opens this person's details"
                  style={({ pressed }) => [
                    styles.rowMain,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  {rowContent}
                  <Feather
                    name="chevron-right"
                    size={18}
                    color={theme.textSecondary}
                    accessible={false}
                  />
                </Pressable>
              ) : (
                <View style={styles.rowMain}>{rowContent}</View>
              )}
              <Pressable
                onPress={() => askToRemove(profile.id, profile.name)}
                disabled={busy}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${profile.name}`}
                accessibilityState={{ disabled: busy }}
                style={({ pressed }) => [
                  styles.removeButton,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Feather
                  name="trash-2"
                  size={18}
                  color={theme.error}
                  accessible={false}
                />
              </Pressable>
            </View>
          );
        })}
      </View>
    );
  };

  const showAdd =
    canEdit && !isLoading && !isError && profiles.length > 0 && !atLimit;

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <ScrollView
        {...behindContentA11yProps}
        contentContainerStyle={{
          paddingTop: headerInset,
          paddingHorizontal: Spacing.lg,
          paddingBottom: insets.bottom + Spacing["3xl"],
          gap: Spacing.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
        {renderBody()}

        {showAdd ? (
          <Button
            onPress={() => openForm()}
            accessibilityLabel="Add a family member"
          >
            Add a family member
          </Button>
        ) : null}
        {canEdit && !isLoading && !isError && atLimit ? (
          <ThemedText
            type="small"
            style={{ color: theme.textSecondary, textAlign: "center" }}
          >
            {`You can add up to ${MAX_FAMILY_PROFILES} people`}
          </ThemedText>
        ) : null}
      </ScrollView>
      <ConfirmationModal />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
  },
  rowMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: Spacing.md,
    minHeight: 56,
    gap: Spacing.md,
  },
  rowText: { flex: 1, gap: 2 },
  removeButton: {
    width: 48,
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
  },
});
