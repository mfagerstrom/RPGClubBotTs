var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { EmbedBuilder } from "discord.js";
import { Discord, Slash } from "discordx";
import { getUpcomingNominationWindow } from "../functions/NominationWindow.js";
import { listNominationsForRound } from "../classes/Nomination.js";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
let CombinedNoms = class CombinedNoms {
    async noms(interaction) {
        await safeDeferReply(interaction);
        try {
            const window = await getUpcomingNominationWindow();
            const voteLabel = formatDate(window.nextVoteAt);
            const [gotm, nrGotm] = await Promise.all([
                listNominationsForRound("gotm", window.targetRound),
                listNominationsForRound("nr-gotm", window.targetRound),
            ]);
            const embeds = [];
            embeds.push(buildListEmbed({
                title: `GOTM Nominations - Round ${window.targetRound}`,
                nominations: gotm,
                voteDate: voteLabel,
                command: "/gotm nominate",
            }));
            embeds.push(buildListEmbed({
                title: `NR-GOTM Nominations - Round ${window.targetRound}`,
                nominations: nrGotm,
                voteDate: voteLabel,
                command: "/nr-gotm nominate",
            }));
            await safeReply(interaction, { embeds });
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Could not load nominations: ${msg}`,
            });
        }
    }
};
__decorate([
    Slash({
        description: "Show both GOTM and NR-GOTM nominations for the upcoming round",
        name: "noms",
    })
], CombinedNoms.prototype, "noms", null);
CombinedNoms = __decorate([
    Discord()
], CombinedNoms);
export { CombinedNoms };
function buildListEmbed(opts) {
    const lines = opts.nominations.length > 0
        ? opts.nominations.map((n, idx) => `${numberEmoji(idx + 1)} ${n.gameTitle} — <@${n.userId}>`)
        : ["No nominations yet."];
    return new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle(opts.title)
        .setDescription(lines.join("\n"))
        .setFooter({
        text: `Vote on ${opts.voteDate}\n` +
            `Do you want to nominate a game? Use ${opts.command}`,
    });
}
function numberEmoji(n) {
    const lookup = {
        1: ":one:",
        2: ":two:",
        3: ":three:",
        4: ":four:",
        5: ":five:",
        6: ":six:",
        7: ":seven:",
        8: ":eight:",
        9: ":nine:",
        10: ":keycap_ten:",
    };
    return lookup[n] ?? `${n}.`;
}
function formatDate(date) {
    return date.toLocaleDateString("en-US", { timeZone: "America/New_York" });
}
