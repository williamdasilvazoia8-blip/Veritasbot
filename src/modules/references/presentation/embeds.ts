import { EmbedBuilder } from 'discord.js';
import { DISCORD_LIMITS, escapeDiscord, truncate } from '../../../shared/discord-text.js';
import { DOCUMENTS, formatUnitRange, type ReferenceDocumentId, type ReferenceUnit } from '../domain/types.js';

export const DOCUMENT_COLORS: Record<ReferenceDocumentId, number> = { ccc: 0x7b1fa2, cic: 0x37474f };

/** Rodapé obrigatório: documento, edição e titular dos direitos. */
export function documentAttribution(id: ReferenceDocumentId): string {
  const d = DOCUMENTS[id];
  return `${d.edition} · ${d.copyright}`;
}

/**
 * Uma embed por parágrafo/cânon (o mais longo tem ~2000 caracteres). A secção aparece em
 * letra pequena; cada uma termina com o link para a página oficial. Números sem texto na fonte são indicados.
 */
export function unitEmbeds(
  id: ReferenceDocumentId,
  units: ReferenceUnit[],
  opts: { missing?: number[]; note?: string } = {},
): EmbedBuilder[] {
  const embeds = units.map((u) => {
    const context = u.context ? `-# ${escapeDiscord(truncate(u.context, 300))}\n` : '';
    // O link vai no texto e não em setURL: o Discord junta numa só as embeds de uma mensagem
    // que têm o mesmo URL (ex.: §27-30, todos na mesma página do vatican.va) e mostra só a 1.ª.
    const url = u.sourceUrl ?? DOCUMENTS[id].sourceUrl;
    const link = /^https:\/\/[^\s()]+$/.test(url) ? `\n-# [Texto oficial](${url})` : '';
    return new EmbedBuilder()
      .setColor(DOCUMENT_COLORS[id])
      .setTitle(truncate(formatUnitRange(id, u.number), DISCORD_LIMITS.embedTitle))
      .setDescription(
        truncate(`${context}${escapeDiscord(u.text)}`, DISCORD_LIMITS.embedDescription - link.length) + link,
      );
  });
  const last = embeds.at(-1);
  if (last) {
    const notes: string[] = [];
    if (opts.missing?.length)
      notes.push(
        `Sem texto na fonte: ${opts.missing.map((n) => (id === 'ccc' ? `§${n}` : `cân. ${n}`)).join(', ')}.`,
      );
    if (opts.note) notes.push(opts.note);
    if (notes.length)
      last.setDescription(
        truncate(`${last.data.description ?? ''}\n\n-# ${notes.join(' ')}`, DISCORD_LIMITS.embedDescription),
      );
    last.setFooter({ text: truncate(documentAttribution(id), DISCORD_LIMITS.embedFooter) });
  }
  return embeds;
}
