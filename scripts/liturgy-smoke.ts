/**
 * Teste de fumaça AO VIVO (opcional): consulta a API Liturgia Diária e o LitCal
 * para hoje no fuso informado e imprime um resumo. Não faz parte da suíte
 * automatizada porque depende de rede e da disponibilidade dos serviços.
 *
 *   npm run liturgy:smoke -- [America/Sao_Paulo]
 */
import { LiturgiaDiariaV2Client } from '../src/modules/liturgy/providers/liturgia-diaria/client.js';
import { LitcalClient } from '../src/modules/calendar/providers/litcal/client.js';
import { SaintsService } from '../src/modules/calendar/application/saints-service.js';
import { primaryCelebration } from '../src/modules/liturgy/domain/types.js';
import { localDate } from '../src/shared/dates.js';

const tz = process.argv[2] ?? 'America/Sao_Paulo';
const date = localDate(tz);
console.log(`Data local (${tz}): ${date}`);

try {
  const v2 = new LiturgiaDiariaV2Client({
    baseUrl: process.env.LITURGIA_API_BASE_URL ?? 'https://liturgia.up.railway.app',
    timeoutMs: 10_000,
    maxBytes: 2_000_000,
  });
  const day = await v2.getDay(date, 'pt-BR');
  const c = day ? primaryCelebration(day) : undefined;
  console.log(
    'Liturgia Diária v2:',
    c
      ? `${c.name} (${c.color}) · ${c.readings.map((r) => r.options[0]?.reference).join(' | ')}`
      : 'não encontrada (404)',
  );
} catch (err) {
  console.log('Liturgia Diária v2: FALHOU —', (err as Error).message);
}

const saints = new SaintsService(
  new LitcalClient({
    baseUrl: process.env.LITCAL_API_BASE_URL ?? 'https://litcal.johnromanodorazio.com/api/v5',
    timeoutMs: 20_000,
    maxBytes: 8_000_000,
  }),
);
const r = await saints.getDay(date, 'GENERAL', 'la', { includeWeekdays: true });
console.log(
  'LitCal:',
  r.status === 'ok'
    ? r.celebrations.map((x) => `${x.name} [${x.gradeLabel}]`).join('; ') || '(nada)'
    : `FALHOU — ${r.message}`,
);
