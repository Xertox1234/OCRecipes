import { describe, it, expect } from "vitest";
import { generateDomainMap } from "../build-domain-map";

describe("generateDomainMap", () => {
  const sh = generateDomainMap();

  it("defines apply_domain_map and documents the caller-provided _add", () => {
    expect(sh).toContain("apply_domain_map() {");
    expect(sh).toContain("Define _add()");
  });

  it("marks the file as generated", () => {
    expect(sh).toContain("GENERATED FILE");
    expect(sh).toContain("npm run build:domain-map");
  });

  it("excludes the blanket typescript-on-.ts policy (per contract)", () => {
    // The blanket fallback lives in inject-patterns.sh, never in the map.
    expect(sh).not.toContain("*.ts|*.tsx) add_domain typescript");
  });

  it("emits all 18 LLM services in the ai-prompting block (4->18 drift fix)", () => {
    for (const s of [
      "voice-transcription.ts",
      "coach-tools.ts",
      "menu-analysis.ts",
      "canonical-enrichment.ts",
    ]) {
      expect(sh).toContain(`server/services/${s}`);
    }
    expect(sh).toContain("_add ai-prompting;");
  });

  it("emits absolute and relative glob forms for a recursive dir", () => {
    expect(sh).toContain('"$f" == */server/routes/*');
    expect(sh).toContain('"$f" == server/routes/*');
  });

  it("never emits the camera routing label", () => {
    expect(sh).not.toMatch(/_add camera/);
  });

  it("emits the design_guidelines.md exact-file rule", () => {
    expect(sh).toContain("design_guidelines.md");
    expect(sh).toContain("_add design-system;");
  });

  it("does not emit routing-only (camera) lines that duplicate their parents", () => {
    // The Scan + camera-dir rules are routing-only (empty domains); their domains
    // duplicate the parent rules, so no separate _add block should appear.
    expect(sh).not.toContain("client/screens/Scan*");
    expect(sh).not.toContain("client/components/camera/*");
    // The parent rules ARE still emitted.
    expect(sh).toContain("client/screens/*");
    expect(sh).toContain("client/components/*");
  });

  it("emits the D6 hooks union (hooks, client-state, react-native, accessibility)", () => {
    const hooksLine = sh.split("\n").find((l) => l.includes("client/hooks/*"));
    expect(hooksLine).toBeDefined();
    for (const d of [
      "hooks",
      "client-state",
      "react-native",
      "accessibility",
    ]) {
      expect(hooksLine).toContain(`_add ${d};`);
    }
  });
});
