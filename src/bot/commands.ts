import type { ButtonHandler, SlashCommand } from './types.js';
import { bibliaCommand } from '../modules/bible/commands/biblia.js';
import { liturgiaCommand } from '../modules/liturgy/commands/liturgia.js';
import { calendarioCommand } from '../modules/liturgy/commands/calendario.js';
import { moderationCommands } from '../modules/moderation/commands/moderation-commands.js';
import { agendarCommand, scheduleButtons } from '../modules/scheduling/commands/agendar.js';
import { configCommand } from '../modules/guild-settings/config-command.js';
import {
  catecismoCommand,
  direitoCanonicoCommand,
} from '../modules/references/commands/reference-commands.js';

export const commands: SlashCommand[] = [
  bibliaCommand,
  liturgiaCommand,
  calendarioCommand,
  catecismoCommand,
  direitoCanonicoCommand,
  agendarCommand,
  configCommand,
  ...moderationCommands,
];

export const buttons: ButtonHandler[] = [scheduleButtons];
