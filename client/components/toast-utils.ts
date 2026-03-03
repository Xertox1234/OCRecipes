import type { Colors } from "@/constants/theme";

export type ToastVariant = "success" | "error" | "info";

type Theme = (typeof Colors)["light"];

export function getToastColors(
  variant: ToastVariant,
  theme: Theme,
): { background: string; text: string; icon: string } {
  switch (variant) {
    case "success":
      return {
        background: theme.success,
        text: "#FFFFFF",
        icon: "check-circle",
      };
    case "error":
      return { background: theme.error, text: "#FFFFFF", icon: "alert-circle" };
    case "info":
      return { background: theme.info, text: "#FFFFFF", icon: "info" };
  }
}

export function getToastAccessibilityRole(
  variant: ToastVariant,
): "alert" | "none" {
  return variant === "error" ? "alert" : "none";
}
