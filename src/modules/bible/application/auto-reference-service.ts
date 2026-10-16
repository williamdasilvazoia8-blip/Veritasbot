import type { BibleProvider, Passage } from './bible-provider.js';
import { parseReferences } from '../parsing/reference-parser.js';
import type { BibleReference } from '../domain/types.js';
import { hebrewToVulgate } from '../domain/psalms-versification.js';
import type { QuotationMatcher } from '../search/quotation-matcher.js';

export interface IncomingMessage {
  id: string;
  guildId: string;
  channelId: string;
  /** IDs da categoria/thread pai, para regras de canal permitidas por categoria. */
  parentChannelId?: string | null;
  content: string;
  authorIsBot: boolean;
  isWebhook: boolean;
  isSystem: boolean;
}

export interface AutoReferenceSettings {
  enabled: boolean;
  allowedChannelIds: string[];
  excludedChannelIds: string[];
  maxReferences: number;
  cooldownSeconds: number;
  allowWebhookMessages: boolean;
  psalmNumbering: string;
  quotationMatchingEnabled: boolean;
  quotationMinWords: number;
  quotationChannelIds: string[];
}

export type AutoReply =
  | {
      kind: 'passages';
      passages: Passage[];
      truncated: Array<{ reference: BibleReference; verseCount: number }>;
    }
  | { kind: 'quotation'; passage: Passage; coverage: number };

/**
 * Regra de canais das respostas automáticas (o canal ou a sua categoria/canal pai):
 * excluído ganha sempre; com lista de permitidos não vazia, só esses respondem.
 */
export function channelRule(
  ids: Array<string | null | undefined>,
  allowed: string[],
  excluded: string[],
): 'ok' | 'excluded' | 'not-allowed' {
  const present = ids.filter((x): x is string => Boolean(x));
  if (present.some((id) => excluded.includes(id))) return 'excluded';
  if (allowed.length > 0 && !present.some((id) => allowed.includes(id))) return 'not-allowed';
  return 'ok';
}

/**
 * Decide, de forma determinística, se uma mensagem comum deve receber resposta
 * com texto bíblico. Não conhece discord.js: recebe dados simples e devolve o
 * que enviar. Deduplica por ID de mensagem e aplica cooldown por canal.
 */
export class AutoReferenceService {
  private readonly processed = new Map<string, number>();
  private readonly lastReplyByChannel = new Map<string, number>();

  constructor(
    private readonly bible: BibleProvider,
    private readonly opts: {
      maxVersesPerPassage: number;
      globalEnabled: boolean;
      quotationGloballyEnabled: boolean;
      getQuotationMatcher?: () => QuotationMatcher | null;
      now?: () => number;
      dedupeTtlMs?: number;
    },
  ) {}

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  /** Retorna true se a mensagem já foi processada (eventos duplicados do gateway). */
  private seen(messageId: string): boolean {
    const now = this.now();
    const ttl = this.opts.dedupeTtlMs ?? 10 * 60_000;
    if (this.processed.size > 5000) {
      for (const [id, at] of this.processed) if (now - at > ttl) this.processed.delete(id);
    }
    if (this.processed.has(messageId)) return true;
    this.processed.set(messageId, now);
    return false;
  }

  private channelAllowed(msg: IncomingMessage, s: AutoReferenceSettings, channelList: string[]): boolean {
    return channelRule([msg.channelId, msg.parentChannelId], channelList, s.excludedChannelIds) === 'ok';
  }

  async handle(msg: IncomingMessage, s: AutoReferenceSettings): Promise<AutoReply | null> {
    if (!this.opts.globalEnabled || !s.enabled) return null;
    if (msg.authorIsBot || msg.isSystem) return null;
    if (msg.isWebhook && !s.allowWebhookMessages) return null;
    if (!msg.content || msg.content.length > 4000) return null;
    if (!this.bible.edition) return null;
    if (this.seen(msg.id)) return null;
    if (!this.channelAllowed(msg, s, s.allowedChannelIds)) return null;

    const cooldownKey = `${msg.guildId}:${msg.channelId}`;
    const last = this.lastReplyByChannel.get(cooldownKey) ?? 0;
    if (this.now() - last < s.cooldownSeconds * 1000) return null;

    const refs = parseReferences(msg.content, {
      strict: true,
      requireVerse: true,
      maxResults: Math.max(1, s.maxReferences),
    });
    if (refs.length > 0) {
      const passages: Passage[] = [];
      const truncated: Array<{ reference: BibleReference; verseCount: number }> = [];
      for (const original of refs) {
        const ref = this.applyPsalmNumbering(original, s.psalmNumbering);
        if (!ref) continue;
        const res = await this.bible.getPassage(ref, { maxVerses: this.opts.maxVersesPerPassage });
        if (res.ok) passages.push(res.passage);
        else if (res.error.kind === 'too-long')
          truncated.push({ reference: ref, verseCount: res.error.verseCount });
        // Referências inválidas são ignoradas em silêncio na detecção automática (sem ruído e sem inventar texto).
      }
      if (passages.length === 0 && truncated.length === 0) return null;
      this.lastReplyByChannel.set(cooldownKey, this.now());
      return { kind: 'passages', passages, truncated };
    }

    if (
      this.opts.quotationGloballyEnabled &&
      s.quotationMatchingEnabled &&
      this.channelAllowed(msg, s, s.quotationChannelIds)
    ) {
      const matcher = this.opts.getQuotationMatcher?.();
      const match = matcher?.match(msg.content, s.quotationMinWords);
      if (match) {
        const v = match.verse;
        const res = await this.bible.getPassage({
          bookId: v.bookId,
          chapter: v.chapter,
          verseStart: v.verse,
          raw: '',
          index: 0,
        });
        if (res.ok) {
          this.lastReplyByChannel.set(cooldownKey, this.now());
          return { kind: 'quotation', passage: res.passage, coverage: match.coverage };
        }
      }
    }
    return null;
  }

  /** Servidores podem digitar salmos na numeração hebraica; convertemos só quando é 1:1. */
  private applyPsalmNumbering(ref: BibleReference, numbering: string): BibleReference | null {
    if (ref.bookId !== 'PSA' || numbering !== 'hebrew') return ref;
    const start = hebrewToVulgate(ref.chapter);
    const end = ref.chapterEnd !== undefined ? hebrewToVulgate(ref.chapterEnd) : start;
    if (start === null || end === null) return null;
    return { ...ref, chapter: start, ...(ref.chapterEnd !== undefined ? { chapterEnd: end } : {}) };
  }
}
