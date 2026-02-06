import type { CommandInteraction } from "discord.js";
import { ActionRowBuilder, ButtonBuilder } from "discord.js";
import {
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "@discordjs/builders";

type ImportLogEvent = (message: string, meta: Record<string, string | number>) => void;

type ImportComponentDiagnosticsParams = {
  importId: number;
  itemId: number;
  rowIndex: number;
  components: Array<ContainerBuilder | ActionRowBuilder<any>>;
  logPrefix: string;
  logEvent?: ImportLogEvent;
};

type ImportMessageContainerParams = {
  content: string;
  thumbnailUrl: string | null;
  logPrefix: string;
  logMeta?: Record<string, unknown>;
};

type ImportCommandHandlers<Session> = {
  interaction: CommandInteraction;
  action: ImportAction;
  onStart: () => Promise<void>;
  getActiveSession: (userId: string) => Promise<Session | null>;
  onMissingSession: () => Promise<void>;
  onStatus: (session: Session) => Promise<void>;
  onPause: (session: Session) => Promise<void>;
  onCancel: (session: Session) => Promise<void>;
  onResume: (session: Session) => Promise<void>;
};

export const IMPORT_ACTIONS = [
  "start",
  "resume",
  "status",
  "pause",
  "cancel",
] as const;

export type ImportAction = (typeof IMPORT_ACTIONS)[number];

export async function handleImportActionCommand<Session>(
  handlers: ImportCommandHandlers<Session>,
): Promise<void> {
  const { interaction, action } = handlers;
  if (action === "start") {
    await handlers.onStart();
    return;
  }

  const session = await handlers.getActiveSession(interaction.user.id);
  if (!session) {
    await handlers.onMissingSession();
    return;
  }

  if (action === "status") {
    await handlers.onStatus(session);
    return;
  }

  if (action === "pause") {
    await handlers.onPause(session);
    return;
  }

  if (action === "cancel") {
    await handlers.onCancel(session);
    return;
  }

  await handlers.onResume(session);
}

export function safeV2TextContent(value: string, maxLength: number): string {
  const normalized = value.split("\0").join("").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}...`;
}

export function flattenErrorMessages(error: unknown, depth: number = 0): string[] {
  if (!error || depth > 3) return [];
  const anyError = error as any;
  const messages: string[] = [];
  const baseMessage = String(anyError?.message ?? "").trim();
  if (baseMessage) messages.push(baseMessage);

  const nested = [
    ...(Array.isArray(anyError?.errors) ? anyError.errors : []),
    ...(Array.isArray(anyError?.issues) ? anyError.issues : []),
  ];
  for (const item of nested) {
    const nestedMessage = String((item as any)?.message ?? "").trim();
    if (nestedMessage) messages.push(nestedMessage);
    messages.push(...flattenErrorMessages(item, depth + 1));
  }

  if (anyError?.cause) {
    messages.push(...flattenErrorMessages(anyError.cause, depth + 1));
  }

  return [...new Set(messages)].slice(0, 8);
}

export function buildImportMessageContainer(
  params: ImportMessageContainerParams,
): ContainerBuilder {
  const safeContent = safeV2TextContent(params.content, 3500);
  const container = new ContainerBuilder();
  if (!params.thumbnailUrl) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(safeContent),
    );
    return container;
  }
  try {
    const section = new SectionBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(safeContent),
    );
    section.setThumbnailAccessory(new ThumbnailBuilder().setURL(params.thumbnailUrl));
    section.toJSON();
    container.addSectionComponents(section);
  } catch (error) {
    const messages = flattenErrorMessages(error);
    console.error(
      `[${params.logPrefix}] header section validation failed`,
      JSON.stringify({
        ...params.logMeta,
        contentLength: safeContent.length,
        hasThumbnail: Boolean(params.thumbnailUrl),
        messages,
      }),
    );
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(safeV2TextContent(params.content, 1000)),
    );
  }
  return container;
}

export function buildImportTextContainer(content: string): ContainerBuilder {
  return new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(safeV2TextContent(content, 3500)),
  );
}

export function buildImportActionsContainer(params: {
  helpText: string;
  controlRow: ActionRowBuilder<ButtonBuilder>;
}): ContainerBuilder {
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent("### Actions"),
    new TextDisplayBuilder().setContent(params.helpText),
  );
  container.addActionRowComponents(params.controlRow.toJSON());
  return container;
}

export function logImportComponentDiagnostics(
  params: ImportComponentDiagnosticsParams,
): void {
  params.components.forEach((component, index) => {
    try {
      (component as any)?.toJSON?.();
    } catch (error) {
      const messages = flattenErrorMessages(error);
      params.logEvent?.("render_component_invalid", {
        importId: params.importId,
        itemId: params.itemId,
        rowIndex: params.rowIndex,
        componentIndex: index,
      });
      console.error(
        `[${params.logPrefix}] component validation failed`,
        JSON.stringify({
          importId: params.importId,
          itemId: params.itemId,
          rowIndex: params.rowIndex,
          componentIndex: index,
          componentType: describeComponentForDebug(component),
          messages,
        }),
      );
    }
  });
}

function describeComponentForDebug(component: unknown): string {
  const anyComponent = component as any;
  const typeName = String(anyComponent?.constructor?.name ?? typeof component);
  return typeName;
}
