import { createHash } from "crypto";
import type { Activity, Snowflake } from "discord.js";

export type ActivityIconPreference = "auto" | "large" | "small";

export type ActivityIconCandidate = {
  activityName: string;
  iconType: "large" | "small";
  sourceRef: string;
  url: string;
};

export function createActivityIconCandidate(input: {
  activityName: string;
  iconType: "large" | "small";
  sourceRef: string;
  url: string;
}): ActivityIconCandidate {
  return {
    activityName: input.activityName,
    iconType: input.iconType,
    sourceRef: input.sourceRef,
    url: input.url,
  };
}

export type ActivityEmojiErrorCode =
  | "activity-not-found"
  | "icon-not-accessible"
  | "icon-rate-limited"
  | "unsupported-format"
  | "icon-too-large"
  | "icon-not-square"
  | "icon-size-unsupported";

export class ActivityEmojiError extends Error {
  readonly code: ActivityEmojiErrorCode;

  constructor(code: ActivityEmojiErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export type ActivityEmojiAsset = {
  bytes: Buffer;
  emojiName: string;
  fileName: string;
  isDuplicateByBytes: boolean;
  isDuplicateBySource: boolean;
  sourceUrl: string;
  activityName: string;
  iconType: "large" | "small";
  size: number;
  mimeType: string;
};

const DISCORD_HOSTS = new Set<string>([
  "cdn.discordapp.com",
  "media.discordapp.net",
]);
const SUPPORTED_CONTENT_TYPES = new Set<string>([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const MAX_EMOJI_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const sourceCache = new Map<string, ActivityEmojiAsset>();
const bytesHashCache = new Map<string, ActivityEmojiAsset>();

function buildImageSourceRef(
  activityName: string,
  iconType: "large" | "small",
  rawAssetKey: Snowflake | null | undefined,
): string {
  return [activityName.trim().toLowerCase(), iconType, rawAssetKey ?? "unknown"].join(":");
}

function tryBuildDiscordAssetUrl(
  activity: Activity,
  iconType: "large" | "small",
  size: number,
): string | null {
  if (iconType === "large") {
    return activity.assets?.largeImageURL({ extension: "png", forceStatic: true, size }) ?? null;
  }
  return activity.assets?.smallImageURL({ extension: "png", forceStatic: true, size }) ?? null;
}

function normalizeDiscordUrl(rawUrl: string, size: number): string {
  try {
    const parsed = new URL(rawUrl);
    if (!DISCORD_HOSTS.has(parsed.hostname)) return rawUrl;
    parsed.searchParams.set("size", String(size));
    parsed.searchParams.set("quality", "lossless");
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

export function collectActivityIconCandidates(
  activities: readonly Activity[],
  options: {
    activityName?: string;
    iconPreference: ActivityIconPreference;
    targetSize: number;
  },
): ActivityIconCandidate[] {
  const requestedActivityName = options.activityName?.trim().toLowerCase() ?? "";
  const candidates: ActivityIconCandidate[] = [];

  for (const activity of activities) {
    const activityName = activity.name?.trim() ?? "";
    if (!activityName.length) continue;
    if (requestedActivityName && activityName.toLowerCase() !== requestedActivityName) continue;

    const iconsByPreference: ("large" | "small")[] = options.iconPreference === "auto"
      ? ["large", "small"]
      : [options.iconPreference];

    for (const iconType of iconsByPreference) {
      const rawAssetKey = iconType === "large"
        ? activity.assets?.largeImage
        : activity.assets?.smallImage;
      const activityUrl = tryBuildDiscordAssetUrl(activity, iconType, options.targetSize);
      if (!activityUrl) continue;

      candidates.push({
        activityName,
        iconType,
        sourceRef: buildImageSourceRef(activityName, iconType, rawAssetKey ?? activityUrl),
        url: normalizeDiscordUrl(activityUrl, options.targetSize),
      });
    }
  }

  return candidates;
}

function detectContentType(contentTypeHeader: string | null): string | null {
  if (!contentTypeHeader) return null;
  const [mimeType] = contentTypeHeader.split(";");
  if (!mimeType) return null;
  return mimeType.trim().toLowerCase();
}

function detectPngDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  const signature = bytes.subarray(0, 8);
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!signature.equals(pngSignature)) return null;
  const chunkType = bytes.subarray(12, 16).toString("ascii");
  if (chunkType !== "IHDR") return null;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return { width, height };
}

function detectGifDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 10) return null;
  const header = bytes.subarray(0, 6).toString("ascii");
  if (header !== "GIF87a" && header !== "GIF89a") return null;
  const width = bytes.readUInt16LE(6);
  const height = bytes.readUInt16LE(8);
  return { width, height };
}

function buildDeterministicEmojiName(activityName: string, bytesHash: string): string {
  const normalizedBase = activityName
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const safeBase = normalizedBase.length ? normalizedBase : "activity";
  const suffix = bytesHash.slice(0, 6);
  const prefixMaxLength = 32 - suffix.length - 1;
  const prefix = safeBase.slice(0, Math.max(2, prefixMaxLength));
  const candidate = `${prefix}_${suffix}`;
  return candidate.slice(0, 32);
}

function getFileName(emojiName: string, mimeType: string): string {
  const ext = mimeType === "image/png"
    ? "png"
    : mimeType === "image/gif"
      ? "gif"
      : mimeType === "image/webp"
        ? "webp"
        : "jpg";
  return `${emojiName}.${ext}`;
}

async function fetchIconBytes(url: string): Promise<{ bytes: Buffer; mimeType: string }> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "user-agent": "RPGClubBotTs/ActivityEmoji",
      "accept": "image/png,image/webp,image/jpeg,image/gif,*/*",
    },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  if (response.status === 429) {
    throw new ActivityEmojiError("icon-rate-limited", "Icon host rate limited the request.");
  }
  if (!response.ok) {
    throw new ActivityEmojiError(
      "icon-not-accessible",
      `Image host returned HTTP ${response.status}.`,
    );
  }

  const mimeType = detectContentType(response.headers.get("content-type"));
  if (!mimeType || !SUPPORTED_CONTENT_TYPES.has(mimeType)) {
    throw new ActivityEmojiError(
      "unsupported-format",
      "Icon format is unsupported. Expected PNG, JPEG, WEBP, or GIF.",
    );
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) {
    throw new ActivityEmojiError("icon-not-accessible", "Downloaded icon payload was empty.");
  }
  if (bytes.length > MAX_EMOJI_BYTES) {
    throw new ActivityEmojiError(
      "icon-too-large",
      "Icon is larger than Discord custom emoji size limit (256 KB).",
    );
  }

  return { bytes, mimeType };
}

function assertSquareAndSize(
  bytes: Buffer,
  mimeType: string,
  targetSize: number,
): void {
  const dimensions = mimeType === "image/png"
    ? detectPngDimensions(bytes)
    : mimeType === "image/gif"
      ? detectGifDimensions(bytes)
      : null;

  if (!dimensions) {
    throw new ActivityEmojiError(
      "icon-size-unsupported",
      "Could not verify image dimensions for this format.",
    );
  }
  if (dimensions.width !== dimensions.height) {
    throw new ActivityEmojiError(
      "icon-not-square",
      `Icon is not square (${dimensions.width}x${dimensions.height}).`,
    );
  }
  if (dimensions.width !== targetSize) {
    throw new ActivityEmojiError(
      "icon-size-unsupported",
      `Icon is square but not ${targetSize}x${targetSize}.`,
    );
  }
}

function getBytesHash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function getOrCreateActivityEmojiAsset(
  candidate: ActivityIconCandidate,
  targetSize: number,
): Promise<ActivityEmojiAsset> {
  const sourceCacheKey = `${candidate.sourceRef}:size:${targetSize}`;
  const cachedBySource = sourceCache.get(sourceCacheKey);
  if (cachedBySource) {
    return {
      ...cachedBySource,
      isDuplicateByBytes: false,
      isDuplicateBySource: true,
    };
  }

  const { bytes, mimeType } = await fetchIconBytes(candidate.url);
  assertSquareAndSize(bytes, mimeType, targetSize);

  const bytesHash = getBytesHash(bytes);
  const duplicateByBytes = bytesHashCache.get(bytesHash);
  if (duplicateByBytes) {
    sourceCache.set(sourceCacheKey, duplicateByBytes);
    return {
      ...duplicateByBytes,
      isDuplicateByBytes: true,
      isDuplicateBySource: false,
    };
  }

  const emojiName = buildDeterministicEmojiName(candidate.activityName, bytesHash);
  const createdAsset: ActivityEmojiAsset = {
    bytes,
    emojiName,
    fileName: getFileName(emojiName, mimeType),
    isDuplicateByBytes: false,
    isDuplicateBySource: false,
    sourceUrl: candidate.url,
    activityName: candidate.activityName,
    iconType: candidate.iconType,
    size: targetSize,
    mimeType,
  };

  sourceCache.set(sourceCacheKey, createdAsset);
  bytesHashCache.set(bytesHash, createdAsset);
  return createdAsset;
}
