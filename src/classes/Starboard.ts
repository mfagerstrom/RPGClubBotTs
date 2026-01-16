import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";

export type StarboardRecord = {
  messageId: string;
  channelId: string;
  starboardMessageId: string;
  authorId: string;
  starCount: number;
  createdAt: Date;
};

export default class Starboard {
  static async getByMessageId(messageId: string): Promise<StarboardRecord | null> {
    const connection = await getOraclePool().getConnection();
    try {
      const result = await connection.execute<{
        MESSAGE_ID: string;
        CHANNEL_ID: string;
        STARBOARD_MESSAGE_ID: string;
        AUTHOR_ID: string;
        STAR_COUNT: number;
        CREATED_AT: Date;
      }>(
        `SELECT MESSAGE_ID,
                CHANNEL_ID,
                STARBOARD_MESSAGE_ID,
                AUTHOR_ID,
                STAR_COUNT,
                CREATED_AT
           FROM RPG_CLUB_STARBOARD
          WHERE MESSAGE_ID = :messageId`,
        { messageId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const row = result.rows?.[0];
      if (!row) return null;
      return {
        messageId: row.MESSAGE_ID,
        channelId: row.CHANNEL_ID,
        starboardMessageId: row.STARBOARD_MESSAGE_ID,
        authorId: row.AUTHOR_ID,
        starCount: Number(row.STAR_COUNT ?? 0),
        createdAt: row.CREATED_AT instanceof Date ? row.CREATED_AT : new Date(row.CREATED_AT as any),
      };
    } finally {
      await connection.close();
    }
  }

  static async insert(record: Omit<StarboardRecord, "createdAt">): Promise<void> {
    const connection = await getOraclePool().getConnection();
    try {
      await connection.execute(
        `INSERT INTO RPG_CLUB_STARBOARD
          (MESSAGE_ID, CHANNEL_ID, STARBOARD_MESSAGE_ID, AUTHOR_ID, STAR_COUNT)
         VALUES (:messageId, :channelId, :starboardMessageId, :authorId, :starCount)`,
        {
          messageId: record.messageId,
          channelId: record.channelId,
          starboardMessageId: record.starboardMessageId,
          authorId: record.authorId,
          starCount: record.starCount,
        },
        { autoCommit: true },
      );
    } finally {
      await connection.close();
    }
  }
}
