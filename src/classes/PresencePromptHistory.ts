import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";
import { normalizePresenceGameTitle } from "./PresencePromptOptOut.js";

export type PresencePromptStatus =
  | "PENDING"
  | "ACCEPTED"
  | "DECLINED"
  | "OPT_OUT_GAME"
  | "OPT_OUT_ALL";

export default class PresencePromptHistory {
  static async createPrompt(
    promptId: string,
    userId: string,
    gameTitle: string,
  ): Promise<void> {
    const normalized = normalizePresenceGameTitle(gameTitle);
    const connection = await getOraclePool().getConnection();
    try {
      await connection.execute(
        `INSERT INTO RPG_CLUB_PRESENCE_PROMPT_HISTORY
          (PROMPT_ID, USER_ID, GAME_TITLE, GAME_TITLE_NORM, STATUS)
         VALUES (:promptId, :userId, :gameTitle, :gameTitleNorm, 'PENDING')`,
        {
          promptId,
          userId,
          gameTitle,
          gameTitleNorm: normalized,
        },
        { autoCommit: true },
      );
    } finally {
      await connection.close();
    }
  }

  static async markResolved(promptId: string, status: PresencePromptStatus): Promise<void> {
    const connection = await getOraclePool().getConnection();
    try {
      await connection.execute(
        `UPDATE RPG_CLUB_PRESENCE_PROMPT_HISTORY
            SET STATUS = :status,
                RESOLVED_AT = SYSTIMESTAMP
          WHERE PROMPT_ID = :promptId`,
        { status, promptId },
        { autoCommit: true },
      );
    } finally {
      await connection.close();
    }
  }

  static async getLastPromptDateForGame(
    userId: string,
    gameTitle: string,
  ): Promise<Date | null> {
    const normalized = normalizePresenceGameTitle(gameTitle);
    const connection = await getOraclePool().getConnection();
    try {
      const result = await connection.execute<{ CREATED_AT: Date }>(
        `SELECT CREATED_AT
           FROM RPG_CLUB_PRESENCE_PROMPT_HISTORY
          WHERE USER_ID = :userId
            AND GAME_TITLE_NORM = :gameTitleNorm
          ORDER BY CREATED_AT DESC
          FETCH NEXT 1 ROWS ONLY`,
        { userId, gameTitleNorm: normalized },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const row = result.rows?.[0];
      if (!row?.CREATED_AT) return null;
      return row.CREATED_AT instanceof Date ? row.CREATED_AT : new Date(row.CREATED_AT as any);
    } finally {
      await connection.close();
    }
  }

  static async countPendingForGame(userId: string, gameTitle: string): Promise<number> {
    const normalized = normalizePresenceGameTitle(gameTitle);
    const connection = await getOraclePool().getConnection();
    try {
      const result = await connection.execute<{ CNT: number }>(
        `SELECT COUNT(*) AS CNT
           FROM RPG_CLUB_PRESENCE_PROMPT_HISTORY
          WHERE USER_ID = :userId
            AND GAME_TITLE_NORM = :gameTitleNorm
            AND STATUS = 'PENDING'`,
        { userId, gameTitleNorm: normalized },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const row = result.rows?.[0];
      return Number(row?.CNT ?? 0);
    } finally {
      await connection.close();
    }
  }

  static async countPendingForUser(userId: string): Promise<number> {
    const connection = await getOraclePool().getConnection();
    try {
      const result = await connection.execute<{ CNT: number }>(
        `SELECT COUNT(*) AS CNT
           FROM RPG_CLUB_PRESENCE_PROMPT_HISTORY
          WHERE USER_ID = :userId
            AND STATUS = 'PENDING'`,
        { userId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const row = result.rows?.[0];
      return Number(row?.CNT ?? 0);
    } finally {
      await connection.close();
    }
  }
}
