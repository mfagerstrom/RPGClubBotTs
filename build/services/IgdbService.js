import axios from "axios";
class IgdbService {
    clientId;
    clientSecret;
    accessToken = null;
    tokenExpiry = 0; // Unix timestamp
    constructor() {
        this.clientId = process.env.IGDB_CLIENT_ID || "";
        this.clientSecret = process.env.IGDB_CLIENT_SECRET || "";
        if (!this.clientId || !this.clientSecret) {
            console.error("IGDB_CLIENT_ID or IGDB_CLIENT_SECRET not set in environment variables.");
        }
    }
    async getAccessToken() {
        if (this.accessToken && Date.now() < this.tokenExpiry) {
            return this.accessToken;
        }
        try {
            const response = await axios.post(`https://id.twitch.tv/oauth2/token?client_id=${this.clientId}` +
                `&client_secret=${this.clientSecret}&grant_type=client_credentials`);
            this.accessToken = response.data.access_token;
            this.tokenExpiry = Date.now() + (response.data.expires_in * 1000) - 60000;
            console.log("IGDB: Fetched new Twitch access token.");
            return this.accessToken;
        }
        catch (error) {
            console.error("IGDB: Failed to fetch Twitch access token:", error);
            throw new Error("IGDB service unavailable: Could not authenticate with Twitch.");
        }
    }
    async searchGames(query, limit = 10) {
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
            const response = await axios.post("https://api.igdb.com/v4/games", body, {
                headers: {
                    "Client-ID": this.clientId,
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "text/plain",
                },
            });
            return response.data;
        }
        catch (error) {
            console.error("IGDB: Failed to search games:", error);
            throw new Error(`IGDB service unavailable: Could not search for games. Error: ${error.message}`);
        }
    }
    async getGameDetails(igdbId) {
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
            const response = await axios.post("https://api.igdb.com/v4/games", body, {
                headers: {
                    "Client-ID": this.clientId,
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "text/plain",
                },
            });
            return response.data[0] || null;
        }
        catch (error) {
            console.error("IGDB: Failed to get game details:", error);
            throw new Error(`IGDB service unavailable: Could not retrieve game details. Error: ${error.message}`);
        }
    }
    // Helper to get image URL from image_id
    static getCoverImageUrl(imageId, size = "cover_big") {
        return `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.jpg`;
    }
}
export const igdbService = new IgdbService();
