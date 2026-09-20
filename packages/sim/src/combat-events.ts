// Eventos de domínio de COMBATE: um golpe caiu, uma cura repôs, uma magia saiu, um supply foi
// usado (FUN-109).
//
// Irmãos dos eventos de presença (`presence.ts`) e do passo (`movement.ts`), pela mesma razão
// de existir: o `sim` produz o acontecimento haja ou não alguém olhando (invariante 3), e quem
// o transforma em bytes é o hospedeiro. Antes destes quatro, a vida do PERSONAGEM só chegava ao
// cliente no `session-state` da reanexação: a barra dele ficava parada a hunt inteira enquanto
// a do monstro andava, e o jogador que olhava não sabia se estava apanhando.
//
// **O que a apresentação precisa, e nada de mecânica.** Nenhum destes eventos carrega dano
// resolvido, armadura, esquiva ou custo: `amount` é o que SAIU (ou ENTROU) na barra, porque é
// isso que o número flutuante mostra. O resolvido é assunto do extrato (`bestBasicHit`), e
// juntar os dois no mesmo evento faria o cliente escolher qual mostrar — e escolher errado.
//
// `position` viaja em todos, e é decisão: o efeito é desenhado no TILE, não na criatura. Uma
// criatura que já sumiu da tela (morreu no mesmo golpe) ainda precisa do número caindo onde
// ela estava, e o cliente não guarda posição de quem acabou de descartar.

import type { WorldPoint } from './movement.js';
import type { CarriedItem } from './inventory.js';
import type { Departure } from './session.js';

/**
 * Alguém levou dano. `amount` é o APLICADO — `min(dano, vida)` —, o que a barra perdeu.
 *
 * O golpe sai ANTES do `creature-health-changed` correspondente, e a ordem é contrato: o
 * número flutuante acompanha a barra caindo, não o contrário.
 */
export interface CreatureHit {
  readonly kind: 'creature-hit';
  readonly creatureId: string | number;
  readonly attackerId: string | number;
  readonly amount: number;
  readonly source: 'melee' | 'spell';
  readonly position: WorldPoint;
}

/**
 * Alguém REPÔS vida. `amount` é o que repôs, não o que o efeito prometia: curar 80 em quem
 * estava a 10 do máximo é uma cura de 10, e é "+10" que o jogador precisa ver.
 *
 * Não sai para a regeneração passiva: um "+1" por segundo sobre o personagem a hunt inteira é
 * ruído. A barra anda mesmo assim, por `creature-health-changed`.
 */
export interface CreatureHealed {
  readonly kind: 'creature-healed';
  readonly creatureId: string | number;
  readonly amount: number;
  /**
   * `leech` é o CMB-08: a vida que o life leech repôs no ATACANTE. O hospedeiro o desenha como
   * cura, como os outros — a apresentação não distingue, e não precisa enquanto não há UI.
   */
  readonly source: 'spell' | 'supply' | 'leech';
  readonly position: WorldPoint;
}

/** Um alvo de magia como o cliente o enxerga: quem, e onde desenhar o efeito. */
export interface SpellCastTarget {
  readonly creatureId: string | number;
  readonly position: WorldPoint;
}

/**
 * A magia SAIU — uma vez por lançamento, ANTES dos golpes dela.
 *
 * `targets` é a mira inteira, na ordem em que os golpes vão cair; vazio para magia de cura, que
 * não mira ninguém. O dano de cada alvo vem em `creature-hit` separados, porque cada alvo leva
 * o seu — e o cliente desenha o efeito do lançamento uma vez e os números uma vez por alvo.
 */
export interface SpellCast {
  readonly kind: 'spell-cast';
  readonly casterId: string | number;
  readonly spellId: string;
  readonly casterPosition: WorldPoint;
  readonly targets: ReadonlyArray<SpellCastTarget>;
  /**
   * Os tiles da forma (#155), para o efeito aparecer onde não há monstro — a onda é visível
   * inteira, como no Tibia. Vazio em alvo único e em cura.
   */
  readonly tiles: readonly WorldPoint[];
}

/**
 * Um supply foi usado. O que ele repôs, se repôs, vem em `creature-healed`; uma poção de mana
 * produz só este evento — a barra de mana é assunto de outra issue.
 */
export interface SupplyUsed {
  readonly kind: 'supply-used';
  readonly characterId: string | number;
  readonly supplyId: string;
  readonly position: WorldPoint;
  /** Runa (#165): onde caiu. Vazio para poção — o efeito é no usuário. */
  readonly targets: ReadonlyArray<SpellCastTarget>;
  readonly tiles: readonly WorldPoint[];
}

/**
 * Um TIRO saiu (#152): flecha do bow, ou o disparo da wand e do rod — uma vez por golpe,
 * ANTES do `creature-hit` dele. O `sim` diz qual arma e qual munição; o projétil a desenhar é
 * da tabela de aparências, resolvido pelo hospedeiro (invariante 6). `ammoId` só no tiro com
 * munição; a wand dispara sem.
 */
export interface Shot {
  readonly kind: 'shot';
  readonly attackerId: string | number;
  readonly targetId: string | number;
  readonly weaponItemId: string;
  readonly ammoId?: string;
  readonly from: WorldPoint;
  readonly to: WorldPoint;
}

/**
 * Uma ability de MONSTRO saiu (CMB-06): o projétil, o impacto e a forma, ANTES dos golpes dela.
 *
 * É o irmão do `spell-cast` do lado do monstro, e existe pela mesma razão: sem ele, um ataque a
 * distância caía como `creature-hit` melee, sem projétil e sem impacto próprio — o defeito que
 * a issue corrige. O `sim` diz O QUE aconteceu e as CHAVES SEMÂNTICAS de apresentação; o host
 * as resolve em ids de arte na tabela versionada (invariante 6). Chave sem linha é muda.
 *
 * `targets` é a mira inteira, na ordem em que os golpes caem; `tiles` é a forma (vazio em alvo
 * único), para o efeito aparecer onde não há criatura — como o `spell-cast`.
 */
export interface MonsterAbilityCast {
  readonly kind: 'monster-ability-cast';
  readonly casterId: string | number;
  readonly abilityId: string;
  readonly casterPosition: WorldPoint;
  readonly targets: ReadonlyArray<SpellCastTarget>;
  readonly tiles: readonly WorldPoint[];
  readonly missileKey?: string;
  readonly impactKey?: string;
}

export type CombatEvent =
  | CreatureHit | CreatureHealed | SpellCast | SupplyUsed | Shot | MonsterAbilityCast;

/** A bolsa da party mudou (#192): o que há nela, quanto vale, quanto cabe e o que está reservado. */
export interface PartyBagChanged {
  readonly kind: 'party-bag-changed';
  readonly gold: number;
  readonly items: readonly CarriedItem[];
  readonly weight: number;
  /** Σ da capacidade DISPONÍVEL dos presentes — não a total (#396). */
  readonly capacity: number;
  /** Quanto a bolsa vende agora (PRD §10). */
  readonly value: number;
  /** `peso > Σ disponível` (§14). */
  readonly overweight: boolean;
  /** A reserva proporcional de cada membro (§11-§13), para o mapa de capacidade do HUD. */
  readonly reservations: ReadonlyArray<{
    readonly characterId: string;
    readonly reserved: number;
    readonly available: number;
  }>;
}

/**
 * A bolsa foi vendida e dividida (#192): a cada saída, no fim e ao desligar `splitLoot`, além
 * da VENDA AUTOMÁTICA no drop (#395). `reason` diz qual dos quatro momentos gerou o extrato;
 * `itemId` só acompanha `'auto-sell'`, e a venda automática NÃO entra em `notableEvents`.
 */
export interface PartySettlement {
  readonly kind: 'party-settlement';
  readonly total: number;
  readonly reason: 'leave' | 'end' | 'toggle' | 'auto-sell';
  readonly itemId?: string;
  readonly shares: ReadonlyArray<{ readonly characterId: string; readonly gold: number }>;
}

/**
 * A composição da party mudou (#193): quem lidera, quem está presente e vivo. Sai no `leave`
 * — de quem sai, da cascata e da liderança que passa. Só participantes PRESENTES.
 */
export interface PartyState {
  readonly kind: 'party-state';
  readonly leaderId: string;
  readonly members: ReadonlyArray<{ readonly characterId: string; readonly alive: boolean }>;
}

/**
 * Um membro saiu por decisão do RULESET (#193): morte, ou regra de saída — o hospedeiro não
 * chamou `leave`, então precisa receber a saída com o extrato e o personagem, para gravar
 * um e devolver o outro à Cidade. `Session.leave` pelo socket não passa por aqui: quem chamou
 * já tem os dois na mão.
 */
export interface MemberLeft {
  readonly kind: 'member-left';
  readonly characterId: string;
  readonly reason: 'death' | 'exit-rule' | 'manual-exit';
  readonly departure: Departure;
}

/**
 * O follow de UM personagem mudou de estado (ADR 0033 d.9, §D10, #398): ligou/retomou, ou foi
 * INTERROMPIDO sem escolher outro alvo. `targetId` é sempre o alvo CONFIGURADO — inclusive ao
 * desligar, para o cliente saber qual follow parou. `reason` só acompanha `active: false`.
 *
 * Não existe `'disconnected'`: o `sim` não conhece sockets (invariante 3), e a hunt roda sem
 * ninguém olhando. É a divergência registrada do PRD §25.1/§30 — ver D10.
 */
export interface FollowState {
  readonly kind: 'follow-state';
  readonly characterId: string;
  readonly active: boolean;
  readonly targetId: string;
  readonly reason?: 'dead' | 'left' | 'unreachable';
}

/**
 * A votação para encerrar a hunt para TODOS (#432, ADR 0032 d.14): o líder propõe e cada membro
 * presente aprova em até 60 s. `active: false` é o fim da votação — expirou, alguém recusou, ou
 * a sessão encerrou. `approved` é quem já aprovou, na ordem de aprovação; `proposedAtMs` é o
 * instante lógico da proposta e vale `0` quando não há votação.
 *
 * A votação é da SESSÃO, não de um personagem: o cliente inteiro precisa vê-la, e é por isso que
 * ela não mora num `party-state.members[]`.
 */
export interface PartyEndVote {
  readonly kind: 'party-end-vote';
  readonly active: boolean;
  readonly proposedAtMs: number;
  readonly approved: readonly string[];
}

export type PartyEvent =
  | PartyBagChanged
  | PartySettlement
  | PartyState
  | MemberLeft
  | FollowState
  | PartyEndVote;
