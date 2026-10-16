/**
 * Normalização para comparação (nunca para armazenamento): minúsculas e sem
 * diacríticos, preservando o comprimento caractere a caractere para que índices
 * no texto normalizado correspondam ao texto original.
 */
export function foldPreservingLength(text: string): string {
  let out = '';
  for (const ch of text) {
    const folded = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    // Mantém 1:1 em unidades UTF-16; se a dobra mudar o tamanho, usa o original minúsculo.
    out +=
      folded.length === ch.length ? folded : ch.toLowerCase().length === ch.length ? ch.toLowerCase() : ch;
  }
  return out;
}

/** Normalização agressiva para busca de citações: sem acentos, pontuação ou espaços extras. */
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
