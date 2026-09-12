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
      outfitIds: monsterOutfitsOf(content, hunt.id),
      lootDrops: lootDropsOf(content, hunt.id),
    })),
    bot: {
      vocabularyVersion: content.bot.vocabularyVersion,
      advancedFromLevel: content.bot.advancedFromLevel,
      slots: { ...content.bot.slots },
      advancedOnly: {
        conditions: [...content.bot.advancedOnly.conditions],
        targetPolicies: [...content.bot.advancedOnly.targetPolicies],
        postures: [...content.bot.advancedOnly.postures],
      },
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
      })),
      supplies: [...content.supplies.values()].map((supply) => ({
        id: supply.id,
        name: supply.name,
        // O preço APARECE, e é o único número de balanceamento aqui: o jogador configura
        // "beber poção abaixo de 40% de HP" olhando quanto ela custa por hora de hunt.
        price: supply.price,
        effect: supply.effect.kind,
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
      // Como a arma bate (#152): tipo, alcance e família — para o tooltip e o seletor. Mana
      // por golpe e faixa de dano ficam de fora: balanceamento (invariante 4).
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
    // A munição (#152, ADR 0026 decisão 3): o seletor lista a família do bow com o preço por
    // tiro, o único número de balanceamento aqui — é o que o jogador olha para escolher.
    ammunition: [...content.ammunition.values()].map((ammo) => ({
      id: ammo.id,
      name: ammo.name,
      family: ammo.family,
      attack: ammo.attack,
      price: ammo.price,
      appearanceId: ammo.appearanceId,
      requires: ammo.requires.level === undefined ? {} : { level: ammo.requires.level },
    })),
    // Os monstros que existem, para a tela do Bestiário ter nome onde o contador tem id
    // (FUN-113). Só id e nome, em ordem de id para a mensagem ser a mesma a cada boot: a arte
    // chega pelo `creature-appear`, e o resto — vida, ataque, XP — é balanceamento que o
    // cliente não simula (invariante 4).
    monsters: [...content.monsters.values()]
      .map((monster) => ({ id: monster.id, name: monster.name }))
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
