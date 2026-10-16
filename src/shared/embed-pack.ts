import type { APIEmbed } from 'discord.js';
import { DISCORD_LIMITS } from './discord-text.js';

export function embedLength(e: APIEmbed): number {
  return (
    (e.title?.length ?? 0) +
    (e.description?.length ?? 0) +
    (e.footer?.text.length ?? 0) +
    (e.author?.name.length ?? 0) +
    (e.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0)
  );
}

/** Agrupa embeds em mensagens respeitando 10 embeds e 6000 caracteres por mensagem. */
export function packEmbedJson(embeds: APIEmbed[]): APIEmbed[][] {
  const out: APIEmbed[][] = [];
  let cur: APIEmbed[] = [];
  let size = 0;
  for (const e of embeds) {
    const len = embedLength(e);
    if (
      cur.length > 0 &&
      (cur.length >= DISCORD_LIMITS.embedsPerMessage || size + len > DISCORD_LIMITS.embedTotalChars - 100)
    ) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(e);
    size += len;
  }
  if (cur.length) out.push(cur);
  return out;
}
