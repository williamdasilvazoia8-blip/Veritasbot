import { EmbedBuilder } from 'discord.js';
import type { Passage } from '../../modules/bible/application/bible-provider.js';
import { formatPassage } from '../../modules/bible/application/passage-formatter.js';
import { DISCORD_LIMITS, truncate } from '../../shared/discord-text.js';

export const BIBLE_COLOR = 0x8b6f3a;

/** Gera embeds de uma passagem (uma por página). O rodapé sempre atribui a edição. */
export function passageEmbeds(
  passage: Passage,
  opts: { maxPages?: number; heading?: string } = {},
): EmbedBuilder[] {
  const f = formatPassage(passage);
  const maxPages = opts.maxPages ?? 3;
  const pages = f.pages.slice(0, maxPages);
  return pages.map((page, i) => {
    const last = i === pages.length - 1;
    let description = page;
    if (last && f.pages.length > maxPages)
      description += '\n\n*(passagem truncada — use `/biblia passagem` com um trecho menor)*';
    if (last && f.notes.length > 0) description += `\n\n${f.notes.map((n) => `-# ${n}`).join('\n')}`;
    const embed = new EmbedBuilder()
      .setColor(BIBLE_COLOR)
      .setDescription(truncate(description, DISCORD_LIMITS.embedDescription));
    if (i === 0)
      embed.setTitle(
        truncate(opts.heading ? `${opts.heading} — ${f.title}` : f.title, DISCORD_LIMITS.embedTitle),
      );
    if (last) embed.setFooter({ text: truncate(f.footer, DISCORD_LIMITS.embedFooter) });
    return embed;
  });
}

/** Agrupa embeds em mensagens respeitando 10 embeds e 6000 caracteres por mensagem. */
export function packEmbeds(embeds: EmbedBuilder[]): EmbedBuilder[][] {
  const messages: EmbedBuilder[][] = [];
  let current: EmbedBuilder[] = [];
  let size = 0;
  for (const e of embeds) {
    const len = embedLength(e);
    if (
      current.length > 0 &&
      (current.length >= DISCORD_LIMITS.embedsPerMessage || size + len > DISCORD_LIMITS.embedTotalChars - 100)
    ) {
      messages.push(current);
      current = [];
      size = 0;
    }
    current.push(e);
    size += len;
  }
  if (current.length > 0) messages.push(current);
  return messages;
}

function embedLength(e: EmbedBuilder): number {
  const d = e.data;
  return (
    (d.title?.length ?? 0) +
    (d.description?.length ?? 0) +
    (d.footer?.text.length ?? 0) +
    (d.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0)
  );
}
