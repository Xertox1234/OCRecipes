// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { parseAiJson } from "../ai-json";

const schema = z.object({ name: z.string(), n: z.number() });
const msgs = {
  noResponse: "no response",
  invalid: "invalid data",
  validationFailed: "validation failed log",
};

function makeLog() {
  return { warn: vi.fn() };
}

describe("parseAiJson", () => {
  it("returns parsed data for valid JSON matching the schema", () => {
    const log = makeLog();
    expect(parseAiJson('{"name":"a","n":1}', schema, msgs, log)).toEqual({
      name: "a",
      n: 1,
    });
    expect(log.warn).not.toHaveBeenCalled();
  });

  it.each([null, undefined, ""])(
    "throws noResponse for empty content %j",
    (content) => {
      expect(() => parseAiJson(content, schema, msgs, makeLog())).toThrow(
        "no response",
      );
    },
  );

  it("throws invalid for unparseable JSON without logging", () => {
    const log = makeLog();
    expect(() => parseAiJson("not json", schema, msgs, log)).toThrow(
      "invalid data",
    );
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("logs zod errors and throws invalid on a schema miss", () => {
    const log = makeLog();
    expect(() => parseAiJson('{"name":1}', schema, msgs, log)).toThrow(
      "invalid data",
    );
    expect(log.warn).toHaveBeenCalledWith(
      { zodErrors: expect.any(Object) },
      "validation failed log",
    );
  });

  it("throws schemaMismatch (when given) on a schema miss, invalid on bad JSON", () => {
    const m = { ...msgs, schemaMismatch: "unexpected data" };
    expect(() => parseAiJson('{"name":1}', schema, m, makeLog())).toThrow(
      "unexpected data",
    );
    expect(() => parseAiJson("{", schema, m, makeLog())).toThrow(
      "invalid data",
    );
  });
});
