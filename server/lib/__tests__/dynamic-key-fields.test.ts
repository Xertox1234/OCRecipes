import { describe, it, expect } from "vitest";
import type { Response } from "express";
import {
  markDynamicKeyFields,
  readDynamicKeyFields,
} from "../dynamic-key-fields";

/** Minimal Response stand-in — both functions under test only touch `res.locals`. */
function fakeRes(locals: Record<string, unknown> = {}): Response {
  return { locals } as unknown as Response;
}

describe("markDynamicKeyFields / readDynamicKeyFields", () => {
  it("round-trips a single marked field name", () => {
    const res = fakeRes();
    markDynamicKeyFields(res, ["allergenFlags"]);
    expect(readDynamicKeyFields(res)).toEqual(new Set(["allergenFlags"]));
  });

  it("returns an empty set when nothing was marked", () => {
    expect(readDynamicKeyFields(fakeRes())).toEqual(new Set());
  });

  it("merges across multiple calls instead of overwriting", () => {
    const res = fakeRes();
    markDynamicKeyFields(res, ["allergenFlags"]);
    markDynamicKeyFields(res, ["otherDynamicField"]);
    expect(readDynamicKeyFields(res)).toEqual(
      new Set(["allergenFlags", "otherDynamicField"]),
    );
  });

  it("accepts more than one field name in a single call", () => {
    const res = fakeRes();
    markDynamicKeyFields(res, ["allergenFlags", "otherDynamicField"]);
    expect(readDynamicKeyFields(res)).toEqual(
      new Set(["allergenFlags", "otherDynamicField"]),
    );
  });

  it("falls back to an empty set for a malformed (non-array) res.locals value", () => {
    // res.locals is a loose, untyped bag -- some other middleware could plausibly
    // set the same key to a non-array value. readDynamicKeyFields must not throw.
    const res = fakeRes({ dynamicKeyFields: "not-an-array" });
    expect(readDynamicKeyFields(res)).toEqual(new Set());
  });

  it("filters out non-string entries defensively", () => {
    const res = fakeRes({ dynamicKeyFields: ["allergenFlags", 42, null] });
    expect(readDynamicKeyFields(res)).toEqual(new Set(["allergenFlags"]));
  });
});
