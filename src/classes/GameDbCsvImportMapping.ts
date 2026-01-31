import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";

export type GameDbCsvTitleMapStatus = "MAPPED" | "SKIPPED";

export interface IGameDbCsvTitleMap {
  mapId: number;
  titleRaw: string;
  titleNorm: string;
  gameDbGameId: number | null;
  status: GameDbCsvTitleMapStatus;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapRow(row: {
  MAP_ID: number;
  TITLE_RAW: string;
  TITLE_NORM: string;
  GAMEDB_GAME_ID: number | null;
  STATUS: GameDbCsvTitleMapStatus;
  CREATED_BY: string | null;
  CREATED_AT: Date | string;
  UPDATED_AT: Date | string;
}): IGameDbCsvTitleMap {
  return {
    mapId: Number(row.MAP_ID),
    titleRaw: row.TITLE_RAW,
    titleNorm: row.TITLE_NORM,
    gameDbGameId: row.GAMEDB_GAME_ID == null ? null : Number(row.GAMEDB_GAME_ID),
    status: row.STATUS,
    createdBy: row.CREATED_BY ?? null,
    createdAt: toDate(row.CREATED_AT),
    updatedAt: toDate(row.UPDATED_AT),
  };
}

export async function getGameDbCsvTitleMapByNorm(
  titleNorm: string,
): Promise<IGameDbCsvTitleMap | null> {
  const connection = await getOraclePool().getConnection();
  try {
    const res = await connection.execute<{
      MAP_ID: number;
      TITLE_RAW: string;
      TITLE_NORM: string;
      GAMEDB_GAME_ID: number | null;
      STATUS: GameDbCsvTitleMapStatus;
      CREATED_BY: string | null;
      CREATED_AT: Date | string;
      UPDATED_AT: Date | string;
    }>(
      `SELECT MAP_ID,
              TITLE_RAW,
              TITLE_NORM,
              GAMEDB_GAME_ID,
              STATUS,
              CREATED_BY,
              CREATED_AT,
              UPDATED_AT
         FROM RPG_CLUB_GAMEDB_IMPORT_TITLE_MAP
        WHERE TITLE_NORM = :titleNorm`,
      { titleNorm },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const row = res.rows?.[0];
    return row ? mapRow(row) : null;
  } finally {
    await connection.close();
  }
}

export async function upsertGameDbCsvTitleMap(params: {
  titleRaw: string;
  titleNorm: string;
  gameDbGameId: number | null;
  status: GameDbCsvTitleMapStatus;
  createdBy: string | null;
}): Promise<void> {
  const connection = await getOraclePool().getConnection();
  try {
    await connection.execute(
      `MERGE INTO RPG_CLUB_GAMEDB_IMPORT_TITLE_MAP t
       USING (
         SELECT :titleNorm AS TITLE_NORM FROM dual
       ) s
          ON (t.TITLE_NORM = s.TITLE_NORM)
       WHEN MATCHED THEN
         UPDATE SET
           TITLE_RAW = :titleRaw,
           GAMEDB_GAME_ID = :gameDbGameId,
           STATUS = :status,
           CREATED_BY = :createdBy
       WHEN NOT MATCHED THEN
         INSERT (TITLE_RAW, TITLE_NORM, GAMEDB_GAME_ID, STATUS, CREATED_BY)
         VALUES (:titleRaw, :titleNorm, :gameDbGameId, :status, :createdBy)`,
      {
        titleRaw: params.titleRaw,
        titleNorm: params.titleNorm,
        gameDbGameId: params.gameDbGameId,
        status: params.status,
        createdBy: params.createdBy,
      },
      { autoCommit: true },
    );
  } finally {
    await connection.close();
  }
}
