var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Discord, On } from "discordx";
let MessageDeleted = class MessageDeleted {
    messageDelete([_message], _client) {
        void _message;
        void _client;
        /*
        const userName: string | undefined =
          message.member?.nickname?.length ? message.member?.nickname : message.member?.displayName;
      console.log("Message Deleted", userName, message.content);
      */
    }
};
__decorate([
    On()
], MessageDeleted.prototype, "messageDelete", null);
MessageDeleted = __decorate([
    Discord()
], MessageDeleted);
export { MessageDeleted };
