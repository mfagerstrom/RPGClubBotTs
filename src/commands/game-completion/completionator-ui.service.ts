import type {
  ButtonInteraction,
  CommandInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  AttachmentBuilder,
} from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "discord.js";
import Game, { type IGameWithPlatforms, type IPlatformDef } from "../../classes/Game.js";
import Member, { type ICompletionRecord } from "../../classes/Member.js";
import type {
  CompletionatorAddFormState,
  CompletionatorThreadContext,
  ICompletionatorImport,
  ICompletionatorItem,
  CompletionatorModalKind,
  CompletionatorDateChoice,
  IgdbSelectOption,
} from "./completion.types.js";
import { COMPLETION_TYPES } from "../profile.command.js";
import { GAMEDB_CSV_PLATFORM_MAP } from "../../config/gamedbCsvPlatformMap.js";
import { formatTableDate } from "../profile.command.js";
import { formatPlatformDisplayName } from "../../functions/PlatformDisplay.js";
import { COMPLETIONATOR_SKIP_SENTINEL, COMPLETIONATOR_MATCH_THUMBNAIL_NAME } from "./completion.types.js";
import { safeReply } from "../../functions/InteractionUtils.js";
import { buildComponentsV2Flags } from "../../functions/NominationListComponents.js";
import { createIgdbSession } from "../../services/IgdbSelectService.js";

export class CompletionatorUiService {
  buildCompletionatorBaseLines(
    session: ICompletionatorImport,
    item: ICompletionatorItem,
  ): string[] {
    const platformLabel = formatPlatformDisplayName(item.platformName) ?? "Unknown";
    const completedLabel = item.completedAt ? formatTableDate(item.completedAt) : "Unknown";
    return [
      `## Completionator Import #${session.importId}`,
      `Row ${item.rowIndex} of ${session.totalCount}`,
      "",
      `**Title:** ${item.gameTitle}`,
      `**Platform:** ${platformLabel}`,
      `**Region:** ${item.regionName ?? "Unknown"}`,
      `**Type:** ${item.sourceType ?? "Unknown"}`,
      `**Playtime:** ${item.timeText ?? "Unknown"}`,
      `**Completed:** ${completedLabel}`,
    ];
  }

  buildCompletionatorActionLines(
    session: ICompletionatorImport,
    item: ICompletionatorItem,
    actionText: string,
  ): string[] {
    return [
      ...this.buildCompletionatorBaseLines(session, item),
      "",
      `**Action:** ${actionText}`,
    ];
  }

  buildCompletionatorContainer(lines: string[], thumbnailName?: string): ContainerBuilder {
    const content = lines.join("\n").trim();
    const container = new ContainerBuilder();
    if (thumbnailName) {
      const section = new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(`attachment://${thumbnailName}`));
      container.addSectionComponents(section);
    } else {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    }
    return container;
  }

  buildCompletionatorComponents(
    lines: string[],
    rows: ActionRowBuilder<any>[] = [],
    extraContainers: ContainerBuilder[] = [],
  ): Array<ContainerBuilder | ActionRowBuilder<any>> {
    return [this.buildCompletionatorContainer(lines), ...extraContainers, ...rows];
  }

  async buildCompletionatorExistingCompletionsContainer(
    userId: string,
    gameId: number,
    mappedType: string,
    session: ICompletionatorImport,
    item: ICompletionatorItem,
  ): Promise<{
    container: ContainerBuilder;
    files: AttachmentBuilder[];
    changeRow: ActionRowBuilder<ButtonBuilder>;
  }> {
    const game = await Game.getGameById(gameId);
    const completions = await Member.getCompletionsForGame(userId, gameId);
    const gamePlatforms = await Game.getPlatformsForGame(gameId);
    const platforms = await Game.getAllPlatforms();
    const platformMap = new Map(platforms.map((platform: IPlatformDef) => [platform.id, platform.name]));
    const formattedPlatforms = gamePlatforms
      .map((platform: IPlatformDef) => formatPlatformDisplayName(platform.name) ?? platform.name)
      .sort((a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "base" }));
    const platformLine = formattedPlatforms.length
      ? `**Platforms:** ${formattedPlatforms.join(", ")}`
      : "**Platforms:** None listed";

    const gameIdLine = game ? `**GameDB ID:** ${game.id}` : "**GameDB ID:** Unknown";
    const lines: string[] = [
      "## Matched Game",
      game ? `**Title:** ${game.title}` : "**Title:** Unknown",
      gameIdLine,
      `**Mapped Type:** ${mappedType}`,
      platformLine,
      "",
      "## Your Existing Completions",
    ];
    if (!completions.length) {
      lines.push("No completions recorded for this game yet.");
    } else {
      completions.forEach((completion: ICompletionRecord) => {
        const dateLabel = completion.completedAt
          ? formatTableDate(completion.completedAt)
          : "Unknown";
        const playtimeLabel = completion.finalPlaytimeHours
          ? `${completion.finalPlaytimeHours} hrs`
          : "Unknown";
        const platformName = completion.platformId
          ? platformMap.get(completion.platformId) ?? "Unknown Platform"
          : "Unknown Platform";
        const formattedPlatform = formatPlatformDisplayName(platformName) ?? platformName;
        const parts = [
          completion.completionType ?? "Unknown",
          dateLabel,
          playtimeLabel,
          formattedPlatform,
        ].filter(Boolean);
        lines.push(`• ${parts.join(" - ")}`);
      });
    }
    lines.push(
      "",
      "If this completion is not listed above, complete the form below.",
      "Select a completion type, choose a date option, select a platform, then add the completion.",
    );

    const files: AttachmentBuilder[] = [];
    if (game) {
      const primaryArt = game.thumbnailBad ? game.imageData : (game.artData ?? game.imageData);
      if (primaryArt) {
        const { AttachmentBuilder } = await import("discord.js");
        files.push(
          new AttachmentBuilder(primaryArt, { name: COMPLETIONATOR_MATCH_THUMBNAIL_NAME }),
        );
      }
    }
    const thumbnailName = files.length ? COMPLETIONATOR_MATCH_THUMBNAIL_NAME : undefined;
    const container = this.buildCompletionatorContainer(lines, thumbnailName);
    const changeButton = new ButtonBuilder()
      .setCustomId(`comp-import-action:${userId}:${session.importId}:${item.itemId}:igdb`)
      .setLabel("Choose a Different Game")
      .setStyle(ButtonStyle.Secondary);
    const changeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(changeButton);
    return { container, files, changeRow };
  }

  buildCompletionatorAddFormRows(
    state: CompletionatorAddFormState,
    item: ICompletionatorItem,
    platforms: Array<{ id: number; name: string }>,
  ): ActionRowBuilder<any>[] {
    const typeSelect = new StringSelectMenuBuilder()
      .setCustomId(
        `comp-import-form-select:${state.ownerId}:${state.importId}:${state.itemId}:type`,
      )
      .setPlaceholder("Completion type")
      .addOptions(
        COMPLETION_TYPES.map((value: string) => ({
          label: value.slice(0, 100),
          value,
          default: state.completionType === value,
        })),
      );

    const dateOptions: Array<{
      label: string;
      value: CompletionatorDateChoice;
      default?: boolean;
    }> = [];
    if (item.completedAt) {
      dateOptions.push({
        label: `Use CSV date (${formatTableDate(item.completedAt)})`,
        value: "csv",
        default: state.dateChoice === "csv",
      });
    }
    dateOptions.push(
      {
        label: "Today",
        value: "today",
        default: state.dateChoice === "today",
      },
      {
        label: "Unknown date",
        value: "unknown",
        default: state.dateChoice === "unknown",
      },
      {
        label: "Enter date",
        value: "date",
        default: state.dateChoice === "date",
      },
    );

    const dateSelect = new StringSelectMenuBuilder()
      .setCustomId(
        `comp-import-form-select:${state.ownerId}:${state.importId}:${state.itemId}:date`,
      )
      .setPlaceholder("Completion date")
      .addOptions(dateOptions);

    const sortedPlatforms = [...platforms].sort((a, b) =>
      a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
    );
    const platformOptions = sortedPlatforms.map((platform) => ({
      label: platform.name.slice(0, 100),
      value: String(platform.id),
      default: state.platformId === platform.id,
    }));
    const options = [
      ...platformOptions.slice(0, 24),
      { label: "Other", value: "other", default: state.otherPlatform },
    ];
    const platformSelect = new StringSelectMenuBuilder()
      .setCustomId(
        `comp-import-form-select:${state.ownerId}:${state.importId}:${state.itemId}:platform`,
      )
      .setPlaceholder("Platform")
      .addOptions(options);

    const addButton = new ButtonBuilder()
      .setCustomId(`comp-import-action:${state.ownerId}:${state.importId}:${state.itemId}:add`)
      .setLabel("Add Completion")
      .setStyle(ButtonStyle.Success);
    const skipButton = new ButtonBuilder()
      .setCustomId(`comp-import-action:${state.ownerId}:${state.importId}:${state.itemId}:skip`)
      .setLabel("Skip")
      .setStyle(ButtonStyle.Secondary);
    const pauseButton = new ButtonBuilder()
      .setCustomId(`comp-import-action:${state.ownerId}:${state.importId}:${state.itemId}:pause`)
      .setLabel("Pause")
      .setStyle(ButtonStyle.Secondary);

    return [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(typeSelect),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(dateSelect),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(platformSelect),
      new ActionRowBuilder<ButtonBuilder>().addComponents(addButton, skipButton, pauseButton),
    ];
  }

  buildConfirmSameButtons(
    userId: string,
    importId: number,
    itemId: number,
  ): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`comp-import-action:${userId}:${importId}:${itemId}:same-yes`)
        .setLabel("Yes")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`comp-import-action:${userId}:${importId}:${itemId}:same-no`)
        .setLabel("No")
        .setStyle(ButtonStyle.Secondary),
    );
  }

  buildUpdateSelectionComponents(
    userId: string,
    importId: number,
    itemId: number,
    updateOptions: Array<{ label: string; value: string; description: string }>,
  ): {
    updateRow: ActionRowBuilder<StringSelectMenuBuilder>;
    buttonsRow: ActionRowBuilder<ButtonBuilder>;
  } {
    const updateSelect = new StringSelectMenuBuilder()
      .setCustomId(`comp-import-update-fields:${userId}:${importId}:${itemId}`)
      .setPlaceholder("Select fields to update")
      .setMinValues(1)
      .setMaxValues(updateOptions.length)
      .addOptions(updateOptions);

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`comp-import-action:${userId}:${importId}:${itemId}:skip`)
        .setLabel("Skip")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`comp-import-action:${userId}:${importId}:${itemId}:pause`)
        .setLabel("Pause")
        .setStyle(ButtonStyle.Secondary),
    );

    return {
      updateRow: new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(updateSelect),
      buttonsRow: buttons,
    };
  }

  buildGameDbResultsComponents(
    userId: string,
    importId: number,
    itemId: number,
    results: Awaited<ReturnType<typeof Game.searchGames>>,
  ): {
    selectRow: ActionRowBuilder<StringSelectMenuBuilder>;
    buttonsRow: ActionRowBuilder<ButtonBuilder>;
  } {
    const options = [
      {
        label: "Import another title from IGDB",
        value: "import-igdb",
        description: "Search IGDB and import a new GameDB entry",
      },
      ...results.slice(0, 23).map((game: IGameWithPlatforms) => {
        const year =
          game.initialReleaseDate instanceof Date
            ? game.initialReleaseDate.getFullYear()
            : game.initialReleaseDate
              ? new Date(game.initialReleaseDate).getFullYear()
              : null;
        const platformNames = Array.from(
          new Set(
            (game.platforms ?? [])
              .map((platform: IPlatformDef) => formatPlatformDisplayName(platform.name) ?? platform.name)
              .filter((name: string | null) => Boolean(name)),
          ),
        );
        const sortedPlatforms = [...platformNames].sort((a, b) =>
          a.localeCompare(b, "en", { sensitivity: "base" }),
        );
        const platformsLabel = sortedPlatforms.length
          ? sortedPlatforms.join(", ")
          : "Unknown platforms";
        const baseDescription = year ? `${year} - ${platformsLabel}` : platformsLabel;
        const description =
          baseDescription.length > 100
            ? `${baseDescription.slice(0, 97)}...`
            : baseDescription;
        return {
          label: game.title.slice(0, 100),
          value: String(game.id),
          description,
        };
      }),
      {
        label: `Skip (${COMPLETIONATOR_SKIP_SENTINEL})`,
        value: COMPLETIONATOR_SKIP_SENTINEL,
        description: "Skip this completion",
      },
    ];

    const select = new StringSelectMenuBuilder()
      .setCustomId(`comp-import-select:${userId}:${importId}:${itemId}`)
      .setPlaceholder("Select the matching game")
      .addOptions(options);

    const pauseButton = new ButtonBuilder()
      .setCustomId(`comp-import-action:${userId}:${importId}:${itemId}:pause`)
      .setLabel("Pause Import")
      .setStyle(ButtonStyle.Secondary);
    const skipButton = new ButtonBuilder()
      .setCustomId(`comp-import-action:${userId}:${importId}:${itemId}:skip`)
      .setLabel("Skip")
      .setStyle(ButtonStyle.Secondary);

    return {
      selectRow: new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
      buttonsRow: new ActionRowBuilder<ButtonBuilder>().addComponents(pauseButton, skipButton),
    };
  }

  buildCompletionatorNoMatchRows(
    userId: string,
    importId: number,
    itemId: number,
  ): ActionRowBuilder<ButtonBuilder>[] {
    const primaryRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`comp-import-action:${userId}:${importId}:${itemId}:igdb`)
        .setLabel("Import from IGDB")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`comp-import-action:${userId}:${importId}:${itemId}:igdb-manual`)
        .setLabel("Enter IGDB ID")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`comp-import-action:${userId}:${importId}:${itemId}:query`)
        .setLabel("Query GameDB")
        .setStyle(ButtonStyle.Primary),
    );
    const secondaryRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`comp-import-action:${userId}:${importId}:${itemId}:manual`)
        .setLabel("Enter GameDB ID")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`comp-import-action:${userId}:${importId}:${itemId}:skip`)
        .setLabel("Skip")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`comp-import-action:${userId}:${importId}:${itemId}:pause`)
        .setLabel("Pause")
        .setStyle(ButtonStyle.Secondary),
    );
    return [primaryRow, secondaryRow];
  }

  buildIgdbSelectionComponents(
    userId: string,
    session: ICompletionatorImport,
    item: ICompletionatorItem,
    igdbResults: any[],
    onSelect: (interaction: StringSelectMenuInteraction, gameId: number) => Promise<void>,
  ): {
    selectComponents: ActionRowBuilder<any>[];
    extraRows: ActionRowBuilder<ButtonBuilder>[];
  } {
    const opts: IgdbSelectOption[] = igdbResults.map((game) => {
      const year = game.first_release_date
        ? new Date(game.first_release_date * 1000).getFullYear()
        : "TBD";
      return {
        id: game.id,
        label: `${game.name} (${year})`,
        description: (game.summary || "No summary").slice(0, 95),
      };
    });

    const pauseButton = new ButtonBuilder()
      .setCustomId(`comp-import-action:${userId}:${session.importId}:${item.itemId}:pause`)
      .setLabel("Pause")
      .setStyle(ButtonStyle.Secondary);
    const skipButton = new ButtonBuilder()
      .setCustomId(`comp-import-action:${userId}:${session.importId}:${item.itemId}:skip`)
      .setLabel("Skip")
      .setStyle(ButtonStyle.Secondary);
    const queryButton = new ButtonBuilder()
      .setCustomId(`comp-import-action:${userId}:${session.importId}:${item.itemId}:igdb-query`)
      .setLabel("New IGDB Search")
      .setStyle(ButtonStyle.Secondary);
    const extraRows = [
      new ActionRowBuilder<ButtonBuilder>().addComponents(pauseButton, skipButton, queryButton),
    ];

    const { components } = createIgdbSession(userId, opts, onSelect, extraRows);

    return {
      selectComponents: components,
      extraRows: [],
    };
  }

  buildIgdbRetryButtons(
    userId: string,
    importId: number,
    itemId: number,
  ): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`comp-import-action:${userId}:${importId}:${itemId}:igdb-query`)
        .setLabel("New IGDB Search")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`comp-import-action:${userId}:${importId}:${itemId}:skip`)
        .setLabel("Skip")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`comp-import-action:${userId}:${importId}:${itemId}:pause`)
        .setLabel("Pause")
        .setStyle(ButtonStyle.Secondary),
    );
  }

  resolvePlatformId(
    platformName: string,
    platforms: Array<{ id: number; name: string }>,
  ): number | null {
    const platformKey = platformName.trim().toLowerCase();
    const mappedNames = GAMEDB_CSV_PLATFORM_MAP[platformKey] ?? [];
    if (!mappedNames.length) return null;

    const platformByName = new Map(
      platforms.map((platform) => [platform.name.toLowerCase(), platform.id]),
    );
    return (
      mappedNames
        .map((name: string) => platformByName.get(name.toLowerCase()))
        .find((id: number | undefined): id is number => Boolean(id)) ?? null
    );
  }

  async respondToImportInteraction(
    interaction:
      | CommandInteraction
      | ButtonInteraction
      | StringSelectMenuInteraction
      | ModalSubmitInteraction,
    payload: {
      components: Array<ContainerBuilder | ActionRowBuilder<any>>;
      files?: any[];
    },
    ephemeral?: boolean,
    context?: CompletionatorThreadContext,
  ): Promise<void> {
    const flags = buildComponentsV2Flags(Boolean(ephemeral));
    const files = payload.files ?? [];
    if (context?.message) {
      await context.message.edit({ ...payload, files, flags }).catch(() => {});
      return;
    }

    if ("isMessageComponent" in interaction && interaction.isMessageComponent()) {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ ...payload, files, flags });
      } else {
        await interaction.update({ ...payload, files, flags });
      }
      return;
    }

    await safeReply(interaction, {
      ...payload,
      files,
      flags,
    });
  }

  isInteractionEphemeral(
    interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
  ): boolean {
    const message = "message" in interaction ? interaction.message : null;
    const flags = message?.flags;
    return Boolean(flags && flags.has(MessageFlags.Ephemeral));
  }

  createDateModal(
    userId: string,
    importId: number,
    itemId: number,
  ): ModalBuilder {
    const modal = new ModalBuilder()
      .setCustomId(`comp-import-date:${userId}:${importId}:${itemId}`)
      .setTitle("Completion Date");
    const dateInput = new TextInputBuilder()
      .setCustomId("completion-date")
      .setLabel("Completion date (YYYY-MM-DD)")
      .setPlaceholder("2025-12-31")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(dateInput));
    return modal;
  }

  createInputModal(
    kind: CompletionatorModalKind,
    title: string,
    label: string,
    placeholder: string,
    userId: string,
    importId: number,
    itemId: number,
    itemTitle?: string,
  ): ModalBuilder {
    const modal = new ModalBuilder()
      .setCustomId(`comp-import-modal:${kind}:${userId}:${importId}:${itemId}`)
      .setTitle(title);
    const input = new TextInputBuilder()
      .setCustomId("completionator-input")
      .setLabel(label.slice(0, 45))
      .setPlaceholder((itemTitle ?? placeholder).slice(0, 100))
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
    return modal;
  }
}
