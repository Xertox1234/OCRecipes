// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { Alert, type AlertButton } from "react-native";
import { ErrorCode } from "@shared/constants/error-codes";
import { ApiError } from "@/lib/api-error";
import { pickCoachPhoto } from "@/lib/coach-photo-picker";
import { uploadPhotoToCoach } from "@/lib/photo-upload";
import { useCoachPhotoSend } from "../useCoachPhotoSend";

vi.mock("@/lib/coach-photo-picker", () => ({ pickCoachPhoto: vi.fn() }));
vi.mock("@/lib/photo-upload", () => ({ uploadPhotoToCoach: vi.fn() }));

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
    vi.mocked(uploadPhotoToCoach).mockResolvedValue(undefined);
    const { result, args } = setup({ openingBriefForm: "short" });

    await choose(result, "Take Photo");

    expect(pickCoachPhoto).toHaveBeenCalledWith("camera", expect.any(Function));
    expect(args.onStart).toHaveBeenCalledOnce();
    expect(uploadPhotoToCoach).toHaveBeenCalledWith(
      "file:///meal.jpg",
      7,
      "short",
    );
    expect(args.onSettled).toHaveBeenCalledWith(7, null, true);
    expect(result.current.isSendingPhoto).toBe(false);
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
      { atDailyLimit: true, message: null },
      false,
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
    vi.mocked(uploadPhotoToCoach).mockResolvedValue(undefined);
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
    expect(onSettled).toHaveBeenCalledWith(7, null, true);
  });

  it("does not open while another turn is starting", () => {
    const { result } = setup({ canStart: () => false });
    const alertSpy = vi.spyOn(Alert, "alert");
    act(() => result.current.openPhotoChooser());
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("does not open while disabled", () => {
    const { result } = setup({ disabled: true });
    const alertSpy = vi.spyOn(Alert, "alert");
    act(() => result.current.openPhotoChooser());
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
