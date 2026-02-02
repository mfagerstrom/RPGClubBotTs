import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";

export interface ISuggestionReviewSession {
  sessionId: string;
  reviewerId: string;
  suggestionIds: number[];
  index: number;
  totalCount: number;
  createdAt: Date;
  updatedAt: Date;
}

type SuggestionReviewSessionRow = {
  SESSION_ID: string;
  REVIEWER_ID: string;
  SUGGESTION_IDS: string | null;
  CURRENT_INDEX: number | null;
  TOTAL_COUNT: number | null;
  CREATED_AT: Date | string;
  UPDATED_AT: Date | string;
};

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function normalizeSuggestionIds(ids: number[]): number[] {
  return ids
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);
}

function serializeSuggestionIds(ids: number[]): string {
  const normalized = normalizeSuggestionIds(ids);
  const payload = JSON.stringify(normalized);
  if (payload.length > 4000) {
    throw new Error("Too many suggestion ids to persist.");
  }
  return payload;
}

function parseSuggestionIds(value: string | null): number[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return normalizeSuggestionIds(parsed as number[]);
  } catch {
    return [];
  }
}

function mapSessionRow(row: SuggestionReviewSessionRow): ISuggestionReviewSession {
  return {
    sessionId: row.SESSION_ID,
    reviewerId: row.REVIEWER_ID,
    suggestionIds: parseSuggestionIds(row.SUGGESTION_IDS),
    index: Number(row.CURRENT_INDEX ?? 0),
    totalCount: Number(row.TOTAL_COUNT ?? 0),
    createdAt: toDate(row.CREATED_AT),
    updatedAt: toDate(row.UPDATED_AT),
  };
}

export async function createSuggestionReviewSessionRecord(session: {
  sessionId: string;
  reviewerId: string;
  suggestionIds: number[];
  index: number;
  totalCount: number;
}): Promise<ISuggestionReviewSession> {
  const connection = await getOraclePool().getConnection();
  try {
    const suggestionIds = serializeSuggestionIds(session.suggestionIds);
    await connection.execute(
      `INSERT INTO RPG_CLUB_SUGGESTION_REVIEW_SESSIONS
         (SESSION_ID, REVIEWER_ID, SUGGESTION_IDS, CURRENT_INDEX, TOTAL_COUNT)
       VALUES (:sessionId, :reviewerId, :suggestionIds, :currentIndex, :totalCount)`,
      {
        sessionId: session.sessionId,
        reviewerId: session.reviewerId,
        suggestionIds,
        currentIndex: Math.max(session.index, 0),
        totalCount: Math.max(session.totalCount, 0),
      },
      { autoCommit: true },
    );

    const saved = await getSuggestionReviewSession(session.sessionId, connection);
    if (!saved) {
      throw new Error("Failed to create suggestion review session.");
    }
    return saved;
  } finally {
    await connection.close();
  }
}

export async function getSuggestionReviewSession(
  sessionId: string,
  existingConnection?: oracledb.Connection,
): Promise<ISuggestionReviewSession | null> {
  const connection = existingConnection ?? (await getOraclePool().getConnection());
  try {
    const result = await connection.execute<SuggestionReviewSessionRow>(
      `SELECT SESSION_ID,
              REVIEWER_ID,
              SUGGESTION_IDS,
              CURRENT_INDEX,
              TOTAL_COUNT,
              CREATED_AT,
              UPDATED_AT
         FROM RPG_CLUB_SUGGESTION_REVIEW_SESSIONS
        WHERE SESSION_ID = :sessionId`,
      { sessionId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const row = result.rows?.[0];
    return row ? mapSessionRow(row) : null;
  } finally {
    if (!existingConnection) {
      await connection.close();
    }
  }
}

export async function updateSuggestionReviewSession(
  session: ISuggestionReviewSession,
): Promise<void> {
  const connection = await getOraclePool().getConnection();
  try {
    const suggestionIds = serializeSuggestionIds(session.suggestionIds);
    await connection.execute(
      `UPDATE RPG_CLUB_SUGGESTION_REVIEW_SESSIONS
          SET REVIEWER_ID = :reviewerId,
              SUGGESTION_IDS = :suggestionIds,
              CURRENT_INDEX = :currentIndex,
              TOTAL_COUNT = :totalCount
        WHERE SESSION_ID = :sessionId`,
      {
        reviewerId: session.reviewerId,
        suggestionIds,
        currentIndex: Math.max(session.index, 0),
        totalCount: Math.max(session.totalCount, 0),
        sessionId: session.sessionId,
      },
      { autoCommit: true },
    );
  } finally {
    await connection.close();
  }
}

export async function deleteSuggestionReviewSession(sessionId: string): Promise<boolean> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute(
      `DELETE FROM RPG_CLUB_SUGGESTION_REVIEW_SESSIONS WHERE SESSION_ID = :sessionId`,
      { sessionId },
      { autoCommit: true },
    );
    return (result.rowsAffected ?? 0) > 0;
  } finally {
    await connection.close();
  }
}

export async function deleteSuggestionReviewSessionsForReviewer(
  reviewerId: string,
): Promise<number> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute(
      `DELETE FROM RPG_CLUB_SUGGESTION_REVIEW_SESSIONS WHERE REVIEWER_ID = :reviewerId`,
      { reviewerId },
      { autoCommit: true },
    );
    return Number(result.rowsAffected ?? 0);
  } finally {
    await connection.close();
  }
}

export async function deleteExpiredSuggestionReviewSessions(
  cutoffDate: Date,
): Promise<number> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute(
      `DELETE FROM RPG_CLUB_SUGGESTION_REVIEW_SESSIONS WHERE CREATED_AT < :cutoff`,
      { cutoff: cutoffDate },
      { autoCommit: true },
    );
    return Number(result.rowsAffected ?? 0);
  } finally {
    await connection.close();
  }
}
