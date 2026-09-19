// O catálogo que o cliente recebe: o que existe para jogar e para configurar (FUN-79, FUN-89).
//
// **Uma mensagem, e não duas.** A seleção de hunt e a UI do bot perguntam a mesma coisa — "o que
// este servidor tem" —, chegam no mesmo instante e mudam pela mesma razão: a versão de conteúdo,
// que é fixada na sessão (invariante 7). Separar daria dois pacotes que nunca aparecem um sem o
// outro.
//
// **A tela do bot não tem lista de opções em código.** O que ela oferece é o que este arquivo
// diz que existe — se as duas divergirem, o jogador configura o que o bot recusa, e descobre isso
// pelo extrato que não fecha em vez de por uma mensagem de erro.
//
// O que NÃO entra: dano, cura, cooldown, alcance. São balanceamento, e o cliente não simula
// (invariante 4) — mandá-los seria dar ao cliente material para calcular resultado.

import type { S2CProps } from '@draconya/protocol';
import type { Content } from '@draconya/content';
import {
  BOT_AUTOMATION_CATALOGUE, BOT_HOTKEYS, BOT_SET_COUNT, BOT_SET_NAMES, BOT_SLOTS_PER_SET,
} from '@draconya/content';
import { huntListings } from '@draconya/sim';

export type Catalogue = S2CProps<'catalogue'>;

/**
 * Monta o catálogo UMA vez, no boot.
 *
 * A versão de conteúdo é fixada e não muda enquanto o processo vive, então recalcular por
 * conexão seria refazer o mesmo trabalho para todo mundo que entra.
 */
export function buildCatalogue(content: Content): Catalogue {
  return {
    hunts: huntListings(content).map((hunt) => ({
      id: hunt.id,
      name: hunt.name,
      recommendedLevel: hunt.recommendedLevel,
      // Cópia mutável: `HuntListing` traz a união fechada e `readonly`, e a mensagem leva
      // `string` — quem define quais dificuldades existem é o conteúdo, não o protocolo.
      difficulties: [...hunt.difficulties],
      ...(hunt.description === undefined ? {} : { description: hunt.description }),
      difficultyDetails: difficultyDetailsOf(content, hunt.id),
      outfitIds: monsterOutfitsOf(content, hunt.id),
      lootDrops: lootDropsOf(content, hunt.id),
      monsters: monstersOf(content, hunt.id),
      loot: lootOf(content, hunt.id),
    })),
    bot: {
      vocabularyVersion: content.bot.vocabularyVersion,
      setCount: BOT_SET_COUNT,
      slotsPerSet: BOT_SLOTS_PER_SET,
      setNames: [...BOT_SET_NAMES],
      hotkeys: [...BOT_HOTKEYS],
      groups: groupsOf(content),
      spells: [...content.spells.values()].map((spell) => ({
        id: spell.id,
        name: spell.name,
        manaCost: spell.manaCost,
        minLevel: spell.minLevel,
        // `null` e não ausente: a tela precisa distinguir "qualquer um lança" de "o servidor
        // não disse", e campo opcional colapsa os dois no mesmo `undefined`.
        vocationId: spell.vocationId ?? null,
        // Só o `kind`: é o que separa em qual categoria a magia cabe. O quanto ela cura ou
        // machuca é balanceamento.
        effect: spell.effect.kind,
        // O grupo (#155): a tela mostra ao lado do nome; BP e conversão não descem.
        group: spell.group ?? 'attack',
      })),
      /**
       * Os suprimentos abstratos (§20.1, ADR 0026 d.3): poção e runa NÃO são itens — usar debita
       * gold. O `price` e o `group` são o que a tela mostra para escolher.
       */
      supplies: [...content.supplies.values()].map((supply) => ({
        id: supply.id,
        name: supply.name,
        price: supply.price,
        effect: supply.effect.kind,
        group: supply.group,
        requires: {
          ...(supply.requires.level === undefined ? {} : { level: supply.requires.level }),
          ...(supply.requires.magicLevel === undefined
            ? {}
            : { magicLevel: supply.requires.magicLevel }),
        },
      })),
      // Os cinco modelos de automação e os parâmetros de cada um (AB-12), do descritor do
      // conteúdo. A engine é dona do mecanismo; o conteúdo, dos rótulos.
      automations: BOT_AUTOMATION_CATALOGUE.map((descriptor) => ({
        model: descriptor.model,
        label: descriptor.label,
        params: descriptor.params.map((param) => ({ name: param.name, kind: param.kind })),
      })),
    },
    // As DEFINIÇÕES, uma vez cada. Atributo base é fixo (§21.2): duas espadas do mesmo id são
    // idênticas, então repetir nome e peso por instância mandaria o mesmo texto dezenas de
    // vezes a cada loot.
    items: [...content.items.values()].map((item) => ({
      id: item.id,
      name: item.name,
      appearanceId: item.appearanceId,
      weight: item.weight,
      // `null` e não ausente: "não veste em lugar nenhum" é uma informação, e campo opcional
      // a confundiria com "o servidor não disse".
      slot: item.slot ?? null,
      twoHanded: item.twoHanded,
      // Valor de venda ao NPC, ataque e armadura (#337).
      value: item.value,
      attack: item.attack,
      armor: item.armor,
      // O tipo (AB-09): o editor de ação do AB-11 filtra consumível por aqui.
      kind: item.kind,
      // O rótulo curto da barra/Mochila (AB-13), só quando o conteúdo o declara.
      ...(item.shortLabel === undefined ? {} : { shortLabel: item.shortLabel }),
      // Como a arma bate (#152): tipo, alcance e família — para o tooltip. Mana por golpe e
      // faixa de dano ficam de fora: balanceamento (invariante 4).
      ...(item.weapon === undefined
        ? {}
        : {
          weapon: {
            kind: item.weapon.kind,
            range: item.weapon.range,
            ...(item.weapon.ammoFamily === undefined ? {} : { ammoFamily: item.weapon.ammoFamily }),
          },
        }),
    })),
    /**
     * A munição abstrata (#152, ADR 0026 d.3): o seletor no slot do escudo lista a família do
     * bow, com o preço por tiro e o `appearanceId` do ícone. `attack` é o único número de
     * balanceamento aqui, pela mesma razão do preço do supply: é o que o jogador olha.
     */
    ammunition: [...content.ammunition.values()].map((ammo) => ({
      id: ammo.id,
      name: ammo.name,
      family: ammo.family,
      attack: ammo.attack,
      price: ammo.price,
      appearanceId: ammo.appearanceId,
      requires: {
        ...(ammo.requires.level === undefined ? {} : { level: ammo.requires.level }),
      },
    })),
    // As vocações e o level da escolha (#154): o diálogo do level 8 lê daqui — a tela não
    // pode ter o 8 em código. Só os ganhos e a arma inicial (id de item); nada de fórmula.
    vocations: [...content.vocations.values()]
      .filter((vocation) => vocation.startingWeaponItemId !== undefined)
      .map((vocation) => ({
        id: vocation.id,
        name: vocation.name,
        healthPerLevel: vocation.healthPerLevel,
        manaPerLevel: vocation.manaPerLevel,
        capacityPerLevel: vocation.capacityPerLevel,
        startingWeaponItemId: vocation.startingWeaponItemId as string,
      })),
    vocationLevel: content.progression.vocationLevel,
    progression: {
      startingSpeed: content.progression.startingSpeed,
      speedPerLevel: content.progression.speedPerLevel,
      regen: { ...content.progression.regen },
    },
    // Os monstros que existem, para a tela do Bestiário ter nome onde o contador tem id
    // (FUN-113). Vida e XP para o detalhe (SV-02, #338). Em ordem de id para a mensagem ser a
    // mesma a cada boot: a arte chega pelo `creature-appear`, e o resto é balanceamento que o
    // cliente não simula (invariante 4).
    monsters: [...content.monsters.values()]
      .map((monster) => ({
        id: monster.id,
        name: monster.name,
        ...(monster.class !== undefined ? { class: monster.class } : {}),
        health: monster.health,
        experience: monster.experience,
      }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    // Os marcos e o bônus por marco, do conteúdo fixado na sessão (invariante 7). A chave só
    // existe quando o conteúdo tem Bestiário: ausente, a tela mostra só a contagem — e é o
    // conteúdo de teste, que não fala de progressão permanente. Só os dois campos: `id` e
    // `_open` são assunto do carregador, não do cliente.
    ...(content.bestiary === undefined
      ? {}
      : {
        bestiary: {
          milestones: [...content.bestiary.milestones],
          xpBonusPercentPerMilestone: content.bestiary.xpBonusPercentPerMilestone,
        },
      }),
  };
}

/**
 * Os grupos de cooldown do conteúdo (AB-09, ADR 0032 d.2): a união de `spell.group` e
 * `supply.group`, em ordem estável. É o vocabulário que o editor do AB-11 oferece, e é o que o
 * motor de grupos usa para priorizar dentro de cada livro.
 */
function groupsOf(content: Content): string[] {
  const groups = new Set<string>();
  for (const spell of content.spells.values()) {
    if (spell.group !== undefined) groups.add(spell.group);
  }
  for (const supply of content.supplies.values()) {
    groups.add(supply.group);
  }
  return [...groups].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function monstersOf(content: Content, huntId: string): Array<{ id: string; name: string }> {
  const hunt = content.hunts.get(huntId);
  if (hunt === undefined) return [];
  const found = new Map<string, string>();
  for (const difficulty of Object.values(hunt.difficulties)) {
    for (const entry of difficulty.composition) {
      const monster = content.monsters.get(entry.monsterId);
      if (monster !== undefined) found.set(monster.id, monster.name);
    }
  }
  return [...found.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function lootOf(content: Content, huntId: string): Array<{ itemId: string; name: string }> {
  const hunt = content.hunts.get(huntId);
  if (hunt === undefined) return [];
  const found = new Map<string, string>();
  for (const difficulty of Object.values(hunt.difficulties)) {
    for (const entry of difficulty.composition) {
      const loot = content.monsters.get(entry.monsterId)?.loot;
      if (loot === undefined) continue;
      for (const item of loot.items) {
        if (item.chance <= 0) continue;
        const definition = content.items.get(item.itemId);
        if (definition !== undefined) found.set(item.itemId, definition.name);
      }
    }
  }
  return [...found.entries()]
    .map(([itemId, name]) => ({ itemId, name }))
    .sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
}

/**
 * Os outfits de todo monstro que pode nascer nesta hunt, em qualquer dificuldade (FUN-112).
 *
 * Únicos e em ordem, para a mensagem ser a mesma a cada boot: é o que o cliente aquece na
 * Cidade, e um id repetido seria uma folha pedida duas vezes. Vem do conteúdo fixado na
 * sessão (invariante 7) — o `outfitId` já resolvido pela tabela de aparências (FUN-94).
 */
/**
 * Quantos drops distintos a hunt tem (FUN-123): gold conta um se algum monstro dela solta, e
 * cada item distinto conta um — é o "2 drops de loot" que o Huntera mostra na Rat Cellars
 * (gold e queijo). Só o NÚMERO: a lista de loot possível é da tela de detalhe, que não existe.
 */
function lootDropsOf(content: Content, huntId: string): number {
  const hunt = content.hunts.get(huntId);
  if (hunt === undefined) return 0;
  const items = new Set<string>();
  let gold = false;
  for (const difficulty of Object.values(hunt.difficulties)) {
    for (const entry of difficulty.composition) {
      const loot = content.monsters.get(entry.monsterId)?.loot;
      if (loot === undefined) continue;
      if (loot.gold !== undefined && loot.gold.chance > 0) gold = true;
      for (const item of loot.items) if (item.chance > 0) items.add(item.itemId);
    }
  }
  return items.size + (gold ? 1 : 0);
}

function monsterOutfitsOf(content: Content, huntId: string): number[] {
  const hunt = content.hunts.get(huntId);
  if (hunt === undefined) return [];
  const outfits = new Set<number>();
  for (const difficulty of Object.values(hunt.difficulties)) {
    for (const entry of difficulty.composition) {
      const outfit = content.monsters.get(entry.monsterId)?.outfitId;
      if (outfit !== undefined) outfits.add(outfit);
    }
  }
  return [...outfits].sort((a, b) => a - b);
}

/**
 * Quantos monstros cada dificuldade desta hunt mantém vivos, NO TOTAL (FUN-123,
 * `huntDifficultySchema.monsterCount`) — o "Ousado · 4" que o Huntera mostra ao lado do nome
 * da dificuldade. Mesma ORDEM de `Object.keys(hunt.difficulties)`, que é a MESMA fonte que
 * `huntListings` usa para `difficulties` (`packages/sim/src/hunt/catalogue.ts:40`) — os dois
 * lêem o mesmo objeto, então a ordem entre os dois campos é garantida sem precisar reordenar
 * nada aqui.
 */
function difficultyDetailsOf(content: Content, huntId: string): { id: string; monsterCount: number }[] {
  const hunt = content.hunts.get(huntId);
  if (hunt === undefined) return [];
  const details: { id: string; monsterCount: number }[] = [];
  for (const [id, difficulty] of Object.entries(hunt.difficulties)) {
    if (difficulty === undefined) continue;
    details.push({ id, monsterCount: difficulty.monsterCount });
  }
  return details;
}

