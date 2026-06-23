interface ThemeColors {
  error: string;
  accentSolid: string;
  buttonText: string;
  backgroundSecondary: string;
  text: string;
}

interface ConfirmButtonStyle {
  backgroundColor: string;
  textColor: string;
}

/**
 * Returns button style for the confirm action based on destructive flag.
 * Destructive: red (theme.error) background, white text.
 * Non-destructive: accent (theme.accentSolid) background, white text.
 */
export function getConfirmButtonStyle(
  destructive: boolean,
  theme: ThemeColors,
): ConfirmButtonStyle {
  return {
    backgroundColor: destructive ? theme.error : theme.accentSolid,
    textColor: theme.buttonText,
  };
}

/**
 * Returns cancel button style — always secondary variant.
 */
export function getCancelButtonStyle(theme: ThemeColors): ConfirmButtonStyle {
  return {
    backgroundColor: theme.backgroundSecondary,
    textColor: theme.text,
  };
}

/**
 * Returns default button labels based on destructive flag.
 */
export function getDefaultLabels(destructive: boolean): {
  confirmLabel: string;
  cancelLabel: string;
} {
  return {
    confirmLabel: destructive ? "Delete" : "Confirm",
    cancelLabel: "Cancel",
  };
}
