import type { LiturgicalDay } from '../../../domain/types.js';
import { normalizeAntiphons, normalizePrayers, slugify } from '../common.js';
import type { V3Day } from './schema.js';

/** v3: várias celebrações; preserva `principal`, ordem (`ordem`) e alternativas (`opcoes`). */
export function normalizeV3(raw: V3Day, isoDate: string): LiturgicalDay {
  const anyPrimary = raw.celebracoes.some((c) => c.principal === true);
  return {
    date: isoDate,
    source: 'dancrf-liturgia-diaria',
    sourceVersion: 'v3',
    celebrations: raw.celebracoes.map((c, i) => ({
      id: c.id ?? slugify(c.liturgia),
      name: c.liturgia,
      // Se o provedor não marcar nenhuma, a primeira é tratada como principal.
      isPrimary: anyPrimary ? c.principal === true : i === 0,
      color: c.cor ?? null,
      prayers: normalizePrayers(c.oracoes),
      antiphons: normalizeAntiphons(c.antifonas),
      readings: [...c.leituras]
        .sort((a, b) => a.ordem - b.ordem)
        .map((r) => ({
          order: r.ordem,
          type: r.tipo,
          label: r.rotulo ?? r.tipo,
          options: r.opcoes
            .filter((o): o is typeof o & { texto: string } => Boolean(o.texto))
            .map((o) => ({
              ...(o.referencia ? { reference: o.referencia } : {}),
              ...(o.titulo ? { title: o.titulo } : {}),
              ...(o.refrao ? { refrain: o.refrao } : {}),
              text: o.texto,
            })),
        }))
        .filter((r) => r.options.length > 0),
    })),
  };
}
