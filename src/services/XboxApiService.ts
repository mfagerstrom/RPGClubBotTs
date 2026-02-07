type XboxIdentifierKind = "xuid" | "gamertag";
export type XboxApiErrorCode =
  | "invalid-identifier"
  | "profile-not-found"
  | "api-unauthorized"
  | "api-rate-limited"
  | "api-unavailable";

export class XboxApiError extends Error {
  readonly code: XboxApiErrorCode;

  constructor(code: XboxApiErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export type XboxOwnedGame = {
  titleId: string | null;
  productId: string | null;
  name: string;
  platformLabel: string | null;
};

export type XboxResolvedProfile = {
  xuid: string;
  gamertag: string | null;
  identifierKind: XboxIdentifierKind;
  rawIdentifier: string;
};

export type XboxOwnedLibrary = {
  xuid: string;
  gamertag: string | null;
  gameCount: number;
  games: XboxOwnedGame[];
};

type RetryableError = Error & { retryAfterMs?: number };

type RequestOptions = {
  maxAttempts?: number;
};

type XboxApiProvider = "xboxapi" | "openxbl";

const XUID_REGEX = /^\d{16,20}$/;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_MIN_INTERVAL_MS = 350;
const DEFAULT_XBOX_API_BASE_URL = "https://xboxapi.com";
const OPENXBL_API_BASE_PATH = "/api/v2";
const ALLOWED_XBOX_PLATFORM_LABELS = new Set([
  "xbox 360",
  "xbox one",
  "xbox series x|s",
  "xbox series x",
  "xbox series s",
]);
const EXCLUDED_TITLE_NAME_TOKENS = ["windows", "pc", "uwp"];

function getXboxApiKey(): string {
  return process.env.XBOX_API_KEY ?? "";
}

function getXboxApiBaseUrl(): string {
  return process.env.XBOX_API_BASE_URL ?? DEFAULT_XBOX_API_BASE_URL;
}

function getXboxExcludeGamePass(): boolean {
  const raw = process.env.XBOX_API_EXCLUDE_GAMEPASS ?? "";
  const value = raw.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function getXboxApiProvider(baseUrl: string): XboxApiProvider {
  if (baseUrl.toLowerCase().includes("xbl.io")) return "openxbl";
  return "xboxapi";
}

function ensureNoTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function ensureOpenXblBaseUrl(rawBaseUrl: string): string {
  const trimmed = ensureNoTrailingSlash(rawBaseUrl);
  const lower = trimmed.toLowerCase();
  if (lower.endsWith(OPENXBL_API_BASE_PATH)) {
    return trimmed;
  }
  if (lower.endsWith("/api")) {
    return `${trimmed}/v2`;
  }
  return `${trimmed}${OPENXBL_API_BASE_PATH}`;
}

function getOpenXblContractHeader(): string | null {
  const raw = process.env.XBOX_API_CONTRACT ?? "";
  const value = raw.trim();
  return value ? value : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(maxMs: number): number {
  return Math.floor(Math.random() * Math.max(1, maxMs));
}

export function parseXboxProfileIdentifier(rawIdentifier: string): {
  kind: XboxIdentifierKind;
  value: string;
} {
  const trimmed = rawIdentifier.trim();
  if (!trimmed.length) {
    throw new XboxApiError("invalid-identifier", "Xbox profile identifier is required.");
  }

  if (XUID_REGEX.test(trimmed)) {
    return { kind: "xuid", value: trimmed };
  }

  if (trimmed.length > 64) {
    throw new XboxApiError("invalid-identifier", "Xbox gamertag is too long.");
  }

  return { kind: "gamertag", value: trimmed };
}

export function classifyXboxHttpStatus(status: number): XboxApiErrorCode | null {
  if (status === 401 || status === 403) return "api-unauthorized";
  if (status === 404) return "profile-not-found";
  if (status === 429) return "api-rate-limited";
  if (status >= 500) return "api-unavailable";
  return null;
}

function parseRetryAfter(headers: Headers): number | undefined {
  const retryAfter = headers.get("retry-after");
  if (!retryAfter) return undefined;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.floor(seconds * 1000);
  }
  return undefined;
}

function extractTitleId(raw: Record<string, unknown>): string | null {
  const value = raw.titleId ?? raw.titleID ?? raw.title_id ?? raw.id ?? raw.titleid;
  if (value == null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function extractProductId(raw: Record<string, unknown>): string | null {
  const value = raw.productId ?? raw.productID ?? raw.product_id ?? raw.pfn;
  if (value == null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function extractTitleName(raw: Record<string, unknown>): string {
  return String(
    raw.name ??
      raw.title ??
      raw.titleName ??
      raw.displayName ??
      raw.productName ??
      "",
  ).trim();
}

function normalizeXboxOwnedGames(raw: unknown, platformLabel: string | null): XboxOwnedGame[] {
  const candidates = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as any)?.titles)
      ? (raw as any).titles
      : Array.isArray((raw as any)?.games)
        ? (raw as any).games
        : [];
  const results: XboxOwnedGame[] = [];
  const seen = new Set<string>();

  for (const entry of candidates) {
    if (!entry || typeof entry !== "object") continue;
    const rawEntry = entry as Record<string, unknown>;
    const name = extractTitleName(rawEntry);
    if (!name) continue;
    const titleId = extractTitleId(rawEntry);
    const productId = extractProductId(rawEntry);
    const key = titleId
      ? `id:${titleId}`
      : `name:${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      titleId,
      productId,
      name,
      platformLabel,
    });
  }

  return results;
}

function extractOpenXblPeople(raw: unknown): Array<Record<string, unknown>> {
  if (!raw || typeof raw !== "object") return [];
  const people = (raw as any)?.people;
  if (Array.isArray(people)) return people as Array<Record<string, unknown>>;
  if (Array.isArray(people?.people)) return people.people as Array<Record<string, unknown>>;
  return [];
}

function extractOpenXblXuidFromPeople(people: Array<Record<string, unknown>>): string | null {
  for (const entry of people) {
    const candidate = entry?.xuid ?? entry?.id ?? entry?.xuid64 ?? null;
    if (candidate == null) continue;
    const value = String(candidate).trim();
    if (XUID_REGEX.test(value)) return value;
  }
  return null;
}

function extractOpenXblGamertagFromPeople(people: Array<Record<string, unknown>>): string | null {
  for (const entry of people) {
    const tag = entry?.gamertag ?? entry?.modernGamertag ?? entry?.uniqueModernGamertag ?? null;
    if (tag == null) continue;
    const value = String(tag).trim();
    if (value) return value;
  }
  return null;
}

function extractOpenXblAchievementTitles(raw: unknown): XboxOwnedGame[] {
  const titles = Array.isArray((raw as any)?.titles)
    ? (raw as any).titles
    : Array.isArray((raw as any)?.achievements?.titles)
      ? (raw as any).achievements.titles
      : Array.isArray((raw as any)?.achievements)
        ? (raw as any).achievements
        : [];
  const results: XboxOwnedGame[] = [];
  const seen = new Set<string>();
  for (const entry of titles) {
    if (!entry || typeof entry !== "object") continue;
    const rawEntry = entry as Record<string, unknown>;
    const name = extractTitleName(rawEntry);
    if (!name) continue;
    const titleId = extractTitleId(rawEntry);
    const productId = extractProductId(rawEntry);
    const key = titleId ? `id:${titleId}` : `name:${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      titleId,
      productId,
      name,
      platformLabel: null,
    });
  }
  return results;
}

function isAllowedXboxPlatformGame(game: XboxOwnedGame): boolean {
  if (game.platformLabel) {
    const normalized = game.platformLabel.toLowerCase().trim();
    if (!ALLOWED_XBOX_PLATFORM_LABELS.has(normalized)) {
      return false;
    }
  }
  const productId = game.productId?.toLowerCase() ?? "";
  if (productId && EXCLUDED_TITLE_NAME_TOKENS.some((token) => productId.includes(token))) {
    return false;
  }
  const titleName = game.name.toLowerCase();
  if (EXCLUDED_TITLE_NAME_TOKENS.some((token) => titleName.includes(token))) {
    return false;
  }
  return true;
}

function extractOpenXblGamePassIds(raw: unknown): Set<string> {
  const items = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as any)?.titles)
      ? (raw as any).titles
      : Array.isArray((raw as any)?.games)
        ? (raw as any).games
        : [];
  const ids = new Set<string>();
  for (const entry of items) {
    if (!entry || typeof entry !== "object") continue;
    const rawEntry = entry as Record<string, unknown>;
    const titleId = extractTitleId(rawEntry);
    if (titleId) ids.add(titleId);
    const productId = extractProductId(rawEntry);
    if (productId) ids.add(productId);
    const storeId = rawEntry.storeId ?? rawEntry.storeID ?? rawEntry.store_id ?? null;
    if (storeId != null) {
      const value = String(storeId).trim();
      if (value) ids.add(value);
    }
    const id = rawEntry.id ?? null;
    if (id != null) {
      const value = String(id).trim();
      if (value) ids.add(value);
    }
  }
  return ids;
}

export class XboxApiService {
  private nextAllowedAtMs = 0;

  private get apiKey(): string {
    const key = getXboxApiKey();
    if (!key) {
      throw new Error("Xbox API key is not configured.");
    }
    return key;
  }

  private get baseUrl(): string {
    const rawBaseUrl = getXboxApiBaseUrl();
    const provider = getXboxApiProvider(rawBaseUrl);
    if (provider === "openxbl") {
      return ensureOpenXblBaseUrl(rawBaseUrl);
    }
    return ensureNoTrailingSlash(rawBaseUrl);
  }

  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    if (now < this.nextAllowedAtMs) {
      await sleep(this.nextAllowedAtMs - now);
    }
    this.nextAllowedAtMs = Date.now() + DEFAULT_MIN_INTERVAL_MS;
  }

  private logRequestFailure(params: {
    url: string;
    attempt: number;
    maxAttempts: number;
    status: number | null;
    retryAfterMs?: number;
    responseText?: string | null;
    responseContentType?: string | null;
    errorMessage?: string | null;
  }): void {
    const details = {
      url: params.url,
      attempt: params.attempt,
      maxAttempts: params.maxAttempts,
      status: params.status ?? "n/a",
      retryAfterMs: params.retryAfterMs ?? "n/a",
      contentType: params.responseContentType ?? "n/a",
      responseText: params.responseText ?? "n/a",
      errorMessage: params.errorMessage ?? "n/a",
    };
    console.info("[XboxApi] request failed", JSON.stringify(details));
  }

  private async requestJson<T>(
    path: string,
    options?: RequestOptions,
  ): Promise<T> {
    const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    let attempt = 0;
    let lastError: unknown = null;
    const url = `${this.baseUrl}${path}`;
    const provider = getXboxApiProvider(this.baseUrl);
    const headers: Record<string, string> = {
      "Accept": "application/json",
    };
    if (provider === "openxbl") {
      headers["X-Authorization"] = this.apiKey;
      const contract = getOpenXblContractHeader();
      if (contract) {
        headers["X-Contract"] = contract;
      }
      headers["Accept-Language"] = "en-US";
    } else {
      headers["X-AUTH"] = this.apiKey;
    }

    while (attempt < maxAttempts) {
      attempt += 1;
      await this.waitForRateLimit();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          headers,
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (response.ok) {
          return await response.json() as T;
        }

        const retryAfterMs = parseRetryAfter(response.headers);
        const responseText = await response.text().catch(() => null);
        this.logRequestFailure({
          url,
          attempt,
          maxAttempts,
          status: response.status,
          retryAfterMs,
          responseText: responseText ? responseText.slice(0, 500) : null,
          responseContentType: response.headers.get("content-type"),
        });
        const errorCode = classifyXboxHttpStatus(response.status);
        if (errorCode) {
          const error = new XboxApiError(
            errorCode,
            `Xbox API request failed with status ${response.status}.`,
          ) as RetryableError;
          error.retryAfterMs = retryAfterMs;
          throw error;
        }

        throw new Error(`Xbox API request failed with status ${response.status}.`);
      } catch (error: any) {
        clearTimeout(timeout);
        lastError = error;
        this.logRequestFailure({
          url,
          attempt,
          maxAttempts,
          status: null,
          errorMessage: String(error?.message ?? "unknown error"),
        });
        const statusCode = error instanceof XboxApiError ? error.code : null;
        const isRetryable = statusCode === "api-rate-limited" || statusCode === "api-unavailable";
        if (!isRetryable || attempt >= maxAttempts) {
          throw error;
        }
        const retryAfterMs = (error as RetryableError)?.retryAfterMs;
        const baseDelay = retryAfterMs ?? 500 * attempt;
        await sleep(baseDelay + jitter(350));
      }
    }

    throw lastError ?? new Error("Xbox API request failed.");
  }

  async resolveProfileIdentifier(rawIdentifier: string): Promise<XboxResolvedProfile> {
    const parsed = parseXboxProfileIdentifier(rawIdentifier);
    if (parsed.kind === "xuid") {
      return {
        xuid: parsed.value,
        gamertag: null,
        identifierKind: "xuid",
        rawIdentifier,
      };
    }

    const safeTag = encodeURIComponent(parsed.value);
    const provider = getXboxApiProvider(this.baseUrl);
    if (provider === "openxbl") {
      const response = await this.requestJson<unknown>(`/search/${safeTag}`);
      const people = extractOpenXblPeople(response);
      const xuid = extractOpenXblXuidFromPeople(people);
      if (!xuid) {
        throw new XboxApiError("profile-not-found", "Xbox gamertag was not found.");
      }
      const resolvedTag = extractOpenXblGamertagFromPeople(people) ?? parsed.value;
      return {
        xuid,
        gamertag: resolvedTag,
        identifierKind: "gamertag",
        rawIdentifier,
      };
    }

    const response = await this.requestJson<unknown>(`/v2/xuid/${safeTag}`);
    const xuid = typeof response === "string" || typeof response === "number"
      ? String(response)
      : typeof (response as any)?.xuid === "string"
        ? String((response as any).xuid)
        : typeof (response as any)?.xuid === "number"
          ? String((response as any).xuid)
          : null;
    if (!xuid || !XUID_REGEX.test(xuid)) {
      throw new XboxApiError("profile-not-found", "Xbox gamertag was not found.");
    }

    return {
      xuid,
      gamertag: parsed.value,
      identifierKind: "gamertag",
      rawIdentifier,
    };
  }

  async getOwnedGames(xuid: string): Promise<XboxOwnedLibrary> {
    const provider = getXboxApiProvider(this.baseUrl);
    if (provider === "openxbl") {
      const response = await this.requestJson<unknown>(
        `/achievements/player/${encodeURIComponent(xuid)}`,
      );
      let games = extractOpenXblAchievementTitles(response).filter(isAllowedXboxPlatformGame);
      if (!games.length) {
        throw new XboxApiError(
          "profile-not-found",
          "No Xbox titles were returned by OpenXBL. Check privacy settings or use CSV import.",
        );
      }
      if (getXboxExcludeGamePass()) {
        try {
          const gamePassResponse = await this.requestJson<unknown>("/gamepass/all");
          const gamePassIds = extractOpenXblGamePassIds(gamePassResponse);
          if (gamePassIds.size) {
            games = games.filter((game) => {
              if (game.productId && gamePassIds.has(game.productId)) return false;
              if (game.titleId && gamePassIds.has(game.titleId)) return false;
              return true;
            });
          }
        } catch (error: any) {
          console.info(
            "[XboxApi] gamepass filter failed",
            JSON.stringify({ message: String(error?.message ?? "unknown error") }),
          );
        }
      }
      return {
        xuid,
        gamertag: null,
        gameCount: games.length,
        games,
      };
    }

    const [xboxOne, xbox360] = await Promise.all([
      this.requestJson<unknown>(`/v2/${encodeURIComponent(xuid)}/xboxonegames`),
      this.requestJson<unknown>(`/v2/${encodeURIComponent(xuid)}/xbox360games`),
    ]);

    const games = [
      ...normalizeXboxOwnedGames(xboxOne, "Xbox One"),
      ...normalizeXboxOwnedGames(xbox360, "Xbox 360"),
    ].filter(isAllowedXboxPlatformGame);
    return {
      xuid,
      gamertag: null,
      gameCount: games.length,
      games,
    };
  }
}

export const xboxApiService = new XboxApiService();
