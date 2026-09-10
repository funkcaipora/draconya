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
});

// Quando o pacote não está aqui, isto é o que aparece no lugar do bloco acima: uma linha que
// diz por que ele não rodou, em vez de silêncio que parece cobertura.
describe.skipIf(pack !== null)('o pacote de assets não está nesta máquina', () => {
  it('e por isso o leitor foi provado só contra fixture', () => {
    expect(pack).toBeNull();
  });
});
