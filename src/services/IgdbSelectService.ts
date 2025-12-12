import {
  ActionRowBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  type StringSelectMenuInteraction,
} from "discord.js";

export type IgdbSelectOption = { id: number; label: string; description?: string };

type Session = {
  ownerId: string;
  options: IgdbSelectOption[];
  onSelect: (interaction: StringSelectMenuInteraction, gameId: number) => Promise<void>;
};

// Leave room for prev/next navigation in the 25-option Discord limit.
const PAGE_SIZE = 22; // 22 options + prev/next (up to 24) stays under 25
const IGDB_SESSION_KEY = Symbol.for("igdbSelectSessions");

function getSessionStore(): Map<string, Session> {
  const g = globalThis as any;
  if (!g[IGDB_SESSION_KEY]) {
    g[IGDB_SESSION_KEY] = new Map<string, Session>();
  }
  return g[IGDB_SESSION_KEY] as Map<string, Session>;
}

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
  const sorted = [...options].sort((a, b) => {
    const lenDiff = a.label.length - b.label.length;
    if (lenDiff !== 0) return lenDiff;
    return a.label.localeCompare(b.label);
  });
  getSessionStore().set(sessionId, { ownerId, options: sorted, onSelect });
  return {
    sessionId,
    components: buildIgdbComponents(sessionId, 0),
  };
}

export function buildIgdbComponents(
  sessionId: string,
  page: number,
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const session = getSessionStore().get(sessionId);
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
  return getSessionStore().get(sessionId);
}

export function deleteIgdbSession(sessionId: string): void {
  getSessionStore().delete(sessionId);
}

export async function handleIgdbSelectInteraction(
  interaction: StringSelectMenuInteraction,
): Promise<boolean> {
  const [, sessionId, pageRaw] = interaction.customId.split(":");
  if (!sessionId) return false;
  const session = getSessionStore().get(sessionId);
  if (!session) {
    await interaction
      .reply({
        content: "This selection session has expired.",
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
    return true;
  }

  if (interaction.user.id !== session.ownerId) {
    await interaction
      .reply({
        content: "This selection isn't for you.",
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
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
        // ensure the interaction is acknowledged to avoid "Interaction failed"
        await interaction.deferUpdate().catch(() => {});
      }
    }
    return true;
  }

  const selected = resolveIgdbSelection(sessionId, page, value);
  if (!selected || selected.kind !== "select") {
    await interaction
      .reply({
        content: "Invalid selection.",
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
    return true;
  }

  try {
    await session.onSelect(interaction, selected.gameId);
  } finally {
    getSessionStore().delete(sessionId);
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
  const session = getSessionStore().get(sessionId);
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
