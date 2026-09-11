import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readAppearances } from '../packages/client/src/assets/appearances.js';
import { appearance, appearances } from '../packages/client/src/assets/testing.js';
import { packSchema } from '../packages/content/src/schemas.js';
import type { Pack } from '../packages/content/src/schemas.js';
import {
  checkInventories, differenceBetween, formatInventory, inventoryOf, rangesOf,
  readPackInventory,
} from './pack-inventory.js';

const SHA = 'c'.repeat(64);
const ids = (list: readonly number[]) => list.map((id) => appearance({ id }));

/** Um pacote sintético em disco: catálogo apontando o `.dat`, e o `.dat` com estes ids. */
function writePack(root: string, version: string, registries: {
  object?: readonly number[]; outfit?: readonly number[];
  effect?: readonly number[]; missile?: readonly number[];
}): void {
  const dir = join(root, version);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'catalog-content.json'), JSON.stringify([
    { type: 'appearances', file: 'appearances-test.dat' },
  ]));
  writeFileSync(join(dir, 'appearances-test.dat'), appearances({
    object: ids(registries.object ?? []),
    outfit: ids(registries.outfit ?? []),
    effect: ids(registries.effect ?? []),
    missile: ids(registries.missile ?? []),
  }));
}

describe('rangesOf', () => {
  it('junta ids consecutivos numa faixa inclusiva, e deixa o buraco de fora', () => {
    expect(rangesOf([1, 2, 3, 7, 9, 10])).toEqual([[1, 3], [7, 7], [9, 10]]);
  });

  it('não depende da ordem nem de repetição na entrada', () => {
    expect(rangesOf([10, 9, 3, 1, 2, 2])).toEqual([[1, 3], [9, 10]]);
  });

  it('sem id nenhum é sem faixa nenhuma', () => {
    expect(rangesOf([])).toEqual([]);
  });
});

describe('inventoryOf', () => {
  it('lê os quatro registros do catálogo, cada um no seu lugar', () => {
    const catalogue = readAppearances(appearances({
      object: ids([100, 101, 102, 104]), outfit: ids([1, 2]), effect: ids([1]), missile: [],
    }));
    const pack = inventoryOf(catalogue, '1332', SHA);
    expect(pack).toEqual({
      id: 'tibia-1332', version: '1332', appearancesSha256: SHA,
      object: [[100, 102], [104, 104]], outfit: [[1, 2]], effect: [[1, 1]], missile: [],
    });
  });
});

describe('formatInventory', () => {
  const pack: Pack = packSchema.parse({
    id: 'tibia-1332', version: '1332', appearancesSha256: SHA,
    object: Array.from({ length: 40 }, (_, index) => [index * 10 + 1, index * 10 + 5]),
    outfit: [[1, 134]], effect: [], missile: [[1, 42], [44, 45]],
  });

  it('escreve um JSON que o schema lê de volta IGUAL', () => {
    expect(packSchema.parse(JSON.parse(formatInventory(pack)))).toEqual(pack);
  });

  it('quebra as faixas em linhas de até 100 colunas, e não uma por número', () => {
    const lines = formatInventory(pack).split('\n');
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(100);
    // 40 faixas de objeto cabem em poucas linhas; `JSON.stringify(_, null, 2)` daria 120+.
    expect(lines.length).toBeLessThan(25);
    expect(lines).toContain('  "effect": [],');
    expect(lines.at(-1)).toBe('');
  });
});

describe('differenceBetween', () => {
  const pack: Pack = packSchema.parse({
    id: 'tibia-1332', version: '1332', appearancesSha256: SHA,
    object: [[100, 167]], outfit: [[1, 134]], effect: [[1, 80]], missile: [[1, 42]],
  });

  it('iguais é null', () => {
    expect(differenceBetween(pack, { ...pack })).toBeNull();
  });

  it('diz que o .dat mudou antes de comparar faixa nenhuma', () => {
    expect(differenceBetween(pack, { ...pack, appearancesSha256: 'd'.repeat(64) }))
      .toMatch(/o \.dat mudou/);
  });

  it('diz em qual registro e em qual faixa o arquivo e o pacote divergem', () => {
    expect(differenceBetween(pack, { ...pack, effect: [[1, 80], [158, 158]] }))
      .toBe('effect, faixa 1: nada no arquivo, [158,158] no pacote');
    expect(differenceBetween({ ...pack, missile: [[1, 42], [44, 45]] }, pack))
      .toBe('missile, faixa 1: [44,45] no arquivo, nada no pacote');
  });

  it('uma faixa com o mesmo tamanho e outro limite é diferença — contar faixas não basta', () => {
    // É a divergência que um decoder novo produz sem o .dat mudar: mesmo sha, outra faixa.
    expect(differenceBetween(pack, { ...pack, effect: [[1, 81]] }))
      .toBe('effect, faixa 0: [1,80] no arquivo, [1,81] no pacote');
  });

  it('o id do inventário tem que ser o que o pacote produz', () => {
    expect(differenceBetween({ ...pack, id: 'tibia-1400' }, pack))
      .toBe('id: "tibia-1400" no arquivo, "tibia-1332" no pacote');
  });
});

describe('readPackInventory e checkInventories, contra um pacote em disco', () => {
  const roots: string[] = [];
  const scratch = () => {
    const root = mkdtempSync(join(tmpdir(), 'draconya-pack-'));
    roots.push(root);
    return root;
  };
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  it('lê o pacote pelo catálogo e assina o .dat', () => {
    const things = scratch();
    writePack(things, '1332', { object: [100, 101], outfit: [21], effect: [1, 2, 3], missile: [5] });
    const pack = readPackInventory(things, '1332');
    expect(pack?.object).toEqual([[100, 101]]);
    expect(pack?.outfit).toEqual([[21, 21]]);
    expect(pack?.appearancesSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('pacote ausente é null; catálogo sem o .dat é erro', () => {
    const things = scratch();
    expect(readPackInventory(things, '1332')).toBeNull();
    mkdirSync(join(things, '1332'));
    writeFileSync(join(things, '1332', 'catalog-content.json'), JSON.stringify([
      { type: 'appearances', file: 'appearances-gone.dat' },
    ]));
    expect(() => readPackInventory(things, '1332')).toThrow(/appearances-gone\.dat, que não existe/);
  });

  it('confere o inventário versionado com o pacote: fresh, stale ou absent', () => {
    const things = scratch();
    const packs = join(scratch(), 'packs');
    mkdirSync(packs);
    writePack(things, '1332', { object: [100, 101], outfit: [21] });
    const fresh = readPackInventory(things, '1332');
    if (fresh === null) throw new Error('pacote sintético não foi lido');
    writeFileSync(join(packs, 'tibia-1332.json'), formatInventory(fresh));
    writeFileSync(join(packs, 'tibia-1400.json'), formatInventory({ ...fresh, id: 'tibia-1400', version: '1400' }));
    // O inventário de um pacote que mudou desde que foi gerado.
    writePack(things, '1500', { object: [100, 101, 102], outfit: [21] });
    writeFileSync(join(packs, 'tibia-1500.json'), formatInventory({ ...fresh, id: 'tibia-1500', version: '1500' }));

    // Uma nota ao lado dos inventários não é inventário — e o `--check` roda no `pnpm check`,
    // então o primeiro README na pasta derrubaria a verificação inteira com um SyntaxError.
    writeFileSync(join(packs, 'README.md'), '# notas\n');

    expect(checkInventories(packs, things)).toEqual([
      { file: 'tibia-1332.json', status: 'fresh' },
      { file: 'tibia-1400.json', status: 'absent' },
      { file: 'tibia-1500.json', status: 'stale', detail: expect.stringMatching(/o \.dat mudou/) },
    ]);
  });

  it('confere um inventário desatualizado nas FAIXAS, com o mesmo .dat', () => {
    const things = scratch();
    const packs = join(scratch(), 'packs');
    mkdirSync(packs);
    writePack(things, '1332', { object: [100, 101, 102], outfit: [21] });
    const fresh = readPackInventory(things, '1332');
    if (fresh === null) throw new Error('pacote sintético não foi lido');
    writeFileSync(join(packs, 'tibia-1332.json'), formatInventory({ ...fresh, object: [[100, 101]] }));
    expect(checkInventories(packs, things)).toEqual([
      { file: 'tibia-1332.json', status: 'stale', detail: 'object, faixa 0: [100,101] no arquivo, [100,102] no pacote' },
    ]);
  });

  it('sem pasta de inventários não há o que conferir', () => {
    expect(checkInventories(join(scratch(), 'nao-existe'), scratch())).toEqual([]);
  });

});

// O mesmo `--check` do `pnpm check`, como teste: é o único lugar em que o arquivo em
// `packages/content/data/packs` encontra o `.dat` de verdade. Sem o pacote na máquina (o CI)
// o bloco PULA, e aparece como pulado — teste que passa sem conferir nada é falsa confiança,
// e `appearances.pack.test.ts` já faz o mesmo para o mesmo pacote.
const ROOT = join(import.meta.dirname, '..');
const THINGS = resolve(ROOT, process.env.THINGS_DIR ?? 'things');
const REAL_PACKS = join(ROOT, 'packages', 'content', 'data', 'packs');
const hasRealPack = existsSync(join(THINGS, '1332', 'catalog-content.json'));

describe.skipIf(!hasRealPack)('o inventário versionado contra o pacote 1332 desta máquina', () => {
  it('é exatamente o que o gerador produz do pacote — senão, rode pnpm assets:inventory', () => {
    const outcomes = checkInventories(REAL_PACKS, THINGS);
    const own = outcomes.find((outcome) => outcome.file === 'tibia-1332.json');
    expect(own, 'packs/tibia-1332.json existe').toBeDefined();
    expect(own?.status, own?.detail ?? '').toBe('fresh');
  });
});

describe.skipIf(hasRealPack)('sem o pacote 1332 nesta máquina', () => {
  it('o inventário versionado não é conferido contra o .dat — só contra a tabela, em load.test.ts', () => {
    expect(checkInventories(REAL_PACKS, THINGS).map((outcome) => outcome.status)).toEqual(['absent']);
  });
});
