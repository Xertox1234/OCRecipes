import React, { useRef, useState } from "react";
import { StyleSheet, View, type TextInputInstance } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { TextInput } from "@/components/TextInput";
import { Button } from "@/components/Button";
import { InlineError } from "@/components/InlineError";
import { EmptyState } from "@/components/EmptyState";
import { FieldCounter } from "@/components/FieldCounter";
import { AllergenPicker } from "@/components/AllergenPicker";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { SkeletonBox, SkeletonProvider } from "@/components/SkeletonLoader";
import { useConfirmationModal } from "@/components/ConfirmationModal";
import {
  describeFamilyError,
  validateFamilyProfile,
} from "@/components/family-profile-utils";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useHeaderContentInset } from "@/hooks/useHeaderContentInset";
import { useHealthConsent } from "@/hooks/useHealthConsent";
import {
  useCreateFamilyProfile,
  useFamilyProfilesList,
  useUpdateFamilyProfile,
} from "@/hooks/useFamily";
import { useToast } from "@/context/ToastContext";
import { HEALTH_CONSENT_PROMPT } from "@/lib/health-consent";
import { Spacing } from "@/constants/theme";
import {
  FAMILY_NAME_MAX,
  FAMILY_NOTE_MAX,
  type FamilyProfileInput,
} from "@shared/types/family";
import type { Allergy } from "@shared/schema";
import type { FamilyProfileEditScreenNavigationProp } from "@/types/navigation";
import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";

/**
 * Add a person (no `profileId`) or edit one. Allergies and a note are health
 * details, so saving them runs the same consent question as the dietary
 * profile first; a name alone needs none.
 */
export default function FamilyProfileEditScreen() {
  const route =
    useRoute<RouteProp<MealPlanStackParamList, "FamilyProfileEdit">>();
  const profileId = route.params?.profileId;
  const { profiles, isLoading, isError, refetch } = useFamilyProfilesList();
  const { theme } = useTheme();
  const headerInset = useHeaderContentInset(Spacing.lg);

  // Editing waits for the saved list: a form opened before it loads would
  // show blanks that a save then writes over the real person.
  if (profileId !== undefined) {
    const existing = profiles.find((p) => p.id === profileId);
    if (isLoading) {
      return (
        <View
          style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
        >
          <SkeletonProvider>
            <View
              accessibilityElementsHidden
              style={{
                paddingTop: headerInset,
                paddingHorizontal: Spacing.lg,
                gap: Spacing.md,
              }}
            >
              <SkeletonBox width="100%" height={56} />
              <SkeletonBox width="100%" height={120} />
            </View>
          </SkeletonProvider>
        </View>
      );
    }
    if (isError) {
      return (
        <View
          style={[
            styles.container,
            styles.centered,
            { backgroundColor: theme.backgroundRoot },
          ]}
        >
          <EmptyState
            variant="temporary"
            icon="alert-circle"
            title="Couldn't load this person"
            description="Check your connection and try again."
            actionLabel="Try Again"
            onAction={refetch}
          />
        </View>
      );
    }
    if (!existing) {
      return (
        <View
          style={[
            styles.container,
            styles.centered,
            { backgroundColor: theme.backgroundRoot },
          ]}
        >
          <EmptyState
            variant="noResults"
            icon="user-x"
            title="This person isn't here anymore"
            description="They may have been removed. Go back to see your list."
          />
        </View>
      );
    }
    return (
      <FamilyProfileForm
        profileId={profileId}
        initial={{
          name: existing.name,
          allergies: existing.allergies,
          note: existing.note ?? "",
        }}
      />
    );
  }
  return <FamilyProfileForm />;
}

interface FormProps {
  profileId?: number;
  initial?: { name: string; allergies: Allergy[]; note: string };
}

function FamilyProfileForm({ profileId, initial }: FormProps) {
  const navigation = useNavigation<FamilyProfileEditScreenNavigationProp>();
  const insets = useSafeAreaInsets();
  const headerInset = useHeaderContentInset(Spacing.lg);
  const { theme } = useTheme();
  const haptics = useHaptics();
  const toast = useToast();
  const { consented, grant } = useHealthConsent();
  const { confirm, ConfirmationModal, behindContentA11yProps } =
    useConfirmationModal();
  const createProfile = useCreateFamilyProfile();
  const updateProfile = useUpdateFamilyProfile();

  const [name, setName] = useState(initial?.name ?? "");
  const [allergies, setAllergies] = useState<Allergy[]>(
    initial?.allergies ?? [],
  );
  const [note, setNote] = useState(initial?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [nameFocused, setNameFocused] = useState(false);
  const [noteFocused, setNoteFocused] = useState(false);
  // Synchronous guard: two taps in one frame both read `isSaving` as false.
  const savingRef = useRef(false);
  const noteRef = useRef<TextInputInstance>(null);

  const submit = async (input: FamilyProfileInput, recordConsent: boolean) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setIsSaving(true);
    setError(null);
    // No `finally`: React Compiler cannot compile a try with a finalizer.
    try {
      if (recordConsent) await grant();
      if (profileId === undefined) await createProfile.mutateAsync(input);
      else await updateProfile.mutateAsync({ id: profileId, input });
      savingRef.current = false;
      setIsSaving(false);
      haptics.notification(Haptics.NotificationFeedbackType.Success);
      // The toast is the one announcer; its own haptic is off (fired above).
      toast.success(`Saved ${input.name}`, { haptic: false });
      navigation.goBack();
    } catch (err) {
      savingRef.current = false;
      setIsSaving(false);
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      // InlineError announces the message itself.
      setError(describeFamilyError(err));
    }
  };

  const handleSave = () => {
    if (savingRef.current) return;
    const result = validateFamilyProfile({ name, allergies, note });
    if (!result.ok) {
      setError(result.message);
      setShakeKey((k) => k + 1);
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      return;
    }
    // On the parsed value, so it matches what the server counts as a detail.
    const hasHealthDetails =
      result.input.allergies.length > 0 || result.input.note !== null;
    if (hasHealthDetails && !consented) {
      confirm({
        ...HEALTH_CONSENT_PROMPT,
        onConfirm: () => void submit(result.input, true),
      });
      return;
    }
    void submit(result.input, false);
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <KeyboardAwareScrollViewCompat
        {...behindContentA11yProps}
        style={styles.container}
        contentContainerStyle={{
          paddingTop: headerInset,
          paddingHorizontal: Spacing.lg,
          paddingBottom: insets.bottom + Spacing["3xl"],
          gap: Spacing.xl,
        }}
        keyboardDismissMode="on-drag"
        bottomOffset={Spacing.lg}
      >
        <View>
          <TextInput
            label="Name"
            value={name}
            onChangeText={(text) => {
              setName(text);
              if (error) setError(null);
            }}
            onFocus={() => setNameFocused(true)}
            onBlur={() => setNameFocused(false)}
            maxLength={FAMILY_NAME_MAX}
            editable={!isSaving}
            error={!!error && name.trim() === ""}
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => noteRef.current?.focus()}
            autoCapitalize="words"
          />
          <FieldCounter
            length={name.length}
            max={FAMILY_NAME_MAX}
            visible={nameFocused}
          />
        </View>

        <View style={{ gap: Spacing.md }}>
          <ThemedText type="h4">Allergies</ThemedText>
          <AllergenPicker
            value={allergies}
            onChange={setAllergies}
            disabled={isSaving}
          />
        </View>

        <View>
          <TextInput
            ref={noteRef}
            label="Note (optional)"
            value={note}
            onChangeText={setNote}
            onFocus={() => setNoteFocused(true)}
            onBlur={() => setNoteFocused(false)}
            maxLength={FAMILY_NOTE_MAX}
            editable={!isSaving}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
          <FieldCounter
            length={note.length}
            max={FAMILY_NOTE_MAX}
            visible={noteFocused}
          />
        </View>

        <View>
          <InlineError
            message={error}
            shakeKey={shakeKey}
            style={{ marginBottom: Spacing.sm }}
          />
          <Button
            onPress={handleSave}
            loading={isSaving}
            loadingText="Saving…"
            accessibilityLabel={isSaving ? "Saving" : "Save"}
          >
            Save
          </Button>
        </View>
      </KeyboardAwareScrollViewCompat>
      <ConfirmationModal />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { justifyContent: "center" },
});
