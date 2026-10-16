import { afterAll, beforeEach, expect, it } from 'vitest';
import { describeDb, resetDb, testPrisma } from '../helpers/db.js';
import { MuteService, muteJobId } from '../../src/modules/moderation/application/mute-service.js';
import type { MuteGateway } from '../../src/modules/moderation/application/mute-gateway.js';
import { InMemoryJobScheduler } from '../../src/jobs/in-memory-scheduler.js';

class FakeGateway implements MuteGateway {
  timeouts = new Map<string, Date | null>();
  roles = new Map<string, Set<string>>();
  present = new Set(['target']);
  failNext = false;
  async applyTimeout(_g: string, u: string, until: Date) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('Missing Permissions');
    }
    this.timeouts.set(u, until);
  }
  async clearTimeout(_g: string, u: string) {
    this.timeouts.set(u, null);
    return 'ok' as const;
  }
  async addRole(_g: string, u: string, r: string) {
    if (!this.present.has(u)) return 'member-missing' as const;
    (this.roles.get(u) ?? this.roles.set(u, new Set()).get(u)!).add(r);
    return 'ok' as const;
  }
  async removeRole(_g: string, u: string, r: string) {
    if (!this.present.has(u)) return 'member-missing' as const;
    this.roles.get(u)?.delete(r);
    return 'ok' as const;
  }
  hasRole(u: string, r: string) {
    return this.roles.get(u)?.has(r) ?? false;
  }
}

describeDb('MuteService (PostgreSQL)', () => {
  const prisma = testPrisma();
  let gw: FakeGateway;
  let jobs: InMemoryJobScheduler;
  let svc: MuteService;
  const now = new Date('2026-10-16T12:00:00Z');
  const base = {
    guildId: 'g1',
    targetUserId: 'target',
    actorUserId: 'mod',
    reason: 'teste',
    timezone: 'America/Sao_Paulo',
    mutedRoleId: 'muted',
    now,
  };

  beforeEach(async () => {
    await resetDb(prisma);
    gw = new FakeGateway();
    jobs = new InMemoryJobScheduler();
    svc = new MuteService(prisma, gw, jobs);
  });
  afterAll(() => prisma.$disconnect());

  it('mute curto usa timeout nativo, agenda liberação e expira', async () => {
    const r = await svc.mute({ ...base, durationInput: '30s' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.action.mechanism).toBe('NATIVE_TIMEOUT');
    expect(gw.timeouts.get('target')?.toISOString()).toBe('2026-10-16T12:00:30.000Z');
    expect(jobs.jobs.has(muteJobId(r.action.id))).toBe(true);

    await jobs.runDue(new Date('2026-10-16T12:00:31Z'), {
      'mute-release': ({ actionId }) =>
        svc.release(actionId, { now: new Date('2026-10-16T12:00:31Z') }).then(() => undefined),
    });
    expect((await prisma.moderationAction.findUnique({ where: { id: r.action.id } }))?.status).toBe(
      'EXPIRED',
    );
  });

  it('mute de 1 ano usa o cargo (não um timeout nativo inválido)', async () => {
    const r = await svc.mute({ ...base, durationInput: '1y' });
    expect(r.ok && r.action.mechanism).toBe('MUTED_ROLE');
    expect(gw.hasRole('target', 'muted')).toBe(true);
    expect(gw.timeouts.has('target')).toBe(false);
    if (r.ok) expect(r.action.expiresAt?.toISOString()).toBe('2027-10-16T12:00:00.000Z');
  });

  it('sem cargo configurado, mute longo é recusado com explicação', async () => {
    const r = await svc.mute({ ...base, mutedRoleId: null, durationInput: '2mo' });
    expect(r).toMatchObject({ ok: false });
    expect(await prisma.moderationAction.count()).toBe(0);
  });

  it('job antigo não libera alguém que recebeu um mute posterior', async () => {
    const first = await svc.mute({ ...base, durationInput: '35d' });
    const second = await svc.mute({ ...base, durationInput: '60d', now: new Date('2026-10-17T12:00:00Z') });
    if (!first.ok || !second.ok) throw new Error('esperava ok');
    expect(second.superseded).toBe(1);
    // O job do primeiro dispara na data original: não deve fazer nada.
    expect(await svc.release(first.action.id, { now: new Date('2026-11-20T13:00:00Z') })).toBe('noop');
    expect(gw.hasRole('target', 'muted')).toBe(true);
    expect((await svc.activeMute('g1', 'target'))?.id).toBe(second.action.id);
  });

  it('troca de mecanismo desfaz o anterior (cargo → timeout)', async () => {
    await svc.mute({ ...base, durationInput: '60d' });
    const r = await svc.mute({ ...base, durationInput: '1h' });
    expect(r.ok && r.action.mechanism).toBe('NATIVE_TIMEOUT');
    expect(gw.hasRole('target', 'muted')).toBe(false);
  });

  it('falha no Discord marca FAILED e restaura o mute anterior', async () => {
    const first = await svc.mute({ ...base, durationInput: '2h' });
    gw.failNext = true;
    const second = await svc.mute({ ...base, durationInput: '3h' });
    expect(second.ok).toBe(false);
    expect((await svc.activeMute('g1', 'target'))?.id).toBe(first.ok && first.action.id);
    expect(await prisma.moderationAction.count({ where: { status: 'FAILED' } })).toBe(1);
  });

  it('unmute manual remove o mecanismo e cancela o job', async () => {
    const r = await svc.mute({ ...base, durationInput: '60d' });
    if (!r.ok) throw new Error();
    const released = await svc.unmute('g1', 'target', 'mod2', 'perdão');
    expect(released?.id).toBe(r.action.id);
    expect(gw.hasRole('target', 'muted')).toBe(false);
    expect(jobs.jobs.has(muteJobId(r.action.id))).toBe(false);
    expect(await prisma.moderationAction.findUnique({ where: { id: r.action.id } })).toMatchObject({
      status: 'RELEASED',
      releasedById: 'mod2',
    });
  });

  it('reconciliação após reinício: libera vencidos e reagenda ativos', async () => {
    const short = await svc.mute({ ...base, targetUserId: 'target', durationInput: '35d' });
    gw.present.add('other');
    const long = await svc.mute({ ...base, targetUserId: 'other', durationInput: '1y' });
    if (!short.ok || !long.ok) throw new Error();
    // "Reinício": nova fila vazia e novo serviço.
    const freshJobs = new InMemoryJobScheduler();
    const restarted = new MuteService(prisma, gw, freshJobs);
    const res = await restarted.reconcile(new Date('2026-12-01T00:00:00Z'));
    expect(res).toEqual({ expired: 1, rescheduled: 1 });
    expect(gw.hasRole('target', 'muted')).toBe(false);
    expect(gw.hasRole('other', 'muted')).toBe(true);
    expect(freshJobs.jobs.has(muteJobId(long.action.id))).toBe(true);
  });

  it('reentrada reaplica o cargo; remoção manual no Discord encerra o registro', async () => {
    await svc.mute({ ...base, durationInput: '60d' });
    gw.roles.get('target')!.clear(); // saiu e voltou sem o cargo
    expect(await svc.onMemberRejoin('g1', 'target', now)).toBe(true);
    expect(gw.hasRole('target', 'muted')).toBe(true);
    expect(await svc.onManualRemoval('g1', 'target', 'MUTED_ROLE', now)).toBe(true);
    expect(await svc.activeMute('g1', 'target')).toBeNull();
  });

  it('dados isolados por servidor', async () => {
    await svc.mute({ ...base, durationInput: '1h' });
    expect(await svc.activeMute('g2', 'target')).toBeNull();
  });
});
