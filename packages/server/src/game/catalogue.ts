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
  };
}
