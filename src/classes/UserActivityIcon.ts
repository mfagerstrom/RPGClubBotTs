import oracledb from "oracledb";
import type { Activity } from "discord.js";
import { getOraclePool } from "../db/oracleClient.js";

export type IUserActivityIconRow = {
  userId: string;
  activityName: string;
  iconType: "large" | "small";
  sourceRef: string;
  iconUrl: string;
  lastSeenAt: Date;
};

type RecentIconQueryOptions = {
  activityName?: string;
  iconType?: "large" | "small";
  days?: number;
};

function normalizeActivityName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function chunkValues<T>(items: readonly T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize) as T[]);
  }
  return chunks;
}

function buildSourceRef(
  activityName: string,
  iconType: "large" | "small",
  rawAssetRef: string,
): string {
  return `${normalizeActivityName(activityName)}:${iconType}:${rawAssetRef}`;
}

function normalizeDiscordAssetUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete("size");
    parsed.searchParams.delete("quality");
    return parsed.toString();
  } catch {
    return url;
  }
}

type ActivityRecord = {
  activityName: string;
  activityNameNorm: string;
  iconType: "large" | "small";
  sourceRef: string;
  iconUrl: string;
};

function collectActivityRecords(activities: readonly Activity[]): ActivityRecord[] {
  const records: ActivityRecord[] = [];
  for (const activity of activities) {
    const activityName = activity.name?.trim();
    if (!activityName) continue;
    const activityNameNorm = normalizeActivityName(activityName);
    const largeRef = activity.assets?.largeImage?.trim();
    const smallRef = activity.assets?.smallImage?.trim();
    const largeUrl = activity.assets?.largeImageURL({ extension: "png", forceStatic: true })?.trim();
    const smallUrl = activity.assets?.smallImageURL({ extension: "png", forceStatic: true })?.trim();

    if (largeRef && largeUrl) {
      records.push({
        activityName,
        activityNameNorm,
        iconType: "large",
        sourceRef: buildSourceRef(activityName, "large", largeRef),
        iconUrl: normalizeDiscordAssetUrl(largeUrl),
      });
    }
    if (smallRef && smallUrl) {
      records.push({
        activityName,
        activityNameNorm,
        iconType: "small",
        sourceRef: buildSourceRef(activityName, "small", smallRef),
        iconUrl: normalizeDiscordAssetUrl(smallUrl),
      });
    }
  }
  return records;
}

export default class UserActivityIcon {
  static async recordFromPresence(
    userId: string,
    username: string,
    activities: readonly Activity[],
  ): Promise<void> {
    if (!userId || !activities.length) return;
    const records = collectActivityRecords(activities);
    if (!records.length) return;

    const connection = await getOraclePool().getConnection();
    try {
      for (const record of records) {
        await connection.execute(
          `MERGE INTO RPG_CLUB_USER_ACTIVITY_ICONS t
           USING (
             SELECT
               :userId AS USER_ID,
               :username AS USERNAME,
               :activityName AS ACTIVITY_NAME,
               :activityNameNorm AS ACTIVITY_NAME_NORM,
               :iconType AS ICON_TYPE,
               :sourceRef AS SOURCE_REF,
               :iconUrl AS ICON_URL
             FROM dual
           ) s
           ON (
             t.USER_ID = s.USER_ID
             AND t.ACTIVITY_NAME_NORM = s.ACTIVITY_NAME_NORM
             AND t.ICON_TYPE = s.ICON_TYPE
             AND t.SOURCE_REF = s.SOURCE_REF
           )
           WHEN MATCHED THEN
             UPDATE SET
               t.USERNAME = s.USERNAME,
               t.ICON_URL = s.ICON_URL,
               t.LAST_SEEN_AT = SYSTIMESTAMP,
               t.SEEN_COUNT = t.SEEN_COUNT + 1
           WHEN NOT MATCHED THEN
             INSERT (
               USER_ID,
               USERNAME,
               ACTIVITY_NAME,
               ACTIVITY_NAME_NORM,
               ICON_TYPE,
               SOURCE_REF,
               ICON_URL,
               FIRST_SEEN_AT,
               LAST_SEEN_AT,
               SEEN_COUNT
             )
             VALUES (
               s.USER_ID,
               s.USERNAME,
               s.ACTIVITY_NAME,
               s.ACTIVITY_NAME_NORM,
               s.ICON_TYPE,
               s.SOURCE_REF,
               s.ICON_URL,
               SYSTIMESTAMP,
               SYSTIMESTAMP,
               1
             )`,
          {
            userId,
            username,
            activityName: record.activityName,
            activityNameNorm: record.activityNameNorm,
            iconType: record.iconType,
            sourceRef: record.sourceRef,
            iconUrl: record.iconUrl,
          },
        );
      }
      await connection.commit();
    } finally {
      await connection.close();
    }
  }

  static async getRecentForUser(
    userId: string,
    options?: RecentIconQueryOptions,
  ): Promise<IUserActivityIconRow[]> {
    return this.getRecentForUsers([userId], options);
  }

  static async getRecentForUsers(
    userIds: readonly string[],
    options?: RecentIconQueryOptions,
  ): Promise<IUserActivityIconRow[]> {
    const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
    if (!uniqueUserIds.length) return [];

    const days = Math.max(1, Math.min(60, options?.days ?? 30));
    const activityNameNorm = options?.activityName?.trim()
      ? normalizeActivityName(options.activityName)
      : null;
    const iconType = options?.iconType ?? null;

    const userGroupClauses: string[] = [];
    const binds: Record<string, string | number | null> = {
      days,
      activityNameNorm,
      iconType,
    };

    const userGroups = chunkValues(uniqueUserIds, 900);
    let bindIndex = 0;
    for (const group of userGroups) {
      const groupKeys: string[] = [];
      for (const userId of group) {
        const key = `userId${bindIndex}`;
        groupKeys.push(`:${key}`);
        binds[key] = userId;
        bindIndex += 1;
      }
      userGroupClauses.push(`USER_ID IN (${groupKeys.join(", ")})`);
    }

    const connection = await getOraclePool().getConnection();
    try {
      const result = await connection.execute<{
        USER_ID: string;
        ACTIVITY_NAME: string;
        ICON_TYPE: "large" | "small";
        SOURCE_REF: string;
        ICON_URL: string;
        LAST_SEEN_AT: Date;
      }>(
        `SELECT
           USER_ID,
           ACTIVITY_NAME,
           ICON_TYPE,
           SOURCE_REF,
           ICON_URL,
           LAST_SEEN_AT
         FROM RPG_CLUB_USER_ACTIVITY_ICONS
         WHERE (${userGroupClauses.join(" OR ")})
           AND LAST_SEEN_AT >= SYSTIMESTAMP - NUMTODSINTERVAL(:days, 'DAY')
           AND (:activityNameNorm IS NULL OR ACTIVITY_NAME_NORM = :activityNameNorm)
           AND (:iconType IS NULL OR ICON_TYPE = :iconType)
         ORDER BY LAST_SEEN_AT DESC`,
        binds,
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );

      return (result.rows ?? []).map((row) => ({
        userId: row.USER_ID,
        activityName: row.ACTIVITY_NAME,
        iconType: row.ICON_TYPE,
        sourceRef: row.SOURCE_REF,
        iconUrl: row.ICON_URL,
        lastSeenAt: row.LAST_SEEN_AT instanceof Date
          ? row.LAST_SEEN_AT
          : new Date(row.LAST_SEEN_AT),
      }));
    } finally {
      await connection.close();
    }
  }
}
