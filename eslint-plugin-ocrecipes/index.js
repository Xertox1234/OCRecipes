/**
 * Custom ESLint plugin for OCRecipes server pattern enforcement.
 *
 * Rules:
 * - no-bare-error-response:   Ban `res.status(N).json({ error: ... })` — use `sendError()`.
 * - no-parseint-req:          Ban `parseInt(req.params.*` / `parseInt(req.query.*` — use helpers.
 * - no-as-string-req:         Ban `as string` casts on `req.params.*` / `req.query.*`.
 * - no-error-message-in-ui:   Ban direct user-facing `error.message` rendering in client UI.
 * - no-dead-apiRequest-guard: Ban unreachable `if (!res.ok)` checks after `await apiRequest(...)`.
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

function unwrapCallee(node) {
  let current = unwrapExpression(node);
  while (current && current.type === "MemberExpression") {
    current = unwrapExpression(current.property);
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
    return (
      isPropertyNamed(expr, "error") ||
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

// ─── Plugin export ──────────────────────────────────────────────────────────
module.exports = {
  rules: {
    "no-bare-error-response": noBareErrorResponse,
    "no-parseint-req": noParseIntReq,
    "no-as-string-req": noAsStringReq,
    "no-error-message-in-ui": noErrorMessageInUi,
    "no-dead-apiRequest-guard": noDeadApiRequestGuard,
  },
};
