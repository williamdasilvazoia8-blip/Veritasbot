import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CCC_INDEX_URL } from '../../../src/modules/references/import/ccc-vatican.js';
import { extractCcc, extractCic } from '../../../src/modules/references/import/import-sources.js';

// Opcional: cópias locais das fontes oficiais (não versionadas).
//   CCC_SOURCE_DIR=<pasta com prima-pagina-cic_po.html e as páginas>  CIC_SOURCE_PDF=<CIC_SiteCEP.pdf>
const { CCC_SOURCE_DIR, CIC_SOURCE_PDF } = process.env;

describe.skipIf(!CCC_SOURCE_DIR)('Catecismo real (vatican.va)', () => {
  it('extrai §1-§2865 completos', async () => {
    const doc = await extractCcc(async (url) => {
      const file =
        url === CCC_INDEX_URL
          ? 'prima-pagina-cic_po.html'
          : decodeURIComponent(basename(new URL(url).pathname));
      return new Uint8Array(await readFile(`${CCC_SOURCE_DIR}/${file}`));
    });
    expect(doc.units).toHaveLength(2865);
    expect(doc.report.corrections).toHaveLength(2);
  }, 60_000);
});

describe.skipIf(!CIC_SOURCE_PDF)('Código real (PDF da CEP)', () => {
  it('extrai cân. 1-1752 completos e sem avisos', async () => {
    const doc = await extractCic(async () => new Uint8Array(await readFile(CIC_SOURCE_PDF!)));
    expect(doc.units).toHaveLength(1752);
    expect(doc.report.warnings).toEqual([]);
  }, 120_000);
});
