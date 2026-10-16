/**
 * Utilitários para texto enviado ao Discord: escape de markdown, quebra segura
 * em blocos e limites atuais da plataforma.
 */

export const DISCORD_LIMITS = {
  messageContent: 2000,
  embedDescription: 4096,
  embedTitle: 256,
  embedFieldValue: 1024,
  embedFieldName: 256,
  embedFooter: 2048,
  embedsPerMessage: 10,
  embedTotalChars: 6000,
} as const;

/** Escapa markdown e neutraliza menções em texto vindo de usuários ou provedores externos. */
export function escapeDiscord(text: string): string {
  return text
    .replace(/([\\*_~`|[\]])/g, '\\$1')
    .replace(/^(\s*)([>#-])/gm, '$1\\$2')
    .replace(/^(\s*\d+)\./gm, '$1\\.')
    .replace(/@(everyone|here)/gi, '@​$1')
    .replace(/<([@#][!&]?\d+)>/g, '<​$1>');
}

/** Corta texto para caber em `max` caracteres, acrescentando reticências. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * Divide texto em blocos de até `max` caracteres, preferindo quebrar em parágrafos,
 * depois em linhas, depois em espaços. Nunca corta no meio de uma palavra se houver espaço.
 */
export function splitText(text: string, max: number): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = window.lastIndexOf('\n\n');
    if (cut < max * 0.5) cut = window.lastIndexOf('\n');
    if (cut < max * 0.5) cut = window.lastIndexOf(' ');
    if (cut <= 0) cut = max;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

/** Nenhuma menção é processada; usar em toda resposta com texto de usuário/provedor. */
export const NO_MENTIONS = { parse: [] as never[], repliedUser: false };
