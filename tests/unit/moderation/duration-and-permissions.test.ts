import { describe, expect, it } from 'vitest';
import {
  chooseMechanism,
  computeExpiry,
  describeDuration,
  parseDuration,
  validateSpan,
} from '../../../src/modules/moderation/domain/duration.js';
import {
  checkModerationHierarchy,
  checkRoleMute,
  type MemberSnapshot,
} from '../../../src/modules/moderation/domain/permissions.js';

const parts = (s: string) => {
  const r = parseDuration(s);
  if (!r.ok) throw new Error(r.error);
  return r.parts;
};
const at = (iso: string) => new Date(iso);

describe('parseDuration', () => {
  it.each([
    ['30s', [{ value: 30, unit: 's' }]],
    ['10min', [{ value: 10, unit: 'min' }]],
    ['2h', [{ value: 2, unit: 'h' }]],
    ['7d', [{ value: 7, unit: 'd' }]],
    ['1mo', [{ value: 1, unit: 'mo' }]],
    ['1y', [{ value: 1, unit: 'y' }]],
    [
      '1d12h',
      [
        { value: 1, unit: 'd' },
        { value: 12, unit: 'h' },
      ],
    ],
    ['2 meses', [{ value: 2, unit: 'mo' }]],
  ])('%s', (input, expected) => {
    expect(parts(input)).toEqual(expected);
  });

  it('rejeita "m" ambíguo com explicação', () => {
    const r = parseDuration('5m');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/min.*mo/);
  });

  it.each(['', 'abc', '0h', '3x'])('rejeita "%s"', (input) => {
    expect(parseDuration(input).ok).toBe(false);
  });

  it('descreve em português', () => {
    expect(describeDuration(parts('1d12h'))).toBe('1 dia e 12 horas');
  });
});

describe('computeExpiry — aritmética de calendário', () => {
  it('1 mês a partir de 31/01 termina no fim de fevereiro', () => {
    expect(computeExpiry(parts('1mo'), at('2027-01-31T15:00:00Z'), 'UTC').toISOString()).toBe(
      '2027-02-28T15:00:00.000Z',
    );
    expect(computeExpiry(parts('1mo'), at('2028-01-31T15:00:00Z'), 'UTC').toISOString()).toBe(
      '2028-02-29T15:00:00.000Z',
    );
  });

  it('1 ano a partir de 29/02 vai para 28/02', () => {
    expect(computeExpiry(parts('1y'), at('2028-02-29T12:00:00Z'), 'UTC').toISOString()).toBe(
      '2029-02-28T12:00:00.000Z',
    );
  });

  it('meses respeitam o fuso documentado (dia civil local)', () => {
    // 31/01 23:30 em São Paulo = 01/02 02:30 UTC; +1 mês no fuso local → 28/02 23:30 local
    expect(computeExpiry(parts('1mo'), at('2027-02-01T02:30:00Z'), 'America/Sao_Paulo').toISOString()).toBe(
      '2027-03-01T02:30:00.000Z',
    );
  });

  it('dias atravessando horário de verão mantêm a hora local', () => {
    // Lisboa: 2027-03-28 muda de +0 para +1
    expect(computeExpiry(parts('1d'), at('2027-03-27T12:00:00Z'), 'Europe/Lisbon').toISOString()).toBe(
      '2027-03-28T11:00:00.000Z',
    );
  });
});

describe('escolha do mecanismo', () => {
  const now = at('2026-10-16T12:00:00Z');
  it('até 28 dias usa timeout nativo', () => {
    expect(chooseMechanism(now, computeExpiry(parts('30s'), now, 'UTC'))).toBe('NATIVE_TIMEOUT');
    expect(chooseMechanism(now, computeExpiry(parts('28d'), now, 'UTC'))).toBe('NATIVE_TIMEOUT');
  });
  it('acima de 28 dias usa cargo', () => {
    expect(chooseMechanism(now, computeExpiry(parts('29d'), now, 'UTC'))).toBe('MUTED_ROLE');
    expect(chooseMechanism(now, computeExpiry(parts('1y'), now, 'UTC'))).toBe('MUTED_ROLE');
  });
  it('limites mínimo e máximo', () => {
    expect(validateSpan(now, computeExpiry(parts('2s'), now, 'UTC'))).toMatch(/mínima/);
    expect(validateSpan(now, computeExpiry(parts('11y'), now, 'UTC'))).toMatch(/máxima/);
    expect(validateSpan(now, computeExpiry(parts('10y'), now, 'UTC'))).toBeNull();
  });
});

const m = (over: Partial<MemberSnapshot>): MemberSnapshot => ({
  id: 'x',
  isOwner: false,
  isAdministrator: false,
  highestRolePosition: 1,
  hasPermission: true,
  ...over,
});

describe('checkModerationHierarchy', () => {
  const actor = m({ id: 'mod', highestRolePosition: 5 });
  const bot = m({ id: 'bot', highestRolePosition: 10 });

  it('permite moderar membro abaixo do moderador e do bot', () => {
    expect(
      checkModerationHierarchy({
        actor,
        bot,
        target: m({ id: 't', highestRolePosition: 2 }),
        permissionLabel: 'P',
      }).ok,
    ).toBe(true);
  });
  it('bloqueia sem permissão do moderador ou do bot', () => {
    expect(
      checkModerationHierarchy({
        actor: { ...actor, hasPermission: false },
        bot,
        target: null,
        permissionLabel: 'P',
      }).ok,
    ).toBe(false);
    expect(
      checkModerationHierarchy({
        actor,
        bot: { ...bot, hasPermission: false },
        target: null,
        permissionLabel: 'P',
      }).ok,
    ).toBe(false);
  });
  it('bloqueia alvo igual/superior ao moderador ou ao bot', () => {
    expect(
      checkModerationHierarchy({
        actor,
        bot,
        target: m({ id: 't', highestRolePosition: 5 }),
        permissionLabel: 'P',
      }).ok,
    ).toBe(false);
    expect(
      checkModerationHierarchy({
        actor: { ...actor, isOwner: true, highestRolePosition: 50 },
        bot,
        target: m({ id: 't', highestRolePosition: 10 }),
        permissionLabel: 'P',
      }).ok,
    ).toBe(false);
  });
  it('dono do servidor, o próprio moderador e o bot não são alvos', () => {
    expect(
      checkModerationHierarchy({
        actor,
        bot,
        target: m({ id: 'o', isOwner: true, highestRolePosition: 0 }),
        permissionLabel: 'P',
      }).ok,
    ).toBe(false);
    expect(checkModerationHierarchy({ actor, bot, target: m({ id: 'mod' }), permissionLabel: 'P' }).ok).toBe(
      false,
    );
    expect(checkModerationHierarchy({ actor, bot, target: m({ id: 'bot' }), permissionLabel: 'P' }).ok).toBe(
      false,
    );
  });
  it('dono pode moderar qualquer cargo abaixo do bot', () => {
    expect(
      checkModerationHierarchy({
        actor: { ...actor, isOwner: true, highestRolePosition: 0 },
        bot,
        target: m({ id: 't', highestRolePosition: 8 }),
        permissionLabel: 'P',
      }).ok,
    ).toBe(true);
  });
});

describe('checkRoleMute', () => {
  const base = {
    target: m({}),
    mutedRole: { id: 'r', position: 3 },
    botHighestRolePosition: 10,
    botCanManageRoles: true,
  };
  it('exige cargo configurado, Gerenciar Cargos e hierarquia', () => {
    expect(checkRoleMute(base).ok).toBe(true);
    expect(checkRoleMute({ ...base, mutedRole: null }).ok).toBe(false);
    expect(checkRoleMute({ ...base, botCanManageRoles: false }).ok).toBe(false);
    expect(checkRoleMute({ ...base, mutedRole: { id: 'r', position: 10 } }).ok).toBe(false);
  });
  it('recusa administradores (o cargo não os restringiria)', () => {
    const r = checkRoleMute({ ...base, target: m({ isAdministrator: true }) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Administrador/);
  });
});
