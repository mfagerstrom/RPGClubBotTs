import { ActionRowBuilder, StringSelectMenuBuilder, type StringSelectMenuInteraction } from "discord.js";

export type IgdbSelectOption = { id: number; label: string; description?: string };

type Session = {
  ownerId: string;
  options: IgdbSelectOption[];
  onSelect: (interaction: StringSelectMenuInteraction, gameId: number) => Promise<void>;
};

const PAGE_SIZE = 23; // 23 options + prev/next fits Discord's 25 max
const sessions = new Map<string, Session>();

function chunkOptions(options: IgdbSelectOption[], page: number): {
  pageOptions: IgdbSelectOption[];
  totalPages: number;
} {
  const totalPages = Math.max(1, Math.ceil(options.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const start = safePage * PAGE_SIZE;
  const pageOptions = options.slice(start, start + PAGE_SIZE);
  return { pageOptions, totalPages };
}

export function createIgdbSession(
  ownerId: string,
  options: IgdbSelectOption[],
  onSelect: Session["onSelect"],
): {
  sessionId: string;
  components: ActionRowBuilder<StringSelectMenuBuilder>[];
} {
  const sessionId = `igdb-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  sessions.set(sessionId, { ownerId, options, onSelect });
  return {
    sessionId,
    components: buildIgdbComponents(sessionId, 0),
  };
}

export function buildIgdbComponents(
  sessionId: string,
  page: number,
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const session = sessions.get(sessionId);
  if (!session) return [];
  const { pageOptions, totalPages } = chunkOptions(session.options, page);

  const select = new StringSelectMenuBuilder()
    .setCustomId(`igdb-select:${sessionId}:${page}`)
    .setPlaceholder("Select a game from IGDB")
    .addOptions(
      pageOptions.map((opt) => ({
        label: opt.label.slice(0, 100),
        value: String(opt.id),
        description: opt.description?.slice(0, 100),
      })),
    );

  if (totalPages > 1) {
    if (page > 0) {
      select.addOptions({
        label: "Previous page",
        value: "__igdb_prev",
        description: "Show previous results",
      });
    }
    if (page < totalPages - 1) {
      select.addOptions({
        label: "Next page",
        value: "__igdb_next",
        description: "Show more results",
      });
    }
  }

  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
}

export function getIgdbSession(sessionId: string): Session | undefined {
  return sessions.get(sessionId);
}

export function deleteIgdbSession(sessionId: string): void {
  sessions.delete(sessionId);
}

export async function handleIgdbSelectInteraction(
  interaction: StringSelectMenuInteraction,
): Promise<boolean> {
  const [sessionId, pageRaw] = interaction.customId.split(":");
  if (!sessionId) return false;
  const session = sessions.get(sessionId);
  if (!session) {
    await interaction.reply({
      content: "This selection session has expired.",
      ephemeral: true,
    }).catch(() => {});
    return true;
  }

  if (interaction.user.id !== session.ownerId) {
    await interaction.reply({
      content: "This selection isn't for you.",
      ephemeral: true,
    }).catch(() => {});
    return true;
  }

  const page = Number(pageRaw) || 0;
  const value = interaction.values?.[0];
  if (!value) return true;

  if (value === "__igdb_prev" || value === "__igdb_next") {
    const result = resolveIgdbSelection(sessionId, page, value);
    if (result && result.kind === "page") {
      try {
        await interaction.update({ components: result.components });
      } catch {
        // ignore
      }
    }
    return true;
  }

  const selected = resolveIgdbSelection(sessionId, page, value);
  if (!selected || selected.kind !== "select") {
    await interaction.reply({
      content: "Invalid selection.",
      ephemeral: true,
    }).catch(() => {});
    return true;
  }

  try {
    await session.onSelect(interaction, selected.gameId);
  } finally {
    sessions.delete(sessionId);
  }
  return true;
}

function resolveIgdbSelection(
  sessionId: string,
  page: number,
  value: string,
): {
  kind: "page";
  page: number;
  components: ActionRowBuilder<StringSelectMenuBuilder>[];
} | { kind: "select"; gameId: number } | null {
  const session = sessions.get(sessionId);
  if (!session) return null;

  if (value === "__igdb_prev") {
    const newPage = Math.max(page - 1, 0);
    return {
      kind: "page",
      page: newPage,
      components: buildIgdbComponents(sessionId, newPage),
    };
  }

  if (value === "__igdb_next") {
    const { totalPages } = chunkOptions(session.options, page);
    const newPage = Math.min(page + 1, totalPages - 1);
    return {
      kind: "page",
      page: newPage,
      components: buildIgdbComponents(sessionId, newPage),
    };
  }

  const gameId = Number(value);
  if (!Number.isInteger(gameId) || gameId <= 0) return null;
  return { kind: "select", gameId };
}
