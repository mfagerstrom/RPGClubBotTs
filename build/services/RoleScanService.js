import axios from "axios";
import { AttachmentBuilder, EmbedBuilder } from "discord.js";
import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";
import Member from "../classes/Member.js";
const ROLE_IDS = {
    admin: process.env.ADMIN_ROLE_ID?.replace(/[<@&>]/g, "").trim() || null,
    mod: process.env.MODERATOR_ROLE_ID?.replace(/[<@&>]/g, "").trim() || null,
    regular: process.env.REGULAR_ROLE_ID?.replace(/[<@&>]/g, "").trim() || null,
    member: process.env.MEMBER_ROLE_ID?.replace(/[<@&>]/g, "").trim() || null,
    newcomer: process.env.NEWCOMER_ROLE_ID?.replace(/[<@&>]/g, "").trim() || null,
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function isSendable(channel) {
    return Boolean(channel && typeof channel.send === "function");
}
function avatarBuffersDifferent(a, b) {
    if (!a && !b)
        return false;
    if (!!a !== !!b)
        return true;
    if (!a || !b)
        return true;
    if (a.length !== b.length)
        return true;
    return !a.equals(b);
}
async function downloadImageBuffer(url) {
    const resp = await axios.get(url, { responseType: "arraybuffer" });
    return Buffer.from(resp.data);
}
export async function memberScanTick(client, opts) {
    const guilds = client.guilds.cache;
    if (!guilds.size) {
        console.log("[MemberScan] No guilds found; skipping.");
        return { successCount: 0, failCount: 0 };
    }
    const pool = getOraclePool();
    let connection = await pool.getConnection();
    const isRecoverableOracleError = (err) => {
        const code = err?.code ?? err?.errorNum;
        const msg = err?.message ?? "";
        return (code === "NJS-500" ||
            code === "NJS-503" ||
            code === "ORA-03138" ||
            code === "ORA-03146" ||
            /DPI-1010|ORA-03135|end-of-file on communication channel/i.test(msg));
    };
    const reopenConnection = async () => {
        try {
            await connection?.close();
        }
        catch {
            // ignore
        }
        connection = await pool.getConnection();
    };
    let successCount = 0;
    let failCount = 0;
    const throttle = opts?.throttleMs ?? 1000;
    const logChannelId = opts?.logChannelId ?? "679499735757094950";
    let logChannel = null;
    if (logChannelId) {
        const fetched = await client.channels.fetch(logChannelId).catch(() => null);
        logChannel = fetched && fetched.isTextBased() ? fetched : null;
    }
    // Process each guild sequentially
    for (const guild of guilds.values()) {
        console.log(`[MemberScan] Scanning guild ${guild.id} (${guild.name}) ...`);
        const members = await guild.members.fetch();
        for (const member of members.values()) {
            const user = member.user;
            // Fetch existing row to detect changes
            let existingRow = null;
            try {
                const existing = await connection.execute(`SELECT USERNAME, GLOBAL_NAME, AVATAR_BLOB
             FROM RPG_CLUB_USERS
            WHERE USER_ID = :userId`, { userId: user.id }, {
                    outFormat: oracledb.OUT_FORMAT_OBJECT,
                    fetchInfo: {
                        AVATAR_BLOB: { type: oracledb.BUFFER },
                    },
                });
                const row = (existing.rows ?? [])[0];
                if (row) {
                    existingRow = {
                        USERNAME: row.USERNAME ?? null,
                        GLOBAL_NAME: row.GLOBAL_NAME ?? null,
                        AVATAR_BLOB: row.AVATAR_BLOB ?? null,
                        MESSAGE_COUNT: row.MESSAGE_COUNT ?? null,
                    };
                }
            }
            catch (err) {
                console.error(`[MemberScan] Failed to fetch existing row for ${user.id}`, err);
            }
            // Avatar fetch with throttle
            let avatarBlob = null;
            const avatarUrl = user.displayAvatarURL({ extension: "png", size: 512, forceStatic: true });
            if (avatarUrl) {
                try {
                    const buffer = await downloadImageBuffer(avatarUrl);
                    avatarBlob = buffer;
                }
                catch {
                    // ignore avatar fetch failures
                }
            }
            const hasRole = (id) => {
                if (!id)
                    return 0;
                return member.roles.cache.has(id) ? 1 : 0;
            };
            const adminFlag = hasRole(ROLE_IDS.admin) || member.permissions.has("Administrator") ? 1 : 0;
            const moderatorFlag = hasRole(ROLE_IDS.mod) || member.permissions.has("ManageMessages") ? 1 : 0;
            const regularFlag = hasRole(ROLE_IDS.regular);
            const memberFlag = hasRole(ROLE_IDS.member);
            const newcomerFlag = hasRole(ROLE_IDS.newcomer);
            const baseRecord = {
                userId: user.id,
                isBot: user.bot ? 1 : 0,
                username: user.username,
                globalName: user.globalName ?? null,
                avatarBlob: null,
                serverJoinedAt: member.joinedAt ?? null,
                lastSeenAt: null,
                roleAdmin: adminFlag,
                roleModerator: moderatorFlag,
                roleRegular: regularFlag,
                roleMember: memberFlag,
                roleNewcomer: newcomerFlag,
                messageCount: existingRow?.MESSAGE_COUNT ?? null,
                completionatorUrl: null,
                psnUsername: null,
                xblUsername: null,
                nswFriendCode: null,
                steamUrl: null,
            };
            const execUpsert = async (avatarData) => {
                const record = { ...baseRecord, avatarBlob: avatarData };
                await Member.upsert(record, { connection });
            };
            try {
                await execUpsert(avatarBlob);
                successCount++;
            }
            catch (err) {
                const code = err?.code ?? err?.errorNum;
                if (code === "ORA-03146") {
                    try {
                        await execUpsert(null);
                        successCount++;
                        await delay(1000);
                        continue;
                    }
                    catch (retryErr) {
                        failCount++;
                        console.error(`[MemberScan] Failed to upsert ${user.id} after stripping avatar`, retryErr);
                        await delay(1000);
                        continue;
                    }
                }
                if (isRecoverableOracleError(err)) {
                    await reopenConnection();
                    try {
                        await execUpsert(avatarBlob);
                        successCount++;
                        await delay(1000);
                        continue;
                    }
                    catch (retryErr) {
                        failCount++;
                        console.error(`[MemberScan] Failed to upsert ${user.id} after retry`, retryErr);
                    }
                }
                else {
                    failCount++;
                    console.error(`[MemberScan] Failed to upsert ${user.id}`, err);
                }
            }
            // announce nickname/avatar changes
            if (logChannel && isSendable(logChannel)) {
                const oldNick = existingRow
                    ? (existingRow.GLOBAL_NAME ?? existingRow.USERNAME ?? null)
                    : null;
                const newNick = user.globalName ?? user.username ?? null;
                if (oldNick !== newNick) {
                    const embed = new EmbedBuilder()
                        .setTitle("Nickname changed")
                        .setDescription(`<@${user.id}>`)
                        .addFields({ name: "Old", value: oldNick ?? "(none)", inline: true }, { name: "New", value: newNick ?? "(none)", inline: true })
                        .setTimestamp(new Date());
                    await logChannel.send({ embeds: [embed] });
                }
                if (avatarBuffersDifferent(existingRow?.AVATAR_BLOB ?? null, avatarBlob)) {
                    const files = [];
                    let newImg = null;
                    let oldImg = null;
                    if (avatarBlob) {
                        newImg = new AttachmentBuilder(avatarBlob, { name: `avatar-${user.id}-new.png` });
                        files.push(newImg);
                    }
                    if (existingRow?.AVATAR_BLOB) {
                        oldImg = new AttachmentBuilder(existingRow.AVATAR_BLOB, {
                            name: `avatar-${user.id}-old.png`,
                        });
                        files.push(oldImg);
                    }
                    const embed = new EmbedBuilder()
                        .setTitle("Avatar changed")
                        .setDescription(`<@${user.id}>`)
                        .setTimestamp(new Date());
                    if (newImg) {
                        embed.setImage(`attachment://${newImg.name}`);
                    }
                    await logChannel.send({
                        embeds: [embed],
                        files: files.length ? files : undefined,
                    });
                }
            }
            // throttle per user
            await delay(throttle);
        }
    }
    console.log(`[MemberScan] Completed. Success: ${successCount}, Fail: ${failCount}`);
    return { successCount, failCount };
}
