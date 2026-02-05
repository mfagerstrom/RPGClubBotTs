type SteamIdentifierKind = "steamid64" | "profiles-url" | "vanity-url" | "vanity";
export type SteamApiErrorCode =
  | "invalid-identifier"
  | "private-profile"
  | "api-unavailable"
  | "api-rate-limited"
  | "api-unauthorized";

export class SteamApiError extends Error {
  readonly code: SteamApiErrorCode;

  constructor(code: SteamApiErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export type SteamOwnedGame = {
  appId: number;
  name: string;
  playtimeForeverMinutes: number;
  playtimeWindowsMinutes: number | null;
  playtimeMacMinutes: number | null;
  playtimeLinuxMinutes: number | null;
  playtimeDeckMinutes: number | null;
  lastPlayedAt: Date | null;
};

export type SteamResolvedProfile = {
  steamId64: string;
  identifierKind: SteamIdentifierKind;
  rawIdentifier: string;
  profilePath: string;
};

export type SteamOwnedLibrary = {
  steamId64: string;
  profileName: string | null;
  gameCount: number;
  games: SteamOwnedGame[];
};

type SteamResolveVanityResponse = {
  response?: {
    success?: number;
    steamid?: string;
    message?: string;
  };
};

type SteamOwnedGamesResponse = {
  response?: {
    game_count?: number;
    games?: Array<{
      appid?: number;
      name?: string;
      playtime_forever?: number;
      playtime_windows_forever?: number;
      playtime_mac_forever?: number;
      playtime_linux_forever?: number;
      playtime_deck_forever?: number;
      rtime_last_played?: number;
    }>;
  };
};

type SteamPlayerSummaryResponse = {
  response?: {
    players?: Array<{
      steamid?: string;
      personaname?: string;
    }>;
  };
};

type RetryableError = Error & { retryAfterMs?: number };

type RequestOptions = {
  maxAttempts?: number;
};

const STEAM_ID_64_REGEX = /^\d{17}$/;
const STEAM_PROFILE_URL_REGEX = /^https?:\/\/steamcommunity\.com\/(id|profiles)\/([^/?#]+)/i;
const STEAM_VANITY_REGEX = /^[a-zA-Z0-9_-]{2,64}$/;
const STEAM_API_BASE = "https://api.steampowered.com";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_MIN_INTERVAL_MS = 250;

function getSteamApiKey(): string {
  return process.env.STEAM_WEB_API_KEY ?? process.env.STEAM_API_KEY ?? "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(maxMs: number): number {
  return Math.floor(Math.random() * Math.max(1, maxMs));
}

function isSteamId64(value: string): boolean {
  return STEAM_ID_64_REGEX.test(value);
}

export function parseSteamProfileIdentifier(rawIdentifier: string): {
  kind: SteamIdentifierKind;
  value: string;
} {
  const trimmed = rawIdentifier.trim();
  if (!trimmed.length) {
    throw new SteamApiError("invalid-identifier", "Steam profile identifier is required.");
  }

  if (isSteamId64(trimmed)) {
    return { kind: "steamid64", value: trimmed };
  }

  const profileMatch = STEAM_PROFILE_URL_REGEX.exec(trimmed);
  if (profileMatch) {
    const [, kind, segment] = profileMatch;
    if (kind.toLowerCase() === "profiles") {
      return { kind: "profiles-url", value: segment };
    }
    return { kind: "vanity-url", value: segment };
  }

  if (STEAM_VANITY_REGEX.test(trimmed)) {
    return { kind: "vanity", value: trimmed };
  }

  throw new SteamApiError(
    "invalid-identifier",
    "Unsupported Steam profile identifier format.",
  );
}

export function classifySteamHttpStatus(status: number): SteamApiErrorCode | null {
  if (status === 401) return "api-unauthorized";
  if (status === 403) return "private-profile";
  if (status === 429) return "api-rate-limited";
  if (status >= 500) return "api-unavailable";
  return null;
}

function toOwnedGame(rawGame: {
  appid?: number;
  name?: string;
  playtime_forever?: number;
  playtime_windows_forever?: number;
  playtime_mac_forever?: number;
  playtime_linux_forever?: number;
  playtime_deck_forever?: number;
  rtime_last_played?: number;
}): SteamOwnedGame | null {
  const appId = Number(rawGame.appid ?? 0);
  const name = String(rawGame.name ?? "").trim();
  if (!Number.isInteger(appId) || appId <= 0 || !name.length) {
    return null;
  }

  const lastPlayedAt = rawGame.rtime_last_played
    ? new Date(rawGame.rtime_last_played * 1000)
    : null;

  return {
    appId,
    name,
    playtimeForeverMinutes: Number(rawGame.playtime_forever ?? 0),
    playtimeWindowsMinutes: rawGame.playtime_windows_forever == null
      ? null
      : Number(rawGame.playtime_windows_forever),
    playtimeMacMinutes: rawGame.playtime_mac_forever == null
      ? null
      : Number(rawGame.playtime_mac_forever),
    playtimeLinuxMinutes: rawGame.playtime_linux_forever == null
      ? null
      : Number(rawGame.playtime_linux_forever),
    playtimeDeckMinutes: rawGame.playtime_deck_forever == null
      ? null
      : Number(rawGame.playtime_deck_forever),
    lastPlayedAt,
  };
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
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

export class SteamApiService {
  private nextAllowedAtMs = 0;

  private get apiKey(): string {
    const key = getSteamApiKey();
    if (!key) {
      throw new Error("Steam API key is not configured.");
    }
    return key;
  }

  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    if (now < this.nextAllowedAtMs) {
      await sleep(this.nextAllowedAtMs - now);
    }
    this.nextAllowedAtMs = Date.now() + DEFAULT_MIN_INTERVAL_MS;
  }

  private async requestJson<T>(
    path: string,
    queryParams: Record<string, string>,
    options?: RequestOptions,
  ): Promise<T> {
    const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const params = new URLSearchParams(queryParams);
    params.set("key", this.apiKey);
    const url = `${STEAM_API_BASE}${path}?${params.toString()}`;

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await this.waitForRateLimit();

      try {
        const response = await fetch(url, {
          method: "GET",
          headers: { "user-agent": "RPGClubBotTs/SteamImport" },
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        });

        if (!response.ok) {
          const retryable = isRetryableStatus(response.status);
          const error = new Error(`Steam API returned HTTP ${response.status}.`) as RetryableError;
          error.retryAfterMs = parseRetryAfter(response.headers);
          const statusCode = classifySteamHttpStatus(response.status);

          if (statusCode === "api-unauthorized") {
            throw new SteamApiError(
              "api-unauthorized",
              "Steam API key is invalid or unauthorized.",
            );
          }
          if (statusCode === "private-profile") {
            throw new SteamApiError(
              "private-profile",
              "Steam profile appears private. Set games/profile visibility to public.",
            );
          }
          if (statusCode === "api-rate-limited" && attempt >= maxAttempts) {
            throw new SteamApiError(
              "api-rate-limited",
              "Steam API is rate limiting requests. Please retry shortly.",
            );
          }

          if (!retryable || attempt >= maxAttempts) {
            throw new SteamApiError(
              "api-unavailable",
              `Steam API returned HTTP ${response.status}.`,
            );
          }

          const base = error.retryAfterMs ?? Math.min(5_000, 500 * (2 ** (attempt - 1)));
          await sleep(base + jitter(250));
          continue;
        }

        return await response.json() as T;
      } catch (error) {
        if (error instanceof SteamApiError) {
          throw error;
        }
        lastError = error instanceof Error
          ? error
          : new Error("Unknown Steam API request error.");
        if (attempt >= maxAttempts) break;
        await sleep(Math.min(5_000, 500 * (2 ** (attempt - 1))) + jitter(250));
      }
    }

    throw new SteamApiError(
      "api-unavailable",
      lastError?.message ?? "Steam API request failed.",
    );
  }

  async resolveProfileIdentifier(rawIdentifier: string): Promise<SteamResolvedProfile> {
    const parsed = parseSteamProfileIdentifier(rawIdentifier);
    if (parsed.kind === "steamid64" || parsed.kind === "profiles-url") {
      const steamId64 = parsed.value;
      if (!isSteamId64(steamId64)) {
        throw new SteamApiError("invalid-identifier", "Steam profile id is not a valid SteamID64.");
      }
      return {
        steamId64,
        identifierKind: parsed.kind,
        rawIdentifier,
        profilePath: `profiles/${steamId64}`,
      };
    }

    const resolved = await this.requestJson<SteamResolveVanityResponse>(
      "/ISteamUser/ResolveVanityURL/v1/",
      { vanityurl: parsed.value },
    );
    const steamId64 = resolved.response?.steamid?.trim() ?? "";
    if (!isSteamId64(steamId64)) {
      throw new SteamApiError(
        "invalid-identifier",
        "Could not resolve Steam vanity profile. Ensure the profile exists and is public.",
      );
    }

    return {
      steamId64,
      identifierKind: parsed.kind,
      rawIdentifier,
      profilePath: `profiles/${steamId64}`,
    };
  }

  async getPlayerSummary(steamId64: string): Promise<{ profileName: string | null }> {
    if (!isSteamId64(steamId64)) {
      throw new SteamApiError("invalid-identifier", "Steam ID must be a 17-digit SteamID64.");
    }

    const payload = await this.requestJson<SteamPlayerSummaryResponse>(
      "/ISteamUser/GetPlayerSummaries/v2/",
      { steamids: steamId64 },
    );
    const profileName = payload.response?.players?.[0]?.personaname?.trim() ?? null;
    return { profileName };
  }

  async getOwnedGames(steamId64: string): Promise<SteamOwnedLibrary> {
    if (!isSteamId64(steamId64)) {
      throw new SteamApiError("invalid-identifier", "Steam ID must be a 17-digit SteamID64.");
    }

    const payload = await this.requestJson<SteamOwnedGamesResponse>(
      "/IPlayerService/GetOwnedGames/v1/",
      {
        steamid: steamId64,
        include_appinfo: "1",
        include_played_free_games: "1",
      },
    );

    const rawGames = payload.response?.games ?? [];
    const games = rawGames
      .map((rawGame) => toOwnedGame(rawGame))
      .filter((game): game is SteamOwnedGame => Boolean(game));
    const gameCount = Number(payload.response?.game_count ?? games.length);
    const profileSummary = await this.getPlayerSummary(steamId64);

    if (!games.length) {
      throw new SteamApiError(
        "private-profile",
        "No visible games were returned. Ensure your Steam game details are public.",
      );
    }

    return {
      steamId64,
      profileName: profileSummary.profileName,
      gameCount,
      games,
    };
  }
}

export const steamApiService = new SteamApiService();
