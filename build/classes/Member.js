import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";
function buildParams(record) {
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
    };
}
export default class Member {
    static async touchLastSeen(userId, when = new Date()) {
        const connection = await getOraclePool().getConnection();
        try {
            await connection.execute(`UPDATE RPG_CLUB_USERS
            SET LAST_SEEN_AT = :lastSeen,
                UPDATED_AT = SYSTIMESTAMP
          WHERE USER_ID = :userId`, { userId, lastSeen: when }, { autoCommit: true });
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            console.error(`[Member] Failed to update last seen for ${userId}: ${msg}`);
        }
        finally {
            await connection.close();
        }
    }
    static async setMessageCount(userId, count) {
        const connection = await getOraclePool().getConnection();
        try {
            const result = await connection.execute(`UPDATE RPG_CLUB_USERS
            SET MESSAGE_COUNT = :count,
                UPDATED_AT = SYSTIMESTAMP
          WHERE USER_ID = :userId`, { userId, count }, { autoCommit: true });
            const rows = result.rowsAffected ?? 0;
            if (rows > 0) {
                return;
            }
            await connection.execute(`INSERT INTO RPG_CLUB_USERS (
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
         )`, { userId, count }, { autoCommit: true });
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            console.error(`[Member] Failed to set message count for ${userId}: ${msg}`);
        }
        finally {
            await connection.close();
        }
    }
    static async recordMessageActivity(userId, when = new Date()) {
        const connection = await getOraclePool().getConnection();
        try {
            const result = await connection.execute(`UPDATE RPG_CLUB_USERS
            SET LAST_SEEN_AT = :lastSeen,
                MESSAGE_COUNT = COALESCE(MESSAGE_COUNT, 0) + 1,
                UPDATED_AT = SYSTIMESTAMP
          WHERE USER_ID = :userId`, { userId, lastSeen: when }, { autoCommit: true });
            const rowsUpdated = result.rowsAffected ?? 0;
            if (rowsUpdated > 0) {
                return;
            }
            await connection.execute(`INSERT INTO RPG_CLUB_USERS (
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
         )`, { userId, lastSeen: when }, { autoCommit: true });
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            console.error(`[Member] Failed to record message activity for ${userId}: ${msg}`);
        }
        finally {
            await connection.close();
        }
    }
    static async getByUserId(userId) {
        const connection = await getOraclePool().getConnection();
        try {
            const result = await connection.execute(`SELECT USER_ID,
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
                MESSAGE_COUNT
           FROM RPG_CLUB_USERS
          WHERE USER_ID = :userId`, { userId }, {
                outFormat: oracledb.OUT_FORMAT_OBJECT,
                fetchInfo: {
                    AVATAR_BLOB: { type: oracledb.BUFFER },
                },
            });
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
            };
        }
        finally {
            await connection.close();
        }
    }
    static async upsert(record, opts) {
        const externalConn = opts?.connection ?? null;
        const connection = externalConn ?? (await getOraclePool().getConnection());
        const params = buildParams(record);
        try {
            const update = await connection.execute(`UPDATE RPG_CLUB_USERS
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
                UPDATED_AT = SYSTIMESTAMP
          WHERE USER_ID = :userId`, params, { autoCommit: true });
            const rowsUpdated = update.rowsAffected ?? 0;
            if (rowsUpdated > 0)
                return;
            try {
                await connection.execute(`INSERT INTO RPG_CLUB_USERS (
             USER_ID, IS_BOT, USERNAME, GLOBAL_NAME, AVATAR_BLOB,
             SERVER_JOINED_AT, LAST_SEEN_AT, LAST_FETCHED_AT,
             ROLE_ADMIN, ROLE_MODERATOR, ROLE_REGULAR, ROLE_MEMBER, ROLE_NEWCOMER,
             MESSAGE_COUNT,
             CREATED_AT, UPDATED_AT
           ) VALUES (
             :userId, :isBot, :username, :globalName, :avatarBlob,
             :joinedAt, :lastSeenAt, SYSTIMESTAMP,
             :roleAdmin, :roleModerator, :roleRegular, :roleMember, :roleNewcomer,
             COALESCE(:messageCount, 0),
             SYSTIMESTAMP, SYSTIMESTAMP
           )`, params, { autoCommit: true });
            }
            catch (insErr) {
                const code = insErr?.code ?? insErr?.errorNum;
                if (code === "ORA-00001") {
                    await connection.execute(`UPDATE RPG_CLUB_USERS
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
                    UPDATED_AT = SYSTIMESTAMP
              WHERE USER_ID = :userId`, params, { autoCommit: true });
                }
                else {
                    throw insErr;
                }
            }
        }
        finally {
            if (!externalConn) {
                await connection.close();
            }
        }
    }
}
