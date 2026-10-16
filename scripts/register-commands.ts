/**
 * Registra os comandos de barra no Discord.
 * - Com DISCORD_GUILD_ID: registra só nesse servidor (instantâneo; ideal para desenvolvimento).
 * - Sem: registra globalmente (pode levar alguns minutos para aparecer).
 */
import { REST, Routes } from 'discord.js';
import { z } from 'zod';
import { commands } from '../src/bot/commands.js';

const env = z
  .object({
    DISCORD_TOKEN: z.string().min(1),
    DISCORD_CLIENT_ID: z.string().min(1),
    DISCORD_GUILD_ID: z.string().optional(),
  })
  .parse(process.env);

const body = commands.map((c) => c.data);
const rest = new REST().setToken(env.DISCORD_TOKEN);
const route = env.DISCORD_GUILD_ID
  ? Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID)
  : Routes.applicationCommands(env.DISCORD_CLIENT_ID);

const result = (await rest.put(route, { body })) as unknown[];
console.log(
  `${result.length} comando(s) registrado(s) ${env.DISCORD_GUILD_ID ? `no servidor ${env.DISCORD_GUILD_ID}` : 'globalmente'}.`,
);
