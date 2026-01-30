import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";

export type ISynonymDraftPair = {
  term: string;
  match: string;
};

export type ISynonymDraft = {
  draftId: number;
  userId: string;
  pairs: ISynonymDraftPair[];
  createdAt: Date;
  updatedAt: Date;
};

function parsePairsJson(raw: string | null | undefined): ISynonymDraftPair[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => ({
          term: typeof item?.term === "string" ? item.term : "",
          match: typeof item?.match === "string" ? item.match : "",
        }))
        .filter((pair) => pair.term && pair.match);
    }
  } catch {
    // ignore
  }
  return [];
}

function mapDraftRow(row: any): ISynonymDraft {
  return {
    draftId: Number(row.DRAFT_ID),
    userId: String(row.USER_ID),
    pairs: parsePairsJson(row.PAIRS_JSON ? String(row.PAIRS_JSON) : null),
    createdAt: row.CREATED_AT instanceof Date ? row.CREATED_AT : new Date(row.CREATED_AT),
    updatedAt: row.UPDATED_AT instanceof Date ? row.UPDATED_AT : new Date(row.UPDATED_AT),
  };
}

export default class GameSearchSynonymDraft {
  static async createDraft(userId: string): Promise<ISynonymDraft> {
    const pool = getOraclePool();
    const connection = await pool.getConnection();
    try {
      const result = await connection.execute(
        `INSERT INTO GAMEDB_SEARCH_SYNONYM_DRAFTS (USER_ID, PAIRS_JSON)
         VALUES (:userId, :pairsJson)
         RETURNING DRAFT_ID INTO :draftId`,
        {
          userId,
          pairsJson: JSON.stringify([]),
          draftId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        },
        { autoCommit: true },
      );
      const draftId = Number((result.outBinds as any)?.draftId?.[0]);
      const draft = await this.getDraft(draftId, connection);
      if (!draft) {
        throw new Error("Failed to load synonym draft after creation.");
      }
      return draft;
    } finally {
      await connection.close();
    }
  }

  static async getDraft(
    draftId: number,
    connection?: oracledb.Connection,
  ): Promise<ISynonymDraft | null> {
    const pool = getOraclePool();
    const activeConnection = connection ?? await pool.getConnection();
    try {
      const result = await activeConnection.execute(
        `SELECT DRAFT_ID, USER_ID, PAIRS_JSON, CREATED_AT, UPDATED_AT
           FROM GAMEDB_SEARCH_SYNONYM_DRAFTS
          WHERE DRAFT_ID = :draftId`,
        { draftId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT, fetchInfo: { PAIRS_JSON: { type: oracledb.STRING } } },
      );
      const row = (result.rows ?? [])[0] as any;
      return row ? mapDraftRow(row) : null;
    } finally {
      if (!connection) {
        await activeConnection.close();
      }
    }
  }

  static async appendPairs(
    draftId: number,
    pairs: ISynonymDraftPair[],
  ): Promise<ISynonymDraft | null> {
    const pool = getOraclePool();
    const connection = await pool.getConnection();
    try {
      const existing = await this.getDraft(draftId, connection);
      if (!existing) return null;
      const combined = [...existing.pairs, ...pairs];
      await connection.execute(
        `UPDATE GAMEDB_SEARCH_SYNONYM_DRAFTS
            SET PAIRS_JSON = :pairsJson,
                UPDATED_AT = CURRENT_TIMESTAMP
          WHERE DRAFT_ID = :draftId`,
        {
          draftId,
          pairsJson: JSON.stringify(combined),
        },
        { autoCommit: true },
      );
      return await this.getDraft(draftId, connection);
    } finally {
      await connection.close();
    }
  }

  static async deleteDraft(draftId: number): Promise<void> {
    const pool = getOraclePool();
    const connection = await pool.getConnection();
    try {
      await connection.execute(
        `DELETE FROM GAMEDB_SEARCH_SYNONYM_DRAFTS WHERE DRAFT_ID = :draftId`,
        { draftId },
        { autoCommit: true },
      );
    } finally {
      await connection.close();
    }
  }
}
