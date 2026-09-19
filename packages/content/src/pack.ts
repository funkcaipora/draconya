// A tabela de aparências contra o inventário do pacote (FUN-21).
//
// `appearances/baseline.json` diz que o rato é o outfit 21. Até aqui nada conferia que o outfit
// 21 existe no pacote: o número passava pelo schema e pelo boot, e o defeito aparecia como um
// quadrado invisível em produção — o cliente pede um quadro que não há, desenha o fallback, e
// a causa está a três camadas de distância. `packs/<pack>.json` é a sombra do pacote dentro de
// `content/` (ver `packSchema`), e este módulo é quem cruza os dois.
//
// PURO, como o resto de `content.ts`: recebe a tabela e o inventário já em memória. Quem lê o
// `.dat` de verdade é `scripts/pack-inventory.ts`, que gera e confere o inventário.

import type { Appearances, Pack } from './schemas.js';
import { wallSetOf } from './schemas.js';

/** Os quatro registros do pacote — os mesmos de `AppearanceCatalogue`, no cliente. */
export type PackKind = 'object' | 'outfit' | 'effect' | 'missile';

/**
 * Se o pacote tem o id `id` no registro `kind`. Busca binária pelas faixas, que o schema
 * garante em ordem crescente e sem sobreposição.
 */
export function packHas(pack: Pack, kind: PackKind, id: number): boolean {
  const ranges = pack[kind];
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const range = ranges[middle];
    if (range === undefined) return false;
    if (id < range[0]) high = middle - 1;
    else if (id > range[1]) low = middle + 1;
    else return true;
  }
  return false;
}

/**
 * Cada id da tabela que NÃO existe no pacote, um problema por id — e a mensagem diz qual
 * entrada e qual número, porque é numa tabela de sessenta linhas que alguém vai procurar.
 *
 * Percorre a tabela INTEIRA, e não só monstro e item: chão, parede, efeito de magia e
 * projétil desenham na mesma tela, e um efeito 999 é o mesmo quadrado invisível — só que
 * piscando a cada golpe.
 */
export function packProblems(appearances: Appearances, pack: Pack): string[] {
  const problems: string[] = [];
  const check = (entry: string, kind: PackKind, id: number | undefined): void => {
    if (id === undefined || packHas(pack, kind, id)) return;
    problems.push(`appearances.${entry}: ${kind} ${id} não existe no pacote ${pack.id}`);
  };
  for (const [id, outfit] of Object.entries(appearances.monsters)) {
    check(`monsters.${id}`, 'outfit', outfit);
  }
  check('characters.default', 'outfit', appearances.characters?.default);
  for (const [id, object] of Object.entries(appearances.items)) {
    check(`items.${id}`, 'object', object);
  }
  // A munição é abstrata (ADR 0026 d.3): a tabela guarda o ícone e o projétil, e os dois são
  // conferidos contra o pacote.
  for (const [id, ammo] of Object.entries(appearances.ammunition)) {
    check(`ammunition.${id}.icon`, 'object', ammo.icon);
    check(`ammunition.${id}.missile`, 'missile', ammo.missile);
  }
  for (const [id, weapon] of Object.entries(appearances.weapons)) {
    check(`weapons.${id}.missile`, 'missile', weapon.missile);
  }
  for (const [id, object] of Object.entries(appearances.corpses)) {
    check(`corpses.${id}`, 'object', object);
  }
  for (const [id, map] of Object.entries(appearances.maps)) {
    check(`maps.${id}.floor`, 'object', map.floor);
    // Um número vira as quatro peças iguais (`wallSetOf`), e as quatro são conferidas como
    // o cliente as pede — uma parede `1298` errada reprova uma vez por peça, e diz qual.
    for (const [piece, object] of Object.entries(wallSetOf(map.wall))) {
      check(`maps.${id}.wall.${piece}`, 'object', object);
    }
  }
  for (const [id, spell] of Object.entries(appearances.spells)) {
    check(`spells.${id}.effect`, 'effect', spell.effect);
    check(`spells.${id}.missile`, 'missile', spell.missile);
  }
  for (const [id, supply] of Object.entries(appearances.supplies)) {
    check(`supplies.${id}.effect`, 'effect', supply.effect);
  }
  for (const [id, effect] of Object.entries(appearances.hits)) {
    check(`hits.${id}`, 'effect', effect);
  }
  // As abilities de monstro (CMB-06, #242). As CHAVES são vocabulário semântico e não têm
  // entidade de conteúdo para cruzar — mas os ids que cada linha resolve SÃO de arte, e um
  // projétil/impacto fora do pacote é o mesmo quadrado invisível, agora a cada lançamento.
  // A conferência de um lado só (aqui) é o que a seção `abilities` admitia faltar.
  for (const [id, ability] of Object.entries(appearances.abilities)) {
    check(`abilities.${id}.missile`, 'missile', ability.missile);
    check(`abilities.${id}.effect`, 'effect', ability.effect);
  }
  return problems;
}
