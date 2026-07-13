import { describe, it, expect, vi } from "vitest";
import { safeGoBack } from "../safeGoBack";

describe("safeGoBack", () => {
  it("calls goBack when canGoBack is true, never invokes the fallback", () => {
    const goBack = vi.fn();
    const fallback = vi.fn();
    const navigation = { canGoBack: () => true, goBack };

    safeGoBack(navigation, fallback);

    expect(goBack).toHaveBeenCalledOnce();
    expect(fallback).not.toHaveBeenCalled();
  });

  it("invokes the fallback instead of goBack when canGoBack is false", () => {
    const goBack = vi.fn();
    const fallback = vi.fn();
    const navigation = { canGoBack: () => false, goBack };

    safeGoBack(navigation, fallback);

    expect(fallback).toHaveBeenCalledOnce();
    expect(goBack).not.toHaveBeenCalled();
  });
});
