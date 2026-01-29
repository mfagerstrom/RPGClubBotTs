import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";

export interface ISuggestionItem {
  suggestionId: number;
  title: string;
  details: string | null;
  labels: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapSuggestionRow(row: {
  SUGGESTION_ID: number;
  TITLE: string;
  DETAILS: string | null;
  LABELS: string | null;
  CREATED_BY: string | null;
  CREATED_BY_NAME: string | null;
  CREATED_AT: Date | string;
  UPDATED_AT: Date | string;
}): ISuggestionItem {
  return {
    suggestionId: Number(row.SUGGESTION_ID),
    title: row.TITLE,
    details: row.DETAILS ?? null,
    labels: row.LABELS ?? null,
    createdBy: row.CREATED_BY ?? null,
    createdByName: row.CREATED_BY_NAME ?? null,
    createdAt: toDate(row.CREATED_AT),
    updatedAt: toDate(row.UPDATED_AT),
  };
}

export async function createSuggestion(
  title: string,
  details: string | null,
  labels: string | null,
  createdBy: string | null,
  createdByName: string | null,
): Promise<ISuggestionItem> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute(
      `INSERT INTO RPG_CLUB_SUGGESTIONS (TITLE, DETAILS, LABELS, CREATED_BY, CREATED_BY_NAME)
       VALUES (:title, :details, :labels, :createdBy, :createdByName)
       RETURNING SUGGESTION_ID INTO :id`,
      {
        title,
        details,
        labels,
        createdBy,
        createdByName,
        id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      },
      { autoCommit: true },
    );
    const id = Number((result.outBinds as any)?.id?.[0] ?? 0);
    if (!id) {
      throw new Error("Failed to create suggestion.");
    }
    const suggestion = await getSuggestionById(id, connection);
    if (!suggestion) {
      throw new Error("Failed to load suggestion after creation.");
    }
    return suggestion;
  } finally {
    await connection.close();
  }
}

export async function listSuggestions(limit: number = 50): Promise<ISuggestionItem[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute<{
      SUGGESTION_ID: number;
      TITLE: string;
      DETAILS: string | null;
      LABELS: string | null;
      CREATED_BY: string | null;
      CREATED_BY_NAME: string | null;
      CREATED_AT: Date | string;
      UPDATED_AT: Date | string;
    }>(
      `SELECT SUGGESTION_ID,
              TITLE,
              DETAILS,
              LABELS,
              CREATED_BY,
              CREATED_BY_NAME,
              CREATED_AT,
              UPDATED_AT
         FROM RPG_CLUB_SUGGESTIONS
        ORDER BY CREATED_AT DESC, SUGGESTION_ID DESC
        FETCH FIRST :limit ROWS ONLY`,
      { limit: safeLimit },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return (result.rows ?? []).map((row) => mapSuggestionRow(row));
  } finally {
    await connection.close();
  }
}

export async function countSuggestions(): Promise<number> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute<{ TOTAL: number | null }>(
      "SELECT COUNT(*) AS TOTAL FROM RPG_CLUB_SUGGESTIONS",
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const row = result.rows?.[0];
    return Number(row?.TOTAL ?? 0);
  } finally {
    await connection.close();
  }
}

export async function getSuggestionById(
  suggestionId: number,
  existingConnection?: oracledb.Connection,
): Promise<ISuggestionItem | null> {
  const connection = existingConnection ?? (await getOraclePool().getConnection());
  try {
    const result = await connection.execute<{
      SUGGESTION_ID: number;
      TITLE: string;
      DETAILS: string | null;
      LABELS: string | null;
      CREATED_BY: string | null;
      CREATED_BY_NAME: string | null;
      CREATED_AT: Date | string;
      UPDATED_AT: Date | string;
    }>(
      `SELECT SUGGESTION_ID,
              TITLE,
              DETAILS,
              LABELS,
              CREATED_BY,
              CREATED_BY_NAME,
              CREATED_AT,
              UPDATED_AT
         FROM RPG_CLUB_SUGGESTIONS
        WHERE SUGGESTION_ID = :id`,
      { id: suggestionId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    const row = result.rows?.[0];
    return row ? mapSuggestionRow(row) : null;
  } finally {
    if (!existingConnection) {
      await connection.close();
    }
  }
}

export async function deleteSuggestion(suggestionId: number): Promise<boolean> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute(
      `DELETE FROM RPG_CLUB_SUGGESTIONS WHERE SUGGESTION_ID = :id`,
      { id: suggestionId },
      { autoCommit: true },
    );
    return (result.rowsAffected ?? 0) > 0;
  } finally {
    await connection.close();
  }
}
