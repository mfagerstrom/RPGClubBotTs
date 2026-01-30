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
        const reportOption = (node, key) => {
          context.report({
            node,
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
  },
};
