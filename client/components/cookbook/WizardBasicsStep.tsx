import React, { useRef, useState, type Dispatch, type RefObject } from "react";
import { StyleSheet, View, type TextInput as RNTextInput } from "react-native";

import { ThemedText } from "@/components/ThemedText";
import { TextInput } from "@/components/TextInput";
import { FieldCounter } from "@/components/FieldCounter";
import { InlineError } from "@/components/InlineError";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import { CookbookCoverPlate } from "./CookbookCoverPlate";
import { COVER_WIDTH_COMPACT } from "./cookbook-cover-utils";
import type { WizardAction, WizardState } from "./cookbook-wizard-utils";

const NAME_MAX = 100;
const DESCRIPTION_MAX = 500;

type BasicsField = "name" | "description";

interface WizardBasicsStepProps {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
  /** The name field's ref from the screen's `useFieldValidation`. */
  nameRef: RefObject<RNTextInput | null>;
  nameError: string | null;
  /** Bumped on each rejected Continue so the error shakes. */
  nameShakeKey: number;
  onNameFocus?: () => void;
  onNameBlur?: () => void;
  /** Called with each name edit, so the screen's validation sees it too. */
  onNameChange?: (text: string) => void;
}

/**
 * Wizard step 1: name the cookbook. A small live cover sits at the top so
 * the name lands on the book as the user types.
 */
export function WizardBasicsStep({
  state,
  dispatch,
  nameRef,
  nameError,
  nameShakeKey,
  onNameFocus,
  onNameBlur,
  onNameChange,
}: WizardBasicsStepProps) {
  const { theme } = useTheme();
  const descriptionRef = useRef<RNTextInput>(null);
  // Tracked by field identity, not one boolean: moving Name → Description
  // fires blur and focus as separate events, and a shared flag would flash
  // "nothing focused" in between (see CookbookCreateScreen).
  const [focused, setFocused] = useState<BasicsField | null>(null);

  return (
    <View style={styles.container}>
      <CookbookCoverPlate
        name={state.name}
        description={state.description}
        width={COVER_WIDTH_COMPACT}
      />

      <View style={styles.titleBlock}>
        <ThemedText type="h3" accessibilityRole="header">
          Name your cookbook
        </ThemedText>
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          You can change any of this later.
        </ThemedText>
      </View>

      <View>
        <TextInput
          ref={nameRef}
          label="Cookbook name"
          placeholder="e.g. Sunday Suppers"
          value={state.name}
          onChangeText={(text) => {
            const value = text.slice(0, NAME_MAX);
            dispatch({ type: "setName", value });
            onNameChange?.(value);
          }}
          onFocus={() => {
            setFocused("name");
            onNameFocus?.();
          }}
          onBlur={() => {
            setFocused((f) => (f === "name" ? null : f));
            onNameBlur?.();
          }}
          maxLength={NAME_MAX}
          error={!!nameError}
          returnKeyType="next"
          // Keep the keyboard up while focus moves on.
          submitBehavior="submit"
          onSubmitEditing={() => descriptionRef.current?.focus()}
        />
        <FieldCounter
          length={state.name.length}
          max={NAME_MAX}
          visible={focused === "name"}
          style={styles.charCount}
        />
        <InlineError message={nameError} shakeKey={nameShakeKey} />

        <TextInput
          ref={descriptionRef}
          label="Description (optional)"
          placeholder="A line or two about what's inside"
          value={state.description}
          onChangeText={(text) =>
            dispatch({
              type: "setDescription",
              value: text.slice(0, DESCRIPTION_MAX),
            })
          }
          onFocus={() => setFocused("description")}
          onBlur={() => setFocused((f) => (f === "description" ? null : f))}
          maxLength={DESCRIPTION_MAX}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          style={styles.multilineInput}
          containerStyle={{ marginTop: Spacing.md }}
        />
        <FieldCounter
          length={state.description.length}
          max={DESCRIPTION_MAX}
          visible={focused === "description"}
          style={styles.charCount}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.lg,
  },
  titleBlock: {
    gap: Spacing.xs,
  },
  multilineInput: {
    minHeight: 92,
  },
  charCount: {
    marginTop: Spacing.xs,
  },
});
