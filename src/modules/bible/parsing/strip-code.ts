/**
 * Substitui blocos de código (```...```) e trechos `inline` por espaços,
 * preservando os índices do texto original. Referências dentro de código são ignoradas.
 */
export function blankOutCode(text: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ');
  return text.replace(/```[\s\S]*?(```|$)/g, blank).replace(/`[^`\n]*`/g, blank);
}
