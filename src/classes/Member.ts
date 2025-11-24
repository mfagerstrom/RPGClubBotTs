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
  };
}

export default class Member {
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
             CREATED_AT, UPDATED_AT
           ) VALUES (
             :userId, :isBot, :username, :globalName, :avatarBlob,
             :joinedAt, :lastSeenAt, SYSTIMESTAMP,
             :roleAdmin, :roleModerator, :roleRegular, :roleMember, :roleNewcomer,
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
