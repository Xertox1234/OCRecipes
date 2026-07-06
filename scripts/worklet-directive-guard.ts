/**
 * Static guard: detect an imported (cross-file) function called inside a
 * Reanimated worklet body that lacks its own `"worklet"` directive.
 *
 * Background: the Reanimated Babel plugin workletizes a function only when it
 * carries a `"worklet"` directive, and it processes one file at a time — it
 * does NOT follow `import` edges. A plain function imported from another
 * module and called inside a worklet (e.g. a `runOnUI` body) reaches the UI
 * thread as a non-worklet reference and throws a fatal Worklets error. In a
 * release/OTA build that fatal has no error overlay — the app just closes.
 * See docs/solutions/runtime-errors/reanimated-worklet-util-needs-directive-across-imports-2026-06-27.md
 * for the real incident (PR #470 / #473) this guard follows up on.
 *
 * Scope (intentionally conservative — see the owning todo's Risks section):
 *  - Only NAMED imports from a relative path or the `@/` / `@shared/` aliases
 *    are resolved and checked. Default/namespace imports and library imports
 *    (react-native-reanimated, react-native-gesture-handler, etc.) are out of
 *    scope — those are either already worklets or not ours to annotate, which
 *    also satisfies "don't flag Reanimated built-ins / Math.*" for free
 *    (`Math.max(...)` is a MemberExpression call, never a bare-identifier
 *    call, and reanimated built-ins are never in the local-import map).
 *  - A same-file helper called inside a worklet IS checked too (verified
 *    against the installed `react-native-worklets` Babel plugin: it does NOT
 *    auto-workletize a plain function merely because a worklet calls it,
 *    same-file or not — only a function that itself carries the directive,
 *    or is itself a recognized hook/gesture callback, gets workletized).
 *    Resolution is MODULE-SCOPE (top-level) only by design — it does not
 *    recurse into function/block bodies, so a nested/shadowed declaration at
 *    non-top-level scope sharing the name is never matched (avoids
 *    misattributing a call to the wrong same-named declaration).
 *  - Only the worklet-callback hooks/gesture builder methods listed below are
 *    treated as worklet contexts. Full data-flow worklet inference (e.g. a
 *    `withTiming` completion callback) is out of scope.
 *  - Gesture-builder detection is textual, not data-flow: it only recognizes a
 *    directly-chained builder (`Gesture.Pan().onUpdate(...)`), not one built
 *    through an intermediate variable (`const g = Gesture.Pan(); g.onUpdate(...)`).
 *    Not exercised anywhere in this repo today (both real usages chain directly),
 *    but a future refactor to the variable form would silently lose coverage.
 *  - The local-shadow check (`isLocallyShadowed`) only matches a SIMPLE identifier
 *    binding. A destructured local/parameter sharing an import's name (e.g.
 *    `runOnUI(({ badFn }) => { "worklet"; badFn(1); })` where `badFn` is also a
 *    cross-file import) reproduces a false positive: the destructured binding is
 *    invisible to the shadow check, so the call is (incorrectly) attributed to
 *    the import. A known, accepted false-positive class — destructuring inside a
 *    worklet parameter/declaration for a name that collides with an import is
 *    rare in this codebase's style. Widening `bindingNameMatches` to walk
 *    `ObjectBindingPattern`/`ArrayBindingPattern` elements would close this gap.
 */
import ts from "typescript";
import path from "node:path";

export interface WorkletOffender {
  file: string;
  line: number;
  workletKind: string;
  calleeName: string;
  resolvedFile: string;
}

/** Minimal filesystem seam so the core logic is testable with in-memory fixtures. */
export interface ScanFsAdapter {
  /** Read a file's source text, or return null if it doesn't exist / can't be read. */
  readFile(absPath: string): string | null;
}

/** Alias prefix (no trailing slash, e.g. "@", "@shared") -> absolute directory it resolves to. */
export type AliasRoots = Record<string, string>;

const WORKLET_CALLBACK_HOOKS = new Set([
  "runOnUI",
  "useAnimatedStyle",
  "useAnimatedProps",
  "useAnimatedScrollHandler",
  "useAnimatedGestureHandler",
  "useAnimatedReaction",
  "useDerivedValue",
]);

const GESTURE_CALLBACK_METHODS = new Set([
  "onStart",
  "onUpdate",
  "onChange",
  "onEnd",
  "onBegin",
  "onFinalize",
  "onTouchesDown",
  "onTouchesMove",
  "onTouchesUp",
  "onTouchesCancelled",
]);

// Tried in order against the resolved base path (no extension yet). Includes
// RN platform-split suffixes (a bare specifier like "./foo" can resolve to
// foo.ios.ts / foo.android.ts / foo.native.ts at Metro bundle time) so a
// worklet helper split across platform files still resolves.
const CANDIDATE_SUFFIXES = [
  ".ts",
  ".tsx",
  "/index.ts",
  "/index.tsx",
  ".native.ts",
  ".native.tsx",
  ".ios.ts",
  ".ios.tsx",
  ".android.ts",
  ".android.tsx",
];

function createSource(filePath: string, text: string): ts.SourceFile {
  const kind = filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    kind,
  );
}

/** Resolve a relative or aliased module specifier to a base path (no extension). Returns
 * null for a bare package specifier (node_modules) — those are out of scope by design. */
function resolveModuleBase(
  fromFile: string,
  specifier: string,
  aliasRoots: AliasRoots,
): string | null {
  if (specifier.startsWith(".")) {
    return path.resolve(path.dirname(fromFile), specifier);
  }
  for (const [alias, root] of Object.entries(aliasRoots)) {
    if (specifier === alias || specifier.startsWith(`${alias}/`)) {
      const rest = specifier.slice(alias.length).replace(/^\//, "");
      return rest ? path.join(root, rest) : root;
    }
  }
  return null;
}

function readResolvedFile(
  basePath: string,
  fs: ScanFsAdapter,
): { path: string; source: string } | null {
  const exact = fs.readFile(basePath);
  if (exact !== null) return { path: basePath, source: exact };
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = basePath + suffix;
    const source = fs.readFile(candidate);
    if (source !== null) return { path: candidate, source };
  }
  return null;
}

interface ImportBinding {
  localName: string;
  importedName: string;
  moduleSpecifier: string;
}

/** Named, non-type-only imports whose module specifier is a string literal.
 * Default and namespace imports are intentionally not tracked (out of scope). */
function collectLocalImports(sourceFile: ts.SourceFile): ImportBinding[] {
  const bindings: ImportBinding[] = [];
  sourceFile.forEachChild((node) => {
    if (!ts.isImportDeclaration(node)) return;
    if (!ts.isStringLiteral(node.moduleSpecifier)) return;
    const moduleSpecifier = node.moduleSpecifier.text;
    const clause = node.importClause;
    if (!clause || clause.isTypeOnly) return;
    const namedBindings = clause.namedBindings;
    if (namedBindings && ts.isNamedImports(namedBindings)) {
      for (const el of namedBindings.elements) {
        if (el.isTypeOnly) continue;
        const importedName = (el.propertyName ?? el.name).text;
        bindings.push({
          localName: el.name.text,
          importedName,
          moduleSpecifier,
        });
      }
    }
  });
  return bindings;
}

interface WorkletBody {
  node: ts.Node;
  kind: string;
}

/** Walk the file for worklet-context call sites (the hooks/gesture methods above) and
 * collect the body of every callback argument passed to them. */
function collectWorkletBodies(sourceFile: ts.SourceFile): WorkletBody[] {
  const bodies: WorkletBody[] = [];

  function addCallbackArg(arg: ts.Expression, kind: string) {
    if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
      bodies.push({ node: arg.body, kind });
      return;
    }
    // useAnimatedScrollHandler / useAnimatedGestureHandler object-handler form:
    // { onScroll: (e) => {...}, onBeginDrag: (e) => {...}, ... }
    if (ts.isObjectLiteralExpression(arg)) {
      for (const prop of arg.properties) {
        const propName = prop.name ? prop.name.getText(sourceFile) : "?";
        if (
          ts.isPropertyAssignment(prop) &&
          (ts.isArrowFunction(prop.initializer) ||
            ts.isFunctionExpression(prop.initializer))
        ) {
          bodies.push({
            node: prop.initializer.body,
            kind: `${kind}.${propName}`,
          });
        } else if (ts.isMethodDeclaration(prop) && prop.body) {
          bodies.push({ node: prop.body, kind: `${kind}.${propName}` });
        }
      }
    }
  }

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && WORKLET_CALLBACK_HOOKS.has(callee.text)) {
        for (const arg of node.arguments) addCallbackArg(arg, callee.text);
      } else if (
        ts.isPropertyAccessExpression(callee) &&
        GESTURE_CALLBACK_METHODS.has(callee.name.text) &&
        callee.expression.getText(sourceFile).startsWith("Gesture.")
      ) {
        for (const arg of node.arguments) {
          addCallbackArg(arg, `Gesture.${callee.name.text}`);
        }
      }
    }
    // Deliberately does not stop recursing after a match: a worklet-context
    // hook nested inside another worklet's callback body (not seen anywhere in
    // this repo today) would have its body collected twice — once standalone,
    // once as part of the outer body's call scan — which can only ever produce
    // a duplicate finding, never a missed one. Accepted tradeoff, not an oversight.
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return bodies;
}

interface BareCall {
  name: string;
  line: number;
}

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

/** Only matches a simple identifier binding — destructuring patterns are a rare
 * shadowing vector and are conservatively NOT matched (never treated as a shadow),
 * to avoid overreaching into a class of binding this guard doesn't need to solve. */
function bindingNameMatches(name: ts.BindingName, target: string): boolean {
  return ts.isIdentifier(name) && name.text === target;
}

/** Whether `identifier` is bound by a LOCAL declaration (function/const/let/var,
 * parameter, catch clause, for-loop variable) somewhere between the call site and
 * module scope. A local declaration always shadows a same-named import, so such a
 * call must never be attributed to the import — otherwise an unrelated same-named
 * local helper is misreported as calling the cross-file import. Stops at the
 * SourceFile boundary: a top-level declaration sharing an import's name would be a
 * TS duplicate-identifier error anyway, so it's never reached in valid source. */
function isLocallyShadowed(identifier: ts.Identifier): boolean {
  const name = identifier.text;
  let current: ts.Node | undefined = identifier.parent;
  while (current && !ts.isSourceFile(current)) {
    if (
      isFunctionLike(current) &&
      current.parameters.some((p) => bindingNameMatches(p.name, name))
    ) {
      return true;
    }
    if (ts.isBlock(current)) {
      for (const stmt of current.statements) {
        if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === name) {
          return true;
        }
        if (ts.isVariableStatement(stmt)) {
          for (const decl of stmt.declarationList.declarations) {
            if (bindingNameMatches(decl.name, name)) return true;
          }
        }
      }
    }
    if (
      ts.isCatchClause(current) &&
      current.variableDeclaration &&
      bindingNameMatches(current.variableDeclaration.name, name)
    ) {
      return true;
    }
    if (
      (ts.isForStatement(current) ||
        ts.isForOfStatement(current) ||
        ts.isForInStatement(current)) &&
      current.initializer &&
      ts.isVariableDeclarationList(current.initializer)
    ) {
      for (const decl of current.initializer.declarations) {
        if (bindingNameMatches(decl.name, name)) return true;
      }
    }
    current = current.parent;
  }
  return false;
}

/** Every call expression within `bodyNode` whose callee is a bare identifier
 * (never a MemberExpression like `Math.max` or `e.foo`) AND is not locally
 * shadowed by a same-named function/variable/parameter declared between the
 * call site and module scope. */
function collectBareCalleeCalls(
  bodyNode: ts.Node,
  sourceFile: ts.SourceFile,
): BareCall[] {
  const calls: BareCall[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      !isLocallyShadowed(node.expression)
    ) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(
        node.expression.getStart(sourceFile),
      );
      calls.push({ name: node.expression.text, line: line + 1 });
    }
    ts.forEachChild(node, visit);
  }
  visit(bodyNode);
  return calls;
}

function blockStartsWithWorkletDirective(body: ts.ConciseBody): boolean {
  // A directive prologue is only expressible in a block body — a concise
  // arrow body (`() => "worklet"`, a bare expression) can never carry one, so
  // it correctly reads as "no directive". Within a block, the directive
  // prologue is the leading run of string-literal expression statements
  // (e.g. `"use strict"; "worklet";`) — this matches the real Reanimated
  // Babel plugin, which accepts "worklet" anywhere in that leading run, not
  // only as literally the first statement.
  if (!ts.isBlock(body)) return false;
  for (const stmt of body.statements) {
    if (
      !ts.isExpressionStatement(stmt) ||
      !ts.isStringLiteral(stmt.expression)
    ) {
      return false; // end of the directive prologue — "worklet" never appeared
    }
    if (stmt.expression.text === "worklet") return true;
  }
  return false;
}

/** Look up `name` among `sourceFile`'s MODULE-SCOPE (top-level) declarations
 * only — deliberately does NOT recurse into function/block bodies. A DFS that
 * walked every descendant could match a nested, shadowed same-named
 * declaration (e.g. a private helper inside another function) instead of the
 * real top-level declaration, producing both false positives and false
 * negatives. Returns null when no top-level function/const-arrow declaration
 * by that name exists (e.g. a re-export chain, a class method, or a
 * global/built-in) — callers must treat null as SKIP, never as "no
 * directive", to keep the false-positive rate low. */
function findTopLevelWorkletDirective(
  sourceFile: ts.SourceFile,
  name: string,
): boolean | null {
  for (const stmt of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(stmt) &&
      stmt.name?.text === name &&
      stmt.body
    ) {
      return blockStartsWithWorkletDirective(stmt.body);
    }
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.name.text === name &&
          decl.initializer &&
          (ts.isArrowFunction(decl.initializer) ||
            ts.isFunctionExpression(decl.initializer))
        ) {
          return blockStartsWithWorkletDirective(decl.initializer.body);
        }
      }
    }
  }
  return null;
}

/** Look up `exportedName` in the resolved target file and report whether its
 * definition carries a `"worklet"` directive. Returns null when the target
 * file or the named declaration can't be found (e.g. a re-export chain, or
 * an export that isn't a plain function) — callers should skip rather than
 * flag a null result, to keep the false-positive rate low. */
function resolveWorkletDirective(
  basePath: string,
  exportedName: string,
  fs: ScanFsAdapter,
): boolean | null {
  const found = readResolvedFile(basePath, fs);
  if (!found) return null;
  const targetSource = createSource(found.path, found.source);
  return findTopLevelWorkletDirective(targetSource, exportedName);
}

/**
 * Scan one file's source for imported, non-worklet functions called inside a
 * worklet body. `filePath` must be an absolute path (used to resolve relative
 * imports); `aliasRoots` maps alias prefixes (e.g. "@", "@shared") to their
 * absolute directory.
 */
export function scanFileForWorkletOffenders(
  filePath: string,
  sourceText: string,
  fs: ScanFsAdapter,
  aliasRoots: AliasRoots,
): WorkletOffender[] {
  const sourceFile = createSource(filePath, sourceText);
  const importMap = new Map(
    collectLocalImports(sourceFile).map((b) => [b.localName, b]),
  );

  const offenders: WorkletOffender[] = [];
  for (const { node, kind } of collectWorkletBodies(sourceFile)) {
    for (const call of collectBareCalleeCalls(node, sourceFile)) {
      const binding = importMap.get(call.name);
      if (!binding) {
        // Not a cross-file import — either a same-file, module-scope helper
        // (checked below) or a library built-in / genuine global (no
        // top-level declaration by that name in this file at all, so
        // findTopLevelWorkletDirective returns null and is correctly skipped).
        const sameFileDirective = findTopLevelWorkletDirective(
          sourceFile,
          call.name,
        );
        if (sameFileDirective === false) {
          offenders.push({
            file: filePath,
            line: call.line,
            workletKind: kind,
            calleeName: call.name,
            resolvedFile: filePath,
          });
        }
        continue;
      }

      const basePath = resolveModuleBase(
        filePath,
        binding.moduleSpecifier,
        aliasRoots,
      );
      if (basePath === null) continue; // bare package specifier — out of scope

      const hasDirective = resolveWorkletDirective(
        basePath,
        binding.importedName,
        fs,
      );
      if (hasDirective === false) {
        offenders.push({
          file: filePath,
          line: call.line,
          workletKind: kind,
          calleeName: call.name,
          resolvedFile: basePath,
        });
      }
      // true → compliant; null → couldn't resolve the declaration, skip to avoid a false positive
    }
  }
  return offenders;
}
