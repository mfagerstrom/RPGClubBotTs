import axios from "axios";

interface TwitchAuthResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

// Basic IGDB Game interface for search results
export interface IGDBGame {
  id: number;
  name: string;
  cover?: {
    image_id: string;
  };
  summary?: string;
  first_release_date?: number; // Unix timestamp
  total_rating?: number;
  url?: string;
}

// Detailed IGDB Game interface
export interface IGDBGameDetails extends IGDBGame {
  slug: string;
  genres?: { id: number; name: string }[];
  themes?: { id: number; name: string }[];
  game_modes?: { id: number; name: string }[];
  player_perspectives?: { id: number; name: string }[];
  franchises?: { id: number; name: string }[];
  game_engines?: { id: number; name: string }[];
  collection?: { id: number; name: string }; // Series
  parent_game?: { id: number; name: string }; // Spin-off/DLC parent
  involved_companies?: {
    company: { id: number; name: string };
    developer: boolean;
    publisher: boolean;
  }[];
  platforms?: {
    id: number;
    name: string;
    platform_logo?: { image_id: string };
    websites?: { category: number; url: string }[];
  }[];
  release_dates?: {
    platform: { id: number; name: string };
    region: number; // 1: Europe, 2: North America, 3: Australia, 4: New Zealand, 5: Japan, 6: China, 7: Asia, 8: Worldwide
    date: number; // Unix timestamp
    y: number;
    m: number;
    category?: number;
  }[];
}

class IgdbService {
  private clientId: string;
  private clientSecret: string;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0; // Unix timestamp

  constructor() {
    this.clientId = process.env.IGDB_CLIENT_ID || "";
    this.clientSecret = process.env.IGDB_CLIENT_SECRET || "";

    if (!this.clientId || !this.clientSecret) {
      console.error("IGDB_CLIENT_ID or IGDB_CLIENT_SECRET not set in environment variables.");
    }
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    try {
      const response = await axios.post<TwitchAuthResponse>(
        `https://id.twitch.tv/oauth2/token?client_id=${this.clientId}` +
        `&client_secret=${this.clientSecret}&grant_type=client_credentials`,
      );

      this.accessToken = response.data.access_token;
      this.tokenExpiry = Date.now() + (response.data.expires_in * 1000) - 60000;
      console.log("IGDB: Fetched new Twitch access token.");
      return this.accessToken;
    } catch (error) {
      console.error("IGDB: Failed to fetch Twitch access token:", error);
      throw new Error("IGDB service unavailable: Could not authenticate with Twitch.");
    }
  }

  async searchGames(query: string, limit: number = 10): Promise<IGDBGame[]> {
    if (!this.clientId) {
      throw new Error("IGDB service not configured.");
    }
    const token = await this.getAccessToken();

    const sanitizedQuery = query.replace(/"/g, '\\"');
    const body = [
      "fields name, cover.image_id, summary, first_release_date, total_rating, url;",
      `search "${sanitizedQuery}";`,
      `limit ${limit};`,
    ].join(" ");

    try {
      const response = await axios.post<IGDBGame[]>(
        "https://api.igdb.com/v4/games",
        body,
        {
          headers: {
            "Client-ID": this.clientId,
            "Authorization": `Bearer ${token}`,
            "Content-Type": "text/plain",
          },
        },
      );

      return response.data;
    } catch (error: any) {
      console.error("IGDB: Failed to search games:", error);
      throw new Error(`IGDB service unavailable: Could not search for games. Error: ${error.message}`);
    }
  }

  async getGameDetails(igdbId: number): Promise<IGDBGameDetails | null> {
    if (!this.clientId) {
      throw new Error("IGDB service not configured.");
    }
    const token = await this.getAccessToken();

    const fields = [
      "name",
      "slug",
      "summary",
      "first_release_date",
      "cover.image_id",
      "genres.name",
      "platforms.name",
      "platforms.platform_logo.image_id",
      "release_dates.platform",
      "release_dates.platform.name",
      "release_dates.region",
      "release_dates.date",
      "release_dates.y",
      "release_dates.m",
      "release_dates.category",
      "themes.name",
      "game_modes.name",
      "player_perspectives.name",
      "franchises.name",
      "collection.name",
      "game_engines.name",
      "parent_game.name",
      "involved_companies.company.name",
      "involved_companies.developer",
      "involved_companies.publisher",
      "total_rating",
      "url",
    ].join(", ");

    const body = `fields ${fields}; where id = ${igdbId};`;

    try {
      const response = await axios.post<IGDBGameDetails[]>(
        "https://api.igdb.com/v4/games",
        body,
        {
          headers: {
            "Client-ID": this.clientId,
            "Authorization": `Bearer ${token}`,
            "Content-Type": "text/plain",
          },
        },
      );

      return response.data[0] || null;
    } catch (error: any) {
      console.error("IGDB: Failed to get game details:", error);
      throw new Error(`IGDB service unavailable: Could not retrieve game details. Error: ${error.message}`);
    }
  }

  // Helper to get image URL from image_id
  static getCoverImageUrl(imageId: string, size: string = "cover_big"): string {
    return `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.jpg`;
  }
}

export const igdbService = new IgdbService();
