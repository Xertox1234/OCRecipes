// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";

import { useVoiceRecording } from "../useVoiceRecording";

const {
  mockRequestPermissionsAsync,
  mockSetAudioModeAsync,
  mockCreateAsync,
  mockStopAndUnload,
  mockGetURI,
} = vi.hoisted(() => ({
  mockRequestPermissionsAsync: vi.fn(),
  mockSetAudioModeAsync: vi.fn(),
  mockCreateAsync: vi.fn(),
  mockStopAndUnload: vi.fn(),
  mockGetURI: vi.fn(),
}));

vi.mock("expo-av", () => ({
  Audio: {
    requestPermissionsAsync: () => mockRequestPermissionsAsync(),
    setAudioModeAsync: (opts: unknown) => mockSetAudioModeAsync(opts),
    Recording: {
      createAsync: () => mockCreateAsync(),
    },
    RecordingOptionsPresets: {
      HIGH_QUALITY: { preset: "high" },
    },
  },
}));

describe("useVoiceRecording", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("starts recording on permission grant", async () => {
    mockRequestPermissionsAsync.mockResolvedValue({ status: "granted" });
    mockSetAudioModeAsync.mockResolvedValue(undefined);
    mockCreateAsync.mockResolvedValue({
      recording: { stopAndUnloadAsync: mockStopAndUnload, getURI: mockGetURI },
    });

    const { result } = renderHook(() => useVoiceRecording());

    expect(result.current.isRecording).toBe(false);

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.isRecording).toBe(true);
    expect(mockSetAudioModeAsync).toHaveBeenCalledWith({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });
  });

  it("throws when permission denied", async () => {
    mockRequestPermissionsAsync.mockResolvedValue({ status: "denied" });

    const { result } = renderHook(() => useVoiceRecording());

    await expect(
      act(async () => {
        await result.current.startRecording();
      }),
    ).rejects.toThrow("Microphone permission not granted");

    expect(result.current.isRecording).toBe(false);
  });

  it("stops recording and returns URI", async () => {
    mockRequestPermissionsAsync.mockResolvedValue({ status: "granted" });
    mockSetAudioModeAsync.mockResolvedValue(undefined);
    mockStopAndUnload.mockResolvedValue(undefined);
    mockGetURI.mockReturnValue("file:///recording.m4a");
    mockCreateAsync.mockResolvedValue({
      recording: { stopAndUnloadAsync: mockStopAndUnload, getURI: mockGetURI },
    });

    const { result } = renderHook(() => useVoiceRecording());

    await act(async () => {
      await result.current.startRecording();
    });

    let uri: string | null = null;
    await act(async () => {
      uri = await result.current.stopRecording();
    });

    expect(uri).toBe("file:///recording.m4a");
    expect(result.current.isRecording).toBe(false);
    expect(result.current.recordingUri).toBe("file:///recording.m4a");
    expect(mockSetAudioModeAsync).toHaveBeenCalledWith({
      allowsRecordingIOS: false,
    });
  });

  it("returns null when stopRecording called without active recording", async () => {
    const { result } = renderHook(() => useVoiceRecording());

    let uri: string | null = "initial";
    await act(async () => {
      uri = await result.current.stopRecording();
    });

    expect(uri).toBeNull();
  });
});
