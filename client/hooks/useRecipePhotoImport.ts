import { useMutation } from "@tanstack/react-query";
import {
  uploadRecipePhotoForAnalysis,
  type RecipePhotoResult,
} from "@/lib/photo-upload";

export function useRecipePhotoImport() {
  return useMutation<RecipePhotoResult, Error, string>({
    mutationFn: (uri: string) => uploadRecipePhotoForAnalysis(uri),
  });
}
