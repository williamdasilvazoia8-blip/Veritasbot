/**
 * Importa o Catecismo (vatican.va) e/ou o Código de Direito Canónico (PDF da CEP) para o
 * PostgreSQL. O texto nunca é versionado no Git: é descarregado das fontes oficiais.
 *
 * Uso:
 *   npm run references:import                       # ambos, a partir da internet
 *   npm run references:import -- --document ccc     # só o Catecismo
 *   npm run references:import -- --ccc-dir ./ccc --cic-pdf ./CIC.pdf   # cópias locais
 *   ... --dry-run                                   # extrai e valida sem gravar
 */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { createPrisma } from '../src/database/prisma.js';
import { CCC_INDEX_URL } from '../src/modules/references/import/ccc-vatican.js';
import {
  extractCcc,
  extractCic,
  httpByteSource,
  type ByteSource,
  type ExtractedDocument,
} from '../src/modules/references/import/import-sources.js';
import { saveDocument } from '../src/modules/references/persistence/reference-repository.js';

const { values } = parseArgs({
  options: {
    document: { type: 'string', default: 'all' },
    'ccc-dir': { type: 'string' },
    'cic-pdf': { type: 'string' },
    'rights-status': { type: 'string', default: 'unverified' },
    'dry-run': { type: 'boolean', default: false },
  },
});

const wanted = values.document === 'all' ? ['ccc', 'cic'] : [values.document];
if (!wanted.every((d) => d === 'ccc' || d === 'cic')) {
  console.error('--document deve ser ccc, cic ou all');
  process.exit(2);
}

const http = httpByteSource();
const read: ByteSource = async (url) => {
  if (values['ccc-dir'] && url.includes('cathechism_po')) {
    const file =
      url === CCC_INDEX_URL
        ? 'prima-pagina-cic_po.html'
        : decodeURIComponent(basename(new URL(url).pathname));
    return new Uint8Array(await readFile(`${values['ccc-dir']}/${file}`));
  }
  if (values['cic-pdf'] && url.endsWith('.pdf')) return new Uint8Array(await readFile(values['cic-pdf']));
  console.log(`A descarregar ${url}`);
  return http(url);
};

const results: ExtractedDocument[] = [];
for (const id of wanted) {
  const doc =
    id === 'ccc' ? await extractCcc(read, { delayMs: values['ccc-dir'] ? 0 : 300 }) : await extractCic(read);
  console.log(`${id}: ${doc.units.length} unidades · SHA-256 ${doc.sourceSha256}`);
  for (const c of doc.report.corrections) console.log('  correção:', JSON.stringify(c));
  for (const w of doc.report.warnings) console.log('  aviso:', w);
  results.push(doc);
}

if (values['dry-run']) {
  console.log('--dry-run: nada gravado no banco.');
  process.exit(0);
}

const prisma = createPrisma();
try {
  for (const doc of results) {
    await saveDocument(prisma, { ...doc, rightsStatus: values['rights-status']! });
    console.log(`${doc.id}: gravado.`);
  }
  console.log('Concluído. Reinicie o bot para carregar os textos.');
} finally {
  await prisma.$disconnect();
}
