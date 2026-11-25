// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { AppState, type AppStateStatus } from "react-native";
import { useHandsFree } from "../useHandsFree";

type Args = Parameters<typeof useHandsFree>[0];

function setup(over: Partial<Args> = {}) {
  const fns = {
    startListening: vi.fn(),
    stopListening: vi.fn(),
    speak: vi.fn(),
    stopSpeaking: vi.fn(),
    onStopped: vi.fn(),
  };
  const initial: Args = {
    available: true,
    isListening: false,
    isFinal: false,
    transcript: "",
    speechErrorKind: null,
    ...fns,
    ...over,
  };
  const hook = renderHook((props: Args) => useHandsFree(props), {
    initialProps: initial,
  });
  let current = initial;
  /** Re-render with some inputs changed, as the speech hooks would. */
  const set = (change: Partial<Args>) => {
    current = { ...current, ...change };
    hook.rerender(current);
  };
  return { ...hook, fns, set };
}

/** Start the loop and let the microphone open. */
function startListening(h: ReturnType<typeof setup>) {
  act(() => h.result.current.start());
  h.set({ isListening: true });
}

/** From listening: the user speaks, the recognizer ends, the turn is sent. */
function hearATurn(h: ReturnType<typeof setup>) {
  h.set({ isFinal: true, transcript: "log an apple" });
  h.set({ isListening: false });
}

describe("useHandsFree", () => {
  it("is off until started", () => {
    const h = setup();
    expect(h.result.current.phase).toBe("off");
    expect(h.fns.startListening).not.toHaveBeenCalled();
  });

  it("starts by listening", () => {
    const h = setup();
    act(() => h.result.current.start());
    expect(h.result.current.phase).toBe("listening");
    expect(h.fns.startListening).toHaveBeenCalledOnce();
  });

  it("does not start when it is not available", () => {
    const h = setup({ available: false });
    act(() => h.result.current.start());
    expect(h.result.current.phase).toBe("off");
    expect(h.fns.startListening).not.toHaveBeenCalled();
  });

  it("waits for the reply once something was heard", () => {
    const h = setup();
    startListening(h);
    hearATurn(h);
    expect(h.result.current.phase).toBe("thinking");
    expect(h.fns.onStopped).not.toHaveBeenCalled();
  });

  it("ignores the last turn's transcript until the microphone has opened", () => {
    // The recognizer's last final result is still set when the loop comes
    // back round to listening.
    const h = setup({ isFinal: true, transcript: "the previous turn" });
    act(() => h.result.current.start());
    expect(h.result.current.phase).toBe("listening");
  });

  it("speaks the reply, then listens again", () => {
    const h = setup();
    startListening(h);
    hearATurn(h);
    act(() => h.result.current.replyDone("Logged. Anything else?"));
    expect(h.result.current.phase).toBe("speaking");
    expect(h.fns.speak).toHaveBeenCalledExactlyOnceWith(
      "Logged. Anything else?",
    );
    // Never listening while it speaks: the microphone would hear the reply.
    expect(h.fns.startListening).toHaveBeenCalledOnce();

    act(() => h.result.current.spokenFinished());
    expect(h.result.current.phase).toBe("listening");
    expect(h.fns.startListening).toHaveBeenCalledTimes(2);
  });

  it("goes straight back to listening after a reply with nothing to say", () => {
    const h = setup();
    startListening(h);
    hearATurn(h);
    act(() => h.result.current.replyDone("   "));
    expect(h.fns.speak).not.toHaveBeenCalled();
    expect(h.result.current.phase).toBe("listening");
    expect(h.fns.startListening).toHaveBeenCalledTimes(2);
  });

  it("runs turn after turn", () => {
    const h = setup();
    startListening(h);
    for (let turn = 0; turn < 3; turn++) {
      hearATurn(h);
      act(() => h.result.current.replyDone("Done."));
      act(() => h.result.current.spokenFinished());
      // The recognizer clears its last result as it starts again.
      h.set({ isFinal: false, transcript: "" });
      h.set({ isListening: true });
    }
    expect(h.result.current.phase).toBe("listening");
    expect(h.fns.speak).toHaveBeenCalledTimes(3);
    expect(h.fns.onStopped).not.toHaveBeenCalled();
  });

  it("stops quietly when nothing was said", () => {
    const h = setup();
    startListening(h);
    h.set({ isListening: false });
    expect(h.result.current.phase).toBe("off");
    expect(h.fns.onStopped).toHaveBeenCalledExactlyOnceWith("silence");
  });

  it("treats the recognizer's own no-speech report as silence", () => {
    const h = setup();
    startListening(h);
    h.set({ isListening: false, speechErrorKind: "no-speech" });
    expect(h.fns.onStopped).toHaveBeenCalledExactlyOnceWith("silence");
  });

  it.each(["not-allowed", "failed"] as const)(
    "stops with an error when listening fails (%s)",
    (kind) => {
      const h = setup();
      act(() => h.result.current.start());
      h.set({ speechErrorKind: kind });
      expect(h.result.current.phase).toBe("off");
      expect(h.fns.onStopped).toHaveBeenCalledExactlyOnceWith("error");
    },
  );

  it("stops when the reply fails", () => {
    const h = setup();
    startListening(h);
    hearATurn(h);
    act(() => h.result.current.replyFailed());
    expect(h.result.current.phase).toBe("off");
    expect(h.fns.onStopped).toHaveBeenCalledExactlyOnceWith("error");
  });

  it("stops when the spoken reply is cut off", () => {
    const h = setup();
    startListening(h);
    hearATurn(h);
    act(() => h.result.current.replyDone("A long reply."));
    act(() => h.result.current.speechInterrupted());
    expect(h.result.current.phase).toBe("off");
    expect(h.fns.onStopped).toHaveBeenCalledExactlyOnceWith("interrupted");
    expect(h.fns.startListening).toHaveBeenCalledOnce();
  });

  it("ignores a cut-off or a finished reading that is not its own", () => {
    const h = setup();
    startListening(h);
    act(() => h.result.current.speechInterrupted());
    act(() => h.result.current.spokenFinished());
    expect(h.result.current.phase).toBe("listening");
    expect(h.fns.startListening).toHaveBeenCalledOnce();
  });

  it("ignores a reply when the loop is off", () => {
    const h = setup();
    act(() => h.result.current.replyDone("Hello."));
    act(() => h.result.current.replyFailed());
    expect(h.fns.speak).not.toHaveBeenCalled();
    expect(h.fns.onStopped).not.toHaveBeenCalled();
  });

  it("closes the microphone when stopped while listening", () => {
    const h = setup();
    startListening(h);
    act(() => h.result.current.stop());
    expect(h.result.current.phase).toBe("off");
    expect(h.fns.stopListening).toHaveBeenCalledOnce();
    expect(h.fns.onStopped).toHaveBeenCalledExactlyOnceWith("user");
    // The recognizer ending afterwards is not a second stop.
    h.set({ isListening: false });
    expect(h.fns.onStopped).toHaveBeenCalledOnce();
  });

  it("goes quiet when stopped while speaking", () => {
    const h = setup();
    startListening(h);
    hearATurn(h);
    act(() => h.result.current.replyDone("A long reply."));
    act(() => h.result.current.stop());
    expect(h.fns.stopSpeaking).toHaveBeenCalledOnce();
    expect(h.result.current.phase).toBe("off");
    // The reading it just stopped reports back; that is not a second stop.
    act(() => h.result.current.speechInterrupted());
    expect(h.fns.onStopped).toHaveBeenCalledExactlyOnceWith("user");
  });

  it("does nothing when stopped while already off", () => {
    const h = setup();
    act(() => h.result.current.stop());
    expect(h.fns.onStopped).not.toHaveBeenCalled();
    expect(h.fns.stopListening).not.toHaveBeenCalled();
  });

  it("stops when it is no longer available", () => {
    const h = setup();
    startListening(h);
    h.set({ available: false });
    expect(h.result.current.phase).toBe("off");
    expect(h.fns.stopListening).toHaveBeenCalledOnce();
    expect(h.fns.onStopped).toHaveBeenCalledExactlyOnceWith("unavailable");
  });

  it("stops when the app leaves the foreground", () => {
    let listener: ((state: AppStateStatus) => void) | undefined;
    const remove = vi.fn();
    const spy = vi
      .spyOn(AppState, "addEventListener")
      .mockImplementation((_type, fn) => {
        listener = fn as (state: AppStateStatus) => void;
        return { remove } as unknown as ReturnType<
          typeof AppState.addEventListener
        >;
      });
    const h = setup();
    startListening(h);
    act(() => listener?.("background"));
    expect(h.result.current.phase).toBe("off");
    expect(h.fns.stopListening).toHaveBeenCalledOnce();
    expect(h.fns.onStopped).toHaveBeenCalledExactlyOnceWith("background");
    h.unmount();
    expect(remove).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("listens again when the reply has nothing that can be read", () => {
    // A reply that is only a card: the voice reports it started nothing.
    const h = setup({ speak: vi.fn(() => false) });
    startListening(h);
    hearATurn(h);
    act(() => h.result.current.replyDone("```coach_blocks\n[]\n```"));
    expect(h.result.current.phase).toBe("listening");
    expect(h.fns.startListening).toHaveBeenCalledTimes(2);
  });

  it("stops with an error when the microphone cannot be started", async () => {
    const h = setup({
      startListening: vi.fn(() => Promise.reject(new Error("no mic"))),
    });
    await act(async () => {
      h.result.current.start();
    });
    expect(h.result.current.phase).toBe("off");
    expect(h.fns.onStopped).toHaveBeenCalledExactlyOnceWith("error");
  });

  it("keeps going when the app is only inactive (a system dialog)", () => {
    let listener: ((state: AppStateStatus) => void) | undefined;
    const spy = vi
      .spyOn(AppState, "addEventListener")
      .mockImplementation((_type, fn) => {
        listener = fn as (state: AppStateStatus) => void;
        return { remove: vi.fn() } as unknown as ReturnType<
          typeof AppState.addEventListener
        >;
      });
    const h = setup();
    startListening(h);
    act(() => listener?.("inactive"));
    expect(h.result.current.phase).toBe("listening");
    spy.mockRestore();
  });

  it("closes the microphone when it goes away mid-listen", () => {
    const h = setup();
    startListening(h);
    h.unmount();
    expect(h.fns.stopListening).toHaveBeenCalledOnce();
  });

  it("leaves the microphone alone when it goes away while off", () => {
    const h = setup();
    h.unmount();
    expect(h.fns.stopListening).not.toHaveBeenCalled();
  });
});
