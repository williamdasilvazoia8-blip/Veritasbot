import type { PrismaClient } from '@prisma/client';
import type { Logger } from '../../../shared/logger.js';
import { loadEdition } from '../persistence/bible-repository.js';
import { InMemoryBibleProvider } from './in-memory-corpus.js';
import type { BibleProvider } from './bible-provider.js';
import { QuotationMatcher } from '../search/quotation-matcher.js';

/** Carrega a edição configurada; se ausente, o bot funciona e explica que falta importar. */
export class BibleService {
  private matcher: QuotationMatcher | null = null;

  private constructor(readonly provider: BibleProvider) {}

  static async load(prisma: PrismaClient, editionId: string, logger: Logger): Promise<BibleService> {
    const loaded = await loadEdition(prisma, editionId);
    if (!loaded) {
      logger.warn(
        { editionId },
        'Edição bíblica não importada; respostas bíblicas desativadas até a importação.',
      );
      return new BibleService(InMemoryBibleProvider.empty());
    }
    logger.info(
      { editionId, verses: loaded.verses.length, rights: loaded.edition.rightsStatus },
      'Edição bíblica carregada',
    );
    return new BibleService(new InMemoryBibleProvider(loaded.edition, loaded.verses));
  }

  static fromProvider(provider: BibleProvider): BibleService {
    return new BibleService(provider);
  }

  /** Índice de citações é construído sob demanda (custa ~3 s e memória). */
  getQuotationMatcher(): QuotationMatcher | null {
    if (!this.provider.edition) return null;
    this.matcher ??= new QuotationMatcher(this.provider.allVerses());
    return this.matcher;
  }
}
