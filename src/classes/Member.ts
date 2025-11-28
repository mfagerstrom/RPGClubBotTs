import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";

export interface IMemberRecord {
  userId: string;
  isBot: number;
  username: string | null;
  globalName: string | null;
  avatarBlob: Buffer | null;
  serverJoinedAt: Date | null;
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
}

type Connection = oracledb.Connection;

function buildParams(record: IMemberRecord) {
  return {
    userId: record.userId,
    isBot: record.isBot ? 1 : 0,
    username: record.username,
    globalName: record.globalName,
    avatarBlob: record.avatarBlob,
    joinedAt: record.serverJoinedAt,
    lastSeenAt: record.lastSeenAt,
    roleAdmin: record.roleAdmin ? 1 : 0,
    roleModerator: record.roleModerator ? 1 : 0,
    roleRegular: record.roleRegular ? 1 : 0,
    roleMember: record.roleMember ? 1 : 0,
    roleNewcomer: record.roleNewcomer ? 1 : 0,
    messageCount: record.messageCount ?? null,
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

  static async setMessageCount(userId: string, count: number): Promise<void> {
    const connection = await getOraclePool().getConnection();
    try {
      const result = await connection.execute(
        `UPDATE RPG_CLUB_USERS
            SET MESSAGE_COUNT = :count,
                UPDATED_AT = SYSTIMESTAMP
          WHERE USER_ID = :userId`,
        { userId, count },
        { autoCommit: true },
      );

      const rows = result.rowsAffected ?? 0;
      if (rows > 0) {
        return;
      }

      await connection.execute(
        `INSERT INTO RPG_CLUB_USERS (
           USER_ID, IS_BOT, USERNAME, GLOBAL_NAME, AVATAR_BLOB,
           SERVER_JOINED_AT, LAST_SEEN_AT, LAST_FETCHED_AT,
           ROLE_ADMIN, ROLE_MODERATOR, ROLE_REGULAR, ROLE_MEMBER, ROLE_NEWCOMER,
           MESSAGE_COUNT,
           CREATED_AT, UPDATED_AT
         ) VALUES (
           :userId, 0, NULL, NULL, NULL,
           NULL, NULL, SYSTIMESTAMP,
           0, 0, 0, 0, 0,
           :count,
           SYSTIMESTAMP, SYSTIMESTAMP
         )`,
        { userId, count },
        { autoCommit: true },
      );
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.error(`[Member] Failed to set message count for ${userId}: ${msg}`);
    } finally {
      await connection.close();
    }
  }

  static async recordMessageActivity(
    userId: string,
    when: Date = new Date(),
  ): Promise<void> {
    const connection = await getOraclePool().getConnection();
    try {
      const result = await connection.execute(
        `UPDATE RPG_CLUB_USERS
            SET LAST_SEEN_AT = :lastSeen,
                MESSAGE_COUNT = COALESCE(MESSAGE_COUNT, 0) + 1,
                UPDATED_AT = SYSTIMESTAMP
          WHERE USER_ID = :userId`,
        { userId, lastSeen: when },
        { autoCommit: true },
      );

      const rowsUpdated = result.rowsAffected ?? 0;
      if (rowsUpdated > 0) {
        return;
      }

      await connection.execute(
        `INSERT INTO RPG_CLUB_USERS (
           USER_ID, IS_BOT, USERNAME, GLOBAL_NAME, AVATAR_BLOB,
           SERVER_JOINED_AT, LAST_SEEN_AT, LAST_FETCHED_AT,
           ROLE_ADMIN, ROLE_MODERATOR, ROLE_REGULAR, ROLE_MEMBER, ROLE_NEWCOMER,
           MESSAGE_COUNT,
           CREATED_AT, UPDATED_AT
         ) VALUES (
           :userId, 0, NULL, NULL, NULL,
           NULL, :lastSeen, SYSTIMESTAMP,
           0, 0, 0, 0, 0,
           1,
           SYSTIMESTAMP, SYSTIMESTAMP
         )`,
        { userId, lastSeen: when },
        { autoCommit: true },
      );
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.error(`[Member] Failed to record message activity for ${userId}: ${msg}`);
    } finally {
      await connection.close();
    }
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
      }>(
        `SELECT USER_ID,
                IS_BOT,
                USERNAME,
                GLOBAL_NAME,
                AVATAR_BLOB,
                SERVER_JOINED_AT,
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
                STEAM_URL
           FROM RPG_CLUB_USERS
          WHERE USER_ID = :userId`,
        { userId },
        {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
          fetchInfo: {
            AVATAR_BLOB: { type: oracledb.BUFFER },
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
      };
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
                LAST_SEEN_AT = :lastSeenAt,
                LAST_FETCHED_AT = SYSTIMESTAMP,
                ROLE_ADMIN = :roleAdmin,
                ROLE_MODERATOR = :roleModerator,
                ROLE_REGULAR = :roleRegular,
                ROLE_MEMBER = :roleMember,
                ROLE_NEWCOMER = :roleNewcomer,
                MESSAGE_COUNT = COALESCE(:messageCount, MESSAGE_COUNT),
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
             SERVER_JOINED_AT, LAST_SEEN_AT, LAST_FETCHED_AT,
             ROLE_ADMIN, ROLE_MODERATOR, ROLE_REGULAR, ROLE_MEMBER, ROLE_NEWCOMER,
             MESSAGE_COUNT, COMPLETIONATOR_URL, PSN_USERNAME, XBL_USERNAME, NSW_FRIEND_CODE,
             STEAM_URL,
             CREATED_AT, UPDATED_AT
           ) VALUES (
             :userId, :isBot, :username, :globalName, :avatarBlob,
             :joinedAt, :lastSeenAt, SYSTIMESTAMP,
             :roleAdmin, :roleModerator, :roleRegular, :roleMember, :roleNewcomer,
             COALESCE(:messageCount, 0), :completionatorUrl, :psnUsername, :xblUsername,
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
                    LAST_SEEN_AT = :lastSeenAt,
                    LAST_FETCHED_AT = SYSTIMESTAMP,
                    ROLE_ADMIN = :roleAdmin,
                    ROLE_MODERATOR = :roleModerator,
                    ROLE_REGULAR = :roleRegular,
                    ROLE_MEMBER = :roleMember,
                    ROLE_NEWCOMER = :roleNewcomer,
                    MESSAGE_COUNT = COALESCE(:messageCount, MESSAGE_COUNT),
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
}
