import { EmbedBuilder, ChannelType, type ForumChannel, type TextChannel } from "discord.js";
import type { ArgsOf, Client } from "discordx";
import { Discord, On } from "discordx";
import { joinThreadIfTarget } from "../services/ForumThreadJoinService.js";

const NOW_PLAYING_FORUM_ID: string = '1059875931356938240';
const WHATCHA_PLAYING_CHANNEL_ID: string = '360819470836695042';

@Discord()
export class ThreadCreated {
  @On()
  async threadCreate(
    [thread]: ArgsOf<"threadCreate">,
    client: Client,
  ): Promise<void> {
    await joinThreadIfTarget(thread);

    // New Threads in Now Playing forum channel get announced in the Whatcha Playing channel
    if (thread.parentId === NOW_PLAYING_FORUM_ID) {
      // Always wait 10 seconds before fetching the starter message
      const sleep = (ms: number): Promise<void> =>
        new Promise<void>((resolve): void => {
          setTimeout(resolve, ms);
        });
      await sleep(10_000);
      // Resolve thread author (prefer starter message author; fallback to thread.ownerId)
      let authorName: string = 'Unknown';
      let authorIconUrl: string | undefined;
      let authorProfileUrl: string | undefined;
      let imageUrl: string | undefined;

      try {
        const starter = await thread.fetchStarterMessage();
        if (starter) {
          authorName = starter.member?.displayName ?? starter.author.username;
          authorIconUrl = starter.author.displayAvatarURL();
          authorProfileUrl = `https://discord.com/users/${starter.author.id}`;

          // try attachments first
          for (const att of starter.attachments.values()) {
            const nameLc = att.name?.toLowerCase() ?? '';
            if (
              att.contentType?.toLowerCase()?.startsWith('image/') ||
              /\.(png|jpg|jpeg|gif|webp|bmp|tiff)$/.test(nameLc) ||
              (att as any).width
            ) {
              imageUrl = att.url ?? att.proxyURL;
              break;
            }
          }
          // fallback to embed image/thumbnail (also consider proxy URLs)
          if (!imageUrl) {
            for (const emb of starter.embeds) {
              const anyEmb: any = emb as any;
              const imgUrl: string | undefined =
                emb.image?.url || anyEmb?.image?.proxyURL || anyEmb?.image?.proxy_url;
              const thumbUrl: string | undefined =
                emb.thumbnail?.url ||
                anyEmb?.thumbnail?.proxyURL ||
                anyEmb?.thumbnail?.proxy_url;
              if (imgUrl) {
                imageUrl = imgUrl;
                break;
              }
              if (thumbUrl) {
                imageUrl = thumbUrl;
                break;
              }
            }
          }
        }

        // Retry for up to 5s, polling every 500ms for image to appear
        if (!imageUrl) {
          const deadline: number = Date.now() + 5000;
          while (!imageUrl && Date.now() < deadline) {
            const again = await thread.fetchStarterMessage().catch(() => null);
            if (again) {
              // pick from attachments
              for (const att of again.attachments.values()) {
                const nameLc = att.name?.toLowerCase() ?? '';
                if (
                  att.contentType?.toLowerCase()?.startsWith('image/') ||
                  /\.(png|jpg|jpeg|gif|webp|bmp|tiff)$/.test(nameLc) ||
                  (att as any).width
                ) {
                  imageUrl = att.url ?? att.proxyURL;
                  break;
                }
              }
              // or from embeds (also consider proxy URLs)
              if (!imageUrl) {
                for (const emb of again.embeds) {
                  const anyEmb: any = emb as any;
                  const imgUrl: string | undefined =
                    emb.image?.url || anyEmb?.image?.proxyURL || anyEmb?.image?.proxy_url;
                  const thumbUrl: string | undefined =
                    emb.thumbnail?.url ||
                    anyEmb?.thumbnail?.proxyURL ||
                    anyEmb?.thumbnail?.proxy_url;
                  if (imgUrl) {
                    imageUrl = imgUrl;
                    break;
                  }
                  if (thumbUrl) {
                    imageUrl = thumbUrl;
                    break;
                  }
                }
              }
            }
            if (!imageUrl) {
              await sleep(500);
            }
          }
        }
      } catch {
        // ignore and fallback below
      }

      if (authorName === 'Unknown' && thread.ownerId) {
        try {
          const ownerUser = await client.users.fetch(thread.ownerId);
          if (ownerUser) {
            authorName = ownerUser.username;
            authorIconUrl = ownerUser.displayAvatarURL();
            authorProfileUrl = `https://discord.com/users/${ownerUser.id}`;
          }
        } catch {
          // leave defaults
        }
      }

      const nowPlayingEmbed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle(`${thread.name}`)
        .setURL(`https://discord.com/channels/${thread.guildId}/${thread.id}`)
        .setDescription(`New "Now Playing" Forum Post`)
        .setAuthor({
          name: authorName,
          iconURL: authorIconUrl,
          url: authorProfileUrl,
        });
      if (imageUrl) {
        nowPlayingEmbed.setImage(imageUrl);
      }

      // Add forum thread tag names as fields (if any)
      try {
        if (thread.appliedTags && thread.appliedTags.length && thread.parentId) {
          const parent = await client.channels.fetch(thread.parentId);
          if (parent && parent.type === ChannelType.GuildForum) {
            const forum = parent as ForumChannel;
            const tagNames: string[] = thread.appliedTags
              .map((id) => forum.availableTags.find((t) => t.id === id)?.name)
              .filter((n): n is string => Boolean(n));
            if (tagNames.length) {
              nowPlayingEmbed.addFields({
                name: tagNames.length > 1 ? 'Tags' : 'Tag',
                value: tagNames.join(', ').slice(0, 1024),
                inline: false,
              });
            }
          }
        }
      } catch (err) {
        console.error('Failed to resolve forum tag names:', err);
      }

      const channel = await client.channels.fetch(WHATCHA_PLAYING_CHANNEL_ID);
      if (channel && channel.isTextBased()) {
        try {
          await (channel as TextChannel).send({ embeds: [nowPlayingEmbed] });
        } catch (err) {
          console.error('Failed to send Now Playing embed:', err);
        }
      }
    }

    // Join Live Event forum threads as well
  }
}
