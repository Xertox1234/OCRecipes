import { useCallback, useEffect, useReducer } from "react";

import { useToast } from "@/context/ToastContext";
import { ApiError } from "@/lib/api-error";
import {
  uploadLabelForAnalysis,
  type LabelExtractionResult,
} from "@/lib/photo-upload";
import { ErrorCode } from "@shared/constants/error-codes";
import {
  initialLabelSessionState,
  labelSessionReducer,
} from "@/screens/label-analysis-utils";

const UPDATED_TOAST_MS = 3000;

/**
 * The upload helper only casts the parsed body, so a 200 with no label data
 * reaches the hook. It must fail inside the upload's try: the reducer compares
 * the preview against the result during render, where a throw is a crash.
 * A separate function because React Compiler cannot compile a `throw` written
 * inside a try block.
 */
function requireLabelData(
  labelData: LabelExtractionResult | null | undefined,
): LabelExtractionResult {
  if (!labelData || typeof labelData !== "object") {
    throw new Error("Label analysis returned no label data");
  }
  return labelData;
}

/**
 * Upload the label photo for AI analysis (always, even with a local preview)
 * and reconcile the result with the preview. State transitions live in
 * labelSessionReducer.
 */
export function useLabelAnalysisSession({
  imageUri,
  barcode,
  localPreview,
}: {
  imageUri: string;
  barcode?: string;
  localPreview: LabelExtractionResult | null;
}) {
  const toast = useToast();
  const [state, dispatch] = useReducer(
    labelSessionReducer,
    localPreview,
    initialLabelSessionState,
  );
  const [retryToken, bumpRetryToken] = useReducer((t: number) => t + 1, 0);

  // The preview the screen mounted with. It never changes, so depending on it
  // never re-runs the upload; it decides the failure toast exactly as the
  // reducer decides `uploadFailed`.
  const hasLocalPreview = state.localPreview !== null;

  // Clear the failed state in the tap's own commit (as the pre-hook screen
  // did), not one render later when the effect re-runs.
  const retry = useCallback(() => {
    toast.dismiss();
    dispatch({ type: "uploadStarted" });
    bumpRetryToken();
  }, [toast]);

  useEffect(() => {
    let cancelled = false;

    async function analyze() {
      dispatch({ type: "uploadStarted" });
      try {
        const result = await uploadLabelForAnalysis(imageUri, barcode);
        if (cancelled) return;
        dispatch({
          type: "uploadSucceeded",
          sessionId: result.sessionId,
          aiData: requireLabelData(result.labelData),
        });
      } catch (err) {
        if (cancelled) return;
        // Never surface the raw error.message — the upload helper throws
        // ApiError("Upload failed: <status>", code). Show static copy.
        dispatch({
          type: "uploadFailed",
          message:
            err instanceof ApiError && err.code === ErrorCode.RATE_LIMITED
              ? "Too many requests. Please wait a moment and try again."
              : "Couldn't read this label. Try again with better lighting.",
        });
        if (hasLocalPreview) {
          toast.error(
            "Couldn't verify this label with AI. Retry before logging.",
            { action: { label: "Retry", onPress: retry } },
          );
        }
      }
      // Not a `finally`: React Compiler cannot compile try/finally yet. Both
      // early returns above fire only when cancelled, so this is equivalent.
      if (!cancelled) dispatch({ type: "settled" });
    }

    void analyze();
    return () => {
      cancelled = true;
    };
  }, [imageUri, barcode, retryToken, toast, retry, hasLocalPreview]);

  // Auto-hide the "Updated with AI analysis" toast.
  useEffect(() => {
    if (!state.showUpdatedToast) return;
    const timer = setTimeout(
      () => dispatch({ type: "toastHidden" }),
      UPDATED_TOAST_MS,
    );
    return () => clearTimeout(timer);
  }, [state.showUpdatedToast]);

  return { ...state, retry };
}
