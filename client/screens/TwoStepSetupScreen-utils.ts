export type TwoStepSetupMode = "setup" | "new_phone" | "disable" | "new_codes";

/** "ABCDEFGH…" → "ABCD EFGH …" so the key can be typed into an app by hand. */
export function formatSetupKey(b32: string): string {
  return (b32.match(/.{1,4}/g) ?? []).join(" ");
}

/** What "Copy all" / "Share" hand over. */
export function recoveryCodesText(codes: string[]): string {
  return `OCRecipes recovery codes — each works once\n\n${codes.join("\n")}\n`;
}

/** Done stays disabled until the person confirms they saved the codes. */
export function canFinishSaveCodes(acknowledged: boolean): boolean {
  return acknowledged;
}

export function setupTitle(mode: TwoStepSetupMode): string {
  switch (mode) {
    case "setup":
      return "Turn on two-step verification";
    case "new_phone":
      return "Set up on a new phone";
    case "disable":
      return "Turn off two-step verification";
    case "new_codes":
      return "New recovery codes";
  }
}
