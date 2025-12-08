import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";
const REMINDER_COLUMNS = "REMINDER_ID, USER_ID, REMIND_AT, CONTENT, IS_NOISY, SENT_AT, CREATED_AT, UPDATED_AT";
function normalizeReminderId(value) {
    const id = Number(value);
    if (!Number.isFinite(id) || id <= 0) {
        throw new Error("Invalid reminder id.");
    }
    return id;
}
function normalizeDate(value) {
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) {
            throw new Error("Invalid date value.");
        }
        return value;
    }
    const asDate = new Date(value);
    if (Number.isNaN(asDate.getTime())) {
        throw new Error("Invalid date value.");
    }
    return asDate;
}
function normalizeContent(value) {
    const trimmed = (value ?? "").toString().trim();
    if (!trimmed.length) {
        return "Reminder";
    }
    if (trimmed.length <= 400) {
        return trimmed;
    }
    return trimmed.slice(0, 400);
}
function mapRowToReminder(row) {
    const reminderId = normalizeReminderId(row.REMINDER_ID);
    const remindAt = normalizeDate(row.REMIND_AT);
    const content = normalizeContent(row.CONTENT);
    const isNoisy = Boolean(row.IS_NOISY);
    const sentAt = row.SENT_AT === null || row.SENT_AT === undefined
        ? null
        : normalizeDate(row.SENT_AT);
    const createdAt = row.CREATED_AT === null || row.CREATED_AT === undefined
        ? null
        : normalizeDate(row.CREATED_AT);
    const updatedAt = row.UPDATED_AT === null || row.UPDATED_AT === undefined
        ? null
        : normalizeDate(row.UPDATED_AT);
    return {
        reminderId,
        userId: row.USER_ID,
        remindAt,
        content,
        isNoisy,
        sentAt,
        createdAt,
        updatedAt,
    };
}
export default class Reminder {
    static async create(userId, remindAt, content, isNoisy = false) {
        const normalizedDate = normalizeDate(remindAt);
        const normalizedContent = normalizeContent(content);
        const noisyVal = isNoisy ? 1 : 0;
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const result = await connection.execute(`INSERT INTO USER_REMINDERS (
           USER_ID, REMIND_AT, CONTENT, IS_NOISY, SENT_AT, CREATED_AT, UPDATED_AT
         ) VALUES (
           :userId, :remindAt, :content, :noisyVal, NULL, SYSTIMESTAMP, SYSTIMESTAMP
         )
         RETURNING REMINDER_ID INTO :reminderId`, {
                userId,
                remindAt: normalizedDate,
                content: normalizedContent,
                noisyVal,
                reminderId: {
                    dir: oracledb.BIND_OUT,
                    type: oracledb.NUMBER,
                },
            }, { autoCommit: true });
            const out = (result.outBinds ?? {});
            const reminderId = normalizeReminderId(out.reminderId?.[0] ?? 0);
            const inserted = await Reminder.getById(reminderId, { connection });
            if (!inserted) {
                throw new Error(`Failed to read inserted reminder ${reminderId}.`);
            }
            return inserted;
        }
        finally {
            await connection.close();
        }
    }
    static async listByUser(userId) {
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const result = await connection.execute(`SELECT ${REMINDER_COLUMNS}
           FROM USER_REMINDERS
          WHERE USER_ID = :userId
          ORDER BY REMIND_AT`, { userId }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
            const rows = (result.rows ?? []);
            return rows.map((row) => mapRowToReminder(row));
        }
        finally {
            await connection.close();
        }
    }
    static async getById(reminderId, opts) {
        const id = normalizeReminderId(reminderId);
        const externalConn = opts?.connection ?? null;
        const connection = externalConn ?? (await getOraclePool().getConnection());
        try {
            const result = await connection.execute(`SELECT ${REMINDER_COLUMNS}
           FROM USER_REMINDERS
          WHERE REMINDER_ID = :reminderId`, { reminderId: id }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
            const rows = (result.rows ?? []);
            if (!rows.length) {
                return null;
            }
            const row = rows[0];
            return mapRowToReminder(row);
        }
        finally {
            if (!externalConn) {
                await connection.close();
            }
        }
    }
    static async delete(reminderId, userId) {
        const id = normalizeReminderId(reminderId);
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const result = await connection.execute(`DELETE FROM USER_REMINDERS
          WHERE REMINDER_ID = :reminderId
            AND USER_ID = :userId`, { reminderId: id, userId }, { autoCommit: true });
            return (result.rowsAffected ?? 0) > 0;
        }
        finally {
            await connection.close();
        }
    }
    static async snooze(reminderId, userId, remindAt) {
        const id = normalizeReminderId(reminderId);
        const normalizedDate = normalizeDate(remindAt);
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const result = await connection.execute(`UPDATE USER_REMINDERS
            SET REMIND_AT = :remindAt,
                SENT_AT = NULL,
                UPDATED_AT = SYSTIMESTAMP
          WHERE REMINDER_ID = :reminderId
            AND USER_ID = :userId`, { reminderId: id, userId, remindAt: normalizedDate }, { autoCommit: true });
            if ((result.rowsAffected ?? 0) === 0) {
                return null;
            }
            return await Reminder.getById(reminderId, { connection });
        }
        finally {
            await connection.close();
        }
    }
    static async markSent(reminderId) {
        const id = normalizeReminderId(reminderId);
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const result = await connection.execute(`UPDATE USER_REMINDERS
            SET SENT_AT = SYSTIMESTAMP,
                UPDATED_AT = SYSTIMESTAMP
          WHERE REMINDER_ID = :reminderId`, { reminderId: id }, { autoCommit: true });
            if ((result.rowsAffected ?? 0) === 0) {
                throw new Error(`No reminder found for id ${id} when marking as sent.`);
            }
        }
        finally {
            await connection.close();
        }
    }
    static async getDueUndelivered(cutoff = new Date(), limit = 20) {
        const normalizedDate = normalizeDate(cutoff);
        const safeLimit = Math.max(1, Math.min(limit, 100));
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const result = await connection.execute(`SELECT ${REMINDER_COLUMNS}
           FROM (
             SELECT ${REMINDER_COLUMNS}
               FROM USER_REMINDERS
              WHERE REMIND_AT <= :cutoff
                AND SENT_AT IS NULL
              ORDER BY REMIND_AT
           )
          WHERE ROWNUM <= :limit`, { cutoff: normalizedDate, limit: safeLimit }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
            const rows = (result.rows ?? []);
            return rows.map((row) => mapRowToReminder(row));
        }
        finally {
            await connection.close();
        }
    }
}
