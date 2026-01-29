import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";

export type HltbCacheEntry = {
  gameId: number;
  name: string | null;
  url: string | null;
  imageUrl: string | null;
  main: string | null;
  mainSides: string | null;
  completionist: string | null;
  singlePlayer: string | null;
  coOp: string | null;
  vs: string | null;
  sourceQuery: string | null;
  scrapedAt: Date | null;
  updatedAt: Date | null;
};

function mapRow(row: {
  GAMEDB_GAME_ID: number;
  HLTB_NAME: string | null;
  HLTB_URL: string | null;
  HLTB_IMAGE_URL: string | null;
  MAIN: string | null;
  MAIN_SIDES: string | null;
  COMPLETIONIST: string | null;
  SINGLE_PLAYER: string | null;
  CO_OP: string | null;
  VS: string | null;
  SOURCE_QUERY: string | null;
  SCRAPED_AT: Date | string | null;
  UPDATED_AT: Date | string | null;
}): HltbCacheEntry {
  const toDate = (value: Date | string | null): Date | null => {
    if (!value) return null;
    return value instanceof Date ? value : new Date(value);
  };
  return {
    gameId: Number(row.GAMEDB_GAME_ID),
    name: row.HLTB_NAME ?? null,
    url: row.HLTB_URL ?? null,
    imageUrl: row.HLTB_IMAGE_URL ?? null,
    main: row.MAIN ?? null,
    mainSides: row.MAIN_SIDES ?? null,
    completionist: row.COMPLETIONIST ?? null,
    singlePlayer: row.SINGLE_PLAYER ?? null,
    coOp: row.CO_OP ?? null,
    vs: row.VS ?? null,
    sourceQuery: row.SOURCE_QUERY ?? null,
    scrapedAt: toDate(row.SCRAPED_AT ?? null),
    updatedAt: toDate(row.UPDATED_AT ?? null),
  };
}

export async function getHltbCacheByGameId(
  gameId: number,
): Promise<HltbCacheEntry | null> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute<{
      GAMEDB_GAME_ID: number;
      HLTB_NAME: string | null;
      HLTB_URL: string | null;
      HLTB_IMAGE_URL: string | null;
      MAIN: string | null;
      MAIN_SIDES: string | null;
      COMPLETIONIST: string | null;
      SINGLE_PLAYER: string | null;
      CO_OP: string | null;
      VS: string | null;
      SOURCE_QUERY: string | null;
      SCRAPED_AT: Date | string | null;
      UPDATED_AT: Date | string | null;
    }>(
      `SELECT GAMEDB_GAME_ID,
              HLTB_NAME,
              HLTB_URL,
              HLTB_IMAGE_URL,
              MAIN,
              MAIN_SIDES,
              COMPLETIONIST,
              SINGLE_PLAYER,
              CO_OP,
              VS,
              SOURCE_QUERY,
              SCRAPED_AT,
              UPDATED_AT
         FROM RPG_CLUB_HLTB_CACHE
        WHERE GAMEDB_GAME_ID = :gameId`,
      { gameId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const row = (result.rows ?? [])[0];
    return row ? mapRow(row) : null;
  } finally {
    await connection.close();
  }
}

export async function upsertHltbCache(
  gameId: number,
  payload: {
    name?: string | null;
    url?: string | null;
    imageUrl?: string | null;
    main?: string | null;
    mainSides?: string | null;
    completionist?: string | null;
    singlePlayer?: string | null;
    coOp?: string | null;
    vs?: string | null;
    sourceQuery?: string | null;
  },
): Promise<void> {
  const connection = await getOraclePool().getConnection();
  try {
    await connection.execute(
      `MERGE INTO RPG_CLUB_HLTB_CACHE t
       USING (SELECT :gameId AS GAME_ID FROM dual) s
          ON (t.GAMEDB_GAME_ID = s.GAME_ID)
       WHEN MATCHED THEN
         UPDATE SET
           HLTB_NAME = :name,
           HLTB_URL = :url,
           HLTB_IMAGE_URL = :imageUrl,
           MAIN = :main,
           MAIN_SIDES = :mainSides,
           COMPLETIONIST = :completionist,
           SINGLE_PLAYER = :singlePlayer,
           CO_OP = :coOp,
           VS = :vs,
           SOURCE_QUERY = :sourceQuery,
           SCRAPED_AT = SYSTIMESTAMP,
           UPDATED_AT = SYSTIMESTAMP
       WHEN NOT MATCHED THEN
         INSERT (
           GAMEDB_GAME_ID,
           HLTB_NAME,
           HLTB_URL,
           HLTB_IMAGE_URL,
           MAIN,
           MAIN_SIDES,
           COMPLETIONIST,
           SINGLE_PLAYER,
           CO_OP,
           VS,
           SOURCE_QUERY,
           SCRAPED_AT,
           UPDATED_AT
         ) VALUES (
           :gameId,
           :name,
           :url,
           :imageUrl,
           :main,
           :mainSides,
           :completionist,
           :singlePlayer,
           :coOp,
           :vs,
           :sourceQuery,
           SYSTIMESTAMP,
           SYSTIMESTAMP
         )`,
      {
        gameId,
        name: payload.name ?? null,
        url: payload.url ?? null,
        imageUrl: payload.imageUrl ?? null,
        main: payload.main ?? null,
        mainSides: payload.mainSides ?? null,
        completionist: payload.completionist ?? null,
        singlePlayer: payload.singlePlayer ?? null,
        coOp: payload.coOp ?? null,
        vs: payload.vs ?? null,
        sourceQuery: payload.sourceQuery ?? null,
      },
      { autoCommit: true },
    );
  } finally {
    await connection.close();
  }
}
