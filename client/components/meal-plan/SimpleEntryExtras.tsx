import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { Chip } from "@/components/Chip";
import { FocusBottomSheetTextInput } from "@/components/FocusBottomSheetTextInput";
import { FocusField } from "@/components/FocusField";
import { InlineError } from "@/components/InlineError";
import { ThemedText } from "@/components/ThemedText";
import { useFieldFocus } from "@/components/useFieldFocus";
import { LABELLED_INPUT_TEXT } from "@/components/field-focus-utils";
import { useTheme } from "@/hooks/useTheme";
import {
  BorderRadius,
  FontFamily,
  Spacing,
  withOpacity,
} from "@/constants/theme";

const FIELD_LABEL = "Drink or side";

interface SimpleEntryExtrasProps {
  suggestions: string[];
  /** The text being estimated right now, if any. */
  pendingName: string | null;
  error: string | null;
  /** Resolves true once the food is in the entry. */
  onAdd: (text: string) => Promise<boolean>;
  /** The "something else" field has just opened. */
  onFieldShown?: () => void;
}

/**
 * Optional drinks and sides for a simple entry: a few suggestions for the
 * meal, plus a field for anything else. Each one is estimated and joins the
 * foods above.
 */
export function SimpleEntryExtras({
  suggestions,
  pendingName,
  error,
  onAdd,
  onFieldShown,
}: SimpleEntryExtrasProps) {
  const { theme } = useTheme();
  const fieldFocus = useFieldFocus();
  const [showField, setShowField] = useState(false);
  const [text, setText] = useState("");
  const busy = pendingName != null;
  const trimmed = text.trim();
  const canSubmit = trimmed.length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    // The draft stays until the food is in; a failure keeps it for a retry.
    if (await onAdd(trimmed)) setText("");
  };

  return (
    <View style={styles.container}>
      <ThemedText
        style={[styles.heading, { color: theme.textSecondary }]}
        accessibilityRole="header"
      >
        Add a drink or side
      </ThemedText>
      <View style={styles.chips}>
        {suggestions.map((name) => (
          <Chip
            key={name}
            label={name}
            variant="outline"
            accessibilityLabel={`Add ${name}`}
            onPress={busy ? undefined : () => void onAdd(name)}
            leading={
              pendingName === name ? (
                <ActivityIndicator size="small" color={theme.link} />
              ) : (
                <Feather
                  name="plus"
                  size={14}
                  color={theme.link}
                  accessible={false}
                />
              )
            }
          />
        ))}
        <Chip
          label="Something else"
          variant="outline"
          selected={showField}
          accessibilityLabel="Add something else"
          onPress={() => {
            if (!showField) onFieldShown?.();
            setShowField(!showField);
          }}
        />
      </View>

      {showField && (
        <FocusField
          focus={fieldFocus}
          label={FIELD_LABEL}
          hasValue={text.length > 0}
          style={[
            styles.field,
            { backgroundColor: withOpacity(theme.text, 0.05) },
          ]}
        >
          <FocusBottomSheetTextInput
            focusRing={false}
            onFocus={fieldFocus.onFocus}
            onBlur={fieldFocus.onBlur}
            style={[styles.input, { color: theme.text }]}
            value={text}
            onChangeText={setText}
            editable={!busy}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => void submit()}
            accessibilityLabel={FIELD_LABEL}
          />
          <Pressable
            onPress={() => void submit()}
            disabled={!canSubmit}
            hitSlop={8}
            style={[
              styles.submit,
              {
                backgroundColor: canSubmit
                  ? theme.accentSolid
                  : withOpacity(theme.text, 0.1),
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Add drink or side"
          >
            {pendingName != null && pendingName === trimmed ? (
              <ActivityIndicator size="small" color={theme.buttonText} />
            ) : (
              <Feather
                name="plus"
                size={18}
                color={canSubmit ? theme.buttonText : theme.textSecondary}
                accessible={false}
              />
            )}
          </Pressable>
        </FocusField>
      )}

      <InlineError message={error} style={styles.error} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: Spacing.lg,
  },
  heading: {
    fontSize: 13,
    fontFamily: FontFamily.semiBold,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: Spacing.sm,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginTop: Spacing.md,
    paddingLeft: Spacing.md,
    paddingRight: Spacing.sm,
    borderRadius: BorderRadius.card,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: FontFamily.regular,
    ...LABELLED_INPUT_TEXT,
  },
  submit: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  error: {
    marginTop: Spacing.sm,
  },
});
