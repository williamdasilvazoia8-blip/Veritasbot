import {
  channelRule,
  type AutoReferenceSettings,
  type IncomingMessage,
} from '../../bible/application/auto-reference-service.js';
import { parseDocumentReferences, type DocumentReference } from '../parsing/reference-parser.js';
import type { ReferenceLibrary } from './reference-library.js';
import type { ReferenceUnit } from '../domain/types.js';

export interface DocumentReply {
  reference: DocumentReference;
  units: ReferenceUnit[];
  missing: number[];
}

/**
 * Respostas automáticas a "CCC 1234" / "cân. 1055" em mensagens comuns. Usa as mesmas
 * regras da Bíblia (ativação, canais, cooldown, máximo de referências por mensagem).
 */
export class DocumentAutoReplyService {
  private readonly processed = new Map<string, number>();
  private readonly lastReplyByChannel = new Map<string, number>();

  constructor(
    private readonly library: ReferenceLibrary,
    private readonly opts: { isGuildAllowed: (guildId: string) => boolean; now?: () => number },
  ) {}

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  handle(msg: IncomingMessage, s: AutoReferenceSettings): DocumentReply[] {
    if (!s.enabled || msg.authorIsBot || msg.isSystem) return [];
    if (msg.isWebhook && !s.allowWebhookMessages) return [];
    if (!msg.content || msg.content.length > 4000 || !this.opts.isGuildAllowed(msg.guildId)) return [];

    const now = this.now();
    if (this.processed.size > 5000)
      for (const [id, at] of this.processed) if (now - at > 10 * 60_000) this.processed.delete(id);
    if (this.processed.has(msg.id)) return [];
    this.processed.set(msg.id, now);

    if (channelRule([msg.channelId, msg.parentChannelId], s.allowedChannelIds, s.excludedChannelIds) !== 'ok')
      return [];

    const key = `${msg.guildId}:${msg.channelId}`;
    const last = this.lastReplyByChannel.get(key);
    if (last !== undefined && now - last < s.cooldownSeconds * 1000) return [];

    const replies: DocumentReply[] = [];
    for (const reference of parseDocumentReferences(msg.content, Math.max(1, s.maxReferences))) {
      const res = this.library.get(reference.documentId, reference.start, reference.end);
      // Documento não importado ou número sem texto: silêncio (sem ruído, sem inventar).
      if (res.ok) replies.push({ reference, units: res.units, missing: res.missing });
    }
    if (replies.length > 0) this.lastReplyByChannel.set(key, now);
    return replies;
  }
}
