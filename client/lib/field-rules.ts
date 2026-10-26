/**
 * The live checklist under a field with rules — form-fields spec §5.2. Each
 * rule's limits come from the shared modules the server validates with, so
 * the list can never promise something the server refuses.
 */
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  passwordLength,
} from "@shared/constants/password-policy";
import {
  USERNAME_MAX,
  USERNAME_MIN,
  USERNAME_PATTERN,
} from "@shared/constants/username";

export type FieldRule = { id: string; label: string; met: boolean };

/** The length rule, plus a `max` line only once the password is too long. */
export function passwordRules(pw: string): FieldRule[] {
  const length = passwordLength(pw);
  const rules: FieldRule[] = [
    {
      id: "min",
      label: `At least ${PASSWORD_MIN} characters`,
      met: length >= PASSWORD_MIN,
    },
  ];
  if (length > PASSWORD_MAX) {
    rules.push({
      id: "max",
      label: `At most ${PASSWORD_MAX} characters`,
      met: false,
    });
  }
  return rules;
}

export function confirmRules(pw: string, confirm: string): FieldRule[] {
  return [
    {
      id: "match",
      label: "Matches",
      met: confirm.length > 0 && confirm === pw,
    },
  ];
}

/** Expects the trimmed name, as the sign-up check and the server see it. */
export function usernameRules(u: string): FieldRule[] {
  return [
    {
      id: "length",
      label: `${USERNAME_MIN}–${USERNAME_MAX} characters`,
      met: u.length >= USERNAME_MIN && u.length <= USERNAME_MAX,
    },
    {
      id: "chars",
      label: "Letters, numbers or _",
      met: USERNAME_PATTERN.test(u),
    },
  ];
}

/**
 * Show the checklist while the field is focused, or once it has been checked
 * (left with text, or the main button pressed) while a rule is still unmet.
 * A field left empty stays quiet, as its error does (spec §5.1).
 */
export function rulesVisible(s: {
  focused: boolean;
  checked: boolean;
  rules: FieldRule[];
}): boolean {
  return s.focused || (s.checked && s.rules.some((r) => !r.met));
}
