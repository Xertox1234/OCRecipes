// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, screen } from "@testing-library/react";

import type { FamilyProfile } from "@shared/schema";

import { renderComponent } from "../../../../test/utils/render-component";
import { AudienceFilterChips } from "../AudienceFilterChips";
import { AudienceChoice, type AudienceChoiceValue } from "../AudienceChoice";
import type { AudienceFilter } from "../family-utils";

const haptics = vi.hoisted(() => ({
  selection: vi.fn(),
  impact: vi.fn(),
  notification: vi.fn(),
}));
vi.mock("@/hooks/useHaptics", () => ({ useHaptics: () => haptics }));

const ivy = { id: 7, name: "Ivy", allergies: [] } as unknown as FamilyProfile;
const sam = { id: 8, name: "Sam", allergies: [] } as unknown as FamilyProfile;
const profiles = [ivy, sam];

afterEach(() => cleanup());
beforeEach(() => vi.clearAllMocks());

describe("AudienceFilterChips", () => {
  const onChange = vi.fn();
  const onAddProfile = vi.fn();

  function renderChips(filter: AudienceFilter = { kind: "all" }) {
    return renderComponent(
      <AudienceFilterChips
        profiles={profiles}
        filter={filter}
        onChange={onChange}
        onAddProfile={onAddProfile}
      />,
    );
  }

  it("is a radiogroup of All, Me and each name, with the current one checked", () => {
    renderChips({ kind: "profile", profileId: 7 });
    expect(screen.getByRole("radiogroup")).toBeDefined();
    const radios = screen.getAllByRole("radio");
    expect(
      radios.map((r) => r.getAttribute("aria-label") ?? r.textContent),
    ).toEqual(["All", "Me", "Ivy", "Sam"]);
    const checked = radios.filter(
      (r) => r.getAttribute("aria-checked") === "true",
    );
    expect(checked).toHaveLength(1);
    expect(checked[0].textContent).toContain("Ivy");
  });

  it("selects a profile and ticks the selection haptic once", () => {
    renderChips();
    fireEvent.click(screen.getByRole("radio", { name: "Ivy" }));
    expect(onChange).toHaveBeenCalledWith({ kind: "profile", profileId: 7 });
    expect(haptics.selection).toHaveBeenCalledTimes(1);
  });

  it("selects Me and All", () => {
    renderChips({ kind: "profile", profileId: 7 });
    fireEvent.click(screen.getByRole("radio", { name: "Me" }));
    expect(onChange).toHaveBeenLastCalledWith({ kind: "me" });
    fireEvent.click(screen.getByRole("radio", { name: "All" }));
    expect(onChange).toHaveBeenLastCalledWith({ kind: "all" });
  });

  it("has a plain + button that adds a family member, outside the radio group", () => {
    renderChips();
    const add = screen.getByRole("button", { name: "Add a family member" });
    expect(add.getAttribute("role")).toBe("button");
    fireEvent.click(add);
    expect(onAddProfile).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("radio")).toHaveLength(4);
  });
});

describe("AudienceChoice", () => {
  const onChange = vi.fn();

  function renderChoice(value: AudienceChoiceValue) {
    return renderComponent(
      <AudienceChoice profiles={profiles} value={value} onChange={onChange} />,
    );
  }

  it("offers Everyone, Just me and each name as radios", () => {
    renderChoice({ audience: "shared", familyProfileId: null });
    expect(screen.getByRole("radiogroup")).toBeDefined();
    expect(
      screen
        .getAllByRole("radio")
        .map((r) => r.getAttribute("aria-label") ?? r.textContent),
    ).toEqual(["Everyone", "Just me", "Ivy", "Sam"]);
  });

  it("checks the option the value names", () => {
    renderChoice({ audience: "profile", familyProfileId: 8 });
    const checked = screen
      .getAllByRole("radio")
      .filter((r) => r.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
    expect(checked[0].textContent).toContain("Sam");
  });

  it("reports each choice with the id only for a profile", () => {
    renderChoice({ audience: "shared", familyProfileId: null });
    fireEvent.click(screen.getByRole("radio", { name: "Just me" }));
    expect(onChange).toHaveBeenLastCalledWith({
      audience: "self",
      familyProfileId: null,
    });
    fireEvent.click(screen.getByRole("radio", { name: "Ivy" }));
    expect(onChange).toHaveBeenLastCalledWith({
      audience: "profile",
      familyProfileId: 7,
    });
    fireEvent.click(screen.getByRole("radio", { name: "Everyone" }));
    expect(onChange).toHaveBeenLastCalledWith({
      audience: "shared",
      familyProfileId: null,
    });
  });
});
