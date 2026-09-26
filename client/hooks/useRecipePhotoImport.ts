import { useMutation } from "@tanstack/react-query";
import {
  uploadRecipePhotoForAnalysis,
  type RecipePhotoResult,
} from "@/lib/photo-upload";

export function useRecipePhotoImport() {
  return useMutation<RecipePhotoResult, Error, string>({
    mutationFn: (uri: string) => uploadRecipePhotoForAnalysis(uri),
    // Its one call site (RecipePhotoImportScreen, via useRecipeExtractionFlow)
    // already shows a visible error + retry for any generic failure.
    meta: { silentError: true },
  });
}
