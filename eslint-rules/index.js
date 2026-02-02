const DISCORD_JS_SOURCE = "discord.js";
const INTERACTION_RESPONSE_METHODS = new Set([
  "reply",
  "deferReply",
  "editReply",
  "followUp",
  "update",
]);
const INTERACTION_RESPONSE_HELPERS = new Set([
  "safeReply",
  "safeDeferReply",
  "safeUpdate",
  "safeFollowUp",
]);
const DEPRECATED_RESPONSE_OPTION_KEYS = new Set(["ephemeral", "fetchReply"]);
const INTERACTION_DECORATORS = new Set([
  "ButtonComponent",
  "SelectMenuComponent",
  "ModalComponent",
]);
const CHECKED_SET_CUSTOM_ID_BUILDERS = new Set([
  "ButtonBuilder",
  "V2ButtonBuilder",
  "StringSelectMenuBuilder",
  "ModalBuilder",
]);

function getLiteralString(node) {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  return null;
}

function collectStaticStringConstants(program) {
  const map = new Map();
  for (const node of program.body) {
    if (node.type !== "VariableDeclaration" || node.kind !== "const") continue;
    for (const declarator of node.declarations) {
      if (declarator.type !== "VariableDeclarator") continue;
      if (!declarator.id || declarator.id.type !== "Identifier") continue;
      const value = resolveStaticStringExpression(declarator.init, map);
      if (typeof value === "string") {
        map.set(declarator.id.name, value);
      }
    }
  }
  return map;
}

function resolveStaticStringExpression(node, constantMap) {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (node.type === "Identifier") {
    return constantMap.get(node.name) ?? null;
  }
  if (node.type === "TemplateLiteral") {
    if (node.expressions.length === 0) {
      return node.quasis[0]?.value?.cooked ?? node.quasis[0]?.value?.raw ?? "";
    }
    let output = "";
    for (let i = 0; i < node.quasis.length; i += 1) {
      output += node.quasis[i]?.value?.cooked ?? node.quasis[i]?.value?.raw ?? "";
      if (i >= node.expressions.length) continue;
      const exprValue = resolveStaticStringExpression(node.expressions[i], constantMap);
      if (typeof exprValue !== "string") return null;
      output += exprValue;
    }
    return output;
  }
  if (node.type === "BinaryExpression" && node.operator === "+") {
    const left = resolveStaticStringExpression(node.left, constantMap);
    const right = resolveStaticStringExpression(node.right, constantMap);
    if (typeof left === "string" && typeof right === "string") {
      return `${left}${right}`;
    }
  }
  return null;
}

function extractResolvablePrefix(node, constantMap) {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (node.type === "Identifier") {
    return constantMap.get(node.name) ?? null;
  }
  if (node.type === "TemplateLiteral") {
    let output = "";
    for (let i = 0; i < node.quasis.length; i += 1) {
      output += node.quasis[i]?.value?.cooked ?? node.quasis[i]?.value?.raw ?? "";
      if (i >= node.expressions.length) continue;
      const expr = node.expressions[i];
      const exprValue = resolveStaticStringExpression(expr, constantMap);
      if (typeof exprValue !== "string") {
        return output.length ? output : null;
      }
      output += exprValue;
    }
    return output;
  }
  const staticString = resolveStaticStringExpression(node, constantMap);
  return typeof staticString === "string" ? staticString : null;
}

function extractRegexPrefix(pattern) {
  if (typeof pattern !== "string" || !pattern.startsWith("^")) {
    return null;
  }

  let prefix = "";
  for (let i = 1; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === "\\") {
      const next = pattern[i + 1];
      if (!next) break;
      if (/^[dDsSwWbB]$/.test(next)) break;
      prefix += next;
      i += 1;
      continue;
    }
    if (/^[A-Za-z0-9:_-]$/.test(char)) {
      prefix += char;
      continue;
    }
    break;
  }
  return prefix || null;
}

function getDecoratorIdentifierName(node) {
  if (!node) return null;
  if (node.type === "Identifier") return node.name;
  if (node.type === "CallExpression" && node.callee.type === "Identifier") {
    return node.callee.name;
  }
  return null;
}

function getDecoratorIdValueArg(decoratorExpression) {
  if (!decoratorExpression || decoratorExpression.type !== "CallExpression") {
    return null;
  }
  const firstArg = decoratorExpression.arguments[0];
  if (!firstArg || firstArg.type !== "ObjectExpression") return null;
  for (const prop of firstArg.properties) {
    if (!prop || prop.type !== "Property") continue;
    const keyName = getPropertyName(prop.key);
    if (keyName === "id") {
      return prop.value;
    }
  }
  return null;
}

function getDecoratorKind(name) {
  if (name === "ButtonComponent") return "button";
  if (name === "SelectMenuComponent") return "select";
  if (name === "ModalComponent") return "modal";
  return null;
}

function getBuilderRootName(node) {
  let current = node;
  while (current && current.type === "CallExpression") {
    if (current.callee.type !== "MemberExpression") break;
    current = current.callee.object;
  }

  if (current?.type === "NewExpression") {
    if (current.callee.type === "Identifier") {
      return current.callee.name;
    }
    if (
      current.callee.type === "MemberExpression" &&
      current.callee.property.type === "Identifier"
    ) {
      return current.callee.property.name;
    }
  }
  return null;
}

function getInteractionKindForBuilder(rootName) {
  if (!rootName || !CHECKED_SET_CUSTOM_ID_BUILDERS.has(rootName)) {
    return null;
  }
  if (rootName === "StringSelectMenuBuilder") return "select";
  if (rootName === "ModalBuilder") return "modal";
  return "button";
}

function getDiscordJsButtonBuilderNames(program) {
  const localNames = new Set();
  for (const node of program.body) {
    if (node.type !== "ImportDeclaration") continue;
    if (node.source.value !== DISCORD_JS_SOURCE) continue;
    for (const spec of node.specifiers) {
      if (spec.type !== "ImportSpecifier") continue;
      if (spec.imported.name === "ButtonBuilder") {
        localNames.add(spec.local.name);
      }
    }
  }
  return localNames;
}

function getPropertyName(node) {
  if (node.type === "Identifier") return node.name;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  return null;
}

function getCalleePropertyName(node) {
  if (!node) return null;
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression" && node.property.type === "Identifier") {
    return node.property.name;
  }
  return null;
}

export default {
  rules: {
    "no-djs-button-in-v2-accessory": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Disallow discord.js ButtonBuilder in Components v2 SectionBuilder button accessories.",
        },
        schema: [],
        messages: {
          discordJsButton:
            "Use the Components v2 ButtonBuilder from @discordjs/builders for SectionBuilder.",
        },
      },
      create(context) {
        let discordJsButtonNames = new Set();
        return {
          Program(node) {
            discordJsButtonNames = getDiscordJsButtonBuilderNames(node);
          },
          CallExpression(node) {
            if (discordJsButtonNames.size === 0) return;
            const callee = node.callee;
            if (
              callee.type !== "MemberExpression" ||
              callee.property.type !== "Identifier" ||
              callee.property.name !== "setButtonAccessory"
            ) {
              return;
            }
            const [arg] = node.arguments;
            if (!arg) return;
            if (arg.type === "NewExpression" && arg.callee.type === "Identifier") {
              if (discordJsButtonNames.has(arg.callee.name)) {
                context.report({ node: arg, messageId: "discordJsButton" });
              }
              return;
            }
            if (arg.type === "Identifier" && discordJsButtonNames.has(arg.name)) {
              context.report({ node: arg, messageId: "discordJsButton" });
            }
          },
        };
      },
    },
    "no-deprecated-interaction-options": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Disallow deprecated interaction response options and fetchReply usage.",
        },
        schema: [],
        messages: {
          deprecatedOption:
            "Use flags or withResponse instead of deprecated interaction response options.",
          deprecatedFetchReply:
            "Do not call fetchReply directly; use withResponse or fetch after replying.",
        },
      },
      create(context) {
        const reportOption = (propNode, key) => {
          // Offer an autofix when the deprecated `ephemeral` property is a boolean literal.
          if (propNode && propNode.type === "Property") {
            const valueNode = propNode.value;
            context.report({
              node: propNode.key,
              messageId: "deprecatedOption",
              data: { key },
              fix: (fixer) => {
                try {
                  if (valueNode && valueNode.type === "Literal") {
                    if (valueNode.value === true) {
                      // Replace `ephemeral: true` with `flags: MessageFlags.Ephemeral`
                      return fixer.replaceText(propNode, "flags: MessageFlags.Ephemeral");
                    }
                    if (valueNode.value === false) {
                      // Remove the property entirely. Try to remove trailing comma if present.
                      return fixer.remove(propNode);
                    }
                  }
                } catch {
                  // fallthrough to no-fix
                }
                return null;
              },
            });
            return;
          }

          context.report({
            node: propNode,
            messageId: "deprecatedOption",
            data: { key },
          });
        };

        const checkOptionsObject = (node) => {
          if (!node || node.type !== "ObjectExpression") return;
          for (const prop of node.properties) {
            if (prop.type !== "Property") continue;
            const keyName = getPropertyName(prop.key);
            if (!keyName || !DEPRECATED_RESPONSE_OPTION_KEYS.has(keyName)) continue;
            reportOption(prop.key, keyName);
          }
        };

        return {
          CallExpression(node) {
            const calleeName = getCalleePropertyName(node.callee);
            if (!calleeName) return;
            const isMethodCall =
              node.callee.type === "MemberExpression" &&
              INTERACTION_RESPONSE_METHODS.has(calleeName);
            const isHelperCall =
              node.callee.type === "Identifier" &&
              INTERACTION_RESPONSE_HELPERS.has(calleeName);
            if (!isMethodCall && !isHelperCall) return;
            checkOptionsObject(node.arguments[0]);
          },
          MemberExpression(node) {
            if (node.property.type !== "Identifier") return;
            if (node.property.name !== "fetchReply") return;
            context.report({ node: node.property, messageId: "deprecatedFetchReply" });
          },
        };
      },
    },
    "custom-id-has-matching-handler": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Require interaction setCustomId prefixes to match an in-file component handler.",
        },
        schema: [],
        messages: {
          missingHandler:
            "No matching {{kind}} handler found for custom ID prefix '{{prefix}}'.",
        },
      },
      create(context) {
        let constantMap = new Map();
        const handlerPrefixesByKind = {
          button: new Set(),
          select: new Set(),
          modal: new Set(),
        };
        const pendingCalls = [];

        const addHandlerPrefix = (kind, prefix) => {
          if (!kind || !prefix) return;
          handlerPrefixesByKind[kind].add(prefix);
        };

        const hasMatchingPrefix = (kind, prefix) => {
          const handlers = handlerPrefixesByKind[kind];
          if (!handlers || !handlers.size) return false;
          for (const handlerPrefix of handlers) {
            if (prefix.startsWith(handlerPrefix) || handlerPrefix.startsWith(prefix)) {
              return true;
            }
          }
          return false;
        };

        return {
          Program(node) {
            constantMap = collectStaticStringConstants(node);
            handlerPrefixesByKind.button.clear();
            handlerPrefixesByKind.select.clear();
            handlerPrefixesByKind.modal.clear();
            pendingCalls.length = 0;
          },
          Decorator(node) {
            const decoratorExpression = node.expression;
            const decoratorName = getDecoratorIdentifierName(decoratorExpression);
            if (!decoratorName || !INTERACTION_DECORATORS.has(decoratorName)) return;
            const kind = getDecoratorKind(decoratorName);
            if (!kind) return;

            const idValueNode = getDecoratorIdValueArg(decoratorExpression);
            if (!idValueNode) return;

            const literalId = getLiteralString(idValueNode);
            if (literalId) {
              addHandlerPrefix(kind, literalId);
              return;
            }

            if (idValueNode.type === "Identifier") {
              const resolved = constantMap.get(idValueNode.name) ?? null;
              if (resolved) addHandlerPrefix(kind, resolved);
              return;
            }

            if (idValueNode.type === "TemplateLiteral") {
              const resolved = extractResolvablePrefix(idValueNode, constantMap);
              if (resolved) addHandlerPrefix(kind, resolved);
              return;
            }

            if (
              idValueNode.type === "Literal" &&
              idValueNode.regex &&
              typeof idValueNode.regex.pattern === "string"
            ) {
              const regexPrefix = extractRegexPrefix(idValueNode.regex.pattern);
              if (regexPrefix) addHandlerPrefix(kind, regexPrefix);
            }
          },
          CallExpression(node) {
            const callee = node.callee;
            if (
              callee.type !== "MemberExpression" ||
              callee.property.type !== "Identifier" ||
              callee.property.name !== "setCustomId"
            ) {
              return;
            }

            const rootBuilderName = getBuilderRootName(callee.object);
            const kind = getInteractionKindForBuilder(rootBuilderName);
            if (!kind) return;

            const [customIdArg] = node.arguments;
            const prefix = extractResolvablePrefix(customIdArg, constantMap);
            if (!prefix) return;

            pendingCalls.push({ node: customIdArg, kind, prefix });
          },
          "Program:exit"() {
            for (const call of pendingCalls) {
              if (hasMatchingPrefix(call.kind, call.prefix)) continue;
              context.report({
                node: call.node,
                messageId: "missingHandler",
                data: {
                  kind: call.kind,
                  prefix: call.prefix,
                },
              });
            }
          },
        };
      },
    },
  },
};
