import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSourceCommit } from './env.js';
import { CANARY_NPC_DIR } from './npc-prices.js';
import {
  applyLearnPrices, CANARY_VOCATION_BASE, currentLearnPriceOf, formatSpellPricesReport, learnPriceOf,
  readSpellTeachings, readTeachingsFromSource, writeLearnPriceField,
} from './spell-prices.js';
import type { SpellTeaching } from './spell-prices.js';
import type { CatalogImportContext } from './registry.js';

const COMMIT = 'a'.repeat(40);

// Fixtures SINTÉTICAS no formato do Canary — números e nomes inventados, nunca um arquivo real
// copiado (ADR 0019/0038 d.7).

/** A forma de UMA linha (a maioria dos NPCs reais). */
const INLINE_NPC = `
local npcConfig = {}
local node1 = keywordHandler:addKeyword({ "test bolt" }, StdModule.say, { npcHandler = npcHandler, text = "..." })
node1:addChildKeyword({ "yes" }, StdModule.learnSpell, { npcHandler = npcHandler, premium = false, spellName = "Test Bolt", vocation = { 1, 2, 5, 6 }, price = 800, level = 16 })
local node2 = keywordHandler:addKeyword({ "test wave" }, StdModule.say, { npcHandler = npcHandler, text = "..." })
node2:addChildKeyword({ "yes" }, StdModule.learnSpell, { npcHandler = npcHandler, premium = true, spellName = "test wave", vocation = { 4, 8 }, price = 1500, level = 30 })
`;

/** A forma multilinha (os NPCs de Carlin/Thais mais novos). */
const MULTILINE_NPC = `
local npcConfig = {}
testNode:addChildKeyword({ "yes" }, StdModule.learnSpell, {
	npcHandler = npcHandler,
	premium = false,
	spellName = "Test Bolt",
	vocation = { 1, 5 },
	price = 500,
	level = 16,
})
`;

/** Só Monk: a vocação não existe no Draconya. */
const MONK_ONLY_NPC = `
node:addChildKeyword({ "yes" }, StdModule.learnSpell, { npcHandler = npcHandler, premium = false, spellName = "Test Palm", vocation = { 9, 10 }, price = 250000, level = 175 })
`;

/** Um preço que não é literal: NUNCA vira zero em silêncio. */
const NON_LITERAL_NPC = `
node:addChildKeyword({ "yes" }, StdModule.learnSpell, { npcHandler = npcHandler, premium = false, spellName = "Test Bolt", vocation = { 1 }, price = spellPrice, level = 16 })
`;

/** Um NPC que não ensina nada. */
const PLAIN_NPC = `
local npcConfig = {}
npcConfig.name = "Villager"
`;

function withNpcDir(
  files: Readonly<Record<string, string>>,
  run: (ctx: CatalogImportContext) => void,
): void {
  const canaryDir = mkdtempSync(join(tmpdir(), 'draconya-spell-prices-test-'));
  try {
    const npcDir = join(canaryDir, CANARY_NPC_DIR);
    mkdirSync(npcDir, { recursive: true });
    for (const [name, content] of Object.entries(files)) writeFileSync(join(npcDir, name), content);
    run({ canaryDir, forgottenServerDir: '/nao/existe', canaryCommit: COMMIT, forgottenServerCommit: '' });
  } finally {
    rmSync(canaryDir, { recursive: true, force: true });
  }
}

describe('readTeachingsFromSource', () => {
  it('lê a chamada de uma linha e a multilinha, com a vocação normalizada para a base', () => {
    const inline = readTeachingsFromSource(INLINE_NPC, 'inline.lua');
    expect(inline.unresolved).toEqual([]);
    expect(inline.teachings).toEqual([
      { spellName: 'Test Bolt', vocations: ['sorcerer', 'druid'], price: 800, premium: false, npcFile: 'inline.lua' },
      { spellName: 'test wave', vocations: ['knight'], price: 1500, premium: true, npcFile: 'inline.lua' },
    ]);
    const multiline = readTeachingsFromSource(MULTILINE_NPC, 'multi.lua');
    expect(multiline.teachings).toEqual([
      { spellName: 'Test Bolt', vocations: ['sorcerer'], price: 500, premium: false, npcFile: 'multi.lua' },
    ]);
  });

  it('Monk vira lista vazia de vocação (fora do jogo), sem erro', () => {
    const { teachings, unresolved } = readTeachingsFromSource(MONK_ONLY_NPC, 'monk.lua');
    expect(unresolved).toEqual([]);
    expect(teachings[0]?.vocations).toEqual([]);
  });

  it('preço não literal vai para `unresolved`, nunca vira zero', () => {
    const { teachings, unresolved } = readTeachingsFromSource(NON_LITERAL_NPC, 'odd.lua');
    expect(teachings).toEqual([]);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]?.file).toBe('odd.lua');
    expect(unresolved[0]?.reason).toContain('spellPrice');
  });

  it('a tabela de vocação do Canary cobre 1–8 e deixa Monk de fora', () => {
    expect(Object.keys(CANARY_VOCATION_BASE).map(Number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('readSpellTeachings', () => {
  it('só os arquivos que ensinam entram na conta', () => {
    withNpcDir({ 'a.lua': INLINE_NPC, 'b.lua': MULTILINE_NPC, 'c.lua': PLAIN_NPC }, (ctx) => {
      const aggregate = readSpellTeachings(ctx);
      expect(aggregate.npcFilesRead).toBe(3);
      expect(aggregate.npcFilesTeaching).toBe(2);
      expect(aggregate.teachings).toHaveLength(3);
      expect(aggregate.unresolved).toEqual([]);
    });
  });
});

describe('learnPriceOf', () => {
  const teachings: SpellTeaching[] = [
    { spellName: 'Test Bolt', vocations: ['sorcerer', 'druid'], price: 800, premium: false, npcFile: 'b.lua' },
    { spellName: 'test bolt', vocations: ['sorcerer'], price: 500, premium: false, npcFile: 'a.lua' },
    { spellName: 'Test Bolt', vocations: ['knight'], price: 9999, premium: false, npcFile: 'k.lua' },
    { spellName: 'Cure Poison', vocations: ['sorcerer', 'druid', 'paladin', 'knight'], price: 150, premium: false, npcFile: 'c.lua' },
  ];

  it('o MENOR preço entre os NPCs que ensinam à vocação, sem diferenciar caixa', () => {
    expect(learnPriceOf(teachings, 'Test Bolt', 'sorcerer')).toEqual({
      price: 500, npcFile: 'a.lua', teachers: 2, prices: [500, 800],
    });
    // O druid só é ensinado por um NPC: o preço mais baixo da OUTRA vocação não vale para ele.
    expect(learnPriceOf(teachings, 'Test Bolt', 'druid')?.price).toBe(800);
  });

  it('a vocação que ninguém ensina não herda o preço das outras', () => {
    expect(learnPriceOf(teachings, 'Test Bolt', 'paladin')).toBeNull();
  });

  it('magia sem `vocationId` (Cure Poison) vale para qualquer NPC que a ensine', () => {
    expect(learnPriceOf(teachings, 'Cure Poison', undefined)?.price).toBe(150);
  });

  it('nome desconhecido é `null`, e não zero', () => {
    expect(learnPriceOf(teachings, 'No Such Spell', 'knight')).toBeNull();
  });
});

describe('writeLearnPriceField', () => {
  const source = '{\n  "id": "x",\n  "minLevel": 8,\n  "manaCost": 20,\n  "cooldownMs": 1000\n}\n';

  it('insere a linha logo antes de manaCost, preservando o resto do arquivo', () => {
    const written = writeLearnPriceField(source, 800);
    expect(written).toBe('{\n  "id": "x",\n  "minLevel": 8,\n  "learnPrice": 800,\n  "manaCost": 20,\n  "cooldownMs": 1000\n}\n');
    expect(JSON.parse(written).learnPrice).toBe(800);
  });

  it('troca o valor existente, sem duplicar o campo — e é idempotente', () => {
    const once = writeLearnPriceField(source, 800);
    const twice = writeLearnPriceField(once, 1000);
    expect(twice.match(/"learnPrice"/g)).toHaveLength(1);
    expect(JSON.parse(twice).learnPrice).toBe(1000);
    expect(writeLearnPriceField(twice, 1000)).toBe(twice);
  });

  it('recusa arquivo sem manaCost — formato inesperado', () => {
    expect(() => writeLearnPriceField('{ "id": "x" }', 1)).toThrow(/manaCost/);
  });

  it('currentLearnPriceOf lê o campo, ou `null` quando ausente', () => {
    expect(currentLearnPriceOf({ learnPrice: 5 })).toBe(5);
    expect(currentLearnPriceOf({})).toBeNull();
  });
});

describe('applyLearnPrices', () => {
  const aggregate = {
    teachings: [
      { spellName: 'Test Bolt', vocations: ['sorcerer'], price: 800, premium: false, npcFile: 'a.lua' },
    ] as SpellTeaching[],
    npcFilesRead: 1, npcFilesTeaching: 1, unresolved: [],
  };

  function withRepoRoot(run: (repoRoot: string, spellsDir: string) => void): void {
    const repoRoot = mkdtempSync(join(tmpdir(), 'draconya-spell-prices-repo-test-'));
    try {
      const spellsDir = join(repoRoot, 'packages/content/data/spells');
      mkdirSync(spellsDir, { recursive: true });
      run(repoRoot, spellsDir);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  }

  const spellFile = (name: string, vocationId: string): string =>
    `{\n  "id": "x",\n  "name": "${name}",\n  "vocationId": "${vocationId}",\n  "minLevel": 16,\n  "manaCost": 20,\n  "cooldownMs": 1000\n}\n`;

  it('grava o menor preço do NPC, é idempotente, e --check não escreve nada', () => {
    withRepoRoot((repoRoot, spellsDir) => {
      const path = join(spellsDir, 'test-bolt.json');
      writeFileSync(path, spellFile('Test Bolt', 'sorcerer'));

      const dry = applyLearnPrices(repoRoot, aggregate, { check: true });
      expect(dry.changes).toHaveLength(1);
      expect(JSON.parse(readFileSync(path, 'utf8')).learnPrice).toBeUndefined();

      const first = applyLearnPrices(repoRoot, aggregate, { check: false });
      expect(first.changes[0]).toMatchObject({ slug: 'test-bolt', oldPrice: null, newPrice: 800 });
      expect(JSON.parse(readFileSync(path, 'utf8')).learnPrice).toBe(800);

      expect(applyLearnPrices(repoRoot, aggregate, { check: false }).changes).toHaveLength(0);
    });
  });

  it('magia sem NPC nunca é tocada nem zerada: o preço curado à mão fica', () => {
    withRepoRoot((repoRoot, spellsDir) => {
      const path = join(spellsDir, 'test-orphan.json');
      const text = '{\n  "id": "o",\n  "name": "Test Orphan",\n  "learnPrice": 2000,\n  "manaCost": 20\n}\n';
      writeFileSync(path, text);
      const outcome = applyLearnPrices(repoRoot, aggregate, { check: false });
      expect(outcome.changes).toEqual([]);
      expect(outcome.resolutions[0]).toMatchObject({ slug: 'test-orphan', observation: null, currentPrice: 2000 });
      expect(readFileSync(path, 'utf8')).toBe(text);
    });
  });

  it('o relatório é determinístico e lista a magia sem NPC', () => {
    withRepoRoot((repoRoot, spellsDir) => {
      writeFileSync(join(spellsDir, 'test-bolt.json'), spellFile('Test Bolt', 'sorcerer'));
      writeFileSync(join(spellsDir, 'test-orphan.json'), '{ "id": "o", "name": "Test Orphan", "manaCost": 1 }\n');
      const { changes, resolutions } = applyLearnPrices(repoRoot, aggregate, { check: true });
      const report = formatSpellPricesReport(aggregate, changes, resolutions, COMMIT);
      expect(report).toBe(formatSpellPricesReport(aggregate, changes, resolutions, COMMIT));
      expect(report).toContain('| `test-bolt` | sorcerer | 800 | `a.lua` | 1 | 800 |');
      expect(report).toContain('| `test-orphan` | — | AUSENTE |');
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Contra o checkout real, quando ele está nesta máquina (`CANARY_DIR`) — pulado no CI.

const REAL_CANARY_DIR = process.env['CANARY_DIR'];
const HAS_REAL_CANARY = REAL_CANARY_DIR !== undefined && REAL_CANARY_DIR !== ''
  && existsSync(join(REAL_CANARY_DIR, CANARY_NPC_DIR));
const REAL_CANARY_TIMEOUT_MS = 20_000;

describe.skipIf(!HAS_REAL_CANARY)('leitor contra o Canary real (CANARY_DIR)', () => {
  const dir = HAS_REAL_CANARY ? (REAL_CANARY_DIR as string) : '';
  const ctx: CatalogImportContext = {
    canaryDir: dir, forgottenServerDir: '/nao/existe',
    canaryCommit: HAS_REAL_CANARY ? readSourceCommit(dir) : '', forgottenServerCommit: '',
  };
  // Os ~1000 `.lua` são lidos UMA vez, como em `npc-prices.test.ts`.
  const aggregate = HAS_REAL_CANARY ? readSpellTeachings(ctx) : undefined;

  it('lê as 1841 chamadas de 51 NPCs, sem nenhuma fora do corte', () => {
    expect(aggregate?.npcFilesTeaching).toBe(51);
    expect(aggregate?.teachings).toHaveLength(1841);
    expect(aggregate?.unresolved).toEqual([]);
  }, REAL_CANARY_TIMEOUT_MS);

  it('Berserk custa 2500 ao Knight; Apprentice\'s Strike é de graça; Great Death Beam não é ensinada', () => {
    const teachings = aggregate?.teachings ?? [];
    expect(learnPriceOf(teachings, 'Berserk', 'knight')?.price).toBe(2500);
    expect(learnPriceOf(teachings, "Apprentice's Strike", 'druid')?.price).toBe(0);
    expect(learnPriceOf(teachings, 'Great Death Beam', 'sorcerer')).toBeNull();
  }, REAL_CANARY_TIMEOUT_MS);
});
