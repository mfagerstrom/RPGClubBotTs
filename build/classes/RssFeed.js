import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";
export function normalizeKeywords(input) {
    if (!input)
        return [];
    const values = typeof input === "string" ? input.split(",") : input;
    return values
        .map((k) => (k ?? "").trim().toLowerCase())
        .filter((k) => k.length > 0);
}
export async function listFeeds(existingConnection) {
    const connection = existingConnection ?? await getOraclePool().getConnection();
    const shouldClose = !existingConnection;
    try {
        const result = await connection.execute(`SELECT FEED_ID,
              FEED_NAME,
              FEED_URL,
              CHANNEL_ID,
              INCLUDE_KEYWORDS,
              EXCLUDE_KEYWORDS
         FROM RPG_CLUB_RSS_FEEDS
        ORDER BY FEED_ID`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        return (result.rows ?? []).map((row) => ({
            feedId: row.FEED_ID,
            feedName: row.FEED_NAME ?? null,
            feedUrl: row.FEED_URL,
            channelId: row.CHANNEL_ID,
            includeKeywords: normalizeKeywords(row.INCLUDE_KEYWORDS),
            excludeKeywords: normalizeKeywords(row.EXCLUDE_KEYWORDS),
        }));
    }
    finally {
        if (shouldClose) {
            await connection.close();
        }
    }
}
export async function addFeed(feedName, feedUrl, channelId, includeKeywords, excludeKeywords) {
    const connection = await getOraclePool().getConnection();
    try {
        const normalizedInclude = normalizeKeywords(includeKeywords);
        const normalizedExclude = normalizeKeywords(excludeKeywords);
        const result = await connection.execute(`INSERT INTO RPG_CLUB_RSS_FEEDS (
         FEED_NAME,
         FEED_URL,
         CHANNEL_ID,
         INCLUDE_KEYWORDS,
         EXCLUDE_KEYWORDS
       ) VALUES (
         :feedName,
         :feedUrl,
         :channelId,
         :includes,
         :excludes
       )
       RETURNING FEED_ID INTO :id`, {
            feedName,
            feedUrl,
            channelId,
            includes: normalizedInclude.join(", "),
            excludes: normalizedExclude.join(", "),
            id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        }, { autoCommit: true });
        const id = result.outBinds?.id?.[0];
        return typeof id === "number" ? id : 0;
    }
    finally {
        await connection.close();
    }
}
export async function removeFeed(feedId) {
    const connection = await getOraclePool().getConnection();
    try {
        const result = await connection.execute(`DELETE FROM RPG_CLUB_RSS_FEEDS WHERE FEED_ID = :id`, { id: feedId }, { autoCommit: true });
        return (result.rowsAffected ?? 0) > 0;
    }
    finally {
        await connection.close();
    }
}
export async function updateFeed(feedId, updates) {
    const connection = await getOraclePool().getConnection();
    const sets = [];
    const params = { feedId };
    if (updates.feedUrl !== undefined) {
        sets.push("FEED_URL = :feedUrl");
        params.feedUrl = updates.feedUrl;
    }
    if (updates.feedName !== undefined) {
        sets.push("FEED_NAME = :feedName");
        params.feedName = updates.feedName;
    }
    if (updates.channelId !== undefined) {
        sets.push("CHANNEL_ID = :channelId");
        params.channelId = updates.channelId;
    }
    if (updates.includeKeywords !== undefined) {
        const normalized = normalizeKeywords(updates.includeKeywords);
        sets.push("INCLUDE_KEYWORDS = :includes");
        params.includes = normalized.join(", ");
    }
    if (updates.excludeKeywords !== undefined) {
        const normalized = normalizeKeywords(updates.excludeKeywords);
        sets.push("EXCLUDE_KEYWORDS = :excludes");
        params.excludes = normalized.join(", ");
    }
    if (!sets.length) {
        await connection.close();
        return false;
    }
    try {
        const result = await connection.execute(`UPDATE RPG_CLUB_RSS_FEEDS
          SET ${sets.join(", ")}
        WHERE FEED_ID = :feedId`, params, { autoCommit: true });
        return (result.rowsAffected ?? 0) > 0;
    }
    finally {
        await connection.close();
    }
}
export async function markItemsSeen(items, existingConnection) {
    if (!items.length)
        return;
    const connection = existingConnection ?? await getOraclePool().getConnection();
    const shouldClose = !existingConnection;
    try {
        const normalized = items.map((item) => ({
            ...item,
            itemGuid: item.itemGuid ? item.itemGuid.slice(0, 512) : null,
            itemLink: item.itemLink ? item.itemLink.slice(0, 512) : null,
        }));
        await connection.executeMany(`MERGE INTO RPG_CLUB_RSS_FEED_ITEMS t
        USING (
          SELECT :feedId AS feed_id,
                 :itemIdHash AS item_id_hash,
                 :itemGuid AS item_guid,
                 :itemLink AS item_link,
                 :publishedAt AS published_at
            FROM dual
        ) s
           ON (t.FEED_ID = s.feed_id AND t.ITEM_ID_HASH = s.item_id_hash)
         WHEN NOT MATCHED THEN
           INSERT (FEED_ID, ITEM_ID_HASH, ITEM_GUID, ITEM_LINK, PUBLISHED_AT, FIRST_SEEN_AT)
           VALUES (s.feed_id, s.item_id_hash, s.item_guid, s.item_link, s.published_at, SYSTIMESTAMP)`, normalized, {
            autoCommit: true,
            bindDefs: {
                feedId: { type: oracledb.NUMBER },
                itemIdHash: { type: oracledb.STRING, maxSize: 128 },
                itemGuid: { type: oracledb.STRING, maxSize: 1024 },
                itemLink: { type: oracledb.STRING, maxSize: 1024 },
                publishedAt: { type: oracledb.DATE },
            },
        });
    }
    finally {
        if (shouldClose) {
            await connection.close();
        }
    }
}
export async function isItemSeen(feedId, itemIdHash, existingConnection) {
    const connection = existingConnection ?? await getOraclePool().getConnection();
    const shouldClose = !existingConnection;
    try {
        const result = await connection.execute(`SELECT 1 FROM RPG_CLUB_RSS_FEED_ITEMS WHERE FEED_ID = :feedId AND ITEM_ID_HASH = :hash`, { feedId, hash: itemIdHash });
        return (result.rows ?? []).length > 0;
    }
    finally {
        if (shouldClose) {
            await connection.close();
        }
    }
}
export async function getSeenItemHashes(feedId, itemIdHashes, existingConnection) {
    if (!itemIdHashes.length)
        return new Set();
    const connection = existingConnection ?? await getOraclePool().getConnection();
    const shouldClose = !existingConnection;
    try {
        const foundHashes = new Set();
        const CHUNK_SIZE = 900;
        for (let i = 0; i < itemIdHashes.length; i += CHUNK_SIZE) {
            const chunk = itemIdHashes.slice(i, i + CHUNK_SIZE);
            const bindVars = { feedId };
            const bindPlaceholders = [];
            chunk.forEach((hash, idx) => {
                const key = `h${idx}`;
                bindVars[key] = hash;
                bindPlaceholders.push(`:${key}`);
            });
            const result = await connection.execute(`SELECT ITEM_ID_HASH
           FROM RPG_CLUB_RSS_FEED_ITEMS
          WHERE FEED_ID = :feedId
            AND ITEM_ID_HASH IN (${bindPlaceholders.join(", ")})`, bindVars, { outFormat: oracledb.OUT_FORMAT_OBJECT });
            (result.rows ?? []).forEach((row) => foundHashes.add(row.ITEM_ID_HASH));
        }
        return foundHashes;
    }
    finally {
        if (shouldClose) {
            await connection.close();
        }
    }
}
