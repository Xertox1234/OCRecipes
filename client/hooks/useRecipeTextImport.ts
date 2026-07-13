import { useMutation } from "@tanstack/react-query";
import {
  uploadRecipeTextForAnalysis,
  type RecipePhotoResult,
} from "@/lib/photo-upload";

export function useRecipeTextImport() {
  return useMutation<RecipePhotoResult, Error, string>({
    mutationFn: (text: string) => uploadRecipeTextForAnalysis(text),
  });
}
