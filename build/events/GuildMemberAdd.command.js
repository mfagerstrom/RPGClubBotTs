var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Discord, On } from "discordx";
let GuildMemberAdd = class GuildMemberAdd {
    async guildMemberAdd([member], client) {
        // auto-role assignment on member join
        let role = member.guild.roles.cache.find(r => r.name === "newcomers");
        if (role) {
            member.roles.add(role);
        }
    }
};
__decorate([
    On()
], GuildMemberAdd.prototype, "guildMemberAdd", null);
GuildMemberAdd = __decorate([
    Discord()
], GuildMemberAdd);
export { GuildMemberAdd };
