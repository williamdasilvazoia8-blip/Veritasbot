import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LiturgiaDiariaV2Client } from '../../../src/modules/liturgy/providers/liturgia-diaria/client.js';
import { allReadingsMessages } from '../../../src/modules/liturgy/presentation/embeds.js';
import { primaryCelebration, type LiturgicalDay } from '../../../src/modules/liturgy/domain/types.js';
import { embedLength } from '../../../src/shared/embed-pack.js';
import { fakeFetch } from '../../helpers/fake-fetch.js';

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../fixtures/liturgia/${name}`, import.meta.url), 'utf8'));

async function day(name: string, iso: string): Promise<LiturgicalDay> {
  const f = fakeFetch([{ status: 200, body: fixture(name) }]);
  return (await new LiturgiaDiariaV2Client({
    baseUrl: 'https://x',
    timeoutMs: 100,
    maxBytes: 1e6,
    fetch: f,
  }).getDay(iso, 'pt-BR'))!;
}

describe('allReadingsMessages (/liturgia leituras sem número)', () => {
  it('dia comum: as 3 leituras, por ordem, numa única mensagem', async () => {
    const d = await day('v2-dia-comum.json', '2026-10-16');
    const { messages, truncated } = allReadingsMessages(d, primaryCelebration(d)!);
    expect(truncated).toBe(false);
    expect(messages).toHaveLength(1);
    const titles = messages[0]!.map((e) => e.title?.split(' — ')[0]).filter(Boolean);
    expect(titles).toEqual(['Primeira Leitura', 'Salmo Responsorial', 'Evangelho']);
    expect(messages[0]!.map((e) => e.description).join('\n')).toContain('Ef 1, 11-14');
  });

  it('Vigília Pascal: todas as leituras e alternativas, sem passar dos limites', async () => {
    const d = await day('v2-vigilia-pascal.json', '2025-04-19');
    const c = primaryCelebration(d)!;
    const { messages } = allReadingsMessages(d, c);
    const text = messages
      .flat()
      .map((e) => e.description)
      .join('\n');
    expect(text).toContain('Gn 1, 1-2, 2 (Forma Longa)');
    expect(text).toContain('Gn 1, 1. 26-31a (Forma Breve)');
    expect(text).toContain('Rm 6, 3-11');
  });

  it('textos longos são divididos e limitados a 6 mensagens', async () => {
    const d = await day('v2-dia-comum.json', '2026-10-16');
    const c = primaryCelebration(d)!;
    const long = {
      ...c,
      readings: c.readings.map((r) => ({
        ...r,
        options: r.options.map((o) => ({ ...o, text: 'palavra '.repeat(3000) })),
      })),
    };
    const { messages, truncated } = allReadingsMessages(d, long, 6);
    expect(messages.length).toBeLessThanOrEqual(6);
    for (const m of messages) {
      expect(m.length).toBeLessThanOrEqual(10);
      expect(m.reduce((n, e) => n + embedLength(e), 0)).toBeLessThanOrEqual(6000);
    }
    expect(truncated).toBe(true);
  });
});
