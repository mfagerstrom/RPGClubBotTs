import type { User } from "discord.js";
import type { IMemberRecord } from "../classes/Member.js";

export const PROFILE_CUSTOM_CSS_HOOK = "/* PROFILE_CUSTOM_CSS */";

type Browser = any;
type Page = any;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(value: Date | null): string {
  if (!value) return "Unknown";
  return value.toLocaleString();
}

function buildAvatarDataUrl(record: IMemberRecord, user: User): string | null {
  if (record.avatarBlob) {
    const base64 = record.avatarBlob.toString("base64");
    return `data:image/png;base64,${base64}`;
  }

  const url = user.displayAvatarURL({ extension: "png", size: 256, forceStatic: true });
  return url || null;
}

export function buildProfileHtml(record: IMemberRecord, user: User): string {
  const avatarSrc = buildAvatarDataUrl(record, user);
  const roles =
    [
      record.roleAdmin ? "Admin" : null,
      record.roleModerator ? "Moderator" : null,
      record.roleRegular ? "Regular" : null,
      record.roleMember ? "Member" : null,
      record.roleNewcomer ? "Newcomer" : null,
    ]
      .filter(Boolean)
      .join(", ") || "None";

  const platforms = [
    record.steamUrl ? `<span class="pill">Steam</span>` : null,
    record.xblUsername ? `<span class="pill">Xbox Live</span>` : null,
    record.psnUsername ? `<span class="pill">PSN</span>` : null,
    record.nswFriendCode ? `<span class="pill">Switch</span>` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const items = [
    { label: "Last Seen", value: formatDate(record.lastSeenAt) },
    { label: "Joined Server", value: formatDate(record.serverJoinedAt) },
    { label: "Roles", value: roles },
    { label: "Bot", value: record.isBot ? "Yes" : "No" },
    record.completionatorUrl
      ? {
          label: "Completionator",
          value: `<a href="${escapeHtml(record.completionatorUrl)}">Profile</a>`,
        }
      : null,
    record.steamUrl
      ? { label: "Steam", value: `<a href="${escapeHtml(record.steamUrl)}">Profile</a>` }
      : null,
    record.psnUsername ? { label: "PSN", value: escapeHtml(record.psnUsername) } : null,
    record.xblUsername ? { label: "Xbox Live", value: escapeHtml(record.xblUsername) } : null,
    record.nswFriendCode ? { label: "Switch", value: escapeHtml(record.nswFriendCode) } : null,
  ].filter(Boolean) as { label: string; value: string }[];

  const fieldsHtml = items
    .map(
      (item) =>
        `<div class="field"><div class="label">${escapeHtml(
          item.label,
        )}</div><div class="value">${item.value}</div></div>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Profile for ${escapeHtml(record.username ?? user.username ?? "Member")}</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 24px;
        font-family: "Inter", "Segoe UI", system-ui, sans-serif;
        background: #0f172a;
        color: #e2e8f0;
      }
      .card {
        width: 860px;
        margin: 0 auto;
        background: linear-gradient(145deg, #111827 0%, #0b1220 100%);
        border: 1px solid #1f2937;
        border-radius: 16px;
        padding: 24px;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      }
      .header {
        display: flex;
        gap: 16px;
        align-items: center;
        margin-bottom: 16px;
      }
      .avatar {
        width: 96px;
        height: 96px;
        border-radius: 16px;
        object-fit: cover;
        border: 2px solid #1f6feb;
        background: #0b1220;
      }
      .title {
        font-size: 24px;
        font-weight: 700;
        margin: 0;
        color: #f8fafc;
      }
      .subtitle {
        font-size: 14px;
        color: #94a3b8;
        margin-top: 4px;
      }
      .pill {
        display: inline-block;
        padding: 4px 10px;
        border-radius: 12px;
        background: #1f2937;
        color: #cbd5e1;
        font-size: 12px;
        margin-right: 6px;
      }
      .fields {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 12px;
        margin-top: 16px;
      }
      .field {
        padding: 12px;
        border-radius: 12px;
        background: #0f172a;
        border: 1px solid #1f2937;
      }
      .label {
        font-size: 12px;
        color: #94a3b8;
        margin-bottom: 4px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .value {
        font-size: 14px;
        color: #e2e8f0;
        word-break: break-word;
      }
      a { color: #60a5fa; text-decoration: none; }
      a:hover { text-decoration: underline; }

      ${PROFILE_CUSTOM_CSS_HOOK}
    </style>
  </head>
  <body>
    <div class="card">
      <div class="header">
        ${
          avatarSrc
            ? `<img class="avatar" src="${avatarSrc}" alt="avatar" />`
            : `<div class="avatar" aria-hidden="true"></div>`
        }
        <div>
          <h1 class="title">${escapeHtml(
            record.globalName ?? record.username ?? user.username ?? "Member",
          )}</h1>
          <div class="subtitle">User ID: ${escapeHtml(record.userId)}</div>
          <div class="subtitle">Platforms: ${platforms || "None"}</div>
        </div>
      </div>
      <div class="fields">
        ${fieldsHtml}
      </div>
    </div>
  </body>
</html>`;
}

async function renderHtmlToPng(html: string): Promise<Buffer> {
  let browser: Browser | null = null;
  let page: Page | null = null;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 900, height: 600 } });
    await page.setContent(html, { waitUntil: "networkidle" });
    const buffer = await page.screenshot({ fullPage: true, type: "png" });
    return buffer;
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

export async function renderProfileImage(record: IMemberRecord, user: User): Promise<Buffer> {
  const html = buildProfileHtml(record, user);
  return renderHtmlToPng(html);
}
