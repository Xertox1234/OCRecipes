import type { ComponentProps } from "react";
import type { Feather } from "@expo/vector-icons";

export interface RecipeImportOption {
  key: "url" | "camera" | "gallery" | "clipboard";
  icon: ComponentProps<typeof Feather>["name"];
  title: string;
  desc: string;
}

export const RECIPE_IMPORT_OPTIONS: RecipeImportOption[] = [
  {
    key: "url",
    icon: "link",
    title: "From URL",
    desc: "Paste a recipe link",
  },
  {
    key: "camera",
    icon: "camera",
    title: "From Camera",
    desc: "Snap a cookbook or recipe card",
  },
  {
    key: "gallery",
    icon: "image",
    title: "From Gallery",
    desc: "Choose a recipe screenshot",
  },
  {
    key: "clipboard",
    icon: "clipboard",
    title: "From Clipboard",
    desc: "Use a copied recipe image",
  },
];
