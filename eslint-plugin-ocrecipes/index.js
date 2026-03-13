/**
 * Custom ESLint plugin for OCRecipes server pattern enforcement.
 *
 * Rules:
 * - no-bare-error-response:  Ban `res.status(N).json({ error: ... })` — use `sendError()`.
 * - no-parseint-req:         Ban `parseInt(req.params.*` / `parseInt(req.query.*` — use helpers.
 * - no-as-string-req:        Ban `as string` casts on `req.params.*` / `req.query.*`.
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

// ─── Plugin export ──────────────────────────────────────────────────────────
module.exports = {
  rules: {
    "no-bare-error-response": noBareErrorResponse,
    "no-parseint-req": noParseIntReq,
    "no-as-string-req": noAsStringReq,
  },
};
