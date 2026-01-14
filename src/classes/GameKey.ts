import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";

export interface IGameKey {
  keyId: number;
  gameTitle: string;
  platform: string;
  keyValue: string;
  donorUserId: string;
  claimedByUserId: string | null;
  claimedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toDate(value: Date | string | null): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function mapGameKeyRow(row: {
  KEY_ID: number;
  GAME_TITLE: string;
  PLATFORM: string;
  KEY_VALUE: string;
  DONOR_USER_ID: string;
  CLAIMED_BY_USER_ID: string | null;
  CLAIMED_AT: Date | string | null;
  CREATED_AT: Date | string;
  UPDATED_AT: Date | string;
}): IGameKey {
  return {
    keyId: Number(row.KEY_ID),
    gameTitle: row.GAME_TITLE,
    platform: row.PLATFORM,
    keyValue: row.KEY_VALUE,
    donorUserId: row.DONOR_USER_ID,
    claimedByUserId: row.CLAIMED_BY_USER_ID ?? null,
    claimedAt: toDate(row.CLAIMED_AT),
    createdAt: toDate(row.CREATED_AT) ?? new Date(),
    updatedAt: toDate(row.UPDATED_AT) ?? new Date(),
  };
}

export async function createGameKey(
  title: string,
  platform: string,
  keyValue: string,
  donorUserId: string,
): Promise<IGameKey> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute(
      `INSERT INTO RPG_CLUB_GAME_KEYS (GAME_TITLE, PLATFORM, KEY_VALUE, DONOR_USER_ID)
       VALUES (:title, :platform, :keyValue, :donorUserId)
       RETURNING KEY_ID INTO :id`,
      {
        title,
        platform,
        keyValue,
        donorUserId,
        id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      },
      { autoCommit: true },
    );
    const id = Number((result.outBinds as any)?.id?.[0] ?? 0);
    if (!id) {
      throw new Error("Failed to create game key.");
    }
    const key = await getGameKeyById(id, connection);
    if (!key) {
      throw new Error("Failed to load game key after creation.");
    }
    return key;
  } finally {
    await connection.close();
  }
}

export async function getGameKeyById(
  keyId: number,
  existingConnection?: oracledb.Connection,
): Promise<IGameKey | null> {
  const connection = existingConnection ?? (await getOraclePool().getConnection());
  try {
    const result = await connection.execute<{
      KEY_ID: number;
      GAME_TITLE: string;
      PLATFORM: string;
      KEY_VALUE: string;
      DONOR_USER_ID: string;
      CLAIMED_BY_USER_ID: string | null;
      CLAIMED_AT: Date | string | null;
      CREATED_AT: Date | string;
      UPDATED_AT: Date | string;
    }>(
      `SELECT KEY_ID,
              GAME_TITLE,
              PLATFORM,
              KEY_VALUE,
              DONOR_USER_ID,
              CLAIMED_BY_USER_ID,
              CLAIMED_AT,
              CREATED_AT,
              UPDATED_AT
         FROM RPG_CLUB_GAME_KEYS
        WHERE KEY_ID = :id`,
      { id: keyId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const row = result.rows?.[0];
    return row ? mapGameKeyRow(row) : null;
  } finally {
    if (!existingConnection) {
      await connection.close();
    }
  }
}

export async function countAvailableGameKeys(): Promise<number> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute<{ TOTAL: number | null }>(
      `SELECT COUNT(*) AS TOTAL
         FROM RPG_CLUB_GAME_KEYS
        WHERE CLAIMED_BY_USER_ID IS NULL`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const row = result.rows?.[0];
    return Number(row?.TOTAL ?? 0);
  } finally {
    await connection.close();
  }
}

export async function listAvailableGameKeys(
  offset: number,
  limit: number,
): Promise<IGameKey[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  const safeOffset = Math.max(offset, 0);
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute<{
      KEY_ID: number;
      GAME_TITLE: string;
      PLATFORM: string;
      KEY_VALUE: string;
      DONOR_USER_ID: string;
      CLAIMED_BY_USER_ID: string | null;
      CLAIMED_AT: Date | string | null;
      CREATED_AT: Date | string;
      UPDATED_AT: Date | string;
    }>(
      `SELECT KEY_ID,
              GAME_TITLE,
              PLATFORM,
              KEY_VALUE,
              DONOR_USER_ID,
              CLAIMED_BY_USER_ID,
              CLAIMED_AT,
              CREATED_AT,
              UPDATED_AT
         FROM RPG_CLUB_GAME_KEYS
        WHERE CLAIMED_BY_USER_ID IS NULL
        ORDER BY UPPER(GAME_TITLE), KEY_ID
        OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
      { offset: safeOffset, limit: safeLimit },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return (result.rows ?? []).map((row) => mapGameKeyRow(row));
  } finally {
    await connection.close();
  }
}

export async function claimGameKey(
  keyId: number,
  userId: string,
): Promise<boolean> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute(
      `UPDATE RPG_CLUB_GAME_KEYS
          SET CLAIMED_BY_USER_ID = :userId,
              CLAIMED_AT = SYSTIMESTAMP
        WHERE KEY_ID = :keyId
          AND CLAIMED_BY_USER_ID IS NULL`,
      { keyId, userId },
      { autoCommit: true },
    );
    return (result.rowsAffected ?? 0) > 0;
  } finally {
    await connection.close();
  }
}

export async function revokeGameKey(keyId: number): Promise<boolean> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute(
      `DELETE FROM RPG_CLUB_GAME_KEYS WHERE KEY_ID = :keyId`,
      { keyId },
      { autoCommit: true },
    );
    return (result.rowsAffected ?? 0) > 0;
  } finally {
    await connection.close();
  }
}
