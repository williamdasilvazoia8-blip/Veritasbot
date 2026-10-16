import { readFileSync } from 'node:fs';
import { afterAll, beforeEach, expect, it } from 'vitest';
import { describeDb, resetDb, testPrisma } from '../helpers/db.js';
import { InMemoryJobScheduler } from '../../src/jobs/in-memory-scheduler.js';
import { AuditService } from '../../src/modules/audit/audit-service.js';
import { GuildSettingsService } from '../../src/modules/guild-settings/settings-service.js';
import { ScheduleService, scheduleJobId } from '../../src/modules/scheduling/application/schedule-service.js';
import { DeliveryService, nonceFor } from '../../src/modules/scheduling/application/delivery-service.js';
import { ScheduledMessageRenderer } from '../../src/modules/scheduling/application/renderer.js';
import {
  SendError,
  type MessageSender,
  type OutgoingMessage,
} from '../../src/modules/scheduling/application/types.js';
import { LiturgyService } from '../../src/modules/liturgy/application/liturgy-service.js';
import { LiturgiaDiariaV2Client } from '../../src/modules/liturgy/providers/liturgia-diaria/client.js';
import { SaintsService } from '../../src/modules/calendar/application/saints-service.js';
import { LitcalClient } from '../../src/modules/calendar/providers/litcal/client.js';
import { fakeFetch, noSleep } from '../helpers/fake-fetch.js';

const fixture = (p: string) => JSON.parse(readFileSync(new URL(`../fixtures/${p}`, import.meta.url), 'utf8'));

class FakeSender implements MessageSender {
  sent: Array<{ channelId: string; message: OutgoingMessage; nonce: string }> = [];
  failWith: Error | null = null;
  failAfter = Infinity;
  async send(channelId: string, message: OutgoingMessage, nonce: string) {
    if (this.failWith && this.sent.length >= this.failAfter) throw this.failWith;
    this.sent.push({ channelId, message, nonce });
    return { messageId: `msg${this.sent.length}` };
  }
}

describeDb('Agendamentos (PostgreSQL)', () => {
  const prisma = testPrisma();
  let clock: Date;
  let jobs: InMemoryJobScheduler;
  let sender: FakeSender;
  let schedules: ScheduleService;
  let delivery: DeliveryService;
  let settings: GuildSettingsService;
  let liturgyFetch: ReturnType<typeof fakeFetch>;
  let litcalFetch: ReturnType<typeof fakeFetch>;
  const failures: string[] = [];

  const build = () => {
    const audit = new AuditService(prisma);
    settings = new GuildSettingsService(
      prisma,
      audit,
      { locale: 'pt-BR', timezone: 'America/Sao_Paulo', liturgyApiVersion: 'v2', bibleAutoReferences: true },
      0,
    );
    const liturgy = new LiturgyService({
      providers: {
        v2: new LiturgiaDiariaV2Client({
          baseUrl: 'https://lit',
          timeoutMs: 500,
          maxBytes: 1e6,
          fetch: liturgyFetch,
          sleep: noSleep,
          maxAttempts: 1,
        }),
      },
      defaultVersion: 'v2',
      v3Enabled: false,
    });
    const saints = new SaintsService(
      new LitcalClient({
        baseUrl: 'https://litcal/api/v5',
        timeoutMs: 500,
        maxBytes: 5e6,
        fetch: litcalFetch,
        sleep: noSleep,
        maxAttempts: 1,
      }),
    );
    schedules = new ScheduleService(prisma, jobs, audit, () => clock);
    delivery = new DeliveryService(
      prisma,
      schedules,
      jobs,
      sender,
      new ScheduledMessageRenderer(settings, liturgy, saints),
      {
        onPermanentFailure: async (_s, e) => void failures.push(e),
      },
    );
  };
  const handlers = () => ({
    'schedule-delivery': async ({
      scheduleId,
      occurrenceKey,
    }: {
      scheduleId: string;
      occurrenceKey: string;
    }) => void (await delivery.deliver(scheduleId, occurrenceKey)),
  });
  const text = (content: string) => ({ content, mentionRoleIds: [] });

  beforeEach(async () => {
    await resetDb(prisma);
    clock = new Date('2026-10-16T12:00:00Z');
    jobs = new InMemoryJobScheduler();
    sender = new FakeSender();
    liturgyFetch = fakeFetch([{ status: 200, body: fixture('liturgia/v2-dia-comum.json') }]);
    litcalFetch = fakeFetch([{ status: 200, body: fixture('litcal/general-2024-excerpt.json') }]);
    failures.length = 0;
    build();
  });
  afterAll(() => prisma.$disconnect());

  async function createActive(over: Partial<Parameters<ScheduleService['createDraft']>[0]> = {}) {
    const d = await schedules.createDraft({
      guildId: 'g1',
      channelId: 'c1',
      creatorId: 'admin',
      kind: 'TEXT',
      payload: text('Angelus'),
      timezone: 'Europe/Lisbon',
      startLocal: '2026-10-17T12:00',
      recurrence: 'DAILY',
      ...over,
    });
    if (!d.ok) throw new Error(d.error);
    expect(d.schedule.status).toBe('DRAFT');
    expect(jobs.jobs.size).toBe(0); // rascunho não agenda nada antes da ativação
    const a = await schedules.activate('g1', d.schedule.id, 'admin');
    if (!a.ok) throw new Error(a.error);
    return a;
  }

  it('entrega no instante local correto e agenda a próxima ocorrência', async () => {
    const { schedule, next } = await createActive();
    expect(next!.runAt.toISOString()).toBe('2026-10-17T11:00:00.000Z'); // 12:00 em Lisboa (+1)
    clock = new Date('2026-10-17T11:00:00Z');
    await jobs.runDue(clock, handlers());
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]!.message.content).toBe('Angelus');
    expect(sender.sent[0]!.nonce).toBe(nonceFor(schedule.id, '2026-10-17T12:00', 0));
    const after = await prisma.scheduledMessage.findUniqueOrThrow({ where: { id: schedule.id } });
    expect(after.nextOccurrenceKey).toBe('2026-10-18T12:00');
    expect(jobs.jobs.has(scheduleJobId(schedule.id, '2026-10-18T12:00'))).toBe(true);
    // depois da mudança de horário (25/10) continua às 12:00 locais
    const d = await prisma.scheduledDelivery.findFirstOrThrow({ where: { scheduledMessageId: schedule.id } });
    expect(d).toMatchObject({ status: 'DELIVERED', discordMessageId: 'msg1', partsSent: 1 });
  });

  it('processamento duplicado da mesma ocorrência não reenvia', async () => {
    const { schedule } = await createActive();
    clock = new Date('2026-10-17T11:00:00Z');
    await delivery.deliver(schedule.id, '2026-10-17T12:00');
    expect(await delivery.deliver(schedule.id, '2026-10-17T12:00')).toBe('stale');
    expect(sender.sent).toHaveLength(1);
  });

  it('edição torna o job antigo obsoleto', async () => {
    const { schedule } = await createActive();
    const e = await schedules.edit('g1', schedule.id, 'admin', { startLocal: '2026-10-17T18:00' });
    expect(e.ok && e.next?.key).toBe('2026-10-17T18:00');
    expect(await delivery.deliver(schedule.id, '2026-10-17T12:00')).toBe('stale');
    expect(sender.sent).toHaveLength(0);
  });

  it('pausar/cancelar impede o envio; retomar recalcula a próxima ocorrência', async () => {
    const { schedule } = await createActive();
    await schedules.pause('g1', schedule.id, 'admin');
    expect(await delivery.deliver(schedule.id, '2026-10-17T12:00')).toBe('stale');
    clock = new Date('2026-10-20T00:00:00Z');
    const r = await schedules.activate('g1', schedule.id, 'admin');
    expect(r.ok && r.next?.key).toBe('2026-10-20T12:00');
    await schedules.cancel('g1', schedule.id, 'admin');
    expect((await schedules.activate('g1', schedule.id, 'admin')).ok).toBe(false);
  });

  it('falha permanente (canal apagado/sem permissão) suspende com status visível', async () => {
    const { schedule } = await createActive();
    sender.failWith = new SendError('Unknown Channel', true);
    sender.failAfter = 0;
    expect(await delivery.deliver(schedule.id, '2026-10-17T12:00')).toBe('permanent-failure');
    const s = await prisma.scheduledMessage.findUniqueOrThrow({ where: { id: schedule.id } });
    expect(s).toMatchObject({ status: 'ERROR', lastError: 'Unknown Channel' });
    expect(failures).toEqual(['Unknown Channel']);
  });

  it('falha transitória é relançada (fila repete) e a nova tentativa usa o mesmo nonce', async () => {
    const { schedule } = await createActive();
    sender.failWith = new Error('ECONNRESET');
    sender.failAfter = 0;
    await expect(delivery.deliver(schedule.id, '2026-10-17T12:00')).rejects.toThrow('ECONNRESET');
    sender.failWith = null;
    expect(await delivery.deliver(schedule.id, '2026-10-17T12:00')).toBe('delivered');
    const d = await prisma.scheduledDelivery.findFirstOrThrow({ where: { scheduledMessageId: schedule.id } });
    expect(d.attempts).toBe(2);
  });

  it('ocorrência única é concluída após o envio', async () => {
    const { schedule } = await createActive({
      recurrence: 'ONCE',
      startLocal: '2026-12-08T08:00',
      timezone: 'America/Sao_Paulo',
    });
    clock = new Date('2026-12-08T11:00:00Z');
    await jobs.runDue(clock, handlers());
    expect((await prisma.scheduledMessage.findUniqueOrThrow({ where: { id: schedule.id } })).status).toBe(
      'COMPLETED',
    );
  });

  it('reinício: reconstrói a fila; perdidos além da tolerância são SKIPPED', async () => {
    const { schedule } = await createActive();
    jobs = new InMemoryJobScheduler();
    build();
    clock = new Date('2026-10-17T12:00:00Z'); // 1h de atraso, dentro da tolerância de 6h
    expect(await schedules.reconcile(6 * 3600_000)).toEqual({ enqueued: 1, skipped: 0 });
    await jobs.runDue(clock, handlers());
    expect(sender.sent).toHaveLength(1);

    jobs = new InMemoryJobScheduler();
    build();
    clock = new Date('2026-10-19T00:00:00Z'); // ocorrência de 18/10 perdida há >6h
    expect(await schedules.reconcile(6 * 3600_000)).toEqual({ enqueued: 1, skipped: 1 });
    const skipped = await prisma.scheduledDelivery.findFirst({
      where: { scheduledMessageId: schedule.id, status: 'SKIPPED' },
    });
    expect(skipped?.occurrenceKey).toBe('2026-10-18T12:00');
    expect(
      (await prisma.scheduledMessage.findUniqueOrThrow({ where: { id: schedule.id } })).nextOccurrenceKey,
    ).toBe('2026-10-19T12:00');
  });

  it('isolamento por servidor', async () => {
    const { schedule } = await createActive();
    expect(await schedules.get('g2', schedule.id)).toBeNull();
    expect((await schedules.cancel('g2', schedule.id, 'intruso')).ok).toBe(false);
  });

  describe_daily();

  function describe_daily() {
    it('anúncio diário: busca leituras e santos na data REAL da ocorrência', async () => {
      // 16/10/2024 é a data dos fixtures (LitCal real: Sta. Edwiges e Sta. Margarida Maria).
      clock = new Date('2024-10-15T12:00:00Z');
      liturgyFetch = fakeFetch([
        { status: 200, body: { ...fixture('liturgia/v2-dia-comum.json'), data: '16/10/2024' } },
      ]);
      build();
      const { schedule, next } = await createActive({
        kind: 'LITURGY_DAILY',
        payload: { offsetDays: 0, readings: 'gospel', saints: true, optionalMemorials: true },
        timezone: 'America/Sao_Paulo',
        startLocal: '2024-10-15T07:00',
      });
      expect(next!.key).toBe('2024-10-16T07:00');
      clock = new Date('2024-10-16T10:00:00Z');
      await jobs.runDue(clock, handlers());

      expect(liturgyFetch.calls).toContain('https://lit/v2/?dia=16&mes=10&ano=2024');
      expect(litcalFetch.calls).toEqual(['https://litcal/api/v5/calendar/2024?year_type=CIVIL']);
      expect(sender.sent.length).toBeGreaterThanOrEqual(2); // resumo + santos, depois o Evangelho
      const first = sender.sent[0]!.message;
      expect(first.content).toContain('16 de outubro de 2024');
      const allEmbeds = sender.sent.flatMap(
        (s) =>
          (s.message.embeds ?? []) as Array<{
            title?: string;
            description?: string;
            footer?: { text: string };
          }>,
      );
      expect(allEmbeds.find((e) => e.title?.startsWith('Santos'))?.description).toContain('Sancti Hedvigis');
      const gospel = allEmbeds.find((e) => e.title?.startsWith('Evangelho'));
      expect(gospel?.footer?.text).toContain('não da tradução Matos Soares');
      expect(sender.sent.every((s) => s.message.allowedRoleIds.length === 0)).toBe(true);
      const d = await prisma.scheduledDelivery.findFirstOrThrow({
        where: { scheduledMessageId: schedule.id },
      });
      expect(d.partsSent).toBe(sender.sent.length);
      expect(d.discordMessageId?.split(',')).toHaveLength(sender.sent.length);
    });

    it('anúncio em várias partes retoma de onde parou, sem repetir', async () => {
      clock = new Date('2024-10-15T12:00:00Z');
      liturgyFetch = fakeFetch([
        { status: 200, body: { ...fixture('liturgia/v2-dia-comum.json'), data: '16/10/2024' } },
      ]);
      build();
      const { schedule } = await createActive({
        kind: 'LITURGY_DAILY',
        payload: { offsetDays: 0, readings: 'full', saints: true, optionalMemorials: true },
        timezone: 'America/Sao_Paulo',
        startLocal: '2024-10-15T07:00',
      });
      clock = new Date('2024-10-16T10:00:00Z');
      sender.failWith = new Error('rede caiu');
      sender.failAfter = 1;
      await expect(delivery.deliver(schedule.id, '2024-10-16T07:00')).rejects.toThrow('rede caiu');
      expect(sender.sent).toHaveLength(1);
      sender.failWith = null;
      expect(await delivery.deliver(schedule.id, '2024-10-16T07:00')).toBe('delivered');
      const nonces = sender.sent.map((s) => s.nonce);
      expect(new Set(nonces).size).toBe(nonces.length); // nenhuma parte repetida
      expect(nonces[1]).toBe(nonceFor(schedule.id, '2024-10-16T07:00', 1));
    });

    it('provedores fora do ar: tenta de novo e, depois, publica aviso honesto', async () => {
      clock = new Date('2026-10-16T12:00:00Z');
      liturgyFetch = fakeFetch([{ status: 503 }]);
      litcalFetch = fakeFetch([{ status: 503 }]);
      build();
      const { schedule } = await createActive({
        kind: 'LITURGY_DAILY',
        payload: { offsetDays: 1, readings: 'references', saints: true },
        startLocal: '2026-10-16T20:00',
        timezone: 'America/Sao_Paulo',
      });
      clock = new Date('2026-10-16T23:00:00Z');
      for (let i = 0; i < 2; i++)
        await expect(delivery.deliver(schedule.id, '2026-10-16T20:00')).rejects.toThrow(/indisponível/);
      expect(await delivery.deliver(schedule.id, '2026-10-16T20:00')).toBe('delivered');
      const msg = sender.sent[0]!.message;
      expect(msg.content).toContain('Liturgia de amanhã');
      expect(msg.content).toContain('17 de outubro de 2026'); // véspera: dia seguinte ao da ocorrência
      const embeds = msg.embeds as Array<{ description?: string }>;
      expect(embeds.map((e) => e.description).join(' ')).toMatch(/indisponível/);
    });
  }
});
