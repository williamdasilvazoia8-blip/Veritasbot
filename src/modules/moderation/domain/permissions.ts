/** Instantâneo mínimo de um membro, extraído do discord.js para regras puras e testáveis. */
export interface MemberSnapshot {
  id: string;
  isOwner: boolean;
  isAdministrator: boolean;
  highestRolePosition: number;
  hasPermission: boolean;
}

export type HierarchyCheck = { ok: true } | { ok: false; reason: string };

/**
 * Regras aplicadas a TODA ação de moderação contra um membro:
 * - quem executa tem a permissão exigida;
 * - o bot tem a permissão exigida;
 * - ninguém modera a si mesmo, o dono do servidor ou o próprio bot;
 * - o cargo mais alto do moderador (salvo o dono) e o do bot devem estar acima do alvo.
 */
export function checkModerationHierarchy(params: {
  actor: MemberSnapshot;
  bot: MemberSnapshot;
  target: MemberSnapshot | null;
  permissionLabel: string;
}): HierarchyCheck {
  const { actor, bot, target, permissionLabel } = params;
  if (!actor.hasPermission) return { ok: false, reason: `Você precisa da permissão **${permissionLabel}**.` };
  if (!bot.hasPermission)
    return { ok: false, reason: `O bot não tem a permissão **${permissionLabel}** neste servidor.` };
  if (!target) return { ok: true };
  if (target.id === actor.id) return { ok: false, reason: 'Você não pode aplicar esta ação a si mesmo.' };
  if (target.id === bot.id) return { ok: false, reason: 'O bot não pode moderar a si mesmo.' };
  if (target.isOwner) return { ok: false, reason: 'O dono do servidor não pode ser moderado.' };
  if (!actor.isOwner && actor.highestRolePosition <= target.highestRolePosition) {
    return { ok: false, reason: 'O cargo do alvo é igual ou superior ao seu.' };
  }
  if (bot.highestRolePosition <= target.highestRolePosition) {
    return {
      ok: false,
      reason: 'O cargo do alvo é igual ou superior ao do bot. Mova o cargo do bot para cima.',
    };
  }
  return { ok: true };
}

/** Pré-condições específicas do silenciamento por cargo (mutes acima de 28 dias). */
export function checkRoleMute(params: {
  target: MemberSnapshot;
  mutedRole: { id: string; position: number } | null;
  botHighestRolePosition: number;
  botCanManageRoles: boolean;
}): HierarchyCheck {
  if (!params.mutedRole)
    return {
      ok: false,
      reason:
        'Silenciamentos acima de 28 dias exigem um cargo de silenciado. Configure com `/configurar-silenciado`.',
    };
  if (!params.botCanManageRoles)
    return { ok: false, reason: 'O bot precisa da permissão **Gerenciar Cargos**.' };
  if (params.mutedRole.position >= params.botHighestRolePosition)
    return { ok: false, reason: 'O cargo de silenciado está acima do cargo do bot.' };
  if (params.target.isAdministrator) {
    return {
      ok: false,
      reason:
        'O alvo tem **Administrador**: um cargo de silenciado não restringe administradores. Ação não aplicada.',
    };
  }
  return { ok: true };
}
