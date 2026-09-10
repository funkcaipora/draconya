// Skills que sobem pelo USO (§9.4 **[DECIDIDO]**, FUN-75).
//
// Paradigma do Tibia: skill não vem de level, vem de fazer. O motor sabe CONTAR uso e sabe
// quando um nível fecha; quanto cada uso rende, quanto custa cada nível e quanto a skill
// acrescenta ao golpe são conteúdo, e mudar qualquer um deles é editar JSON.
//
// **Pontos são acumulador, e isso não briga com o invariante 2.** O que a regra proíbe é
// grandeza dependente do TEMPO somada por tick; aqui o que se soma é uso, e uso é evento na
// fila — um golpe que vence, uma magia que sai. A 1 Hz e a 10 Hz acontecem os mesmos usos nos
// mesmos instantes lógicos, então a skill sobe igual.

import type { Skill } from '@draconya/content';

/** Onde uma skill está: o nível e quanto já se acumulou rumo ao próximo. */
export interface SkillState {
  readonly level: number;
  readonly points: number;
}

/** `skillId` → estado. Entra no snapshot e no extrato. */
export type SkillsState = Readonly<Record<string, SkillState>>;

/**
 * Quantos pontos faltam para sair de `level`.
 *
 * Fórmula e não tabela: tabela precisa ter fim, e o fim vira teto acidental que ninguém
 * decidiu. O expoente conta a partir do nível INICIAL — sem isso, uma skill que começa em 10
 * cobraria pelo décimo nível já no primeiro uso.
 *
 * **O custo é INTEIRO**, e isso não é cosmético. `50 * 1.1` dá `55.000000000000007` em ponto
 * flutuante, e o resto que sobra ao fechar um nível carregaria esse lixo para o próximo, e
 * para o seguinte. Numa hunt de oito horas são milhares de níveis de resíduo somado — a mesma
 * armadilha que o `AGENTS.md` deste pacote registra sobre acumular `0,1` dez vezes. Com custo
 * inteiro e uso inteiro, a conta fecha exata.
 */
export function pointsForLevel(definition: Skill, level: number): number {
  const steps = Math.max(0, level - definition.startingLevel);
  return Math.round(definition.curve.base * definition.curve.factor ** steps);
}

export class Skills {
  readonly #levels = new Map<string, number>();
  readonly #points = new Map<string, number>();

  static fromState(state: SkillsState | undefined): Skills {
    const skills = new Skills();
    if (state === undefined) return skills;
    for (const [id, value] of Object.entries(state)) {
      skills.#levels.set(id, value.level);
      skills.#points.set(id, value.points);
    }
    return skills;
  }

  getState(): SkillsState {
    const state: Record<string, SkillState> = {};
    for (const [id, level] of this.#levels) {
      state[id] = { level, points: this.#points.get(id) ?? 0 };
    }
    return state;
  }

  /**
   * O nível de agora, ou o inicial do conteúdo.
   *
   * Skill que nunca foi usada não tem entrada no mapa, e é assim de propósito: gravar o nível
   * inicial de toda skill em todo personagem é encher o snapshot com o valor padrão.
   */
  levelOf(definition: Skill): number {
    return this.#levels.get(definition.id) ?? definition.startingLevel;
  }

  /**
   * Soma pontos e sobe os níveis que couberem. Devolve quantos níveis subiram.
   *
   * Um laço, e não uma divisão: a curva é exponencial, então "quantos níveis cabem em N
   * pontos" não tem forma fechada barata. Na prática o laço roda zero ou uma vez — um golpe
   * não sobe dois níveis —, e o caso de muitos é um extrato antigo sendo aplicado.
   */
  gain(definition: Skill, points: number): number {
    if (points <= 0) return 0;
    let level = this.levelOf(definition);
    let total = (this.#points.get(definition.id) ?? 0) + points;

    let gained = 0;
    for (let needed = pointsForLevel(definition, level); total >= needed;) {
      total -= needed;
      level += 1;
      gained += 1;
      needed = pointsForLevel(definition, level);
    }

    this.#levels.set(definition.id, level);
    this.#points.set(definition.id, total);
    return gained;
  }

  /**
   * Absorve o estado de outro, ficando com o MAIOR de cada skill.
   *
   * Skill nunca desce, e é isso que torna o `max` a fusão certa — não uma escolha conservadora.
   * Existe para o extrato: um extrato antigo, processado fora de ordem, não pode rebaixar uma
   * skill que já subiu. É a mesma preocupação da guarda de instante da stamina, resolvida sem
   * precisar de instante nenhum porque a grandeza é monotônica.
   */
  static merge(current: SkillsState | undefined, incoming: SkillsState): SkillsState {
    const merged: Record<string, SkillState> = { ...(current ?? {}) };
    for (const [id, value] of Object.entries(incoming)) {
      const existing = merged[id];
      if (existing === undefined || higher(value, existing)) merged[id] = value;
    }
    return merged;
  }
}

/** Mais nível ganha; empatado no nível, mais pontos ganha. */
function higher(candidate: SkillState, champion: SkillState): boolean {
  if (candidate.level !== champion.level) return candidate.level > champion.level;
  return candidate.points > champion.points;
}

/**
 * O multiplicador de poder que uma skill dá. `1` quando ela está no nível inicial.
 *
 * Linear por nível, e é decisão provisória registrada no `_open` do conteúdo: no Tibia a
 * contribuição não é linear, e trocar a forma é trocar esta função — não espalhar coeficiente
 * por quem chama.
 */
export function powerMultiplier(definition: Skill, level: number): number {
  return 1 + definition.damagePerLevel * Math.max(0, level - definition.startingLevel);
}
