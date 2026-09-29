import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadContent } from './load.js';
import { packHas } from './pack.js';
import type { Appearances } from './schemas.js';

// A auditoria de apresentação de combate (#242, CMB-09): o contrato que o host usa para
// transformar o que o `sim` emite em `effect`/`missile` no fio é a tabela de aparências, e a
// tabela só vale se cada id EXISTIR no pacote citado. O `buildContent` já recusa o id fora do
// inventário versionado (`packs/tibia-1332.json`, FUN-21); este arquivo prende o mesmo de forma
// independente, e acrescenta a metade que depende da biblioteca local — sem transformar
// `things/` (fora do Git) em dependência da suíte.
//
// Ver docs/combat-presentation-audit.md para o método, a versão e o bloqueio da biblioteca
// parcial. Nenhuma arte é versionada (invariante 6): aqui só se lê o índice e se confere a
// existência do PNG, nunca o conteúdo dele.

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', 'data');
const ROOT = join(HERE, '..', '..', '..');
const AUDIT_DOC = join(ROOT, 'docs', 'combat-presentation-audit.md');

/**
 * Uma referência de apresentação de combate (documentação/teste, nunca payload de runtime).
 * A CHAVE SEMÂNTICA é o que `sim`/`server` usam; o id é o que a tabela versionada resolve, e
 * `verifiedAgainst` diz contra qual pacote/versão ele foi conferido. O `sim` nunca conhece o
 * id — invariante 6.
 */
interface CombatPresentationReference {
  readonly semanticKey: string;
  readonly effect?: number;
  readonly missile?: number;
  readonly verifiedAgainst: string;
}

/**
 * Toda referência de apresentação de combate da tabela: magias, supplies, munição, armas,
 * golpes e abilities de monstro. A tabela separa os registros (`effect` vs `missile`), e é
 * essa separação que decide contra qual inventário cada id é conferido.
 */
function combatPresentationReferences(appearances: Appearances): CombatPresentationReference[] {
  const references: CombatPresentationReference[] = [];
  const push = (
    semanticKey: string,
    ids: { readonly effect?: number | undefined; readonly missile?: number | undefined },
  ): void => {
    references.push({
      semanticKey,
      verifiedAgainst: appearances.pack,
      ...(ids.effect === undefined ? {} : { effect: ids.effect }),
      ...(ids.missile === undefined ? {} : { missile: ids.missile }),
    });
  };
  for (const [id, spell] of Object.entries(appearances.spells)) {
    push(`spell:${id}`, { effect: spell.effect, missile: spell.missile });
  }
  for (const [id, supply] of Object.entries(appearances.supplies)) {
    push(`supply:${id}`, { effect: supply.effect, missile: supply.missile });
  }
  for (const [id, ammo] of Object.entries(appearances.ammunition)) {
    push(`ammunition:${id}`, { missile: ammo.missile });
  }
  for (const [id, weapon] of Object.entries(appearances.weapons)) {
    push(`weapon:${id}`, { missile: weapon.missile });
  }
  for (const [id, effect] of Object.entries(appearances.hits)) {
    push(`hit:${id}`, { effect });
  }
  for (const [id, ability] of Object.entries(appearances.abilities)) {
    push(`ability:${id}`, { effect: ability.effect, missile: ability.missile });
  }
  return references;
}

/** Uma linha de `appearances/<kind>.jsonl` da biblioteca local: só o que a auditoria usa. */
interface LibraryAppearance {
  readonly id: number;
  readonly frameGroups?: readonly { readonly spriteIds?: readonly number[] }[];
}

function readAppearanceIndex(libraryDir: string, kind: 'effect' | 'missile'): Map<number, LibraryAppearance> {
  const path = join(libraryDir, 'appearances', `${kind}.jsonl`);
  const index = new Map<number, LibraryAppearance>();
  if (!existsSync(path)) return index;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const record = JSON.parse(line) as LibraryAppearance;
    index.set(record.id, record);
  }
  return index;
}

/** O primeiro sprite de uma aparência, ou `null` quando a linha não tem quadro nenhum. */
function firstSpriteId(appearance: LibraryAppearance | undefined): number | null {
  const sprite = appearance?.frameGroups?.[0]?.spriteIds?.[0];
  return typeof sprite === 'number' ? sprite : null;
}

/** O PNG individual do sprite, no layout `sprites/<milhar>/<id>.png` da biblioteca. */
function spritePng(libraryDir: string, spriteId: number): string {
  const thousand = String(Math.floor(spriteId / 1000)).padStart(3, '0');
  return join(libraryDir, 'sprites', thousand, `${spriteId}.png`);
}

const THINGS_DIR = resolve(ROOT, process.env.THINGS_DIR ?? 'things');

describe('apresentação de combate: os ids existem no inventário versionado (#242)', () => {
  const content = loadContent(DATA);
  const appearances = content.appearances;
  const pack = content.pack;

  it('a tabela real tem pacote e inventário, e toda referência cai nas faixas dele', () => {
    // O `buildContent` já reprova id fora do pacote; isto é a checagem independente, para a
    // auditoria não depender de o boot estar ligado. Mutação que mata: trocar um id em
    // `appearances/baseline.json` por um número que o pacote 1332 não tem.
    expect(appearances, 'o conteúdo real tem tabela de aparências').toBeDefined();
    expect(pack, 'o conteúdo real tem inventário do pacote').toBeDefined();
    if (appearances === undefined || pack === undefined) return;

    const missing: string[] = [];
    for (const reference of combatPresentationReferences(appearances)) {
      if (reference.effect !== undefined && !packHas(pack, 'effect', reference.effect)) {
        missing.push(`${reference.semanticKey}.effect: effect ${reference.effect}`);
      }
      if (reference.missile !== undefined && !packHas(pack, 'missile', reference.missile)) {
        missing.push(`${reference.semanticKey}.missile: missile ${reference.missile}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('cobre as cinco famílias com arte nesta versão, e a chave semântica nomeia a origem', () => {
    // Não é exaustão de forma: é o mapa do que a auditoria precisa ter olhado. Se uma seção
    // nova nascer em `appearances`, este teste avisa que ela ficou fora da conferência. A sexta
    // família, `ability:`, está vazia nesta versão e é o teste seguinte que a prende.
    expect(appearances).toBeDefined();
    if (appearances === undefined) return;
    const keys = combatPresentationReferences(appearances).map((r) => r.semanticKey);
    for (const prefix of ['spell:', 'supply:', 'ammunition:', 'weapon:', 'hit:']) {
      expect(keys.some((key) => key.startsWith(prefix)), `seção ${prefix}`).toBe(true);
    }
  });

  it('as abilities do Dragon/Dragon Lord usam o vocabulário fire/firearea/blueshimmer (#520)', () => {
    // O rato e o rotworm não declaram `abilities`; o Dragon e o Dragon Lord (#520) são os
    // primeiros a usar o CMB-06 de verdade, e as três chaves são as mesmas já auditadas para
    // magia de fogo: `fire` (míssil 4, CONST_ANI_FIRE), `firearea` (efeito 7,
    // CONST_ME_FIREAREA — já usado por `great-fireball-rune`/`fire-wave`) e `blueshimmer`
    // (efeito 13, CONST_ME_MAGIC_BLUE — já usado pelas curas). Reaproveitar o vocabulário
    // existente é o que faz a primeira asserção deste describe (faixas do pacote) continuar
    // verde sem precisar de nenhum id novo.
    expect(appearances).toBeDefined();
    if (appearances === undefined) return;
    expect(appearances.abilities).toEqual({
      fire: { missile: 4 },
      firearea: { effect: 7 },
      blueshimmer: { effect: 13 },
    });
  });

  it('nenhum `_open` do conteúdo carrega a frase "sem conferência visual"', () => {
    // A frase genérica é o sintoma do dado não conferido: quem lê não sabe QUAL sprite faltou
    // nem quando a auditoria rodou. O `_open` reescrito diz a versão, o bloqueio e onde está o
    // método (docs/combat-presentation-audit.md). Varre TODO o `data/`, não só `spells/`: a
    // munição, a runa e as armas com projétil também carregam a decisão.
    // Mutação que mata: colar a frase de volta.
    const offenders: string[] = [];
    for (const folder of readdirSync(DATA)) {
      for (const file of readdirSync(join(DATA, folder))) {
        const text = readFileSync(join(DATA, folder, file), 'utf8');
        if (/sem conferência visual/.test(text)) offenders.push(`${folder}/${file}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// A metade que depende da biblioteca local. Sem `things/<versão>/library/manifest.json` o
// bloco PULA — a suíte roda no CI sem pacote de arte, e o que segura lá é o inventário
// versionado, acima. Com a biblioteca presente, o id tem que existir no ÍNDICE dela (não só no
// inventário de faixas), e o PNG do primeiro sprite é a evidência quando ele existe.
const LIBRARY_VERSION = '1332';
const LIBRARY_DIR = join(THINGS_DIR, LIBRARY_VERSION, 'library');
const MANIFEST_PATH = join(LIBRARY_DIR, 'manifest.json');
const hasLibrary = existsSync(MANIFEST_PATH);

describe.skipIf(!hasLibrary)('a biblioteca local de assets (#242)', () => {
  interface Manifest {
    readonly assetVersion: string;
    readonly completeness: {
      readonly complete: boolean;
      readonly sheetCount: number;
      readonly availableSheetCount: number;
      readonly spriteCount: number;
      readonly availableSpriteCount: number;
    };
  }

  const manifest = hasLibrary
    ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest
    : null;

  it('o manifesto é da mesma versão do pacote que a tabela cita', () => {
    // Versão diferente é mistura de bibliotecas, e a auditoria não pode misturar: os ids de um
    // pacote não são os do outro. `THINGS_VERSION` e `appearances.pack` divergentes já derrubam
    // o `game` (served-pack); aqui é o mesmo contrato do lado da auditoria.
    expect(manifest?.assetVersion).toBe(LIBRARY_VERSION);
    const content = loadContent(DATA);
    expect(content.pack?.version).toBe(LIBRARY_VERSION);
  });

  it('toda aparência de combate existe no índice da biblioteca, e o primeiro sprite é rastreável', () => {
    // O inventário de faixas diz que o id EXISTE; o índice da biblioteca diz o que ele desenha.
    // Um id presente na faixa e ausente do índice seria um defeito do pacote, não da tabela.
    const content = loadContent(DATA);
    const appearances = content.appearances;
    if (appearances === undefined) throw new Error('conteúdo real sem tabela de aparências');
    const effects = readAppearanceIndex(LIBRARY_DIR, 'effect');
    const missiles = readAppearanceIndex(LIBRARY_DIR, 'missile');

    const missing: string[] = [];
    for (const reference of combatPresentationReferences(appearances)) {
      if (reference.effect !== undefined && !effects.has(reference.effect)) {
        missing.push(`${reference.semanticKey}.effect: effect ${reference.effect}`);
      }
      if (reference.missile !== undefined && !missiles.has(reference.missile)) {
        missing.push(`${reference.semanticKey}.missile: missile ${reference.missile}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('com a biblioteca completa, todo efeito/projétil tem o PNG do primeiro sprite', () => {
    // A biblioteca parcial não pode provar nada: o gerador grava `png: null` quando a folha
    // falta, e a auditoria de #242 documenta o bloqueio em vez de inventar fidelidade (DT-01).
    // Quando a biblioteca vier completa, este teste exige a evidência para todos os ids.
    if (manifest?.completeness.complete !== true) return;
    const content = loadContent(DATA);
    const appearances = content.appearances;
    if (appearances === undefined) throw new Error('conteúdo real sem tabela de aparências');
    const effects = readAppearanceIndex(LIBRARY_DIR, 'effect');
    const missiles = readAppearanceIndex(LIBRARY_DIR, 'missile');

    const withoutPng: string[] = [];
    for (const reference of combatPresentationReferences(appearances)) {
      const checks: Array<['effect' | 'missile', number]> = [];
      if (reference.effect !== undefined) checks.push(['effect', reference.effect]);
      if (reference.missile !== undefined) checks.push(['missile', reference.missile]);
      for (const [kind, id] of checks) {
        const index = kind === 'effect' ? effects : missiles;
        const sprite = firstSpriteId(index.get(id));
        if (sprite === null || !existsSync(spritePng(LIBRARY_DIR, sprite))) {
          withoutPng.push(`${reference.semanticKey}.${kind}: ${kind} ${id}`);
        }
      }
    }
    expect(withoutPng).toEqual([]);
  });

  it('com a biblioteca parcial, o bloqueio está documentado e nenhum id foi confirmado por palpite', () => {
    // O estado de hoje: 47 de 4171 folhas, nenhum sprite de efeito/projétil. A auditoria para e
    // registra o bloqueador em docs/combat-presentation-audit.md; o teste prende que o doc
    // existe e cita a parcialidade, para o bloqueio não sumir sem alguém notar.
    expect(manifest?.completeness.complete).toBe(false);
    expect(manifest?.completeness.availableSheetCount).toBeLessThan(manifest?.completeness.sheetCount ?? 0);
    expect(existsSync(AUDIT_DOC), 'docs/combat-presentation-audit.md').toBe(true);
    expect(readFileSync(AUDIT_DOC, 'utf8')).toMatch(/parcial|incomplet/i);
  });
});

describe.skipIf(hasLibrary)('sem a biblioteca local nesta máquina (#242)', () => {
  it('o bloco de evidência visual é pulado, e nenhum id é "confirmado" por adivinhação', () => {
    // O CI e uma máquina nova não têm `things/`. O que continua valendo é o inventário
    // versionado (primeiro bloco): a ausência da arte não vira um teste verde que fingiu olhar.
    expect(hasLibrary).toBe(false);
  });
});
