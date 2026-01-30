const DISCORD_JS_SOURCE = "discord.js";

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
  },
};
