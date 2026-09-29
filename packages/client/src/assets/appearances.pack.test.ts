// O leitor contra o pacote de assets DE VERDADE (FUN-16).
//
// Separado do `appearances.test.ts` de propósito, e a divisão é o ponto:
//
// - lá, fixtures sintéticas provam o COMPORTAMENTO — defaults, pulo por wire type, registros
//   separados —, e rodam em qualquer lugar, CI incluído;
// - aqui, um arquivo real prova que o schema que escrevemos é o schema que existe. Nenhuma
//   fixture consegue provar isso: ela foi escrita pela mesma cabeça que escreveu o leitor, e
//   um número de campo errado nos dois lugares passa nos dois.
//
// **`things/` está no `.gitignore`**, então o CI não tem o pacote e este arquivo PULA lá. Um
// teste que reprova onde o dado não existe seria desligado no primeiro PR vermelho, e aí não
// protegeria nada em lugar nenhum. Skip explícito, e uma linha dizendo por quê.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readAppearances } from './appearances.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** Procura um `appearances*.dat` sob `THINGS_DIR`, em qualquer subpasta de versão. */
function findPack(): string | null {
  // `resolve`, e não `join`: `THINGS_DIR` no `.env` é relativo (`./things`), mas apontar para
  // um pacote fora do repositório é o caso normal de quem tem o cliente instalado — e `join`
  // CONCATENA um caminho absoluto em vez de respeitá-lo, achando pacote nenhum em silêncio.
  const base = resolve(ROOT, process.env['THINGS_DIR'] ?? 'things');
  if (!existsSync(base)) return null;
  const stack = [base];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) continue;
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) { stack.push(path); continue; }
      if (/^appearances.*\.dat$/.test(entry)) return path;
    }
  }
  return null;
}

const pack = findPack();

/**
 * Lido sob demanda, e não no corpo do `describe`.
 *
 * `describe.skipIf` PULA os testes mas ainda avalia o corpo para coletá-los, então ler o
 * arquivo ali derruba a coleta na máquina que não tem o pacote — que é justamente onde este
 * arquivo deveria sumir sem barulho.
 */
let cached: ReturnType<typeof readAppearances> | null = null;
const packed = (): ReturnType<typeof readAppearances> => {
  cached ??= readAppearances(readFileSync(pack ?? ''));
  return cached;
};

describe.skipIf(pack === null)('o leitor contra o pacote real (FUN-16)', () => {

  it('lê dezenas de milhares de objetos, e não zero', () => {
    // O modo de falha silencioso deste leitor é devolver catálogo VAZIO: basta um número de
    // campo errado no topo para tudo virar "campo desconhecido, pula". Sem um piso aqui, o
    // teste passaria com o leitor completamente quebrado.
    expect(packed().object.size).toBeGreaterThan(10_000);
    expect(packed().outfit.size).toBeGreaterThan(100);
    expect(packed().effect.size).toBeGreaterThan(10);
  });

  it('toda aparência tem id, e o id é a chave', () => {
    for (const [id, appearance] of packed().object) {
      expect(appearance.id).toBe(id);
      expect(id).toBeGreaterThan(0);
    }
  });

  it('todo grupo de quadros tem sprite, e o vetor fecha com os padrões', () => {
    // `sprite_id` é indexado por fase × profundidade × altura × largura × camada. Um vetor que
    // não fecha com essa conta é leitura errada de algum `pattern*` — e o sintoma na tela
    // seria direção trocada, não erro.
    let checked = 0;
    for (const appearance of packed().outfit.values()) {
      for (const group of appearance.frameGroups) {
        const perFrame = group.patternWidth * group.patternHeight * group.patternDepth
          * group.layers;
        expect(perFrame).toBeGreaterThan(0);
        expect(group.spriteIds.length % perFrame).toBe(0);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(200);
  });

  it('os outfits têm quatro direções, que é o que o viewport vai desenhar', () => {
    // Criatura no Tibia tem quatro direções. Se este número vier 1, o leitor está lendo
    // `pattern_width` do lugar errado — e a FUN-23 desenharia todo mundo olhando para o norte.
    const withFourDirections = [...packed().outfit.values()]
      .filter((outfit) => outfit.frameGroups.some((group) => group.patternWidth === 4));
    expect(withFourDirections.length).toBeGreaterThan(100);
  });

  it('alguma coisa é ANIMADA, com duração em milissegundos plausível', () => {
    const animated = [...packed().object.values()]
      .flatMap((appearance) => appearance.frameGroups)
      .filter((group) => group.phases.length > 1);
    expect(animated.length).toBeGreaterThan(50);
    for (const group of animated.slice(0, 200)) {
      for (const phase of group.phases) {
        expect(phase.durationMinMs).toBeGreaterThan(0);
        expect(phase.durationMaxMs).toBeGreaterThanOrEqual(phase.durationMinMs);
      }
    }
  });

  it('os ids de sprite são globais e crescem muito além de uma folha só', () => {
    // Confirma o que a FUN-18 vai precisar: o id não é índice dentro de uma folha, é global
    // entre todas elas, e a folha certa sai das faixas do `catalog-content.json`.
    const ids = [...packed().object.values()]
      .flatMap((appearance) => appearance.frameGroups)
      .flatMap((group) => group.spriteIds);
    expect(Math.max(...ids)).toBeGreaterThan(100_000);
  });

  it('as flags batem com o que o mapa precisa: chão tem bank, parede tem unpass (FUN-117)', () => {
    // Os ids são os de `packages/content/data/appearances/baseline.json`: os dois chãos
    // (`rat-cellars` 355, `city` 429) e as quatro peças de parede. Um número de campo errado
    // em `readAppearanceFlags` não dá erro — dá `false` em tudo, e o importador do OTBM
    // marcaria Thais inteira como andável.
    for (const floorId of [355, 429]) {
      expect(packed().object.get(floorId)?.flags?.bankWaypoints).toBeGreaterThan(0);
      expect(packed().object.get(floorId)?.flags?.unpass).toBe(false);
    }
    for (const wallId of [1294, 1295, 1296, 1298]) {
      const wall = packed().object.get(wallId)?.flags;
      expect(wall?.unpass).toBe(true);
      expect(wall?.bottom).toBe(true);
      expect(wall?.unsight).toBe(true);
      expect(wall?.unmove).toBe(true);
      expect(wall?.bankWaypoints).toBeUndefined();
      expect(wall?.take).toBe(false);
      expect(wall?.top).toBe(false);
    }
    // O gancho fica na peça reta, não no poste nem no canto: a vertical (1294) pendura a leste
    // (`south=2` no enum do otclient), a horizontal (1295) ao sul. É o campo 21 lido de verdade.
    expect(packed().object.get(1294)?.flags?.hookSouth).toBe(2);
    expect(packed().object.get(1295)?.flags?.hookSouth).toBe(1);
    expect(packed().object.get(1296)?.flags?.hookSouth).toBeUndefined();
    expect(packed().object.get(1298)?.flags?.hookSouth).toBeUndefined();
    // Os chãos não se pegam nem se penduram, e são `fullbank`.
    for (const floorId of [355, 429]) {
      const floor = packed().object.get(floorId)?.flags;
      expect(floor?.unmove).toBe(true);
      expect(floor?.fullbank).toBe(true);
      expect(floor?.take).toBe(false);
      expect(floor?.hang).toBe(false);
    }
    // O rato: outfit, sem chão nem bloqueio.
    expect(packed().outfit.get(21)?.flags?.bankWaypoints).toBeUndefined();
    expect(packed().outfit.get(21)?.flags?.unpass ?? false).toBe(false);
  });

  it('as flags aparecem em contagens plausíveis no catálogo inteiro', () => {
    // Milhares de chãos e de bloqueios; centenas de elevações e de deslocamentos. Zero em
    // qualquer um deles é número de campo errado.
    const counts = {
      bank: 0, unpass: 0, unmove: 0, unsight: 0, avoid: 0, take: 0, hang: 0, hook: 0,
      shift: 0, elevation: 0, top: 0, clip: 0, bottom: 0, lyingObject: 0, fullbank: 0,
    };
    for (const appearance of packed().object.values()) {
      const flags = appearance.flags;
      if (flags === undefined) continue;
      if (flags.bankWaypoints !== undefined) counts.bank += 1;
      if (flags.unpass) counts.unpass += 1;
      if (flags.unmove) counts.unmove += 1;
      if (flags.unsight) counts.unsight += 1;
      if (flags.avoid) counts.avoid += 1;
      if (flags.take) counts.take += 1;
      if (flags.hang) counts.hang += 1;
      if (flags.hookSouth !== undefined || flags.hookEast !== undefined) counts.hook += 1;
      if (flags.shiftX !== undefined) counts.shift += 1;
      if (flags.elevation !== undefined) counts.elevation += 1;
      if (flags.top) counts.top += 1;
      if (flags.clip) counts.clip += 1;
      if (flags.bottom) counts.bottom += 1;
      if (flags.lyingObject) counts.lyingObject += 1;
      if (flags.fullbank) counts.fullbank += 1;
    }
    // Ordens de grandeza medidas no pacote 1332 (bank 2.706, unpass 14.090, unmove 26.597,
    // unsight 4.865, fullbank 2.401, take 5.757, shift 505, avoid 1.709, height 1.901,
    // bottom 9.237, lying 1.582, top 998, clip 5.245, hang 435, hook 798).
    expect(counts.bank).toBeGreaterThan(1_000);
    expect(counts.unpass).toBeGreaterThan(5_000);
    expect(counts.unmove).toBeGreaterThan(10_000);
    expect(counts.unsight).toBeGreaterThan(1_000);
    expect(counts.avoid).toBeGreaterThan(500);
    expect(counts.take).toBeGreaterThan(1_000);
    expect(counts.hang).toBeGreaterThan(100);
    expect(counts.hook).toBeGreaterThan(100);
    expect(counts.shift).toBeGreaterThan(100);
    expect(counts.elevation).toBeGreaterThan(500);
    expect(counts.top).toBeGreaterThan(100);
    expect(counts.clip).toBeGreaterThan(1_000);
    expect(counts.bottom).toBeGreaterThan(1_000);
    expect(counts.lyingObject).toBeGreaterThan(500);
    expect(counts.fullbank).toBeGreaterThan(1_000);
    // E as duas que quase nada usa, mas alguma coisa usa: uma mutação no número de campo
    // deixaria zero.
    let noMovementAnimation = 0, animateAlways = 0;
    for (const appearance of packed().object.values()) {
      if (appearance.flags?.noMovementAnimation) noMovementAnimation += 1;
    }
    for (const appearance of [...packed().outfit.values(), ...packed().effect.values()]) {
      if (appearance.flags?.animateAlways) animateAlways += 1;
    }
    expect(noMovementAnimation).toBeGreaterThan(0);
    expect(animateAlways).toBeGreaterThan(0);
  });
});

// Quando o pacote não está aqui, isto é o que aparece no lugar do bloco acima: uma linha que
// diz por que ele não rodou, em vez de silêncio que parece cobertura.
describe.skipIf(pack !== null)('o pacote de assets não está nesta máquina', () => {
  it('e por isso o leitor foi provado só contra fixture', () => {
    expect(pack).toBeNull();
  });
});
