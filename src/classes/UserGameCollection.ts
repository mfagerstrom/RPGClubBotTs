import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";

export const COLLECTION_OWNERSHIP_TYPES = [
  "Digital",
  "Physical",
  "Subscription",
  "Other",
] as const;

export type CollectionOwnershipType = (typeof COLLECTION_OWNERSHIP_TYPES)[number];

export interface IUserGameCollectionEntry {
  entryId: number;
  userId: string;
  gameId: number;
  title: string;
  platformId: number | null;
  platformName: string | null;
  platformAbbreviation: string | null;
  ownershipType: CollectionOwnershipType;
  note: string | null;
  isShared: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUserGameCollectionAutocompleteEntry {
  entryId: number;
  gameId: number;
  title: string;
  platformName: string | null;
  ownershipType: CollectionOwnershipType;
}

export interface IUserGameCollectionOverviewEntry {
  platformId: number | null;
  platformName: string | null;
  platformAbbreviation: string | null;
  total: number;
}

export interface IUserGameCollectionUserOverview {
  userId: string;
  username: string | null;
  globalName: string | null;
  totalCount: number;
  platformCounts: IUserGameCollectionOverviewEntry[];
}

type CollectionRow = {
  ENTRY_ID: number;
  USER_ID: string;
  GAMEDB_GAME_ID: number;
  TITLE: string;
  PLATFORM_ID: number | null;
  PLATFORM_NAME: string | null;
  PLATFORM_ABBREVIATION: string | null;
  OWNERSHIP_TYPE: CollectionOwnershipType;
  NOTE: string | null;
  IS_SHARED: number;
  CREATED_AT: Date | string;
  UPDATED_AT: Date | string;
};

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function normalizeOwnershipType(value: string): CollectionOwnershipType {
  const trimmed = value.trim();
  const match = COLLECTION_OWNERSHIP_TYPES.find((item) =>
    item.toLowerCase() === trimmed.toLowerCase(),
  );
  if (!match) {
    throw new Error("Ownership type must be Digital, Physical, Subscription, or Other.");
  }
  return match;
}

function mapEntry(row: CollectionRow): IUserGameCollectionEntry {
  return {
    entryId: Number(row.ENTRY_ID),
    userId: row.USER_ID,
    gameId: Number(row.GAMEDB_GAME_ID),
    title: row.TITLE,
    platformId: row.PLATFORM_ID == null ? null : Number(row.PLATFORM_ID),
    platformName: row.PLATFORM_NAME ?? null,
    platformAbbreviation: row.PLATFORM_ABBREVIATION ?? null,
    ownershipType: row.OWNERSHIP_TYPE,
    note: row.NOTE ?? null,
    isShared: Number(row.IS_SHARED ?? 0) === 1,
    createdAt: toDate(row.CREATED_AT),
    updatedAt: toDate(row.UPDATED_AT),
  };
}

async function getEntryById(
  entryId: number,
  userId: string,
  connection: oracledb.Connection,
): Promise<IUserGameCollectionEntry | null> {
  const result = await connection.execute<CollectionRow>(
    `SELECT c.ENTRY_ID,
            c.USER_ID,
            c.GAMEDB_GAME_ID,
            g.TITLE,
            c.PLATFORM_ID,
            p.PLATFORM_NAME,
            p.PLATFORM_ABBREVIATION,
            c.OWNERSHIP_TYPE,
            c.NOTE,
            c.IS_SHARED,
            c.CREATED_AT,
            c.UPDATED_AT
       FROM USER_GAME_COLLECTIONS c
       JOIN GAMEDB_GAMES g ON g.GAME_ID = c.GAMEDB_GAME_ID
       LEFT JOIN GAMEDB_PLATFORMS p ON p.PLATFORM_ID = c.PLATFORM_ID
      WHERE c.ENTRY_ID = :entryId
        AND c.USER_ID = :userId`,
    { entryId, userId },
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );

  const row = result.rows?.[0];
  return row ? mapEntry(row) : null;
}

export default class UserGameCollection {
  static async addEntry(params: {
    userId: string;
    gameId: number;
    platformId: number | null;
    ownershipType: string;
    note?: string | null;
  }): Promise<IUserGameCollectionEntry> {
    const { userId, gameId, platformId } = params;
    const ownershipType = normalizeOwnershipType(params.ownershipType);
    const note = params.note?.trim() ? params.note.trim() : null;
    const isShared = 1;

    if (!Number.isInteger(gameId) || gameId <= 0) {
      throw new Error("Invalid GameDB id.");
    }
    if (platformId != null && (!Number.isInteger(platformId) || platformId <= 0)) {
      throw new Error("Invalid platform id.");
    }
    if (note && note.length > 500) {
      throw new Error("Note must be 500 characters or fewer.");
    }

    const connection = await getOraclePool().getConnection();
    try {
      const insert = await connection.execute<{ ENTRY_ID: number }>(
        `INSERT INTO USER_GAME_COLLECTIONS (
           USER_ID,
           GAMEDB_GAME_ID,
           PLATFORM_ID,
           OWNERSHIP_TYPE,
           NOTE,
           IS_SHARED
         ) VALUES (
           :userId,
           :gameId,
           :platformId,
           :ownershipType,
           :note,
           :isShared
         )
         RETURNING ENTRY_ID INTO :entryId`,
        {
          userId,
          gameId,
          platformId,
          ownershipType,
          note,
          isShared,
          entryId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        },
        { autoCommit: true },
      );

      const entryId = Number((insert.outBinds as any)?.entryId?.[0] ?? 0);
      if (!entryId) {
        throw new Error("Failed to create collection entry.");
      }

      const saved = await getEntryById(entryId, userId, connection);
      if (!saved) {
        throw new Error("Failed to load created collection entry.");
      }
      return saved;
    } catch (err: any) {
      const msg = String(err?.message ?? "");
      if (/ORA-00001/i.test(msg) || /unique constraint/i.test(msg)) {
        throw new Error("That game/platform/ownership entry already exists in your collection.");
      }
      throw err;
    } finally {
      await connection.close();
    }
  }

  static async getEntryForUser(
    entryId: number,
    userId: string,
  ): Promise<IUserGameCollectionEntry | null> {
    if (!Number.isInteger(entryId) || entryId <= 0) {
      throw new Error("Invalid entry id.");
    }

    const connection = await getOraclePool().getConnection();
    try {
      return await getEntryById(entryId, userId, connection);
    } finally {
      await connection.close();
    }
  }

  static async updateEntryForUser(
    entryId: number,
    userId: string,
    updates: {
      platformId?: number | null;
      ownershipType?: string;
      note?: string | null;
    },
  ): Promise<IUserGameCollectionEntry | null> {
    if (!Number.isInteger(entryId) || entryId <= 0) {
      throw new Error("Invalid entry id.");
    }

    const updateParts: string[] = [];
    const binds: Record<string, any> = { entryId, userId };

    if (updates.platformId !== undefined) {
      if (updates.platformId != null && (!Number.isInteger(updates.platformId) || updates.platformId <= 0)) {
        throw new Error("Invalid platform id.");
      }
      updateParts.push("PLATFORM_ID = :platformId");
      binds.platformId = updates.platformId;
    }

    if (updates.ownershipType !== undefined) {
      updateParts.push("OWNERSHIP_TYPE = :ownershipType");
      binds.ownershipType = normalizeOwnershipType(updates.ownershipType);
    }

    if (updates.note !== undefined) {
      const note = updates.note?.trim() ? updates.note.trim() : null;
      if (note && note.length > 500) {
        throw new Error("Note must be 500 characters or fewer.");
      }
      updateParts.push("NOTE = :note");
      binds.note = note;
    }

    if (!updateParts.length) {
      throw new Error("No collection fields were provided to update.");
    }

    const connection = await getOraclePool().getConnection();
    try {
      const result = await connection.execute(
        `UPDATE USER_GAME_COLLECTIONS
            SET ${updateParts.join(", ")}
          WHERE ENTRY_ID = :entryId
            AND USER_ID = :userId`,
        binds,
        { autoCommit: true },
      );

      if ((result.rowsAffected ?? 0) <= 0) {
        return null;
      }

      return await getEntryById(entryId, userId, connection);
    } catch (err: any) {
      const msg = String(err?.message ?? "");
      if (/ORA-00001/i.test(msg) || /unique constraint/i.test(msg)) {
        throw new Error("That game/platform/ownership entry already exists in your collection.");
      }
      throw err;
    } finally {
      await connection.close();
    }
  }

  static async removeEntryForUser(entryId: number, userId: string): Promise<boolean> {
    if (!Number.isInteger(entryId) || entryId <= 0) {
      throw new Error("Invalid entry id.");
    }

    const connection = await getOraclePool().getConnection();
    try {
      const result = await connection.execute(
        `DELETE FROM USER_GAME_COLLECTIONS
          WHERE ENTRY_ID = :entryId
            AND USER_ID = :userId`,
        { entryId, userId },
        { autoCommit: true },
      );
      return (result.rowsAffected ?? 0) > 0;
    } finally {
      await connection.close();
    }
  }

  static async searchEntries(filters: {
    targetUserId: string;
    title?: string;
    platform?: string;
    platformId?: number | null;
    ownershipType?: string;
    limit?: number;
  }): Promise<IUserGameCollectionEntry[]> {
    const targetUserId = filters.targetUserId;
    const where: string[] = ["c.USER_ID = :targetUserId"];
    const binds: Record<string, any> = { targetUserId };

    if (filters.title?.trim()) {
      where.push("LOWER(g.TITLE) LIKE :title");
      binds.title = `%${filters.title.trim().toLowerCase()}%`;
    }

    if (filters.platform?.trim()) {
      where.push(
        "(LOWER(NVL(p.PLATFORM_NAME, '')) LIKE :platform OR LOWER(NVL(p.PLATFORM_CODE, '')) LIKE :platform OR LOWER(NVL(p.PLATFORM_ABBREVIATION, '')) LIKE :platform)",
      );
      binds.platform = `%${filters.platform.trim().toLowerCase()}%`;
    }

    if (filters.platformId !== undefined) {
      if (filters.platformId == null) {
        where.push("c.PLATFORM_ID IS NULL");
      } else if (Number.isInteger(filters.platformId) && filters.platformId > 0) {
        where.push("c.PLATFORM_ID = :platformId");
        binds.platformId = Math.trunc(filters.platformId);
      } else {
        throw new Error("Invalid platform id.");
      }
    }

    if (filters.ownershipType?.trim()) {
      where.push("c.OWNERSHIP_TYPE = :ownershipType");
      binds.ownershipType = normalizeOwnershipType(filters.ownershipType);
    }

    const requestedLimit = Number(filters.limit ?? 0);
    const hasLimit = Number.isInteger(requestedLimit) && requestedLimit > 0;
    if (hasLimit) {
      binds.limit = Math.trunc(requestedLimit);
    }
    const fetchClause = hasLimit ? "FETCH FIRST :limit ROWS ONLY" : "";

    const connection = await getOraclePool().getConnection();
    try {
      const result = await connection.execute<CollectionRow>(
        `SELECT c.ENTRY_ID,
                c.USER_ID,
                c.GAMEDB_GAME_ID,
                g.TITLE,
                c.PLATFORM_ID,
                p.PLATFORM_NAME,
                p.PLATFORM_ABBREVIATION,
                c.OWNERSHIP_TYPE,
                c.NOTE,
                c.IS_SHARED,
                c.CREATED_AT,
                c.UPDATED_AT
           FROM USER_GAME_COLLECTIONS c
           JOIN GAMEDB_GAMES g ON g.GAME_ID = c.GAMEDB_GAME_ID
          LEFT JOIN GAMEDB_PLATFORMS p ON p.PLATFORM_ID = c.PLATFORM_ID
          WHERE ${where.join(" AND ")}
          ORDER BY LOWER(g.TITLE), LOWER(NVL(p.PLATFORM_NAME, '')), c.ENTRY_ID
          ${fetchClause}`,
        binds,
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );

      return (result.rows ?? []).map(mapEntry);
    } finally {
      await connection.close();
    }
  }

  static async getOverviewForUser(userId: string): Promise<{
    totalCount: number;
    platformCounts: IUserGameCollectionOverviewEntry[];
  }> {
    if (!userId.trim()) {
      throw new Error("Invalid user id.");
    }

    const connection = await getOraclePool().getConnection();
    try {
      const totalResult = await connection.execute<{ TOTAL_COUNT: number }>(
        `SELECT COUNT(*) AS TOTAL_COUNT
           FROM USER_GAME_COLLECTIONS
          WHERE USER_ID = :userId`,
        { userId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const totalCount = Number(totalResult.rows?.[0]?.TOTAL_COUNT ?? 0);

      const result = await connection.execute<{
        PLATFORM_ID: number | null;
        PLATFORM_NAME: string | null;
        PLATFORM_ABBREVIATION: string | null;
        TOTAL_COUNT: number;
      }>(
        `SELECT c.PLATFORM_ID,
                p.PLATFORM_NAME,
                p.PLATFORM_ABBREVIATION,
                COUNT(*) AS TOTAL_COUNT
           FROM USER_GAME_COLLECTIONS c
           LEFT JOIN GAMEDB_PLATFORMS p ON p.PLATFORM_ID = c.PLATFORM_ID
          WHERE c.USER_ID = :userId
          GROUP BY c.PLATFORM_ID, p.PLATFORM_NAME, p.PLATFORM_ABBREVIATION
          ORDER BY COUNT(*) DESC,
                   LOWER(NVL(p.PLATFORM_NAME, 'Unknown')),
                   c.PLATFORM_ID`,
        { userId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );

      const platformCounts = (result.rows ?? []).map((row) => ({
        platformId: row.PLATFORM_ID == null ? null : Number(row.PLATFORM_ID),
        platformName: row.PLATFORM_NAME ?? null,
        platformAbbreviation: row.PLATFORM_ABBREVIATION ?? null,
        total: Number(row.TOTAL_COUNT ?? 0),
      }));

      return { totalCount, platformCounts };
    } finally {
      await connection.close();
    }
  }

  static async getOverviewForAllUsers(): Promise<{
    totalCount: number;
    platformCounts: IUserGameCollectionOverviewEntry[];
    users: IUserGameCollectionUserOverview[];
  }> {
    const connection = await getOraclePool().getConnection();
    try {
      const totalResult = await connection.execute<{ TOTAL_COUNT: number }>(
        `SELECT COUNT(*) AS TOTAL_COUNT
           FROM USER_GAME_COLLECTIONS`,
        {},
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const totalCount = Number(totalResult.rows?.[0]?.TOTAL_COUNT ?? 0);

      const platformResult = await connection.execute<{
        PLATFORM_ID: number | null;
        PLATFORM_NAME: string | null;
        PLATFORM_ABBREVIATION: string | null;
        TOTAL_COUNT: number;
      }>(
        `SELECT c.PLATFORM_ID,
                p.PLATFORM_NAME,
                p.PLATFORM_ABBREVIATION,
                COUNT(*) AS TOTAL_COUNT
           FROM USER_GAME_COLLECTIONS c
           LEFT JOIN GAMEDB_PLATFORMS p ON p.PLATFORM_ID = c.PLATFORM_ID
          GROUP BY c.PLATFORM_ID, p.PLATFORM_NAME, p.PLATFORM_ABBREVIATION
          ORDER BY COUNT(*) DESC,
                   LOWER(NVL(p.PLATFORM_NAME, 'Unknown')),
                   c.PLATFORM_ID`,
        {},
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );

      const platformCounts = (platformResult.rows ?? []).map((row) => ({
        platformId: row.PLATFORM_ID == null ? null : Number(row.PLATFORM_ID),
        platformName: row.PLATFORM_NAME ?? null,
        platformAbbreviation: row.PLATFORM_ABBREVIATION ?? null,
        total: Number(row.TOTAL_COUNT ?? 0),
      }));

      const userResult = await connection.execute<{
        USER_ID: string;
        USERNAME: string | null;
        GLOBAL_NAME: string | null;
        PLATFORM_ID: number | null;
        PLATFORM_NAME: string | null;
        PLATFORM_ABBREVIATION: string | null;
        TOTAL_COUNT: number;
      }>(
        `SELECT c.USER_ID,
                u.USERNAME,
                u.GLOBAL_NAME,
                c.PLATFORM_ID,
                p.PLATFORM_NAME,
                p.PLATFORM_ABBREVIATION,
                COUNT(*) AS TOTAL_COUNT
           FROM USER_GAME_COLLECTIONS c
           LEFT JOIN RPG_CLUB_USERS u ON u.USER_ID = c.USER_ID
           LEFT JOIN GAMEDB_PLATFORMS p ON p.PLATFORM_ID = c.PLATFORM_ID
          WHERE NVL(u.IS_BOT, 0) = 0
          GROUP BY c.USER_ID,
                   u.USERNAME,
                   u.GLOBAL_NAME,
                   c.PLATFORM_ID,
                   p.PLATFORM_NAME,
                   p.PLATFORM_ABBREVIATION
          ORDER BY LOWER(COALESCE(u.GLOBAL_NAME, u.USERNAME, c.USER_ID)),
                   c.USER_ID,
                   COUNT(*) DESC,
                   LOWER(NVL(p.PLATFORM_NAME, 'Unknown')),
                   c.PLATFORM_ID`,
        {},
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );

      const usersById = new Map<string, IUserGameCollectionUserOverview>();
      for (const row of userResult.rows ?? []) {
        const userId = row.USER_ID;
        const existing = usersById.get(userId);
        const platformEntry: IUserGameCollectionOverviewEntry = {
          platformId: row.PLATFORM_ID == null ? null : Number(row.PLATFORM_ID),
          platformName: row.PLATFORM_NAME ?? null,
          platformAbbreviation: row.PLATFORM_ABBREVIATION ?? null,
          total: Number(row.TOTAL_COUNT ?? 0),
        };

        if (existing) {
          existing.platformCounts.push(platformEntry);
          existing.totalCount += platformEntry.total;
        } else {
          usersById.set(userId, {
            userId,
            username: row.USERNAME ?? null,
            globalName: row.GLOBAL_NAME ?? null,
            totalCount: platformEntry.total,
            platformCounts: [platformEntry],
          });
        }
      }

      const users = Array.from(usersById.values()).sort((a, b) => {
        const aName = (a.globalName ?? a.username ?? a.userId).toLowerCase();
        const bName = (b.globalName ?? b.username ?? b.userId).toLowerCase();
        return aName.localeCompare(bName);
      });

      return { totalCount, platformCounts, users };
    } finally {
      await connection.close();
    }
  }

  static async autocompleteEntries(
    userId: string,
    query: string,
    limit: number = 25,
  ): Promise<IUserGameCollectionAutocompleteEntry[]> {
    const trimmed = query.trim().toLowerCase();
    const binds: Record<string, any> = {
      userId,
      limit: Math.max(1, Math.min(limit, 25)),
    };

    const titleWhere = trimmed
      ? "AND (LOWER(g.TITLE) LIKE :query OR LOWER(NVL(p.PLATFORM_NAME, '')) LIKE :query OR LOWER(c.OWNERSHIP_TYPE) LIKE :query)"
      : "";

    if (trimmed) {
      binds.query = `%${trimmed}%`;
    }

    const connection = await getOraclePool().getConnection();
    try {
      const result = await connection.execute<CollectionRow>(
        `SELECT c.ENTRY_ID,
                c.USER_ID,
                c.GAMEDB_GAME_ID,
                g.TITLE,
                c.PLATFORM_ID,
                p.PLATFORM_NAME,
                p.PLATFORM_ABBREVIATION,
                c.OWNERSHIP_TYPE,
                c.NOTE,
                c.IS_SHARED,
                c.CREATED_AT,
                c.UPDATED_AT
           FROM USER_GAME_COLLECTIONS c
           JOIN GAMEDB_GAMES g ON g.GAME_ID = c.GAMEDB_GAME_ID
           LEFT JOIN GAMEDB_PLATFORMS p ON p.PLATFORM_ID = c.PLATFORM_ID
          WHERE c.USER_ID = :userId
            ${titleWhere}
          ORDER BY LOWER(g.TITLE), LOWER(NVL(p.PLATFORM_NAME, '')), c.ENTRY_ID
          FETCH FIRST :limit ROWS ONLY`,
        binds,
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );

      return (result.rows ?? []).map((row) => ({
        entryId: Number(row.ENTRY_ID),
        gameId: Number(row.GAMEDB_GAME_ID),
        title: row.TITLE,
        platformName: row.PLATFORM_NAME ?? null,
        ownershipType: row.OWNERSHIP_TYPE,
      }));
    } finally {
      await connection.close();
    }
  }
}
