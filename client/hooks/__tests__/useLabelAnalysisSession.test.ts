// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { ApiError } from "@/lib/api-error";
import type { LabelExtractionResult } from "@/lib/photo-upload";
import { ErrorCode } from "@shared/constants/error-codes";
import { useLabelAnalysisSession } from "../useLabelAnalysisSession";

const makeToast = () => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  dismiss: vi.fn(),
});

const { mockUpload, toastHolder } = vi.hoisted(() => ({
  mockUpload: vi.fn(),
  toastHolder: { current: null as unknown },
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => toastHolder.current,
}));
vi.mock("@/lib/photo-upload", () => ({ uploadLabelForAnalysis: mockUpload }));

const LABEL = {
  servingSize: "1 cup",
  servingsPerContainer: 2,
  calories: 120,
  confidence: 0.9,
} as unknown as LabelExtractionResult;

const props = { imageUri: "file:///label.jpg", localPreview: LABEL };

let toast: ReturnType<typeof makeToast>;

beforeEach(() => {
  vi.clearAllMocks();
  toast = makeToast();
  toastHolder.current = toast;
  mockUpload.mockResolvedValue({ sessionId: "s1", labelData: LABEL });
});

describe("useLabelAnalysisSession", () => {
  // The toast context value changes identity when Reduce Motion is toggled.
  // The upload must not depend on it: a second run is a second AI call.
  it("does not upload again when the toast changes identity", async () => {
    const { result, rerender } = renderHook(() =>
      useLabelAnalysisSession(props),
    );
    await waitFor(() => expect(result.current.sessionId).toBe("s1"));
    expect(mockUpload).toHaveBeenCalledTimes(1);

    toastHolder.current = makeToast();
    rerender();
    await act(async () => {});

    expect(mockUpload).toHaveBeenCalledTimes(1);
  });

  it("retry uploads again and dismisses through the current toast", async () => {
    mockUpload.mockRejectedValueOnce(new ApiError("Upload failed: 500"));
    const { result, rerender } = renderHook(() =>
      useLabelAnalysisSession(props),
    );
    await waitFor(() => expect(result.current.uploadFailed).toBe(true));

    const newer = makeToast();
    toastHolder.current = newer;
    rerender();
    act(() => result.current.retry());

    await waitFor(() => expect(result.current.sessionId).toBe("s1"));
    expect(mockUpload).toHaveBeenCalledTimes(2);
    expect(newer.dismiss).toHaveBeenCalledTimes(1);
    expect(toast.dismiss).not.toHaveBeenCalled();
  });

  it("a failed upload with a local preview offers Retry", async () => {
    mockUpload.mockRejectedValue(new ApiError("Upload failed: 500"));
    const { result } = renderHook(() => useLabelAnalysisSession(props));
    await waitFor(() => expect(result.current.uploadFailed).toBe(true));

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn't verify this label with AI. Retry before logging.",
      { action: { label: "Retry", onPress: expect.any(Function) } },
    );
  });

  // Retry straight away hits the limiter again, so the toast says to wait and
  // carries no Retry action. The log button still turns into "Retry Analysis".
  it("a rate-limited upload with a local preview says to wait, with no Retry action", async () => {
    mockUpload.mockRejectedValue(
      new ApiError("Upload failed: 429", ErrorCode.RATE_LIMITED, 429),
    );
    const { result } = renderHook(() => useLabelAnalysisSession(props));
    await waitFor(() => expect(result.current.uploadFailed).toBe(true));

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(
      "Too many requests. Wait a moment, then retry before logging.",
    );
  });
});
