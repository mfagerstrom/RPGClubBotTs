var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Discord, On } from "discordx";
let MessageCreated = class MessageCreated {
    async messageCreate([message], client) {
        let consoleOutputString = '';
        // time stamp
        const messageDateTime = new Date(message.createdTimestamp);
        const messageDateTimeString = messageDateTime.toLocaleString();
        consoleOutputString += `${messageDateTimeString} `;
        // user name
        const userName = message.member?.nickname?.length ? message.member?.nickname : message.member?.displayName;
        consoleOutputString += `[${userName} => `;
        // channel name (for threads)
        if (message.channel.type === 11) {
            const parentId = message.channel.parentId;
            if (parentId) {
                const parent = await client.channels.fetch(parentId);
                // @ts-ignore
                consoleOutputString += `#${parent.name}/${message.channel.name}]: `;
            }
        }
        // channel name (for regular channels)
        if (message.channel.type === 0) {
            consoleOutputString += `#${message.channel.name}]: `;
        }
        // message text
        let messageContent = message.content;
        if (messageContent === '') {
            messageContent = '(no message)';
        }
        consoleOutputString += messageContent;
        // images
        let attachment;
        if (message.attachments.size) {
            for (let x = 0; x < message.attachments.size; x++) {
                attachment = message.attachments.at(x);
                if (attachment?.contentType?.includes('image')) {
                    consoleOutputString += `\n{image embedded: '${attachment.proxyURL}'}`;
                }
            }
        }
        // does the user have the members role?
        const hasMemberRole = message.member.roles.cache.some(role => role.name === 'members');
        if (!hasMemberRole) {
            const membersRole = message.member.guild.roles.cache.find(r => r.name === 'members');
            const newcomersRole = message.member.guild.roles.cache.find(r => r.name === 'newcomers');
            if (membersRole) {
                console.log(`Granting member role to ${userName}`);
                message.member.roles.add(membersRole);
            }
            if (newcomersRole) {
                console.log(`Removing newcomers role from ${userName}`);
                message.member.roles.remove(newcomersRole);
            }
        }
        // Logging of messages, mostly for development / testing
        console.log(consoleOutputString);
    }
};
__decorate([
    On()
], MessageCreated.prototype, "messageCreate", null);
MessageCreated = __decorate([
    Discord()
], MessageCreated);
export { MessageCreated };
