// client/hooks/useRecipeExtractionFlow.ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { RecipePhotoResult } from "@/lib/photo-upload";

export type ExtractionState = "analyzing" | "review" | "error";

interface UseRecipeExtractionFlowOptions<TInput> {
  input: TInput;
  mutationFn: (input: TInput) => Promise<RecipePhotoResult>;
  gateCheck: (result: RecipePhotoResult) => boolean;
  gateFailureMessage: string;
  errorCopy: (error: unknown) => string;
}

interface UseRecipeExtractionFlowResult {
  state: ExtractionState;
  result: RecipePhotoResult | null;
  errorMessage: string;
  retry: () => void;
}

/**
 * Shared analyzing -> review/error state machine for recipe extraction
 * screens (photo and pasted text). Runs `mutationFn` on mount and on
 * `retry`; `gateCheck` decides review vs. error for a successful result.
 * A monotonic run id discards a stale in-flight response if `retry` fires
 * again before the previous call resolves.
 */
export function useRecipeExtractionFlow<TInput>({
  input,
  mutationFn,
  gateCheck,
  gateFailureMessage,
  errorCopy,
}: UseRecipeExtractionFlowOptions<TInput>): UseRecipeExtractionFlowResult {
  const [state, setState] = useState<ExtractionState>("analyzing");
  const [result, setResult] = useState<RecipePhotoResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const runIdRef = useRef(0);

  const run = useCallback(() => {
    const thisRunId = ++runIdRef.current;
    setState("analyzing");
    setErrorMessage("");
    setResult(null);
    mutationFn(input).then(
      (data) => {
        if (runIdRef.current !== thisRunId) return;
        if (gateCheck(data)) {
          setResult(data);
          setState("review");
        } else {
          setErrorMessage(gateFailureMessage);
          setState("error");
        }
      },
      (error) => {
        if (runIdRef.current !== thisRunId) return;
        setErrorMessage(errorCopy(error));
        setState("error");
      },
    );
  }, [input, mutationFn, gateCheck, gateFailureMessage, errorCopy]);

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  return { state, result, errorMessage, retry: run };
}
