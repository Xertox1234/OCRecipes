// Mirrors inject-patterns.sh:164-186 — bash [[ "$path" == $glob ]] where `*`
// (and `**`) match any run of characters INCLUDING `/`, so literal `/`
// separators in the glob are required. This is intentionally NOT globstar.
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      while (glob[i + 1] === "*") i++; // collapse a run of * into one
      re += ".*";
    } else if (c === "?") {
      re += ".";
    } else {
      re += c.replace(/[.+^${}()|[\]\\/]/g, "\\$&");
    }
  }
  return new RegExp("^" + re + "$");
}

export function matchesAnyGlob(path: string, globs: string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(path));
}
