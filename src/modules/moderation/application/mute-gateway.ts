/** Operações no Discord necessárias para silenciar; isoladas para testes. */
export interface MuteGateway {
  applyTimeout(guildId: string, userId: string, until: Date, reason: string): Promise<void>;
  clearTimeout(guildId: string, userId: string, reason: string): Promise<'ok' | 'member-missing'>;
  addRole(guildId: string, userId: string, roleId: string, reason: string): Promise<'ok' | 'member-missing'>;
  removeRole(
    guildId: string,
    userId: string,
    roleId: string,
    reason: string,
  ): Promise<'ok' | 'member-missing'>;
}
