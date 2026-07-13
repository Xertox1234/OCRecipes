/**
 * Guard test: every fast-check property-test file pins a seed on its
 * `fc.assert(...)` / `fc.check(...)` calls.
 *
 * See docs/solutions/conventions/fast-check-property-tests-pin-seed-not-in-mutation-testinclude-2026-07-12.md —
 * `vitest.config.ts` sets `retry: 2` to absorb CPU-contention flakes. An
 * UNSEEDED property that finds a genuine counterexample can pass on retry
 * with a fresh random seed, silently absorbing a real bug as a flake. A
 * pinned seed makes any failure reproduce identically across all retry
 * attempts.
 *
 * Discovery is repo-wide (matches the convention's
 * `**\/__tests__/**\/*.property.test.ts` scope) — a `node_modules`/build-tool
 * denylist is used instead of a source-root allowlist so a future property
 * test dropped anywhere (client/, server/, shared/, scripts/, evals/, ...)
 * is still caught, not just the trees that happen to hold one today.
 *
 * This file itself is intentionally NOT named `*.property.test.ts` (it is
 * `fast-check-property-seed-guard.test.ts`), so the walk below never scans
 * its own synthetic fixtures below. Do not rename it to match that suffix.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";

// Directories that never contain first-party TypeScript source: dependency
// trees, VCS internals, this harness's own worktrees, native/build output.
// A conservative superset of vitest.config.ts's `test.exclude` (the repo's
// authoritative list of what Vitest itself skips) — deliberately broader,
// since a directory this walker misses fails OPEN (a property test hiding
// there is silently never checked), while an extra excluded directory only
// costs a skipped subtree that never held source anyway.
// Matched against each entry's basename (not a full path), so ".claude"
// alone is sufficient to skip ".claude/worktrees" too.
const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  ".claude",
  ".worktrees",
  ".expo",
  ".husky",
  ".eas",
  ".github",
  "ios",
  "android",
  "dist",
  "build",
  "coverage",
  ".stryker-tmp",
  "server_dist",
  "uploads",
  "assets",
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (EXCLUDED_DIRS.has(name)) return [];
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return name.endsWith(".property.test.ts") ? [p] : [];
  });
}

/**
 * Property-test files that live inside a `__tests__` directory — matches the
 * `**\/__tests__/**\/*.property.test.ts` convention glob.
 */
function findPropertyTestFiles(): string[] {
  return walk(".").filter((f) => f.split(sep).includes("__tests__"));
}

/**
 * If a string literal (`'`/`"`/`` ` ``, with escapes) or a comment (`//` or
 * `/* *\/`) starts at `src[i]`, returns the index just past it; otherwise
 * returns `i` unchanged. Shared by `extractBalanced` and `splitTopLevelArgs`
 * so a `(`, `)`, or `,` inside an assertion message, error string, or
 * comment cannot desync nesting-depth or argument-boundary tracking.
 *
 * Known limitation (not handled): a regex literal containing an unmatched
 * bracket character relative to its own delimiters (e.g. `/\(/`) is scanned
 * as ordinary source and can still desync a caller's paren/brace depth
 * count — disambiguating a regex literal from a division operator needs
 * preceding-token context, which this lexer-lite helper does not track.
 * Not fixed here (would meaningfully expand this file's scope beyond a
 * grep-based guard); does not affect the current real property test file.
 */
function skipStringOrComment(src: string, i: number): number {
  const ch = src[i];
  if (ch === '"' || ch === "'" || ch === "`") {
    let j = i + 1;
    while (j < src.length && src[j] !== ch) {
      j += src[j] === "\\" ? 2 : 1;
    }
    return Math.min(j + 1, src.length);
  }
  if (ch === "/" && src[i + 1] === "/") {
    let j = i + 2;
    while (j < src.length && src[j] !== "\n") j++;
    return j;
  }
  if (ch === "/" && src[i + 1] === "*") {
    let j = i + 2;
    while (j < src.length && !(src[j] === "*" && src[j + 1] === "/")) j++;
    return Math.min(j + 2, src.length);
  }
  return i;
}

/**
 * The `[start, end)` index ranges of every string literal and comment in
 * `src`. Used to discard a regex match that only "matches" because it falls
 * inside commented-out or quoted example code (see `findSeededIdentifiers`).
 */
function findOpaqueSpans(src: string): [number, number][] {
  const spans: [number, number][] = [];
  let i = 0;
  while (i < src.length) {
    const skip = skipStringOrComment(src, i);
    if (skip !== i) {
      spans.push([i, skip]);
      i = skip;
    } else {
      i++;
    }
  }
  return spans;
}

function isInsideAnySpan(index: number, spans: [number, number][]): boolean {
  return spans.some(([start, end]) => index >= start && index < end);
}

/**
 * Returns `src` with every string literal and comment span blanked out
 * (each character replaced with a space, so length/offsets are unchanged).
 * Used before running a bare `\bseed\s*:/` presence check so a `seed:`
 * substring that only appears inside a trailing comment or an unrelated
 * string value (e.g. `{ numRuns: 100 /* seed: omitted for now *\/ }` or
 * `note: "seed: fixed elsewhere"`) cannot satisfy the requirement — mirrors
 * `findOpaqueSpans`'s comment-awareness, which the structural parsing
 * (`extractBalanced`/`splitTopLevelArgs`/the `const` scan) already had, but
 * the seed-presence regex itself did not.
 */
function redactOpaqueSpans(src: string): string {
  const chars = src.split("");
  for (const [start, end] of findOpaqueSpans(src)) {
    for (let i = start; i < end; i++) chars[i] = " ";
  }
  return chars.join("");
}

/**
 * Extracts the substring from `openIndex` (an opening bracket) to its
 * matching closing bracket, inclusive, by tracking nesting depth — skipping
 * over string literals and comments so their contents can't contribute stray
 * brackets.
 */
function extractBalanced(
  src: string,
  openIndex: number,
  open: string,
  close: string,
): string {
  let depth = 0;
  let i = openIndex;
  while (i < src.length) {
    const skip = skipStringOrComment(src, i);
    if (skip !== i) {
      i = skip;
      continue;
    }
    if (src[i] === open) depth++;
    else if (src[i] === close) {
      depth--;
      if (depth === 0) return src.slice(openIndex, i + 1);
    }
    i++;
  }
  return src.slice(openIndex);
}

/**
 * Splits `src[start..end)` on top-level commas (depth 0 for `()`/`{}`/`[]`,
 * skipping string literals and comments), returning each argument's raw
 * source text. A trailing comma before `end` does not produce an empty
 * final argument, matching JS call-argument semantics.
 */
function splitTopLevelArgs(src: string, start: number, end: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let segStart = start;
  let i = start;
  while (i < end) {
    const skip = skipStringOrComment(src, i);
    if (skip !== i) {
      i = Math.min(skip, end);
      continue;
    }
    const ch = src[i];
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      args.push(src.slice(segStart, i));
      segStart = i + 1;
    }
    i++;
  }
  const last = src.slice(segStart, end);
  if (last.trim().length > 0) args.push(last);
  return args;
}

/**
 * Identifiers declared as `const IDENT = { ... }` whose object literal
 * contains a `seed:` key — covers the repo's shared fast-check params
 * convention (e.g. `const FC_PARAMS = { seed: 20260712, numRuns: 100 }`,
 * referenced by bare name from each `fc.assert(...)` call).
 *
 * A match starting inside a string literal or comment (e.g. a `//`-commented
 * "old approach" showing a fake `const FC_PARAMS = { seed: ... }`) is
 * discarded via `findOpaqueSpans` — otherwise a shadowed, actually-unseeded
 * real declaration of the same name would be misread as seeded.
 */
function findSeededIdentifiers(src: string): Set<string> {
  const seeded = new Set<string>();
  const opaqueSpans = findOpaqueSpans(src);
  const constRe =
    /\bconst\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::\s*[^=]+)?=\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = constRe.exec(src)) !== null) {
    if (isInsideAnySpan(match.index, opaqueSpans)) continue;
    const braceStart = src.indexOf("{", match.index);
    const body = extractBalanced(src, braceStart, "{", "}");
    if (/\bseed\s*:/.test(redactOpaqueSpans(body))) seeded.add(match[1]);
  }
  return seeded;
}

/**
 * Returns one description string per `fc.assert(...)` / `fc.check(...)` call
 * in `src` that pins no seed — neither inline (a `{ seed: ... }` argument)
 * nor via a shared params identifier declared elsewhere in the file with a
 * `seed:` key (see `findSeededIdentifiers`).
 *
 * The search is scoped to the call's trailing (params/config) arguments —
 * everything AFTER the first argument (the property/predicate created by
 * `fc.property(...)`) — not the full call text. Searching the full text
 * would false-"seed" a genuinely unseeded call whose property callback body
 * happens to mention `seed:` or a seeded identifier's name in a comment or
 * string (e.g. an assertion message), and would falsely treat that callback
 * body's own content as satisfying the requirement.
 *
 * Note: this checks that a `seed:` key is *present*, not that its value is a
 * fixed literal — `{ seed: Date.now(), ... }` would pass. That's intentional
 * per the convention doc's "Exceptions" (an env/time-driven seed is
 * sanctioned for a scheduled deep-fuzz job); the default suite is expected
 * to use a literal.
 */
function findUnseededCalls(filePath: string, src: string): string[] {
  const seededIdentifiers = findSeededIdentifiers(src);
  const offenders: string[] = [];
  const callRe = /\bfc\.(assert|check)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = callRe.exec(src)) !== null) {
    const openIndex = match.index + match[0].length - 1;
    const callText = extractBalanced(src, openIndex, "(", ")");
    const closeIndex = openIndex + callText.length - 1;
    const args = splitTopLevelArgs(src, openIndex + 1, closeIndex);
    const configArgs = args.slice(1); // drop the property/predicate argument
    const configText = configArgs.join(",");
    const redactedConfigText = redactOpaqueSpans(configText);
    const hasInlineSeed = /\bseed\s*:/.test(redactedConfigText);
    // Escape regex metacharacters in `id` (identifiers may contain `$`,
    // which is otherwise read as an end-of-string anchor and would make the
    // pattern unmatchable) before testing against the redacted config text,
    // so a comment/string mentioning the identifier's bare name can't count.
    const referencesSeededIdentifier = [...seededIdentifiers].some((id) =>
      new RegExp(`\\b${id.replace(/[$]/g, "\\$&")}\\b`).test(
        redactedConfigText,
      ),
    );
    if (!hasInlineSeed && !referencesSeededIdentifier) {
      const line = src.slice(0, match.index).split("\n").length;
      offenders.push(
        `${filePath}:${line} fc.${match[1]}() call has no pinned seed`,
      );
    }
  }
  return offenders;
}

describe("findUnseededCalls (unit, synthetic fixtures)", () => {
  it("flags an fc.assert call with no seed anywhere in the file (regression case)", () => {
    const src = `
      fc.assert(
        fc.property(fc.integer(), (n) => {
          expect(n).toBe(n);
        }),
      );
    `;
    expect(findUnseededCalls("virtual.ts", src)).toHaveLength(1);
  });

  it("does not flag an fc.assert call with an inline seed", () => {
    const src = `
      fc.assert(
        fc.property(fc.integer(), (n) => {
          expect(n).toBe(n);
        }),
        { seed: 1, numRuns: 10 },
      );
    `;
    expect(findUnseededCalls("virtual.ts", src)).toEqual([]);
  });

  it("does not flag an fc.assert call that references a shared seeded params const (the repo's actual convention)", () => {
    const src = `
      const FC_PARAMS = { seed: 20260712, numRuns: 100 } as const;
      fc.assert(
        fc.property(fc.integer(), (n) => {
          expect(n).toBe(n);
        }),
        FC_PARAMS,
      );
    `;
    expect(findUnseededCalls("virtual.ts", src)).toEqual([]);
  });

  it("flags fc.check the same way as fc.assert", () => {
    const src = `
      fc.check(fc.property(fc.integer(), (n) => n === n));
    `;
    expect(findUnseededCalls("virtual.ts", src)).toHaveLength(1);
  });

  it("does not misparse a paren-containing string literal inside the call as an unbalanced call", () => {
    const src = `
      fc.assert(
        fc.property(fc.integer(), (n) => {
          expect(String(n)).toBe("(" + n + ")");
        }),
        { seed: 7, numRuns: 5 },
      );
    `;
    expect(findUnseededCalls("virtual.ts", src)).toEqual([]);
  });

  it("still finds the true closing paren — and correctly flags the call as unseeded — when an assertion string contains an UNBALANCED paren", () => {
    // Regression case: a naive raw-character paren counter over-reads past
    // this call's true close (the lone "(" inside the string never gets a
    // matching ")"), potentially absorbing the seed of a later, unrelated
    // call and masking this genuinely-unseeded one as seeded.
    const src = `
      const FC_PARAMS = { seed: 1, numRuns: 5 } as const;
      fc.assert(
        fc.property(fc.integer(), (n) => {
          expect(() => f(n)).toThrow("unmatched (");
        }),
      );
      fc.assert(
        fc.property(fc.integer(), (n) => {
          expect(n).toBe(n);
        }),
        FC_PARAMS,
      );
    `;
    const offenders = findUnseededCalls("virtual.ts", src);
    expect(offenders).toHaveLength(1);
    expect(offenders[0]).toContain("virtual.ts:3");
  });

  it("does not treat a seeded identifier's name mentioned only in the property callback's own comment/string as satisfying the requirement", () => {
    // The callback body references "FC_PARAMS" in prose, not as an actual
    // trailing config argument — the call itself passes none.
    const src = `
      const FC_PARAMS = { seed: 1, numRuns: 5 } as const;
      fc.assert(
        fc.property(fc.integer(), (n) => {
          // NOTE: unlike other tests in this file, this one deliberately
          // does not use FC_PARAMS.
          expect(n).toBe(n);
        }),
      );
    `;
    expect(findUnseededCalls("virtual.ts", src)).toHaveLength(1);
  });

  it("does not let a commented-out fake declaration shadow a real, actually-unseeded const of the same name", () => {
    // The `// Old approach: ...` line looks like a seeded declaration but is
    // a comment; the REAL const two lines below has no seed at all.
    const src = `
      // Old approach: const FC_PARAMS = { seed: 1, numRuns: 10 };
      const FC_PARAMS = { numRuns: 100 };
      fc.assert(
        fc.property(fc.integer(), (n) => {
          expect(n).toBe(n);
        }),
        FC_PARAMS,
      );
    `;
    expect(findUnseededCalls("virtual.ts", src)).toHaveLength(1);
  });

  it("does not let a 'seed:' substring inside a comment in the call's config args satisfy the seed requirement", () => {
    // Regression case: a naive `/\bseed\s*:/.test(configText)` check runs
    // against unstripped source, so a comment mentioning "seed:" (without an
    // actual seed key) would fail-open — silently pass a genuinely unseeded
    // call.
    const src = `
      fc.assert(
        fc.property(fc.integer(), (n) => {
          expect(n).toBe(n);
        }),
        { numRuns: 100 /* seed: intentionally omitted for now */ },
      );
    `;
    expect(findUnseededCalls("virtual.ts", src)).toHaveLength(1);
  });

  it("does not let a 'seed:' substring inside a string value of a referenced const's body satisfy the seed requirement", () => {
    // Regression case: same fail-open risk as above, but inside the shared
    // params object's own body rather than the call's config args.
    const src = `
      const FC_PARAMS = { numRuns: 100, note: "seed: fixed elsewhere" };
      fc.assert(
        fc.property(fc.integer(), (n) => {
          expect(n).toBe(n);
        }),
        FC_PARAMS,
      );
    `;
    expect(findUnseededCalls("virtual.ts", src)).toHaveLength(1);
  });
});

describe("every *.property.test.ts file pins a seed on its fc.assert/fc.check calls (static guard)", () => {
  const files = findPropertyTestFiles();

  it("finds at least one property test file (a broken walker must not pass vacuously)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  // Known limitation (not handled): a *.property.test.ts file written with
  // `@fast-check/vitest`'s `test.prop()`/`it.prop()` sugar instead of a raw
  // `fc.assert`/`fc.check` call fails this check with the generic
  // "has no fc.assert()/fc.check() calls" message below — not a clearer
  // "test.prop/it.prop isn't recognized yet" message. Not fixed here:
  // `@fast-check/vitest` isn't a repo dependency and nothing uses it today,
  // and the convention doc mandates raw `fc.assert`/`fc.check`, so this is a
  // future-proofing gap rather than a current bug.
  it('every property test file makes at least one fc.assert/fc.check call (a `seed:` check on zero matched calls would pass vacuously — e.g. a file that imports fast-check under a non-`fc` alias, contrary to the convention doc\'s mandated `import * as fc from "fast-check"`)', () => {
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      const callCount = (src.match(/\bfc\.(assert|check)\s*\(/g) ?? []).length;
      expect(
        callCount,
        `${file} has no fc.assert()/fc.check() calls`,
      ).toBeGreaterThan(0);
    }
  });

  it("no unseeded fc.assert/fc.check calls across the repo", () => {
    const offenders = files.flatMap((file) =>
      findUnseededCalls(file, readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
