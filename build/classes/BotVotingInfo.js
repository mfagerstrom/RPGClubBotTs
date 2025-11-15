import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";
function mapRowToEntry(row) {
    const roundNumber = Number(row.ROUND_NUMBER);
    const nominationListId = row.NOMINATION_LIST_ID === null || row.NOMINATION_LIST_ID === undefined
        ? null
        : Number(row.NOMINATION_LIST_ID);
    const rawDate = row.NEXT_VOTE_AT;
    const nextVoteAt = rawDate instanceof Date ? rawDate : new Date(rawDate);
    if (!Number.isFinite(roundNumber)) {
        throw new Error("Invalid ROUND_NUMBER value in BOT_VOTING_INFO row.");
    }
    if (!(nextVoteAt instanceof Date) || Number.isNaN(nextVoteAt.getTime())) {
        throw new Error("Invalid NEXT_VOTE_AT value in BOT_VOTING_INFO row.");
    }
    return {
        roundNumber,
        nominationListId,
        nextVoteAt,
    };
}
function normalizeRoundNumber(roundNumber) {
    const r = Number(roundNumber);
    if (!Number.isFinite(r) || r <= 0) {
        throw new Error("Invalid round number for BOT_VOTING_INFO.");
    }
    return r;
}
function normalizeDate(value) {
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) {
            throw new Error("Invalid Date value for NEXT_VOTE_AT.");
        }
        return value;
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
        throw new Error("Invalid date string for NEXT_VOTE_AT.");
    }
    return d;
}
export default class BotVotingInfo {
    static async getAll() {
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const result = await connection.execute(`SELECT ROUND_NUMBER,
                NOMINATION_LIST_ID,
                NEXT_VOTE_AT
           FROM BOT_VOTING_INFO
          ORDER BY ROUND_NUMBER`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
            const rows = (result.rows ?? []);
            return rows.map((row) => mapRowToEntry(row));
        }
        finally {
            await connection.close();
        }
    }
    static async getByRound(roundNumber) {
        const round = normalizeRoundNumber(roundNumber);
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const result = await connection.execute(`SELECT ROUND_NUMBER,
                NOMINATION_LIST_ID,
                NEXT_VOTE_AT
           FROM BOT_VOTING_INFO
          WHERE ROUND_NUMBER = :round`, { round }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
            const rows = (result.rows ?? []);
            if (!rows.length)
                return null;
            const row = rows[0];
            return mapRowToEntry(row);
        }
        finally {
            await connection.close();
        }
    }
    /**
     * Create or update a voting info row for the given round.
     */
    static async setRoundInfo(roundNumber, nextVoteAt, nominationListId) {
        const round = normalizeRoundNumber(roundNumber);
        const nextVote = normalizeDate(nextVoteAt);
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const updateResult = await connection.execute(`UPDATE BOT_VOTING_INFO
            SET NOMINATION_LIST_ID = :nominationListId,
                NEXT_VOTE_AT = :nextVoteAt
          WHERE ROUND_NUMBER = :round`, {
                round,
                nominationListId,
                nextVoteAt: nextVote,
            }, { autoCommit: true });
            const rowsUpdated = updateResult.rowsAffected ?? 0;
            if (rowsUpdated > 0) {
                return;
            }
            await connection.execute(`INSERT INTO BOT_VOTING_INFO (
           ROUND_NUMBER,
           NOMINATION_LIST_ID,
           NEXT_VOTE_AT
         ) VALUES (
           :round,
           :nominationListId,
           :nextVoteAt
         )`, {
                round,
                nominationListId,
                nextVoteAt: nextVote,
            }, { autoCommit: true });
        }
        finally {
            await connection.close();
        }
    }
    static async updateNextVoteAt(roundNumber, nextVoteAt) {
        const round = normalizeRoundNumber(roundNumber);
        const nextVote = normalizeDate(nextVoteAt);
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const result = await connection.execute(`UPDATE BOT_VOTING_INFO
            SET NEXT_VOTE_AT = :nextVoteAt
          WHERE ROUND_NUMBER = :round`, {
                round,
                nextVoteAt: nextVote,
            }, { autoCommit: true });
            const rowsUpdated = result.rowsAffected ?? 0;
            if (rowsUpdated === 0) {
                throw new Error(`No BOT_VOTING_INFO row found for round ${round} when updating NEXT_VOTE_AT.`);
            }
        }
        finally {
            await connection.close();
        }
    }
    static async updateNominationListId(roundNumber, nominationListId) {
        const round = normalizeRoundNumber(roundNumber);
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const result = await connection.execute(`UPDATE BOT_VOTING_INFO
            SET NOMINATION_LIST_ID = :nominationListId
          WHERE ROUND_NUMBER = :round`, {
                round,
                nominationListId,
            }, { autoCommit: true });
            const rowsUpdated = result.rowsAffected ?? 0;
            if (rowsUpdated === 0) {
                throw new Error(`No BOT_VOTING_INFO row found for round ${round} when updating NOMINATION_LIST_ID.`);
            }
        }
        finally {
            await connection.close();
        }
    }
    static async deleteRound(roundNumber) {
        const round = normalizeRoundNumber(roundNumber);
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const result = await connection.execute(`DELETE FROM BOT_VOTING_INFO
          WHERE ROUND_NUMBER = :round`, { round }, { autoCommit: true });
            return result.rowsAffected ?? 0;
        }
        finally {
            await connection.close();
        }
    }
}
