import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";

export interface IMemberRecord {
  userId: string;
  isBot: number;
  username: string | null;
  globalName: string | null;
  avatarBlob: Buffer | null;
  serverJoinedAt: Date | null;
  serverLeftAt: Date | null;
  lastSeenAt: Date | null;
  roleAdmin: number;
  roleModerator: number;
  roleRegular: number;
  roleMember: number;
  roleNewcomer: number;
  messageCount: number | null;
  completionatorUrl: string | null;
  psnUsername: string | null;
  xblUsername: string | null;
  nswFriendCode: string | null;
  steamUrl: string | null;
  profileImage: Buffer | null;
  profileImageAt: Date | null;
}

export interface IMemberPlatformRecord {
  userId: string;
  username: string | null;
  globalName: string | null;
  steamUrl: string | null;
  psnUsername: string | null;
  xblUsername: string | null;
  nswFriendCode: string | null;
}

export interface IMemberSearchFilters {
  userId?: string;
  username?: string;
  globalName?: string;
  completionatorUrl?: string;
  steamUrl?: string;
  psnUsername?: string;
  xblUsername?: string;
  nswFriendCode?: string;
  roleAdmin?: boolean;
  roleModerator?: boolean;
  roleRegular?: boolean;
  roleMember?: boolean;
  roleNewcomer?: boolean;
  isBot?: boolean;
  includeDeparted?: boolean;
  joinedAfter?: Date;
  joinedBefore?: Date;
  lastSeenAfter?: Date;
  lastSeenBefore?: Date;
  limit?: number;
}

export interface IMemberSearchResult {
  userId: string;
  username: string | null;
  globalName: string | null;
  isBot: number;
  completionatorUrl: string | null;
  steamUrl: string | null;
  psnUsername: string | null;
  xblUsername: string | null;
  nswFriendCode: string | null;
  roleAdmin: number;
  roleModerator: number;
  roleRegular: number;
  roleMember: number;
  roleNewcomer: number;
  serverJoinedAt: Date | null;
  serverLeftAt: Date | null;
  lastSeenAt: Date | null;
}

export interface IMemberNickHistory {
  oldNick: string | null;
  newNick: string | null;
  changedAt: Date;
}

export interface IMemberNowPlayingEntry {
  title: string;
  threadId: string | null;
}

export interface IMemberNowPlayingList {
  userId: string;
  username: string | null;
  globalName: string | null;
  entries: IMemberNowPlayingEntry[];
}

type Connection = oracledb.Connection;
const MAX_NOW_PLAYING = 10;

function buildParams(record: IMemberRecord) {
  return {
    userId: record.userId,
    isBot: record.isBot ? 1 : 0,
    username: record.username,
    globalName: record.globalName,
    avatarBlob: record.avatarBlob,
    joinedAt: record.serverJoinedAt,
    leftAt: record.serverLeftAt,
    lastSeenAt: record.lastSeenAt,
    roleAdmin: record.roleAdmin ? 1 : 0,
    roleModerator: record.roleModerator ? 1 : 0,
    roleRegular: record.roleRegular ? 1 : 0,
    roleMember: record.roleMember ? 1 : 0,
    roleNewcomer: record.roleNewcomer ? 1 : 0,
    completionatorUrl: record.completionatorUrl,
    psnUsername: record.psnUsername,
    xblUsername: record.xblUsername,
    nswFriendCode: record.nswFriendCode,
    steamUrl: record.steamUrl,
  };
}

export default class Member {
  static async touchLastSeen(userId: string, when: Date = new Date()): Promise<void> {
    const connection = await getOraclePool().getConnection();
    try {
      await connection.execute(
        `UPDATE RPG_CLUB_USERS
            SET LAST_SEEN_AT = :lastSeen,
                UPDATED_AT = SYSTIMESTAMP
          WHERE USER_ID = :userId`,
        { userId, lastSeen: when },
        { autoCommit: true },
      );
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.error(`[Member] Failed to update last seen for ${userId}: ${msg}`);
    } finally {
      await connection.close();
    }
  }

  static async getNowPlaying(
    userId: string,
  ): Promise<{ title: string; threadId: string | null }[]> {
    const connection = await getOraclePool().getConnection();
    try {
      const res = await connection.execute<{ TITLE: string; THREAD_ID: string | null }>(
        `SELECT g.TITLE,
                COALESCE(
                  (
                    SELECT MIN(tgl.THREAD_ID)
                    FROM THREAD_GAME_LINKS tgl
                    WHERE tgl.GAMEDB_GAME_ID = u.GAMEDB_GAME_ID
                  ),
                  (
                    SELECT MIN(th.THREAD_ID)
                    FROM THREADS th
                    WHERE th.GAMEDB_GAME_ID = u.GAMEDB_GAME_ID
                  )
                ) AS THREAD_ID
           FROM USER_NOW_PLAYING u
           JOIN GAMEDB_GAMES g ON g.GAME_ID = u.GAMEDB_GAME_ID
          WHERE u.USER_ID = :userId
            AND u.GAMEDB_GAME_ID IS NOT NULL
          ORDER BY u.ADDED_AT DESC, u.ENTRY_ID DESC`,
        { userId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      return (res.rows ?? [])
        .map((r) => ({ title: r.TITLE, threadId: r.THREAD_ID ?? null }))
        .slice(0, MAX_NOW_PLAYING);
    } finally {
      await connection.close();
    }
  }

  static async getAllNowPlaying(): Promise<IMemberNowPlayingList[]> {
    const connection = await getOraclePool().getConnection();
    try {
      const res = await connection.execute<{
        USER_ID: string;
        USERNAME: string | null;
        GLOBAL_NAME: string | null;
        TITLE: string;
        THREAD_ID: string | null;
      }>(
        `SELECT u.USER_ID,
                ru.USERNAME,
                ru.GLOBAL_NAME,
                g.TITLE,
                COALESCE(
                  (
                    SELECT MIN(tgl.THREAD_ID)
                    FROM THREAD_GAME_LINKS tgl
                    WHERE tgl.GAMEDB_GAME_ID = u.GAMEDB_GAME_ID
                  ),
                  (
                    SELECT MIN(th.THREAD_ID)
                    FROM THREADS th
                    WHERE th.GAMEDB_GAME_ID = u.GAMEDB_GAME_ID
                  )
                ) AS THREAD_ID,
                u.ADDED_AT,
                u.ENTRY_ID
           FROM USER_NOW_PLAYING u
           JOIN RPG_CLUB_USERS ru ON ru.USER_ID = u.USER_ID
           JOIN GAMEDB_GAMES g ON g.GAME_ID = u.GAMEDB_GAME_ID
          WHERE NVL(ru.IS_BOT, 0) = 0
            AND ru.SERVER_LEFT_AT IS NULL
          ORDER BY COALESCE(ru.GLOBAL_NAME, ru.USERNAME, ru.USER_ID),
                   u.ADDED_AT DESC,
                   u.ENTRY_ID DESC`,
        {},
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );

      const grouped = new Map<string, IMemberNowPlayingList>();
      for (const row of res.rows ?? []) {
        let record = grouped.get(row.USER_ID);
        if (!record) {
          record = {
            userId: row.USER_ID,
            username: row.USERNAME ?? null,
            globalName: row.GLOBAL_NAME ?? null,
            entries: [],
          };
          grouped.set(row.USER_ID, record);
        }

        if (record.entries.length < MAX_NOW_PLAYING) {
          record.entries.push({
            title: row.TITLE,
            threadId: row.THREAD_ID ?? null,
          });
        }
      }

      return Array.from(grouped.values()).sort((a, b) => {
        const aName = (a.globalName ?? a.username ?? a.userId).toLowerCase();
        const bName = (b.globalName ?? b.username ?? b.userId).toLowerCase();
        return aName.localeCompare(bName);
      });
    } finally {
      await connection.close();
    }
  }

  static async getNowPlayingEntries(
    userId: string,
  ): Promise<{ gameId: number; title: string }[]> {
    const connection = await getOraclePool().getConnection();
    try {
      const res = await connection.execute<{ GAME_ID: number; TITLE: string }>(
        `SELECT u.GAMEDB_GAME_ID AS GAME_ID, g.TITLE
           FROM USER_NOW_PLAYING u
           JOIN GAMEDB_GAMES g ON g.GAME_ID = u.GAMEDB_GAME_ID
          WHERE u.USER_ID = :userId
            AND u.GAMEDB_GAME_ID IS NOT NULL
          ORDER BY u.ADDED_AT DESC, u.ENTRY_ID DESC`,
        { userId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      return (res.rows ?? []).map((r) => ({
        gameId: Number(r.GAME_ID),
        title: r.TITLE,
      }));
    } finally {
      await connection.close();
    }
  }

  static async addNowPlaying(userId: string, gameId: number): Promise<void> {
    if (!Number.isInteger(gameId) || gameId <= 0) {
      throw new Error("Invalid GameDB id.");
    }
    const connection = await getOraclePool().getConnection();

    try {
      const countRes = await connection.execute<{ CNT: number }>(
        `SELECT COUNT(*) AS CNT FROM USER_NOW_PLAYING WHERE USER_ID = :userId`,
        { userId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const count = Number((countRes.rows ?? [])[0]?.CNT ?? 0);
      if (count >= MAX_NOW_PLAYING) {
        throw new Error(`You can only track up to ${MAX_NOW_PLAYING} Now Playing titles.`);
      }

      await connection.execute(
        `INSERT INTO USER_NOW_PLAYING (USER_ID, GAMEDB_GAME_ID) VALUES (:userId, :gameId)`,
        { userId, gameId },
        { autoCommit: true },
      );
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (/unique/i.test(msg) || /UQ_USER_NOW_PLAYING/i.test(msg)) {
        throw new Error("That title is already in your Now Playing list.");
      }
      throw err;
    } finally {
      await connection.close();
    }
  }

  static async removeNowPlaying(userId: string, gameId: number): Promise<boolean> {
    if (!Number.isInteger(gameId) || gameId <= 0) {
      throw new Error("Invalid GameDB id.");
    }
    const connection = await getOraclePool().getConnection();

    try {
      const res = await connection.execute(
        `DELETE FROM USER_NOW_PLAYING WHERE USER_ID = :userId AND GAMEDB_GAME_ID = :gameId`,
        { userId, gameId },
        { autoCommit: true },
      );
      const rows = (res as any).rowsAffected ?? 0;
      return rows > 0;
    } finally {
      await connection.close();
    }
  }

  static async getRecentNickHistory(
    userId: string,
    limit: number = 5,
  ): Promise<IMemberNickHistory[]> {
    const connection = await getOraclePool().getConnection();
    const safeLimit = Math.min(Math.max(limit, 1), 20);
    try {
      const result = await connection.execute<{
        OLD_NICK: string | null;
        NEW_NICK: string | null;
        CHANGED_AT: Date;
      }>(
        `SELECT OLD_NICK, NEW_NICK, CHANGED_AT
           FROM RPG_CLUB_USER_NICK_HISTORY
          WHERE USER_ID = :userId
          ORDER BY CHANGED_AT DESC
          FETCH FIRST :limit ROWS ONLY`,
        { userId, limit: safeLimit },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );

      return (result.rows ?? []).map((row) => ({
        oldNick: row.OLD_NICK ?? null,
        newNick: row.NEW_NICK ?? null,
        changedAt: row.CHANGED_AT,
      }));
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.error(`[Member] Failed to load nick history for ${userId}: ${msg}`);
      return [];
    } finally {
      await connection.close();
    }
  }

  static async search(filters: IMemberSearchFilters): Promise<IMemberSearchResult[]> {
    const connection = await getOraclePool().getConnection();

    const safeLimit = Math.min(Math.max(filters.limit ?? 50, 1), 100);
    const clauses: string[] = [];
    const params: Record<string, any> = { limit: safeLimit };

    const addLike = (column: string, param: string, value?: string): void => {
      if (!value) return;
      clauses.push(`UPPER(${column}) LIKE '%' || UPPER(:${param}) || '%'`);
      params[param] = value;
    };

    const addBool = (column: string, param: string, value?: boolean): void => {
      if (value === undefined) return;
      clauses.push(`${column} = :${param}`);
      params[param] = value ? 1 : 0;
    };

    addLike("USER_ID", "userId", filters.userId);
    addLike("USERNAME", "username", filters.username);
    addLike("GLOBAL_NAME", "globalName", filters.globalName);
    addLike("COMPLETIONATOR_URL", "completionatorUrl", filters.completionatorUrl);
    addLike("STEAM_URL", "steamUrl", filters.steamUrl);
    addLike("PSN_USERNAME", "psnUsername", filters.psnUsername);
    addLike("XBL_USERNAME", "xblUsername", filters.xblUsername);
    addLike("NSW_FRIEND_CODE", "nswFriendCode", filters.nswFriendCode);

    addBool("ROLE_ADMIN", "roleAdmin", filters.roleAdmin);
    addBool("ROLE_MODERATOR", "roleModerator", filters.roleModerator);
    addBool("ROLE_REGULAR", "roleRegular", filters.roleRegular);
    addBool("ROLE_MEMBER", "roleMember", filters.roleMember);
    addBool("ROLE_NEWCOMER", "roleNewcomer", filters.roleNewcomer);
    addBool("IS_BOT", "isBot", filters.isBot);

    if (!filters.includeDeparted) {
      clauses.push("SERVER_LEFT_AT IS NULL");
    }

    if (filters.joinedAfter) {
      clauses.push("SERVER_JOINED_AT >= :joinedAfter");
      params.joinedAfter = filters.joinedAfter;
    }

    if (filters.joinedBefore) {
      clauses.push("SERVER_JOINED_AT <= :joinedBefore");
      params.joinedBefore = filters.joinedBefore;
    }

    if (filters.lastSeenAfter) {
      clauses.push("LAST_SEEN_AT >= :lastSeenAfter");
      params.lastSeenAfter = filters.lastSeenAfter;
    }

    if (filters.lastSeenBefore) {
      clauses.push("LAST_SEEN_AT <= :lastSeenBefore");
      params.lastSeenBefore = filters.lastSeenBefore;
    }

    const where = clauses.length ? clauses.join(" AND ") : "1=1";

    try {
      const result = await connection.execute<{
        USER_ID: string;
        USERNAME: string | null;
        GLOBAL_NAME: string | null;
        IS_BOT: number;
        COMPLETIONATOR_URL: string | null;
        STEAM_URL: string | null;
        PSN_USERNAME: string | null;
        XBL_USERNAME: string | null;
        NSW_FRIEND_CODE: string | null;
        ROLE_ADMIN: number;
        ROLE_MODERATOR: number;
        ROLE_REGULAR: number;
        ROLE_MEMBER: number;
        ROLE_NEWCOMER: number;
        SERVER_LEFT_AT: Date | null;
        SERVER_JOINED_AT: Date | null;
        LAST_SEEN_AT: Date | null;
      }>(
        `SELECT USER_ID,
                USERNAME,
                GLOBAL_NAME,
                IS_BOT,
                COMPLETIONATOR_URL,
                STEAM_URL,
                PSN_USERNAME,
                XBL_USERNAME,
                NSW_FRIEND_CODE,
                ROLE_ADMIN,
                ROLE_MODERATOR,
                ROLE_REGULAR,
                ROLE_MEMBER,
                ROLE_NEWCOMER,
                SERVER_LEFT_AT,
                SERVER_JOINED_AT,
                LAST_SEEN_AT
           FROM RPG_CLUB_USERS
          WHERE ${where}
          ORDER BY COALESCE(UPPER(GLOBAL_NAME), UPPER(USERNAME), USER_ID)
          FETCH FIRST :limit ROWS ONLY`,
        params,
        {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
        },
      );

      const rows = result.rows ?? [];
      return rows.map<IMemberSearchResult>((row) => ({
        userId: row.USER_ID,
        username: row.USERNAME ?? null,
        globalName: row.GLOBAL_NAME ?? null,
        isBot: row.IS_BOT,
        completionatorUrl: row.COMPLETIONATOR_URL ?? null,
        steamUrl: row.STEAM_URL ?? null,
        psnUsername: row.PSN_USERNAME ?? null,
        xblUsername: row.XBL_USERNAME ?? null,
        nswFriendCode: row.NSW_FRIEND_CODE ?? null,
        roleAdmin: row.ROLE_ADMIN,
        roleModerator: row.ROLE_MODERATOR,
        roleRegular: row.ROLE_REGULAR,
        roleMember: row.ROLE_MEMBER,
        roleNewcomer: row.ROLE_NEWCOMER,
        serverLeftAt: row.SERVER_LEFT_AT ?? null,
        serverJoinedAt: row.SERVER_JOINED_AT ?? null,
        lastSeenAt: row.LAST_SEEN_AT ?? null,
      }));
    } finally {
      await connection.close();
    }
  }

  static async setMessageCount(userId: string, count: number): Promise<void> {
    void userId;
    void count;
    return;
  }

  static async recordMessageActivity(
    userId: string,
    when: Date = new Date(),
  ): Promise<void> {
    void userId;
    void when;
    return;
  }

  static async getByUserId(userId: string): Promise<IMemberRecord | null> {
    const connection = await getOraclePool().getConnection();

    try {
      const result = await connection.execute<{
        USER_ID: string;
        IS_BOT: number;
        USERNAME: string | null;
        GLOBAL_NAME: string | null;
        AVATAR_BLOB: Buffer | null;
        SERVER_JOINED_AT: Date | null;
        SERVER_LEFT_AT: Date | null;
        LAST_SEEN_AT: Date | null;
        ROLE_ADMIN: number;
        ROLE_MODERATOR: number;
        ROLE_REGULAR: number;
        ROLE_MEMBER: number;
        ROLE_NEWCOMER: number;
        MESSAGE_COUNT: number | null;
        COMPLETIONATOR_URL: string | null;
        PSN_USERNAME: string | null;
        XBL_USERNAME: string | null;
        NSW_FRIEND_CODE: string | null;
        STEAM_URL: string | null;
        PROFILE_IMAGE: Buffer | null;
        PROFILE_IMAGE_AT: Date | null;
      }>(
        `SELECT USER_ID,
                IS_BOT,
                USERNAME,
                GLOBAL_NAME,
               AVATAR_BLOB,
               SERVER_JOINED_AT,
                SERVER_LEFT_AT,
                LAST_SEEN_AT,
                ROLE_ADMIN,
                ROLE_MODERATOR,
                ROLE_REGULAR,
                ROLE_MEMBER,
                ROLE_NEWCOMER,
                MESSAGE_COUNT,
                COMPLETIONATOR_URL,
                PSN_USERNAME,
                XBL_USERNAME,
                NSW_FRIEND_CODE,
                STEAM_URL,
                PROFILE_IMAGE,
                PROFILE_IMAGE_AT
           FROM RPG_CLUB_USERS
          WHERE USER_ID = :userId`,
        { userId },
        {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
          fetchInfo: {
            AVATAR_BLOB: { type: oracledb.BUFFER },
            PROFILE_IMAGE: { type: oracledb.BUFFER },
          },
        },
      );

      const row = (result.rows ?? [])[0];
      if (!row) {
        return null;
      }

      return {
        userId: row.USER_ID,
        isBot: row.IS_BOT,
        username: row.USERNAME ?? null,
        globalName: row.GLOBAL_NAME ?? null,
        avatarBlob: row.AVATAR_BLOB ?? null,
        serverJoinedAt: row.SERVER_JOINED_AT ?? null,
        serverLeftAt: row.SERVER_LEFT_AT ?? null,
        lastSeenAt: row.LAST_SEEN_AT ?? null,
        roleAdmin: row.ROLE_ADMIN,
        roleModerator: row.ROLE_MODERATOR,
        roleRegular: row.ROLE_REGULAR,
        roleMember: row.ROLE_MEMBER,
        roleNewcomer: row.ROLE_NEWCOMER,
        messageCount: row.MESSAGE_COUNT ?? null,
        completionatorUrl: row.COMPLETIONATOR_URL ?? null,
        psnUsername: row.PSN_USERNAME ?? null,
        xblUsername: row.XBL_USERNAME ?? null,
        nswFriendCode: row.NSW_FRIEND_CODE ?? null,
        steamUrl: row.STEAM_URL ?? null,
        profileImage: row.PROFILE_IMAGE ?? null,
        profileImageAt: row.PROFILE_IMAGE_AT ?? null,
      };
    } finally {
      await connection.close();
    }
  }

  static async getMembersWithPlatforms(): Promise<IMemberPlatformRecord[]> {
    const connection = await getOraclePool().getConnection();

    try {
      const result = await connection.execute<{
        USER_ID: string;
        USERNAME: string | null;
        GLOBAL_NAME: string | null;
        STEAM_URL: string | null;
        PSN_USERNAME: string | null;
        XBL_USERNAME: string | null;
        NSW_FRIEND_CODE: string | null;
        SERVER_LEFT_AT: Date | null;
      }>(
        `SELECT USER_ID,
                USERNAME,
                GLOBAL_NAME,
                STEAM_URL,
                PSN_USERNAME,
                XBL_USERNAME,
                NSW_FRIEND_CODE,
                SERVER_LEFT_AT
           FROM RPG_CLUB_USERS
          WHERE (STEAM_URL IS NOT NULL
                 OR PSN_USERNAME IS NOT NULL
                 OR XBL_USERNAME IS NOT NULL
                 OR NSW_FRIEND_CODE IS NOT NULL)
            AND NVL(IS_BOT, 0) = 0
            AND SERVER_LEFT_AT IS NULL`,
        {},
        {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
        },
      );

      const rows = result.rows ?? [];
      const members = rows.map<IMemberPlatformRecord>((row) => ({
        userId: row.USER_ID,
        username: row.USERNAME ?? null,
        globalName: row.GLOBAL_NAME ?? null,
        steamUrl: row.STEAM_URL ?? null,
        psnUsername: row.PSN_USERNAME ?? null,
        xblUsername: row.XBL_USERNAME ?? null,
        nswFriendCode: row.NSW_FRIEND_CODE ?? null,
      }));

      return members.sort((a, b) => {
        const aName = (a.globalName ?? a.username ?? a.userId).toLowerCase();
        const bName = (b.globalName ?? b.username ?? b.userId).toLowerCase();
        return aName.localeCompare(bName);
      });
    } finally {
      await connection.close();
    }
  }

  static async upsert(
    record: IMemberRecord,
    opts?: { connection?: Connection },
  ): Promise<void> {
    const externalConn = opts?.connection ?? null;
    const connection = externalConn ?? (await getOraclePool().getConnection());

    const params = buildParams(record);

    try {
      const update = await connection.execute(
        `UPDATE RPG_CLUB_USERS
            SET IS_BOT = :isBot,
                USERNAME = :username,
                GLOBAL_NAME = :globalName,
                AVATAR_BLOB = :avatarBlob,
                SERVER_JOINED_AT = :joinedAt,
                SERVER_LEFT_AT = :leftAt,
                LAST_SEEN_AT = :lastSeenAt,
                LAST_FETCHED_AT = SYSTIMESTAMP,
                ROLE_ADMIN = :roleAdmin,
                ROLE_MODERATOR = :roleModerator,
                ROLE_REGULAR = :roleRegular,
                ROLE_MEMBER = :roleMember,
                ROLE_NEWCOMER = :roleNewcomer,
                COMPLETIONATOR_URL = :completionatorUrl,
                PSN_USERNAME = :psnUsername,
                XBL_USERNAME = :xblUsername,
                NSW_FRIEND_CODE = :nswFriendCode,
                STEAM_URL = :steamUrl,
                UPDATED_AT = SYSTIMESTAMP
          WHERE USER_ID = :userId`,
        params,
        { autoCommit: true },
      );

      const rowsUpdated = update.rowsAffected ?? 0;
      if (rowsUpdated > 0) return;

      try {
        await connection.execute(
          `INSERT INTO RPG_CLUB_USERS (
             USER_ID, IS_BOT, USERNAME, GLOBAL_NAME, AVATAR_BLOB,
             SERVER_JOINED_AT, SERVER_LEFT_AT, LAST_SEEN_AT, LAST_FETCHED_AT,
             ROLE_ADMIN, ROLE_MODERATOR, ROLE_REGULAR, ROLE_MEMBER, ROLE_NEWCOMER,
             COMPLETIONATOR_URL, PSN_USERNAME, XBL_USERNAME, NSW_FRIEND_CODE,
             STEAM_URL,
             CREATED_AT, UPDATED_AT
           ) VALUES (
             :userId, :isBot, :username, :globalName, :avatarBlob,
             :joinedAt, :leftAt, :lastSeenAt, SYSTIMESTAMP,
             :roleAdmin, :roleModerator, :roleRegular, :roleMember, :roleNewcomer,
             :completionatorUrl, :psnUsername, :xblUsername,
             :nswFriendCode, :steamUrl,
             SYSTIMESTAMP, SYSTIMESTAMP
           )`,
          params,
          { autoCommit: true },
        );
      } catch (insErr: any) {
        const code = insErr?.code ?? insErr?.errorNum;
        if (code === "ORA-00001") {
          await connection.execute(
            `UPDATE RPG_CLUB_USERS
                SET IS_BOT = :isBot,
                    USERNAME = :username,
                    GLOBAL_NAME = :globalName,
                    AVATAR_BLOB = :avatarBlob,
                    SERVER_JOINED_AT = :joinedAt,
                    SERVER_LEFT_AT = :leftAt,
                    LAST_SEEN_AT = :lastSeenAt,
                    LAST_FETCHED_AT = SYSTIMESTAMP,
                    ROLE_ADMIN = :roleAdmin,
                    ROLE_MODERATOR = :roleModerator,
                    ROLE_REGULAR = :roleRegular,
                    ROLE_MEMBER = :roleMember,
                    ROLE_NEWCOMER = :roleNewcomer,
                    COMPLETIONATOR_URL = :completionatorUrl,
                    PSN_USERNAME = :psnUsername,
                    XBL_USERNAME = :xblUsername,
                    NSW_FRIEND_CODE = :nswFriendCode,
                    STEAM_URL = :steamUrl,
                    UPDATED_AT = SYSTIMESTAMP
              WHERE USER_ID = :userId`,
            params,
            { autoCommit: true },
          );
        } else {
          throw insErr;
        }
      }
    } finally {
      if (!externalConn) {
        await connection.close();
      }
    }
  }

  static async markDepartedNotIn(userIds: string[]): Promise<number> {
    if (!userIds.length) return 0;

    const connection = await getOraclePool().getConnection();
    const chunkSize = 999; // Oracle IN clause limit per statement (safe)
    let totalUpdated = 0;

    try {
      for (let i = 0; i < userIds.length; i += chunkSize) {
        const chunk = userIds.slice(i, i + chunkSize);
        const binds: Record<string, string> = {};
        const placeholders = chunk.map((id, idx) => {
          const key = `id${idx}`;
          binds[key] = id;
          return `:${key}`;
        });

        const sql = `
          UPDATE RPG_CLUB_USERS
             SET SERVER_LEFT_AT = SYSTIMESTAMP,
                 UPDATED_AT = SYSTIMESTAMP
           WHERE SERVER_LEFT_AT IS NULL
             AND USER_ID NOT IN (${placeholders.join(", ")})
        `;

        const result = await connection.execute(sql, binds, { autoCommit: true });
        totalUpdated += result.rowsAffected ?? 0;
      }
    } finally {
      await connection.close();
    }

    return totalUpdated;
  }
}
