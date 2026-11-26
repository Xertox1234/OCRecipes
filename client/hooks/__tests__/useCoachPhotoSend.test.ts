// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { Alert, Platform, type AlertButton } from "react-native";
import { ErrorCode } from "@shared/constants/error-codes";
import { ApiError } from "@/lib/api-error";
import { pickCoachPhoto } from "@/lib/coach-photo-picker";
import { uploadPhotoToCoach } from "@/lib/photo-upload";
import {
  awaitCoachBarcode,
  sendBarcodeToCoach,
  settleCoachBarcode,
} from "@/lib/coach-barcode-scan";
import { preReadLabel, sendLabelToCoach } from "@/lib/coach-label-pre-read";
import { recognizeTextFromPhoto } from "@/camera/utils/recognizeTextFromPhoto";
import { useCoachPhotoSend } from "../useCoachPhotoSend";

vi.mock("@/lib/coach-photo-picker", () => ({ pickCoachPhoto: vi.fn() }));
vi.mock("@/lib/photo-upload", () => ({ uploadPhotoToCoach: vi.fn() }));
vi.mock("@/lib/coach-label-pre-read", () => ({
  preReadLabel: vi.fn(),
  sendLabelToCoach: vi.fn(),
}));
vi.mock("@/camera/utils/recognizeTextFromPhoto", () => ({
  recognizeTextFromPhoto: vi.fn(),
}));
vi.mock("@/lib/coach-barcode-scan", () => ({
  awaitCoachBarcode: vi.fn(),
  sendBarcodeToCoach: vi.fn(),
  settleCoachBarcode: vi.fn(),
}));

function setup(over: Partial<Parameters<typeof useCoachPhotoSend>[0]> = {}) {
  const args = {
    disabled: false,
    ensureConversation: vi.fn().mockResolvedValue(7),
    onStart: vi.fn(),
    onSettled: vi.fn(),
    onPickFailure: vi.fn(),
    ...over,
  };
  const hook = renderHook(() => useCoachPhotoSend(args));
  return { ...hook, args };
}

/** Open the chooser and tap one of its buttons. */
async function choose(
  result: { current: ReturnType<typeof useCoachPhotoSend> },
  label: string,
) {
  const alertSpy = vi.spyOn(Alert, "alert");
  act(() => result.current.openPhotoChooser());
  const buttons = alertSpy.mock.calls.at(-1)?.[2] as AlertButton[];
  await act(async () => {
    await buttons.find((b) => b.text === label)?.onPress?.();
  });
}

describe("useCoachPhotoSend", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(Alert, "alert").mockImplementation(() => undefined);
  });

  it("offers the camera, the library and a way out", () => {
    const { result } = setup();
    const alertSpy = vi.spyOn(Alert, "alert");
    act(() => result.current.openPhotoChooser());
    const buttons = alertSpy.mock.calls.at(-1)?.[2] as AlertButton[];
    expect(buttons.map((b) => b.text)).toEqual([
      "Take Photo",
      "Choose from Library",
      "Cancel",
    ]);
  });

  it("uploads the picked photo to the conversation and settles clean", async () => {
    vi.mocked(pickCoachPhoto).mockResolvedValue("file:///meal.jpg");
    vi.mocked(uploadPhotoToCoach).mockResolvedValue("I found 2 foods.");
    const { result, args } = setup({ openingBriefForm: "short" });

    await choose(result, "Take Photo");

    expect(pickCoachPhoto).toHaveBeenCalledWith("camera", expect.any(Function));
    expect(args.onStart).toHaveBeenCalledExactlyOnceWith("photo");
    expect(uploadPhotoToCoach).toHaveBeenCalledWith(
      "file:///meal.jpg",
      7,
      "short",
    );
    expect(args.onSettled).toHaveBeenCalledWith(
      7,
      null,
      true,
      "I found 2 foods.",
    );
    expect(result.current.isSendingPhoto).toBe(false);
  });

  describe("a label the phone can read", () => {
    const read = {
      calories: 250,
      protein: 5,
      carbs: 31,
      fat: 12,
      servingSize: "1 cup (228g)",
    };

    it("sends the numbers, not the photo", async () => {
      vi.mocked(pickCoachPhoto).mockResolvedValue("file:///label.jpg");
      vi.mocked(preReadLabel).mockResolvedValue(read);
      vi.mocked(sendLabelToCoach).mockResolvedValue("I read that label.");
      const { result, args } = setup({ openingBriefForm: "full" });

      await choose(result, "Choose from Library");

      expect(preReadLabel).toHaveBeenCalledWith(
        "file:///label.jpg",
        recognizeTextFromPhoto,
      );
      expect(args.onStart).toHaveBeenCalledExactlyOnceWith("photo");
      expect(sendLabelToCoach).toHaveBeenCalledWith(read, 7, "full");
      expect(uploadPhotoToCoach).not.toHaveBeenCalled();
      expect(args.onSettled).toHaveBeenCalledWith(
        7,
        null,
        true,
        "I read that label.",
      );
    });

    it("reports a refused send as a photo failure and does not upload the photo as well", async () => {
      vi.mocked(pickCoachPhoto).mockResolvedValue("file:///label.jpg");
      vi.mocked(preReadLabel).mockResolvedValue(read);
      vi.mocked(sendLabelToCoach).mockRejectedValue(
        new ApiError("429: limit", ErrorCode.DAILY_LIMIT_REACHED),
      );
      const { result, args } = setup();

      await choose(result, "Take Photo");

      expect(uploadPhotoToCoach).not.toHaveBeenCalled();
      const failure = vi.mocked(args.onSettled).mock.calls[0][1];
      expect(failure).not.toBeNull();
    });

    it("uploads the photo when the phone cannot read it as a label", async () => {
      vi.mocked(pickCoachPhoto).mockResolvedValue("file:///meal.jpg");
      vi.mocked(preReadLabel).mockResolvedValue(null);
      vi.mocked(uploadPhotoToCoach).mockResolvedValue("I found 2 foods.");
      const { result } = setup();

      await choose(result, "Take Photo");

      expect(sendLabelToCoach).not.toHaveBeenCalled();
      expect(uploadPhotoToCoach).toHaveBeenCalledWith(
        "file:///meal.jpg",
        7,
        undefined,
      );
    });
  });

  it("does nothing when the user cancels the picker", async () => {
    vi.mocked(pickCoachPhoto).mockResolvedValue(null);
    const { result, args } = setup();
    await choose(result, "Choose from Library");
    expect(pickCoachPhoto).toHaveBeenCalledWith(
      "library",
      expect.any(Function),
    );
    expect(args.onStart).not.toHaveBeenCalled();
    expect(uploadPhotoToCoach).not.toHaveBeenCalled();
  });

  it("settles with the failure when the upload is refused", async () => {
    vi.mocked(pickCoachPhoto).mockResolvedValue("file:///meal.jpg");
    vi.mocked(uploadPhotoToCoach).mockRejectedValue(
      new ApiError("Upload failed: 429", ErrorCode.DAILY_LIMIT_REACHED),
    );
    const { result, args } = setup();
    await choose(result, "Take Photo");
    expect(args.onSettled).toHaveBeenCalledWith(
      7,
      { atDailyLimit: true, message: null, maybeSaved: false },
      false,
      null,
    );
    expect(result.current.isSendingPhoto).toBe(false);
  });

  it("stops, with no upload, when the conversation could not be created", async () => {
    vi.mocked(pickCoachPhoto).mockResolvedValue("file:///meal.jpg");
    const { result, args } = setup({
      ensureConversation: vi.fn().mockResolvedValue(null),
    });
    await choose(result, "Take Photo");
    expect(uploadPhotoToCoach).not.toHaveBeenCalled();
    expect(args.onSettled).not.toHaveBeenCalled();
    expect(result.current.isSendingPhoto).toBe(false);
  });

  // The host's own state moves on while the conversation is created: the
  // brief flag must be the one from when the photo was picked.
  it("reports the brief as sent even after the host drops the brief form", async () => {
    vi.mocked(pickCoachPhoto).mockResolvedValue("file:///meal.jpg");
    vi.mocked(uploadPhotoToCoach).mockResolvedValue(null);
    const onSettled = vi.fn();
    const base = {
      disabled: false,
      onStart: vi.fn(),
      onSettled,
      onPickFailure: vi.fn(),
    };
    let form: "full" | undefined = "full";
    const hook = renderHook(() =>
      useCoachPhotoSend({
        ...base,
        openingBriefForm: form,
        ensureConversation: async () => {
          form = undefined;
          hook.rerender();
          return 7;
        },
      }),
    );
    await choose(hook.result, "Take Photo");
    expect(uploadPhotoToCoach).toHaveBeenCalledWith(
      "file:///meal.jpg",
      7,
      "full",
    );
    expect(onSettled).toHaveBeenCalledWith(7, null, true, null);
  });

  it("does not open while another turn is starting", () => {
    const { result } = setup({ canStart: () => false });
    const alertSpy = vi.spyOn(Alert, "alert");
    act(() => result.current.openPhotoChooser());
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("is busy while the picker is open, before any upload starts", async () => {
    let release: (uri: string | null) => void = () => undefined;
    vi.mocked(pickCoachPhoto).mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const { result } = setup();
    expect(result.current.isPhotoBusy()).toBe(false);

    const alertSpy = vi.spyOn(Alert, "alert");
    act(() => result.current.openPhotoChooser());
    const buttons = alertSpy.mock.calls.at(-1)?.[2] as AlertButton[];
    let done: unknown;
    act(() => {
      done = buttons.find((b) => b.text === "Take Photo")?.onPress?.();
    });
    expect(result.current.isPhotoBusy()).toBe(true);
    expect(result.current.isSendingPhoto).toBe(false);

    await act(async () => {
      release(null);
      await done;
    });
    expect(result.current.isPhotoBusy()).toBe(false);
  });

  it("does not open while disabled", () => {
    const { result } = setup({ disabled: true });
    const alertSpy = vi.spyOn(Alert, "alert");
    act(() => result.current.openPhotoChooser());
    expect(alertSpy).not.toHaveBeenCalled();
  });

  describe("with a barcode scanner", () => {
    const original = Platform.OS;
    afterEach(() => {
      Platform.OS = original;
    });

    it("offers the scanner first when the host can open one", () => {
      Platform.OS = "ios";
      const { result } = setup({ openScanner: vi.fn() });
      const alertSpy = vi.spyOn(Alert, "alert");
      act(() => result.current.openPhotoChooser());
      const buttons = alertSpy.mock.calls.at(-1)?.[2] as AlertButton[];
      expect(buttons.map((b) => b.text)).toEqual([
        "Scan a Barcode",
        "Take Photo",
        "Choose from Library",
        "Cancel",
      ]);
    });

    it("keeps to Android's three buttons: back or a tap outside cancels", () => {
      Platform.OS = "android";
      const { result } = setup({ openScanner: vi.fn() });
      const alertSpy = vi.spyOn(Alert, "alert");
      act(() => result.current.openPhotoChooser());
      const call = alertSpy.mock.calls.at(-1);
      expect((call?.[2] as AlertButton[]).map((b) => b.text)).toEqual([
        "Scan a Barcode",
        "Take Photo",
        "Choose from Library",
      ]);
      expect(call?.[3]).toEqual({ cancelable: true });
    });

    it("opens the scanner, then sends the code it read", async () => {
      vi.mocked(awaitCoachBarcode).mockResolvedValue("4006381333931");
      vi.mocked(sendBarcodeToCoach).mockResolvedValue("I found it.");
      const openScanner = vi.fn();
      const { result, args } = setup({
        openScanner,
        openingBriefForm: "full",
      });

      await choose(result, "Scan a Barcode");

      expect(openScanner).toHaveBeenCalledOnce();
      // The wait is registered before the screen opens, so a fast read
      // cannot be missed.
      expect(
        vi.mocked(awaitCoachBarcode).mock.invocationCallOrder[0],
      ).toBeLessThan(openScanner.mock.invocationCallOrder[0]);
      expect(pickCoachPhoto).not.toHaveBeenCalled();
      expect(args.onStart).toHaveBeenCalledExactlyOnceWith("barcode");
      expect(sendBarcodeToCoach).toHaveBeenCalledWith(
        "4006381333931",
        7,
        "full",
      );
      expect(uploadPhotoToCoach).not.toHaveBeenCalled();
      expect(args.onSettled).toHaveBeenCalledWith(7, null, true, "I found it.");
      expect(result.current.isSendingPhoto).toBe(false);
    });

    it("does nothing when the scanner is closed without a read", async () => {
      vi.mocked(awaitCoachBarcode).mockResolvedValue(null);
      const { result, args } = setup({ openScanner: vi.fn() });
      await choose(result, "Scan a Barcode");
      expect(args.onStart).not.toHaveBeenCalled();
      expect(sendBarcodeToCoach).not.toHaveBeenCalled();
      expect(result.current.isPhotoBusy()).toBe(false);
    });

    it("stops waiting when the scanner could not be opened", async () => {
      // As the real module: the wait ends when it is settled.
      let settle!: (code: string | null) => void;
      vi.mocked(awaitCoachBarcode).mockReturnValue(
        new Promise((resolve) => (settle = resolve)),
      );
      vi.mocked(settleCoachBarcode).mockImplementation((code) => settle(code));
      const { result, args } = setup({
        openScanner: () => {
          throw new Error("navigator not ready");
        },
      });
      await choose(result, "Scan a Barcode");
      expect(settleCoachBarcode).toHaveBeenCalledWith(null);
      expect(args.onStart).not.toHaveBeenCalled();
      expect(result.current.isPhotoBusy()).toBe(false);
    });

    it("stops waiting when the chat goes away", () => {
      const { unmount } = setup({ openScanner: vi.fn() });
      expect(settleCoachBarcode).not.toHaveBeenCalled();
      unmount();
      expect(settleCoachBarcode).toHaveBeenCalledExactlyOnceWith(null);
    });

    it("words a refused scan as a scan, not a photo", async () => {
      vi.mocked(awaitCoachBarcode).mockResolvedValue("4006381333931");
      vi.mocked(sendBarcodeToCoach).mockRejectedValue(new Error("offline"));
      const { result, args } = setup({ openScanner: vi.fn() });
      await choose(result, "Scan a Barcode");
      const failure = vi.mocked(args.onSettled).mock.calls[0][1];
      expect(failure?.message).toMatch(/barcode/i);
      expect(failure?.message).not.toMatch(/photo/i);
    });
  });
});
