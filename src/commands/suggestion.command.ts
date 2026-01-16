import type { CommandInteraction } from "discord.js";
import { ApplicationCommandOptionType, MessageFlags } from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";
import { safeDeferReply, safeReply, sanitizeUserInput } from "../functions/InteractionUtils.js";
import { createSuggestion } from "../classes/Suggestion.js";

const BOT_DEV_CHANNEL_ID = "549603388334014464";
const BOT_DEV_PING_USER_ID = "191938640413327360";

@Discord()
export class SuggestionCommand {
  @Slash({ description: "Submit a bot suggestion", name: "suggestion" })
  async suggestion(
    @SlashOption({
      description: "Short suggestion title",
      name: "title",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    title: string,
    @SlashOption({
      description: "Optional details for the suggestion",
      name: "details",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    details: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const trimmedTitle = sanitizeUserInput(title, { preserveNewlines: false });
    if (!trimmedTitle) {
      await safeReply(interaction, {
        content: "Title cannot be empty.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const trimmedDetails = details
      ? sanitizeUserInput(details, { preserveNewlines: true })
      : undefined;
    const suggestion = await createSuggestion(
      trimmedTitle,
      trimmedDetails ?? null,
      interaction.user.id,
    );

    await safeReply(interaction, {
      content: `Thanks! Suggestion #${suggestion.suggestionId} submitted.`,
      flags: MessageFlags.Ephemeral,
    });

    try {
      const channel = await interaction.client.channels.fetch(BOT_DEV_CHANNEL_ID);
      if (channel && "send" in channel) {
        await (channel as any).send({
          content:
            `<@${BOT_DEV_PING_USER_ID}> New suggestion #${suggestion.suggestionId} submitted by ` +
            `<@${interaction.user.id}>: **${suggestion.title}**`,
        });
      }
    } catch {
      // ignore notification failures
    }
  }
}
