import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";

type ChannelCountBind = {
  userId: string;
  channelId: string;
  count: number;
  scanned: Date;
};

export default class UserChannelMessageCount {
  static async upsertChannelCounts(
    channelId: string,
    counts: Map<string, number>,
    scannedAt: Date,
  ): Promise<void> {
    if (!channelId || counts.size === 0) return;

    const rows: ChannelCountBind[] = Array.from(counts.entries()).map(([userId, count]) => ({
      userId,
      channelId,
      count,
      scanned: scannedAt,
    }));

    const connection = await getOraclePool().getConnection();
    try {
      await connection.executeMany(
        `MERGE INTO RPG_CLUB_USER_CHANNEL_COUNTS t
          USING (
            SELECT :userId AS user_id,
                   :channelId AS channel_id,
                   :count AS message_count,
                   :scanned AS scanned
              FROM dual
          ) s
             ON (t.USER_ID = s.user_id AND t.CHANNEL_ID = s.channel_id)
           WHEN MATCHED THEN
             UPDATE SET t.MESSAGE_COUNT = NVL(t.MESSAGE_COUNT, 0) + s.message_count,
                        t.LAST_SCANNED_AT = s.scanned,
                        t.UPDATED_AT = SYSTIMESTAMP
           WHEN NOT MATCHED THEN
             INSERT (USER_ID, CHANNEL_ID, MESSAGE_COUNT, LAST_SCANNED_AT, CREATED_AT, UPDATED_AT)
             VALUES (s.user_id, s.channel_id, s.message_count, s.scanned, SYSTIMESTAMP, SYSTIMESTAMP)`,
        rows,
        {
          autoCommit: true,
          bindDefs: {
            userId: { type: oracledb.STRING, maxSize: 30 },
            channelId: { type: oracledb.STRING, maxSize: 30 },
            count: { type: oracledb.NUMBER },
            scanned: { type: oracledb.DATE },
          },
        },
      );
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.error(
        `[UserChannelMessageCount] Failed to upsert counts for channel ${channelId}: ${msg}`,
      );
    } finally {
      await connection.close();
    }
  }

  static async getScannedChannelIds(): Promise<Set<string>> {
    const connection = await getOraclePool().getConnection();
    try {
      const result = await connection.execute<{ CHANNEL_ID: string }>(
        `SELECT DISTINCT CHANNEL_ID FROM RPG_CLUB_USER_CHANNEL_COUNTS`,
        [],
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const ids = new Set<string>();
      for (const row of result.rows ?? []) {
        if (row.CHANNEL_ID) {
          ids.add(row.CHANNEL_ID);
        }
      }
      return ids;
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.error(`[UserChannelMessageCount] Failed to load scanned channel ids: ${msg}`);
      return new Set<string>();
    } finally {
      await connection.close();
    }
  }

  static async getChannelScanMeta(): Promise<Map<string, Date>> {
    const connection = await getOraclePool().getConnection();
    try {
      const result = await connection.execute<{ CHANNEL_ID: string; LAST_SCANNED_AT: Date }>(
        `SELECT CHANNEL_ID, LAST_SCANNED_AT FROM RPG_CLUB_USER_CHANNEL_COUNTS`,
        [],
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const map = new Map<string, Date>();
      for (const row of result.rows ?? []) {
        if (row.CHANNEL_ID && row.LAST_SCANNED_AT) {
          map.set(row.CHANNEL_ID, row.LAST_SCANNED_AT);
        }
      }
      return map;
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.error(`[UserChannelMessageCount] Failed to load channel scan metadata: ${msg}`);
      return new Map<string, Date>();
    } finally {
      await connection.close();
    }
  }
}
