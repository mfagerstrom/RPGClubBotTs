import { DateTime } from "luxon";
import BotVotingInfo from "../classes/BotVotingInfo.js";
function normalizeDate(value) {
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) {
            throw new Error("Invalid Date value for vote time.");
        }
        return value;
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
        throw new Error("Invalid date string for vote time.");
    }
    return d;
}
export async function getUpcomingNominationWindow() {
    const currentRound = await BotVotingInfo.getCurrentRound();
    if (!currentRound) {
        throw new Error("No current round found. Set next vote date first.");
    }
    const nextVoteAt = normalizeDate(currentRound.nextVoteAt);
    const closesAt = DateTime.fromJSDate(nextVoteAt).toJSDate();
    return {
        targetRound: currentRound.roundNumber + 1,
        nextVoteAt,
        closesAt,
    };
}
export function areNominationsClosed(window, now = new Date()) {
    return now >= window.closesAt;
}
