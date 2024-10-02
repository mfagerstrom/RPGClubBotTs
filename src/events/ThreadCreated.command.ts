import type { ArgsOf, Client } from "discordx";
import { Discord, On } from "discordx";

@Discord()
export class ThreadCreated {
  @On()
  threadCreate([thread]: ArgsOf<"threadCreate">, client: Client): void {
    
  }
}