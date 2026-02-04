import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";

export interface IReleaseAnnouncementCandidate {
  releaseId: number;
  gameId: number;
  title: string;
  releaseDate: Date;
  announceAt: Date;
  platformName: string | null;
  platformAbbreviation: string | null;
  igdbUrl: string | null;
}

type ReleaseAnnouncementRow = {
  RELEASE_ID: number;
  GAME_ID: number;
  TITLE: string;
  RELEASE_DATE: Date | string;
  ANNOUNCE_AT: Date | string;
  PLATFORM_NAME: string | null;
  PLATFORM_ABBREVIATION: string | null;
  IGDB_URL: string | null;
};

const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 100;
const MISSED_WINDOW_REASON = "release-window-missed";

function clampBatchSize(limit: number): number {
  const asNumber = Number(limit);
  if (!Number.isFinite(asNumber)) {
    return DEFAULT_BATCH_SIZE;
  }
  return Math.min(MAX_BATCH_SIZE, Math.max(1, Math.floor(asNumber)));
}

function parseDate(value: Date | string): Date {
  if (value instanceof Date) {
    return value;
  }
  return new Date(value);
}

function mapCandidateRow(row: ReleaseAnnouncementRow): IReleaseAnnouncementCandidate {
  return {
    releaseId: Number(row.RELEASE_ID),
    gameId: Number(row.GAME_ID),
    title: String(row.TITLE),
    releaseDate: parseDate(row.RELEASE_DATE),
    announceAt: parseDate(row.ANNOUNCE_AT),
    platformName: row.PLATFORM_NAME ? String(row.PLATFORM_NAME) : null,
    platformAbbreviation: row.PLATFORM_ABBREVIATION
      ? String(row.PLATFORM_ABBREVIATION)
      : null,
    igdbUrl: row.IGDB_URL ? String(row.IGDB_URL) : null,
  };
}

export default class GameReleaseAnnouncement {
  static async syncReleaseAnnouncements(): Promise<void> {
    const connection = await getOraclePool().getConnection();
    try {
      await connection.execute(
        `MERGE INTO GAMEDB_RELEASE_ANNOUNCEMENTS a
         USING (
           SELECT r.RELEASE_ID, r.RELEASE_DATE - 7 AS ANNOUNCE_AT
           FROM GAMEDB_RELEASES r
           WHERE r.RELEASE_DATE IS NOT NULL
         ) src
         ON (a.RELEASE_ID = src.RELEASE_ID)
         WHEN MATCHED THEN
           UPDATE SET
             a.ANNOUNCE_AT = src.ANNOUNCE_AT,
             a.UPDATED_AT = CURRENT_TIMESTAMP
           WHERE a.SENT_AT IS NULL
             AND a.SKIPPED_AT IS NULL
             AND a.ANNOUNCE_AT <> src.ANNOUNCE_AT
         WHEN NOT MATCHED THEN
           INSERT (
             RELEASE_ID,
             ANNOUNCE_AT,
             SENT_AT,
             SKIPPED_AT,
             SKIP_REASON,
             CREATED_AT,
             UPDATED_AT
           )
           VALUES (
             src.RELEASE_ID,
             src.ANNOUNCE_AT,
             NULL,
             NULL,
             NULL,
             CURRENT_TIMESTAMP,
             CURRENT_TIMESTAMP
           )`,
        {},
        { autoCommit: true },
      );
    } finally {
      await connection.close();
    }
  }

  static async listDueAnnouncements(
    referenceTime: Date,
    limit: number = DEFAULT_BATCH_SIZE,
  ): Promise<IReleaseAnnouncementCandidate[]> {
    const safeLimit = clampBatchSize(limit);
    const connection = await getOraclePool().getConnection();
    try {
      const result = await connection.execute<ReleaseAnnouncementRow>(
        `SELECT a.RELEASE_ID,
                r.GAME_ID,
                g.TITLE,
                r.RELEASE_DATE,
                a.ANNOUNCE_AT,
                p.PLATFORM_NAME,
                p.PLATFORM_ABBREVIATION,
                g.IGDB_URL
           FROM GAMEDB_RELEASE_ANNOUNCEMENTS a
           JOIN GAMEDB_RELEASES r ON r.RELEASE_ID = a.RELEASE_ID
           JOIN GAMEDB_GAMES g ON g.GAME_ID = r.GAME_ID
           LEFT JOIN GAMEDB_PLATFORMS p ON p.PLATFORM_ID = r.PLATFORM_ID
          WHERE a.SENT_AT IS NULL
            AND a.SKIPPED_AT IS NULL
            AND a.ANNOUNCE_AT <= :referenceTime
            AND r.RELEASE_DATE > :referenceTime
          ORDER BY a.ANNOUNCE_AT ASC, r.RELEASE_DATE ASC, a.RELEASE_ID ASC
          FETCH FIRST :limit ROWS ONLY`,
        { referenceTime, limit: safeLimit },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );

      return (result.rows ?? []).map((row) => mapCandidateRow(row));
    } finally {
      await connection.close();
    }
  }

  static async markAnnouncementSent(releaseId: number, sentAt: Date): Promise<boolean> {
    const connection = await getOraclePool().getConnection();
    try {
      const result = await connection.execute(
        `UPDATE GAMEDB_RELEASE_ANNOUNCEMENTS
            SET SENT_AT = :sentAt,
                SKIP_REASON = NULL,
                UPDATED_AT = CURRENT_TIMESTAMP
          WHERE RELEASE_ID = :releaseId
            AND SENT_AT IS NULL
            AND SKIPPED_AT IS NULL`,
        { releaseId, sentAt },
        { autoCommit: true },
      );
      return (result.rowsAffected ?? 0) > 0;
    } finally {
      await connection.close();
    }
  }

  static async markMissedAnnouncements(referenceTime: Date): Promise<number> {
    const connection = await getOraclePool().getConnection();
    try {
      const result = await connection.execute(
        `UPDATE GAMEDB_RELEASE_ANNOUNCEMENTS a
            SET a.SKIPPED_AT = :referenceTime,
                a.SKIP_REASON = :reason,
                a.UPDATED_AT = CURRENT_TIMESTAMP
          WHERE a.SENT_AT IS NULL
            AND a.SKIPPED_AT IS NULL
            AND a.ANNOUNCE_AT <= :referenceTime
            AND EXISTS (
              SELECT 1
              FROM GAMEDB_RELEASES r
              WHERE r.RELEASE_ID = a.RELEASE_ID
                AND r.RELEASE_DATE <= :referenceTime
            )`,
        {
          referenceTime,
          reason: MISSED_WINDOW_REASON,
        },
        { autoCommit: true },
      );
      return Number(result.rowsAffected ?? 0);
    } finally {
      await connection.close();
    }
  }
}
