/**
 * Custom ESLint plugin for OCRecipes server pattern enforcement.
 *
 * Rules:
 * - no-bare-error-response:   Ban `res.status(N).json({ error: ... })` — use `sendError()`.
 * - no-parseint-req:          Ban `parseInt(req.params.*` / `parseInt(req.query.*` — use helpers.
 * - no-as-string-req:         Ban `as string` casts on `req.params.*` / `req.query.*`.
 * - no-error-message-in-ui:   Ban direct user-facing `error.message` rendering in client UI.
 * - no-dead-apiRequest-guard: Ban unreachable `if (!res.ok)` checks after `await apiRequest(...)`.
 * - no-shadowed-route-paramlist: Ban a `RouteProp`/`NativeStackScreenProps` ParamList argument
 *                             that is not a navigator's canonical ParamList.
 */

"use strict";

// ─── no-bare-error-response ─────────────────────────────────────────────────
// Detects: res.status(N).json({ error: ... }) or res.status(N).json({ message: ... })
// These should use `sendError(res, N, "...")` instead.
const noBareErrorResponse = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow bare res.status().json({ error/message }) — use sendError() instead",
    },
    messages: {
      useSendError:
        'Use sendError(res, {{status}}, "...") instead of res.status({{status}}).json({ {{key}}: ... }).',
    },
    schema: [],
  },
  create(context) {
    return {
      // Match: res.status(N).json(...)
      CallExpression(node) {
        // Must be .json(...)
        if (
          node.callee.type !== "MemberExpression" ||
          node.callee.property.type !== "Identifier" ||
          node.callee.property.name !== "json"
        ) {
          return;
        }

        // The object of .json() must be a CallExpression: res.status(N)
        const statusCall = node.callee.object;
        if (
          statusCall.type !== "CallExpression" ||
          statusCall.callee.type !== "MemberExpression" ||
          statusCall.callee.property.type !== "Identifier" ||
          statusCall.callee.property.name !== "status"
        ) {
          return;
        }

        // Get status code — must be an error status (4xx or 5xx)
        const statusArg = statusCall.arguments[0];
        if (!statusArg || statusArg.type !== "Literal") return;
        const statusCode = statusArg.value;
        if (typeof statusCode !== "number" || statusCode < 400) return;

        // Check if .json() argument is an object with 'error' or 'message' key
        const jsonArg = node.arguments[0];
        if (!jsonArg || jsonArg.type !== "ObjectExpression") return;

        for (const prop of jsonArg.properties) {
          if (
            prop.type === "Property" &&
            prop.key.type === "Identifier" &&
            (prop.key.name === "error" || prop.key.name === "message")
          ) {
            context.report({
              node,
              messageId: "useSendError",
              data: { status: String(statusCode), key: prop.key.name },
            });
            return;
          }
        }
      },
    };
  },
};

// ─── no-parseint-req ────────────────────────────────────────────────────────
// Detects: parseInt(req.params.X, ...) or parseInt(req.query.X, ...)
// These should use parsePositiveIntParam() or parseQueryInt() instead.
const noParseIntReq = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow parseInt on req.params/req.query — use parsePositiveIntParam or parseQueryInt",
    },
    messages: {
      useHelper:
        "Use {{helper}} instead of parseInt(req.{{source}}.*). See PATTERNS.md.",
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee.type !== "Identifier" ||
          node.callee.name !== "parseInt"
        ) {
          return;
        }

        const arg = node.arguments[0];
        if (!arg || arg.type !== "MemberExpression") return;

        // Check for req.params.X or req.query.X
        const obj = arg.object;
        if (
          obj.type !== "MemberExpression" ||
          obj.object.type !== "Identifier" ||
          obj.object.name !== "req"
        ) {
          return;
        }

        if (obj.property.type !== "Identifier") return;
        const source = obj.property.name;

        if (source === "params") {
          context.report({
            node,
            messageId: "useHelper",
            data: { helper: "parsePositiveIntParam()", source },
          });
        } else if (source === "query") {
          context.report({
            node,
            messageId: "useHelper",
            data: { helper: "parseQueryInt()", source },
          });
        }
      },
    };
  },
};

// ─── no-as-string-req ───────────────────────────────────────────────────────
// Detects: req.params.X as string / req.query.X as string
// These should use the proper typed helpers or handle unknown types safely.
const noAsStringReq = {
  meta: {
    type: "problem",
    docs: {
      description:
        'Disallow "as string" casts on req.params/req.query — use typed helpers',
    },
    messages: {
      noAsString:
        'Avoid "as string" cast on req.{{source}}. Use parseQueryString(), parseQueryDate(), parseStringParam(), or typeof checks instead.',
    },
    schema: [],
  },
  create(context) {
    return {
      TSAsExpression(node) {
        // Check the type annotation is `string`
        if (node.typeAnnotation.type !== "TSStringKeyword") {
          return;
        }

        // Walk the expression to find req.params.X or req.query.X
        const expr = node.expression;
        if (!isReqParamOrQuery(expr)) return;

        const source = getReqSource(expr);
        if (source) {
          context.report({
            node,
            messageId: "noAsString",
            data: { source },
          });
        }
      },
    };

    function isReqParamOrQuery(node) {
      // Direct: req.query.name
      if (node.type === "MemberExpression") {
        const obj = node.object;
        if (
          obj.type === "MemberExpression" &&
          obj.object.type === "Identifier" &&
          obj.object.name === "req" &&
          obj.property.type === "Identifier" &&
          (obj.property.name === "params" || obj.property.name === "query")
        ) {
          return true;
        }
      }
      // Parenthesized or chained: (req.query.name as string)?.trim()
      // The TSAsExpression wraps the inner expression, so we just need the direct case
      return false;
    }

    function getReqSource(node) {
      if (node.type === "MemberExpression") {
        const obj = node.object;
        if (
          obj.type === "MemberExpression" &&
          obj.object.type === "Identifier" &&
          obj.object.name === "req" &&
          obj.property.type === "Identifier"
        ) {
          return obj.property.name;
        }
      }
      return null;
    }
  },
};

function isIdentifier(node, name) {
  return node && node.type === "Identifier" && node.name === name;
}

function isPropertyNamed(node, name) {
  if (!node) return false;
  if (!node.computed && node.property.type === "Identifier") {
    return node.property.name === name;
  }
  if (node.computed && node.property.type === "Literal") {
    return node.property.value === name;
  }
  return false;
}

function unwrapExpression(node) {
  let current = node;
  while (
    current &&
    (current.type === "TSAsExpression" ||
      current.type === "TSTypeAssertion" ||
      current.type === "ChainExpression")
  ) {
    current =
      current.type === "ChainExpression"
        ? current.expression
        : current.expression;
  }
  return current;
}

function isApiRequestAwait(expr) {
  const init = unwrapExpression(expr);
  if (!init || init.type !== "AwaitExpression") return false;
  const argument = unwrapExpression(init.argument);
  if (!argument || argument.type !== "CallExpression") return false;
  const callee = unwrapExpression(argument.callee);
  if (isIdentifier(callee, "apiRequest")) return true;
  if (
    callee &&
    callee.type === "MemberExpression" &&
    isPropertyNamed(callee, "apiRequest")
  ) {
    return true;
  }
  return false;
}

function getNodeRangeStart(node) {
  return Array.isArray(node && node.range) ? node.range[0] : -1;
}

function isBefore(left, right) {
  return (
    getNodeRangeStart(left) !== -1 &&
    getNodeRangeStart(left) < getNodeRangeStart(right)
  );
}

function getVariableFromScope(scopeManager, scope, name) {
  let currentScope = scope;
  while (currentScope) {
    if (currentScope.set && currentScope.set.has(name)) {
      return currentScope.set.get(name) || null;
    }
    currentScope = currentScope.upper;
  }
  return null;
}

function findLastWriteBefore(variable, targetNode) {
  let lastWrite = null;
  for (const reference of variable.references) {
    if (!reference.isWrite() || !isBefore(reference.identifier, targetNode)) {
      continue;
    }
    if (
      !lastWrite ||
      getNodeRangeStart(reference.identifier) >
        getNodeRangeStart(lastWrite.identifier)
    ) {
      lastWrite = reference;
    }
  }

  if (lastWrite) {
    return lastWrite.writeExpr;
  }

  for (const def of variable.defs) {
    if (def.type !== "Variable" || !isBefore(def.name, targetNode)) continue;
    const declarator = def.node;
    if (declarator.init) {
      return declarator.init;
    }
  }

  return null;
}

function resolveIdentifierValue(
  scopeManager,
  scope,
  identifier,
  targetNode,
  seen,
) {
  if (!identifier || identifier.type !== "Identifier") return null;
  if (seen.has(identifier.name)) return null;
  seen.add(identifier.name);

  const variable = getVariableFromScope(scopeManager, scope, identifier.name);
  if (!variable) return null;

  const writeExpr = findLastWriteBefore(variable, targetNode);
  if (!writeExpr) return null;

  const expr = unwrapExpression(writeExpr);
  if (isApiRequestAwait(expr)) {
    return { type: "apiRequest", node: expr };
  }
  if (expr && expr.type === "Identifier") {
    return resolveIdentifierValue(scopeManager, scope, expr, targetNode, seen);
  }
  return { type: "other", node: expr };
}

function getGuardedOkIdentifier(node) {
  if (
    !node ||
    node.type !== "MemberExpression" ||
    !isPropertyNamed(node, "ok")
  ) {
    return null;
  }
  const object = unwrapExpression(node.object);
  return object && object.type === "Identifier" ? object : null;
}

function isErrorLikeName(name) {
  return (
    name === "error" ||
    name === "err" ||
    (name.endsWith("Error") && name.length > "Error".length)
  );
}

function isErrorLikeReference(node) {
  const expr = unwrapExpression(node);
  if (!expr) return false;
  if (expr.type === "Identifier") {
    return isErrorLikeName(expr.name);
  }
  if (expr.type === "MemberExpression") {
    if (isPropertyNamed(expr, "error")) {
      const owner = unwrapExpression(expr.object);
      return (
        owner &&
        owner.type === "Identifier" &&
        (owner.name.endsWith("Mutation") ||
          owner.name.endsWith("Query") ||
          isErrorLikeName(owner.name))
      );
    }
    return (
      (expr.property.type === "Identifier" &&
        isErrorLikeName(expr.property.name)) ||
      isErrorLikeReference(expr.object)
    );
  }
  return false;
}

function containsErrorMessageMember(node) {
  const seen = new Set();

  function visit(value) {
    const expr = unwrapExpression(value);
    if (!expr || typeof expr !== "object") return false;
    if (seen.has(expr)) return false;
    seen.add(expr);

    if (
      expr.type === "MemberExpression" &&
      isPropertyNamed(expr, "message") &&
      isErrorLikeReference(expr.object)
    ) {
      return true;
    }

    for (const key of Object.keys(expr)) {
      if (
        key === "parent" ||
        key === "loc" ||
        key === "range" ||
        key === "tokens" ||
        key === "comments"
      ) {
        continue;
      }
      const child = expr[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (visit(item)) return true;
        }
      } else if (visit(child)) {
        return true;
      }
    }

    return false;
  }

  return visit(node);
}

// ─── no-error-message-in-ui ────────────────────────────────────────────────
const noErrorMessageInUi = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow direct user-facing error.message rendering in client UI",
    },
    messages: {
      noErrorMessageInUi:
        "Do not render error.message in the UI — show static copy and branch on error.code instead. See docs/rules/client-state.md.",
    },
    schema: [],
  },
  create(context) {
    function report(node) {
      context.report({
        node,
        messageId: "noErrorMessageInUi",
      });
    }

    return {
      JSXExpressionContainer(node) {
        if (node.parent && node.parent.type === "JSXAttribute") {
          return;
        }
        if (containsErrorMessageMember(node.expression)) {
          report(node.expression);
        }
      },
      CallExpression(node) {
        const firstArg = node.arguments[0];
        if (!firstArg || !containsErrorMessageMember(firstArg)) return;

        const callee = unwrapExpression(node.callee);
        if (
          callee &&
          callee.type === "Identifier" &&
          callee.name.startsWith("set")
        ) {
          report(firstArg);
          return;
        }

        if (
          callee &&
          callee.type === "MemberExpression" &&
          callee.object.type === "Identifier" &&
          callee.property.type === "Identifier"
        ) {
          const objectName = callee.object.name;
          const propertyName = callee.property.name;
          if (
            (objectName === "toast" &&
              (propertyName === "error" || propertyName === "warning")) ||
            (objectName === "AccessibilityInfo" &&
              propertyName === "announceForAccessibility")
          ) {
            report(firstArg);
          }
        }
      },
    };
  },
};

// ─── no-dead-apiRequest-guard ──────────────────────────────────────────────
//
// Known coverage gaps (patterns that bypass this rule):
//
// 1. Destructured `ok` binding — the guard is a bare Identifier (`!ok`), not a
//    MemberExpression (`!x.ok`), so getGuardedOkIdentifier returns null and the
//    IfStatement visitor exits before scope resolution occurs:
//
//      const { ok } = await apiRequest("GET", "/api/items");
//      if (!ok) { throw new Error("..."); }  // NOT flagged
//
//    Note: destructuring another field and checking `.ok` on it
//    (`const { data } = await apiRequest(...); if (!data.ok)`) IS flagged
//    because scope resolution follows the VariableDeclarator init back to the
//    apiRequest call.
//
// 2. Renamed import alias — isApiRequestAwait matches the callee name
//    "apiRequest" literally; an import alias is not resolved:
//
//      import { apiRequest as makeRequest } from "../lib/api";
//      const res = await makeRequest("GET", "/api/items");
//      if (!res.ok) { throw new Error("..."); }  // NOT flagged
//
// These gaps are documented and accepted. Both patterns are rare in this
// codebase; fixing them would require import-binding resolution (alias) and
// binding-type discrimination (destructuring) that significantly complicate
// the rule for marginal coverage gain.
const noDeadApiRequestGuard = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow unreachable !res.ok guards after awaited apiRequest calls",
    },
    messages: {
      noDeadApiRequestGuard:
        "Dead guard — apiRequest always throws on non-ok, so this if(!x.ok) block is unreachable. Delete it and branch on error.code in onError instead. See docs/rules/client-state.md.",
    },
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode;

    function resolveGuardIdentifier(node) {
      if (node.type === "UnaryExpression" && node.operator === "!") {
        return getGuardedOkIdentifier(unwrapExpression(node.argument));
      }
      if (
        node.type === "BinaryExpression" &&
        node.operator === "===" &&
        node.right.type === "Literal" &&
        node.right.value === false
      ) {
        return getGuardedOkIdentifier(unwrapExpression(node.left));
      }
      return null;
    }

    return {
      IfStatement(node) {
        const identifier = resolveGuardIdentifier(unwrapExpression(node.test));
        if (!identifier) return;

        const scope = sourceCode.getScope(node);
        if (!scope) return;

        const resolved = resolveIdentifierValue(
          sourceCode.scopeManager,
          scope,
          identifier,
          node,
          new Set(),
        );

        if (resolved && resolved.type === "apiRequest") {
          context.report({
            node,
            messageId: "noDeadApiRequestGuard",
          });
        }
      },
    };
  },
};

// ─── no-shadowed-route-paramlist ───────────────────────────────────────────
//
// Rejects a route-param type constructor whose ParamList argument is anything
// other than a navigator's canonical ParamList.
//
// Why this exists:
//   A local restatement of the route params is not a duplicate, it is a
//   SHADOW. TypeScript cannot warn that you ignored a field your own type says
//   does not exist, so a param added to the navigator produces no error at any
//   layer and silently never arrives at the screen. `NutritionDetail` lost two
//   user-captured photo URIs to exactly this (PR #742) — the user completed a
//   three-step capture flow and got back a stock image, with strict mode and CI
//   green throughout.
//
//   See docs/solutions/logic-errors/
//       local-route-param-type-shadows-canonical-paramlist-2026-07-30.md
//
// This replaced `scripts/check-route-params.js`, a single-file TEXT scanner
// (PR #812). The move to an AST rule is not a refinement of the same technique
// — it changes what is reachable. The scanner's four documented residuals were
// all consequences of matching characters:
//
//   1. `type P<T> = { … }` / `type P = Readonly<{ … }>` broke the `type <Name> = {`
//      adjacency the pattern required;
//   2. `export type P = { … }` inside a screen was indistinguishable from a
//      navigator's own declaration, because `export` was the only available
//      discriminator;
//   3. a shadow declared in ANOTHER module and imported — declared "unreachable
//      in principle for a single-file scanner";
//   4. a same-line comment defeated the `^` line anchor.
//
// Asking where an identifier is BOUND rather than what the text near it looks
// like closes all four. Residual 3 in particular was only ever unreachable for a
// *text* scanner: the declaration is in another file, but the *import statement*
// is in this one, so scope analysis sees it without a program load. That is why
// this is a plain (non-type-aware) rule and can run in lint-staged as well as CI.
//
// Known coverage gaps (patterns that bypass this rule):
//
// 1. A wrong ParamList declared in, or re-exported from, an ALLOWLISTED module
//    — `client/navigation/<X>Navigator.*` or `client/types/navigation.ts`.
//    Irreducible: something has to be the source of truth, and these are it.
//
// 2. The constructor bypassed entirely by hand-writing the route object shape:
//
//      useRoute<{ params: X; name: string; key: string }>()
//
//    No route-param constructor is named, so nothing here fires. Vanishingly
//    unlikely and visible in review.
//
// 3. Navigation-only constructors (`NativeStackNavigationProp`,
//    `CompositeNavigationProp`, `BottomTabNavigationProp`) also take a ParamList
//    but carry no route params. Deliberately out of scope: a shadow there
//    degrades `navigate()` autocomplete, it does not silently drop a param.

/**
 * Type constructors whose FIRST type argument is a ParamList *and* which carry
 * route params through to the screen.
 */
const ROUTE_PARAM_CONSTRUCTORS = new Set([
  "RouteProp", // @react-navigation/native
  "NativeStackScreenProps", // @react-navigation/native-stack
]);

const NAVIGATION_PACKAGE = /^@react-navigation\//;

/**
 * Modules permitted to declare or re-export a canonical ParamList:
 *   `@/navigation/RootStackNavigator`, `../navigation/RootStackNavigator`
 *   `./RootStackNavigator`   — the relative form used inside client/navigation/
 *   `@/types/navigation`     — the barrel that re-exports every ParamList
 */
function isCanonicalParamListModule(source) {
  return (
    /(?:^|\/)navigation\/[A-Za-z0-9_$]+Navigator$/.test(source) ||
    /^\.{1,2}\/[A-Za-z0-9_$]+Navigator$/.test(source) ||
    /(?:^|\/)types\/navigation$/.test(source)
  );
}

/**
 * True when the file BEING LINTED is itself an allowlisted module, in which
 * case a locally declared ParamList is the source of truth rather than a shadow.
 *
 * Discriminating by filename is what closes residual 2. The text scanner had to
 * excuse every `export`ed alias to avoid flagging the navigators' own
 * declarations, which also excused a screen that exported one.
 */
function isCanonicalParamListFile(filename) {
  const normalized = String(filename).replace(/\\/g, "/");
  return (
    /(?:^|\/)client\/navigation\/[A-Za-z0-9_$]+Navigator\.tsx?$/.test(
      normalized,
    ) || /(?:^|\/)client\/types\/navigation\.ts$/.test(normalized)
  );
}

const noShadowedRouteParamList = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow a RouteProp/NativeStackScreenProps ParamList argument that is not a navigator's canonical ParamList",
    },
    messages: {
      shadowedParamList:
        "`{{constructor}}`'s ParamList argument is {{detail}}, not a navigator's canonical ParamList. Import the ParamList from its navigator (e.g. `RootStackParamList` from `@/navigation/RootStackNavigator`) and index that. A local or foreign restatement is a SHADOW — a param added to the navigator silently never reaches the screen, with no error at any layer. See docs/solutions/logic-errors/local-route-param-type-shadows-canonical-paramlist-2026-07-30.md",
    },
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode;
    const selfIsCanonical = isCanonicalParamListFile(context.filename);

    /** Walk the scope chain outward for the variable `name` resolves to. */
    function resolveVariable(node, name) {
      let scope = sourceCode.getScope(node);
      while (scope) {
        const found = scope.variables.find((v) => v.name === name);
        if (found) return found;
        scope = scope.upper;
      }
      return null;
    }

    /**
     * The import a name is bound to, or null when it is declared locally or
     * resolves to nothing. `exported` is the name the *module* exports, which
     * differs from the local name under an alias (`RouteProp as RP`).
     */
    function importBindingOf(node, name) {
      const variable = resolveVariable(node, name);
      const def = variable && variable.defs[0];
      if (!def || def.type !== "ImportBinding") return null;
      const specifier = def.node;
      const imported =
        specifier.type === "ImportSpecifier" &&
        specifier.imported &&
        specifier.imported.type === "Identifier"
          ? specifier.imported.name
          : name;
      return { source: def.parent.source.value, exported: imported };
    }

    /**
     * The guarded constructor a type name denotes, or null.
     *
     * Judged by binding, not spelling: a renamed import is still caught, and an
     * unrelated `RouteProp` from some other package is left alone. The name
     * fallback covers a reference with no import in scope.
     */
    function guardedConstructor(typeName, node) {
      if (typeName.type !== "Identifier") return null;
      const binding = importBindingOf(node, typeName.name);
      if (binding) {
        return NAVIGATION_PACKAGE.test(binding.source) &&
          ROUTE_PARAM_CONSTRUCTORS.has(binding.exported)
          ? binding.exported
          : null;
      }
      return ROUTE_PARAM_CONSTRUCTORS.has(typeName.name) ? typeName.name : null;
    }

    /**
     * Why a ParamList type argument is not canonical, or null when it is.
     * The string is quoted into the diagnostic, so it names the actual defect
     * rather than restating the rule.
     */
    function shadowDetail(typeNode) {
      if (!typeNode) return null;

      // An intersection is only as canonical as its weakest member. The
      // `MealPlanStackParamList & ProfileStackParamList` shape is legitimate
      // (FavouriteRecipes is registered in both stacks); adding a local alias
      // to that intersection reintroduces the shadow.
      if (typeNode.type === "TSIntersectionType") {
        for (const member of typeNode.types) {
          const detail = shadowDetail(member);
          if (detail) return detail;
        }
        return null;
      }

      if (typeNode.type === "TSTypeLiteral") return "an inline object literal";
      if (typeNode.type !== "TSTypeReference") {
        return `a \`${typeNode.type}\` in the ParamList position`;
      }

      // `Nav.RootStackParamList` — the namespace binding is what to judge.
      let root = typeNode.typeName;
      while (root.type === "TSQualifiedName") root = root.left;
      if (root.type !== "Identifier") {
        return "a ParamList reference that is not a plain name";
      }

      const binding = importBindingOf(root, root.name);
      if (binding) {
        return isCanonicalParamListModule(binding.source)
          ? null
          : `\`${root.name}\`, imported from "${binding.source}"`;
      }

      const variable = resolveVariable(root, root.name);
      if (variable && variable.defs.length > 0) {
        return selfIsCanonical
          ? null
          : `the locally declared type \`${root.name}\``;
      }

      // Bound to nothing here — a global wrapper like `Readonly<{ … }>`, or a
      // name that does not exist. Either way it is not a navigator's ParamList.
      return `\`${root.name}\`, which resolves to no import in this file`;
    }

    return {
      TSTypeReference(node) {
        const constructorName = guardedConstructor(node.typeName, node);
        if (!constructorName) return;

        const typeArgs = node.typeArguments || node.typeParameters;
        if (!typeArgs || typeArgs.params.length === 0) return;

        const detail = shadowDetail(typeArgs.params[0]);
        if (!detail) return;

        context.report({
          node,
          messageId: "shadowedParamList",
          data: { constructor: constructorName, detail },
        });
      },
    };
  },
};

// ─── Plugin export ──────────────────────────────────────────────────────────
module.exports = {
  rules: {
    "no-bare-error-response": noBareErrorResponse,
    "no-parseint-req": noParseIntReq,
    "no-as-string-req": noAsStringReq,
    "no-error-message-in-ui": noErrorMessageInUi,
    "no-dead-apiRequest-guard": noDeadApiRequestGuard,
    "no-shadowed-route-paramlist": noShadowedRouteParamList,
  },
};
