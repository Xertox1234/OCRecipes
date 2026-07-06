import { mergeHeaderInsetStyle } from "../screen-scroll-view-utils";

describe("mergeHeaderInsetStyle", () => {
  it("returns the inset entry with undefined as the second array element when no contentContainerStyle is given", () => {
    expect(mergeHeaderInsetStyle(88)).toEqual([{ paddingTop: 88 }, undefined]);
  });

  it("places the inset first so a caller paddingTop overrides it", () => {
    const merged = mergeHeaderInsetStyle(88, { paddingTop: 200 });

    expect(merged).toEqual([{ paddingTop: 88 }, { paddingTop: 200 }]);
  });

  it("preserves an unrelated caller style alongside the inset", () => {
    const merged = mergeHeaderInsetStyle(108, { paddingBottom: 24 });

    expect(merged).toEqual([{ paddingTop: 108 }, { paddingBottom: 24 }]);
  });

  it("passes through an array-form contentContainerStyle unchanged", () => {
    const callerStyle = [{ paddingBottom: 24 }, { flexGrow: 1 }];
    const merged = mergeHeaderInsetStyle(88, callerStyle);

    expect(merged).toEqual([{ paddingTop: 88 }, callerStyle]);
  });
});
