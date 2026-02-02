// CSV export functionality for game completions

import type { CommandInteraction } from "discord.js";
import { AttachmentBuilder, MessageFlags } from "discord.js";
import { safeDeferReply, safeReply } from "../../functions/InteractionUtils.js";
import Member from "../../classes/Member.js";
import { escapeCsv } from "./completion-helpers.js";

export async function handleCompletionExport(interaction: CommandInteraction): Promise<void> {
  await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

  const completions = await Member.getAllCompletions(interaction.user.id);
  if (!completions.length) {
    await safeReply(interaction, {
      content: "You have no completions to export.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const headers = [
    "ID",
    "Game ID",
    "Title",
    "Type",
    "Platform ID",
    "Completed Date",
    "Playtime (Hours)",
    "Note",
    "Created At",
  ];
  const rows = completions.map((c) => {
    return [
      String(c.completionId),
      String(c.gameId),
      c.title,
      c.completionType,
      c.platformId != null ? String(c.platformId) : "",
      c.completedAt ? c.completedAt.toISOString().split("T")[0] : "",
      c.finalPlaytimeHours != null ? String(c.finalPlaytimeHours) : "",
      c.note ?? "",
      c.createdAt.toISOString(),
    ].map(escapeCsv).join(",");
  });

  const csvContent = [headers.join(","), ...rows].join("\n");
  const buffer = Buffer.from(csvContent, "utf-8");
  const attachment = new AttachmentBuilder(buffer, { name: "completions.csv" });

  await safeReply(interaction, {
    content: `Here is your completion data export (${completions.length} records).`,
    files: [attachment],
    flags: MessageFlags.Ephemeral,
  });
}
