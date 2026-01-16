import type { Client } from "discordx";

export const LOG_CHANNEL_ID = "679499735757094950";

export async function resolveLogChannel(client: Client): Promise<any | null> {
  const channel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased()) return null;
  const sendable = channel as any;
  return typeof sendable.send === "function" ? sendable : null;
}

export function formatTimestampWithDay(timestamp: number | null | undefined): string {
  const date = new Date(timestamp ?? Date.now());
  const now = new Date();
  const timeLabel = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const isSameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (isSameDay) {
    return `Today at ${timeLabel}`;
  }
  const dateLabel = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${dateLabel} at ${timeLabel}`;
}
