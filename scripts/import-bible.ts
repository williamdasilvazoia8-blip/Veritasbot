/**
 * Importa a Bíblia do Pe. Matos Soares a partir do biblia.json do repositório
 * Dancrf/biblia-db (ou cópia local), valida, gera relatório de anomalias e grava
 * no PostgreSQL.
 *
 * Uso:
 *   npm run bible:import -- --source ./data/bible/biblia.json --revision <commit> \
 *     --rights-status unverified [--dry-run]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { importMatosSoares } from '../src/modules/bible/import/matos-soares.js';
import { saveEdition } from '../src/modules/bible/persistence/bible-repository.js';
import { createPrisma } from '../src/database/prisma.js';

const RIGHTS = ['unverified', 'public-domain-verified', 'licensed'] as const;

const { values } = parseArgs({
  options: {
    source: { type: 'string' },
    revision: { type: 'string' },
    'rights-status': { type: 'string', default: 'unverified' },
    edition: { type: 'string', default: process.env.BIBLE_EDITION_ID ?? 'matos-soares-1956' },
    report: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
});

if (!values.source) {
  console.error('Informe --source <caminho do biblia.json>');
  process.exit(2);
}
const rights = values['rights-status'] as (typeof RIGHTS)[number];
if (!RIGHTS.includes(rights)) {
  console.error(`--rights-status deve ser um de: ${RIGHTS.join(', ')}`);
  process.exit(2);
}

const raw = await readFile(values.source, 'utf8');
const result = importMatosSoares(raw);
console.log(`SHA-256 da fonte: ${result.sha256}`);
console.log(
  `Livros: ${result.summary.books} · capítulos: ${result.summary.chapters} · versículos: ${result.summary.verses}`,
);
console.log('Anomalias de numeração:', result.summary.anomaliesByKind);

const reportPath = values.report ?? `data/bible/import-report-${values.edition}.json`;
await writeFile(
  reportPath,
  JSON.stringify(
    {
      sha256: result.sha256,
      revision: values.revision ?? null,
      ...result.summary,
      anomalies: result.anomalies,
    },
    null,
    2,
  ),
);
console.log(`Relatório: ${reportPath}`);

if (values['dry-run']) {
  console.log('--dry-run: nada gravado no banco.');
  process.exit(0);
}

const prisma = createPrisma();
try {
  await saveEdition(
    prisma,
    {
      id: values.edition!,
      name: 'Bíblia Sagrada — trad. Pe. Manuel de Matos Soares (1956)',
      source: 'github.com/Dancrf/biblia-db',
      sourceRevision: values.revision ?? null,
      provenance:
        'Arquivo biblia.json do repositório Dancrf/biblia-db; texto descrito como a tradução de 1956 do Pe. Manuel de Matos Soares.',
      rightsStatus: rights,
      versificationScheme: 'vulgate-psalms',
    },
    result,
  );
  console.log(`Edição "${values.edition}" gravada (${result.verses.length} registros).`);
} finally {
  await prisma.$disconnect();
}
