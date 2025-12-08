import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";

export type RecurrenceUnit = "days" | "weeks" | "months" | "years";

export interface IPublicReminder {
  reminderId: number;
  channelId: string;
  message: string;
  dueAt: Date;
  recurEvery: number | null;
  recurUnit: RecurrenceUnit | null;
  enabled: boolean;
  createdBy: string | null;
}

export async function createReminder(
  channelId: string,
  message: string,
  dueAt: Date,
  recurEvery: number | null,
  recurUnit: RecurrenceUnit | null,
  createdBy: string | null,
): Promise<IPublicReminder> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute(
      `INSERT INTO RPG_CLUB_PUBLIC_REMINDERS (
         CHANNEL_ID,
         MESSAGE,
         DUE_AT,
         RECUR_EVERY,
         RECUR_UNIT,
         ENABLED,
         CREATED_BY
       ) VALUES (
         :channelId,
         :message,
         :dueAt,
         :recurEvery,
         :recurUnit,
         1,
         :createdBy
       )
       RETURNING REMINDER_ID INTO :id`,
      {
        channelId,
        message,
        dueAt,
        recurEvery,
        recurUnit,
        createdBy,
        id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      },
      { autoCommit: true },
    );
    const id = (result.outBinds as any)?.id?.[0] ?? 0;
    return {
      reminderId: Number(id),
      channelId,
      message,
      dueAt,
      recurEvery,
      recurUnit,
      enabled: true,
      createdBy,
    };
  } finally {
    await connection.close();
  }
}

export async function listUpcomingReminders(limit: number = 20): Promise<IPublicReminder[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute<{
      REMINDER_ID: number;
      CHANNEL_ID: string;
      MESSAGE: string;
      DUE_AT: Date;
      RECUR_EVERY: number | null;
      RECUR_UNIT: RecurrenceUnit | null;
      ENABLED: number;
      CREATED_BY: string | null;
    }>(
      `SELECT REMINDER_ID,
              CHANNEL_ID,
              MESSAGE,
              DUE_AT,
              RECUR_EVERY,
              RECUR_UNIT,
              ENABLED,
              CREATED_BY
         FROM RPG_CLUB_PUBLIC_REMINDERS
        WHERE ENABLED = 1
        ORDER BY DUE_AT ASC
        FETCH FIRST :limit ROWS ONLY`,
      { limit: safeLimit },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    return (result.rows ?? []).map((row) => ({
      reminderId: Number(row.REMINDER_ID),
      channelId: row.CHANNEL_ID,
      message: row.MESSAGE,
      dueAt: row.DUE_AT instanceof Date ? row.DUE_AT : new Date(row.DUE_AT),
      recurEvery: row.RECUR_EVERY ?? null,
      recurUnit: (row.RECUR_UNIT as RecurrenceUnit | null) ?? null,
      enabled: (row.ENABLED ?? 0) === 1,
      createdBy: row.CREATED_BY ?? null,
    }));
  } finally {
    await connection.close();
  }
}

export async function deleteReminder(reminderId: number): Promise<boolean> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute(
      `DELETE FROM RPG_CLUB_PUBLIC_REMINDERS WHERE REMINDER_ID = :id`,
      { id: reminderId },
      { autoCommit: true },
    );
    return (result.rowsAffected ?? 0) > 0;
  } finally {
    await connection.close();
  }
}

export async function updateReminderDueDate(
  reminderId: number,
  nextDue: Date,
): Promise<void> {
  const connection = await getOraclePool().getConnection();
  try {
    await connection.execute(
      `UPDATE RPG_CLUB_PUBLIC_REMINDERS
          SET DUE_AT = :nextDue
        WHERE REMINDER_ID = :id`,
      { nextDue, id: reminderId },
      { autoCommit: true },
    );
  } finally {
    await connection.close();
  }
}

export async function disableReminder(reminderId: number): Promise<void> {
  const connection = await getOraclePool().getConnection();
  try {
    await connection.execute(
      `UPDATE RPG_CLUB_PUBLIC_REMINDERS
          SET ENABLED = 0
        WHERE REMINDER_ID = :id`,
      { id: reminderId },
      { autoCommit: true },
    );
  } finally {
    await connection.close();
  }
}
