import type { LiturgicalDay, Reading, ReadingOption } from '../../../domain/types.js';
import { normalizeAntiphons, normalizePrayers, slugify } from '../common.js';
import type { V2Day } from './schema.js';

type Opt = {
  referencia?: string | undefined;
  titulo?: string | undefined;
  refrao?: string | undefined;
  texto?: string | undefined;
};

function toOptions(items: Opt[] | undefined): ReadingOption[] {
  return (items ?? [])
    .filter((i): i is Opt & { texto: string } => Boolean(i.texto))
    .map((i) => ({
      ...(i.referencia ? { reference: i.referencia } : {}),
      ...(i.titulo ? { title: i.titulo } : {}),
      ...(i.refrao ? { refrain: i.refrao } : {}),
      text: i.texto,
    }));
}

/**
 * v2 tem uma única celebração e leituras agrupadas por chave. Convertemos para a
 * lista ordenada comum, preservando TODAS as alternativas e os extras (Vigília Pascal).
 * Extras vêm depois do Evangelho porque a v2 não informa sua posição na Missa.
 */
export function normalizeV2(raw: V2Day, isoDate: string): LiturgicalDay {
  const l = raw.leituras ?? {};
  const readings: Reading[] = [];
  const push = (type: string, label: string, options: ReadingOption[]) => {
    if (options.length > 0) readings.push({ order: readings.length + 1, type, label, options });
  };
  push('leitura', 'Primeira Leitura', toOptions(l.primeiraLeitura));
  push('salmo', 'Salmo Responsorial', toOptions(l.salmo));
  push('leitura', 'Segunda Leitura', toOptions(l.segundaLeitura));
  push('evangelho', 'Evangelho', toOptions(l.evangelho));
  for (const extra of l.extras ?? []) {
    push('extra', extra.tipo ?? extra.titulo ?? 'Texto adicional', toOptions([extra]));
  }
  return {
    date: isoDate,
    source: 'dancrf-liturgia-diaria',
    sourceVersion: 'v2',
    celebrations: [
      {
        id: slugify(raw.liturgia),
        name: raw.liturgia,
        isPrimary: true,
        color: raw.cor ?? null,
        prayers: normalizePrayers(raw.oracoes),
        antiphons: normalizeAntiphons(raw.antifonas),
        readings,
      },
    ],
  };
}
