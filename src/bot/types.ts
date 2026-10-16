import type {
  AutocompleteInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { AppContext } from '../app/context.js';

export interface SlashCommand {
  data: RESTPostAPIChatInputApplicationCommandsJSONBody;
  execute(interaction: ChatInputCommandInteraction<'cached'>, ctx: AppContext): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction<'cached'>, ctx: AppContext): Promise<void>;
}

export interface ButtonHandler {
  /** Prefixo do customId, ex.: "sched" para "sched:activate:<id>". */
  prefix: string;
  execute(interaction: ButtonInteraction<'cached'>, ctx: AppContext, args: string[]): Promise<void>;
}
