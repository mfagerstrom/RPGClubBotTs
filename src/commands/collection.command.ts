import {
  ApplicationCommandOptionType,
  AutocompleteInteraction,
  CommandInteraction,
  EmbedBuilder,
  MessageFlags,
  type User,
} from "discord.js";
import { Discord, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
import UserGameCollection, {
  COLLECTION_OWNERSHIP_TYPES,
  type CollectionOwnershipType,
} from "../classes/UserGameCollection.js";
import Game from "../classes/Game.js";
import Member from "../classes/Member.js";
import {
  autocompleteGameCompletionPlatform,
  resolveGameCompletionPlatformId,
} from "./game-completion/completion-autocomplete.utils.js";
import {
  safeDeferReply,
  sanitizeUserInput,
} from "../functions/InteractionUtils.js";
import {
  COMPLETION_TYPES,
  type CompletionType,
  formatTableDate,
  parseCompletionDateInput,
} from "./profile.command.js";
import { saveCompletion } from "../functions/CompletionHelpers.js";
import { formatGameTitleWithYear } from "../functions/GameTitleAutocompleteUtils.js";

const COLLECTION_ENTRY_VALUE_PREFIX = "collection";
const COLLECTION_LIST_LIMIT = 50;

function parseCollectionEntryAutocompleteValue(raw: string): number | null {
  const value = raw.trim();
  const match = /^collection:(\d+)$/i.exec(value);
  if (!match) return null;
  const entryId = Number(match[1]);
  if (!Number.isInteger(entryId) || entryId <= 0) return null;
  return entryId;
}

function buildCollectionEntryAutocompleteValue(entryId: number): string {
  return `${COLLECTION_ENTRY_VALUE_PREFIX}:${entryId}`;
}

function formatCollectionEntryAutocompleteName(entry: {
  title: string;
  platformName: string | null;
  ownershipType: CollectionOwnershipType;
}): string {
  const platform = entry.platformName ?? "Unknown platform";
  return `${entry.title} | ${platform} | ${entry.ownershipType}`.slice(0, 100);
}

async function autocompleteCollectionGameTitle(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const rawQuery = focused?.value ? String(focused.value) : "";
  const query = sanitizeUserInput(rawQuery, { preserveNewlines: false }).trim();
  if (!query) {
    await interaction.respond([]);
    return;
  }

  const results = await Game.searchGamesAutocomplete(query);
  await interaction.respond(
    results.slice(0, 25).map((game) => ({
      name: formatGameTitleWithYear(game).slice(0, 100),
      value: String(game.id),
    })),
  );
}

async function autocompleteCollectionEntry(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const rawQuery = focused?.value ? String(focused.value) : "";
  const query = sanitizeUserInput(rawQuery, { preserveNewlines: false });

  const results = await UserGameCollection.autocompleteEntries(
    interaction.user.id,
    query,
    25,
  );

  await interaction.respond(
    results.map((entry) => ({
      name: formatCollectionEntryAutocompleteName(entry),
      value: buildCollectionEntryAutocompleteValue(entry.entryId),
    })),
  );
}

function formatCollectionLine(entry: {
  title: string;
  platformName: string | null;
  ownershipType: string;
  note: string | null;
  createdAt: Date;
  entryId: number;
}): string {
  const platform = entry.platformName ?? "Unknown platform";
  const note = entry.note ? ` | Note: ${entry.note}` : "";
  return (
    `#${entry.entryId} **${entry.title}** | ${platform} | ${entry.ownershipType} | ` +
    `Added ${formatTableDate(entry.createdAt)}${note}`
  );
}

@Discord()
@SlashGroup({ name: "collection", description: "Manage your owned game collection" })
@SlashGroup("collection")
export class CollectionCommand {
  @Slash({ name: "add", description: "Add a game you own to your collection" })
  async add(
    @SlashOption({
      name: "title",
      description: "Game title from GameDB",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteCollectionGameTitle,
    })
    gameIdRaw: string,
    @SlashOption({
      name: "platform",
      description: "Owned platform",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteGameCompletionPlatform,
    })
    platformRaw: string,
    @SlashChoice(
      ...COLLECTION_OWNERSHIP_TYPES.map((value) => ({
        name: value,
        value,
      })),
    )
    @SlashOption({
      name: "ownership_type",
      description: "Ownership metadata",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    ownershipType: CollectionOwnershipType,
    @SlashOption({
      name: "note",
      description: "Optional note",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    note: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const gameId = Number(gameIdRaw);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      await interaction.editReply("Invalid game selection.");
      return;
    }

    const game = await Game.getGameById(gameId);
    if (!game) {
      await interaction.editReply("That game is not in GameDB.");
      return;
    }

    const platformId = await resolveGameCompletionPlatformId(platformRaw);
    if (!platformId) {
      await interaction.editReply("Invalid platform selection.");
      return;
    }

    const sanitizedNote = note
      ? sanitizeUserInput(note, { preserveNewlines: true, maxLength: 500 })
      : null;

    try {
      const created = await UserGameCollection.addEntry({
        userId: interaction.user.id,
        gameId,
        platformId,
        ownershipType,
        note: sanitizedNote,
      });

      const platformLabel = created.platformName ?? `Platform #${platformId}`;
      await interaction.editReply(
        `Added **${created.title}** (${platformLabel}, ${created.ownershipType}) ` +
        `to your collection.`,
      );
    } catch (err: any) {
      await interaction.editReply(err?.message ?? "Failed to add collection entry.");
    }
  }

  @Slash({ name: "list", description: "List your collection or another member collection" })
  async list(
    @SlashOption({
      name: "member",
      description: "Member whose collection to view",
      type: ApplicationCommandOptionType.User,
      required: false,
    })
    member: User | undefined,
    @SlashOption({
      name: "title",
      description: "Filter by title",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    title: string | undefined,
    @SlashOption({
      name: "platform",
      description: "Filter by platform text",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    platform: string | undefined,
    @SlashChoice(
      ...COLLECTION_OWNERSHIP_TYPES.map((value) => ({
        name: value,
        value,
      })),
    )
    @SlashOption({
      name: "ownership_type",
      description: "Filter by ownership type",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    ownershipType: CollectionOwnershipType | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const targetUserId = member?.id ?? interaction.user.id;
    const titleFilter = title
      ? sanitizeUserInput(title, { preserveNewlines: false })
      : undefined;
    const platformFilter = platform
      ? sanitizeUserInput(platform, { preserveNewlines: false })
      : undefined;

    const entries = await UserGameCollection.searchEntries({
      targetUserId,
      title: titleFilter,
      platform: platformFilter,
      ownershipType,
      limit: COLLECTION_LIST_LIMIT,
    });

    const viewingOwnCollection = targetUserId === interaction.user.id;
    if (!entries.length) {
      const emptyMessage = viewingOwnCollection
        ? "No collection entries matched your filters."
        : "No collection entries matched your filters for that member.";
      await interaction.editReply(emptyMessage);
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(viewingOwnCollection ? "Your game collection" : `${member?.username ?? "Member"} collection`)
      .setDescription(entries.map((entry) => formatCollectionLine(entry)).join("\n"))
      .setFooter({
        text: "Collections are public by default.",
      });

    await interaction.editReply({ embeds: [embed] });
  }

  @Slash({ name: "edit", description: "Edit one of your collection entries" })
  async edit(
    @SlashOption({
      name: "entry",
      description: "Collection entry",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteCollectionEntry,
    })
    entryRaw: string,
    @SlashOption({
      name: "platform",
      description: "New platform",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: autocompleteGameCompletionPlatform,
    })
    platformRaw: string | undefined,
    @SlashChoice(
      ...COLLECTION_OWNERSHIP_TYPES.map((value) => ({
        name: value,
        value,
      })),
    )
    @SlashOption({
      name: "ownership_type",
      description: "New ownership type",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    ownershipType: CollectionOwnershipType | undefined,
    @SlashOption({
      name: "note",
      description: "New note",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    note: string | undefined,
    @SlashOption({
      name: "clear_note",
      description: "Clear note",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    clearNote: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const entryId = parseCollectionEntryAutocompleteValue(entryRaw);
    if (!entryId) {
      await interaction.editReply("Invalid collection entry selection.");
      return;
    }

    const updates: {
      platformId?: number | null;
      ownershipType?: CollectionOwnershipType;
      note?: string | null;
    } = {};

    if (platformRaw !== undefined) {
      const platformId = await resolveGameCompletionPlatformId(platformRaw);
      if (!platformId) {
        await interaction.editReply("Invalid platform selection.");
        return;
      }
      updates.platformId = platformId;
    }

    if (ownershipType !== undefined) {
      updates.ownershipType = ownershipType;
    }

    if (clearNote) {
      updates.note = null;
    } else if (note !== undefined) {
      updates.note = sanitizeUserInput(note, { preserveNewlines: true, maxLength: 500 });
    }

    if (!Object.keys(updates).length) {
      await interaction.editReply("Provide at least one field to update.");
      return;
    }

    try {
      const updated = await UserGameCollection.updateEntryForUser(
        entryId,
        interaction.user.id,
        updates,
      );
      if (!updated) {
        await interaction.editReply("Collection entry was not found.");
        return;
      }

      const platformLabel = updated.platformName ?? "Unknown platform";
      await interaction.editReply(
        `Updated **${updated.title}** (${platformLabel}, ${updated.ownershipType}).`,
      );
    } catch (err: any) {
      await interaction.editReply(err?.message ?? "Failed to update collection entry.");
    }
  }

  @Slash({ name: "remove", description: "Remove one of your collection entries" })
  async remove(
    @SlashOption({
      name: "entry",
      description: "Collection entry",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteCollectionEntry,
    })
    entryRaw: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const entryId = parseCollectionEntryAutocompleteValue(entryRaw);
    if (!entryId) {
      await interaction.editReply("Invalid collection entry selection.");
      return;
    }

    const existing = await UserGameCollection.getEntryForUser(entryId, interaction.user.id);
    if (!existing) {
      await interaction.editReply("Collection entry was not found.");
      return;
    }

    const deleted = await UserGameCollection.removeEntryForUser(entryId, interaction.user.id);
    if (!deleted) {
      await interaction.editReply("Failed to remove that collection entry.");
      return;
    }

    await interaction.editReply(`Removed **${existing.title}** from your collection.`);
  }

  @Slash({ name: "to-now-playing", description: "Add a collection entry to your now-playing list" })
  async toNowPlaying(
    @SlashOption({
      name: "entry",
      description: "Collection entry",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteCollectionEntry,
    })
    entryRaw: string,
    @SlashOption({
      name: "note_override",
      description: "Override note for now-playing",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    noteOverride: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const entryId = parseCollectionEntryAutocompleteValue(entryRaw);
    if (!entryId) {
      await interaction.editReply("Invalid collection entry selection.");
      return;
    }

    const entry = await UserGameCollection.getEntryForUser(entryId, interaction.user.id);
    if (!entry) {
      await interaction.editReply("Collection entry was not found.");
      return;
    }

    if (!entry.platformId) {
      await interaction.editReply("This entry does not have a platform. Update it before adding.");
      return;
    }

    const note = noteOverride !== undefined
      ? sanitizeUserInput(noteOverride, { preserveNewlines: true, maxLength: 500 })
      : entry.note;

    try {
      await Member.addNowPlaying(interaction.user.id, entry.gameId, entry.platformId, note);
      await interaction.editReply(
        `Added **${entry.title}** (${entry.platformName ?? "Unknown platform"}) ` +
        "to your now-playing list.",
      );
    } catch (err: any) {
      await interaction.editReply(err?.message ?? "Failed to add entry to now-playing.");
    }
  }

  @Slash({ name: "to-completion", description: "Log a completion from a collection entry" })
  async toCompletion(
    @SlashOption({
      name: "entry",
      description: "Collection entry",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteCollectionEntry,
    })
    entryRaw: string,
    @SlashChoice(
      ...COMPLETION_TYPES.map((value) => ({
        name: value,
        value,
      })),
    )
    @SlashOption({
      name: "completion_type",
      description: "Type of completion",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    completionType: CompletionType,
    @SlashOption({
      name: "completion_date",
      description: "YYYY-MM-DD, today, or unknown",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    completionDateRaw: string | undefined,
    @SlashOption({
      name: "final_playtime_hours",
      description: "Playtime in hours",
      type: ApplicationCommandOptionType.Number,
      required: false,
    })
    finalPlaytimeHours: number | undefined,
    @SlashOption({
      name: "note",
      description: "Optional completion note",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    note: string | undefined,
    @SlashOption({
      name: "announce",
      description: "Announce completion",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    announce: boolean | undefined,
    @SlashOption({
      name: "remove_from_now_playing",
      description: "Remove game from now-playing",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    removeFromNowPlaying: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const entryId = parseCollectionEntryAutocompleteValue(entryRaw);
    if (!entryId) {
      await interaction.editReply("Invalid collection entry selection.");
      return;
    }

    const entry = await UserGameCollection.getEntryForUser(entryId, interaction.user.id);
    if (!entry) {
      await interaction.editReply("Collection entry was not found.");
      return;
    }

    const completionDateInput = completionDateRaw
      ? sanitizeUserInput(completionDateRaw, { preserveNewlines: false })
      : undefined;

    let completedAt: Date | null;
    try {
      completedAt = parseCompletionDateInput(completionDateInput);
    } catch (err: any) {
      await interaction.editReply(err?.message ?? "Invalid completion date.");
      return;
    }

    if (
      finalPlaytimeHours !== undefined &&
      (Number.isNaN(finalPlaytimeHours) || finalPlaytimeHours < 0)
    ) {
      await interaction.editReply("Final playtime must be a non-negative number.");
      return;
    }

    const completionNote = note !== undefined
      ? sanitizeUserInput(note, { preserveNewlines: true, maxLength: 500 }) || null
      : entry.note;

    await saveCompletion(
      interaction,
      interaction.user.id,
      entry.gameId,
      entry.platformId,
      completionType,
      completedAt,
      finalPlaytimeHours ?? null,
      completionNote,
      entry.title,
      announce,
      false,
      removeFromNowPlaying ?? true,
    );
  }
}
