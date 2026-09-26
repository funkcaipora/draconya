// Bestiário (§18, FUN-113): abates por monstro, PERMANENTES, e o bônus de XP que os marcos dão.
//
// O motor sabe CONTAR abate e sabe quando um marco fecha; quais são os marcos e quanto cada
// um vale são conteúdo (`bestiary/baseline.json`), e mudar qualquer um dos dois é editar JSON.
// Sem conteúdo, o contador sobe do mesmo jeito — só não há marco nem bônus.
//
// **O contador é acumulador, e isso não briga com o invariante 2**, pela mesma razão das
// skills: o que a regra proíbe é grandeza dependente do TEMPO somada por tick; o que se soma
// aqui é abate, e abate é evento na fila — a morte que `resolveDeath` resolve no instante em
// que vence. A 1 Hz e a 10 Hz morrem os mesmos monstros nos mesmos instantes lógicos.
//
// **O bônus é GLOBAL** (DT-01): +1 % de XP PvE por marco alcançado em QUALQUER monstro, somado.
// O PRD diz "XP PvE permanente", não "XP daquele monstro"; por monstro seria uma segunda
// regra que o PRD não escreve — e que obrigaria o jogador a farmar o mesmo rato para colher o
// que plantou nele.

/** `monsterId` → abates. Entra no snapshot e no extrato, como `SkillsState`. */
export type BestiaryState = Readonly<Record<string, number>>;

/**
 * Os marcos e quanto cada um vale. É estruturalmente o `Bestiary` do conteúdo —
 * `content.bestiary` entra aqui sem adaptador —, declarado de novo para o `sim` só depender do
 * que usa: `id` e `_open` são assunto do carregador.
 */
export interface BestiaryConfig {
  /** Os abates de cada marco, CRESCENTES — o schema do conteúdo garante a ordem. */
  readonly milestones: readonly number[];
  /** Quanto cada marco acrescenta à XP PvE, em pontos percentuais. */
  readonly xpBonusPercentPerMilestone: number;
}

/** O que um abate rendeu ao Bestiário. Ver `Bestiary.record`. */
export interface BestiaryRecord {
  /** Abates deste monstro DEPOIS de contar este. */
  readonly kills: number;
  /** O marco (1-based) que ESTE abate alcançou, ou `null` — o caso de quase todos. */
  readonly milestoneReached: number | null;
}

export class Bestiary {
  readonly #kills = new Map<string, number>();

  static fromState(state?: BestiaryState): Bestiary {
    const bestiary = new Bestiary();
    if (state === undefined) return bestiary;
    for (const [monsterId, kills] of Object.entries(state)) bestiary.#kills.set(monsterId, kills);
    return bestiary;
  }

  /** Uma CÓPIA: quem guarda o estado para um snapshot não vê o abate seguinte aparecer nele. */
  getState(): BestiaryState {
    const state: Record<string, number> = {};
    for (const [monsterId, kills] of this.#kills) state[monsterId] = kills;
    return state;
  }

  /**
   * Abates deste monstro. Monstro nunca abatido não tem entrada, e é assim de propósito: gravar
   * zero para todo monstro do conteúdo em todo personagem é encher o snapshot com o padrão.
   */
  killsOf(monsterId: string): number {
    return this.#kills.get(monsterId) ?? 0;
  }

  /**
   * Conta um abate e diz se ele ALCANÇOU um marco.
   *
   * "Alcançou" é igualdade exata, e basta: o contador sobe de um em um, então cada limiar é
   * cruzado por exatamente um abate — o abate 10 000, e nenhum outro. Comparar por `>=` faria
   * todo abate depois do marco parecer o marco de novo, e o extrato ganharia uma linha por rato.
   *
   * Sem `config` não há marco a alcançar, mas o abate conta: a config é quem define marco, não
   * quem autoriza contar.
   */
  record(monsterId: string, config?: BestiaryConfig): BestiaryRecord {
    const kills = this.killsOf(monsterId) + 1;
    this.#kills.set(monsterId, kills);
    if (config === undefined) return { kills, milestoneReached: null };
    const index = config.milestones.indexOf(kills);
    return { kills, milestoneReached: index === -1 ? null : index + 1 };
  }

  /**
   * Quantos marcos o personagem já alcançou, somados sobre TODOS os monstros (DT-01).
   *
   * Uma varredura por chamada, e não um contador guardado: chamada acontece uma vez por abate,
   * que é evento raro perto do resto da fila, e o mapa tem uma entrada por monstro que o
   * personagem já matou — dezenas, não milhares. Guardar o total exigiria invalidá-lo quando a
   * config mudasse entre chamadas, e é o tipo de cache que fica errado em silêncio.
   */
  milestonesReached(config?: BestiaryConfig): number {
    if (config === undefined) return 0;
    let reached = 0;
    for (const kills of this.#kills.values()) {
      // Os marcos são crescentes: o primeiro que o contador não alcança encerra a contagem
      // deste monstro.
      for (const milestone of config.milestones) {
        if (kills < milestone) break;
        reached += 1;
      }
    }
    return reached;
  }

  /**
   * O bônus de XP dos marcos, em pontos percentuais INTEIROS (DT-01): `p × marcos`, somados
   * sobre todos os monstros. O abate que fecha o marco é pago pela regra de ANTES dele (DT-04)
   * porque quem chama lê este número antes de `record`.
   *
   * Devolve o PERCENTUAL, não a XP já multiplicada: quem compõe os bônus (o ruleset) SOMA este
   * número aos outros bônus (level, VIP, evento) e aplica UMA multiplicação em inteiro
   * (`applyExperienceBonus`, `progression.ts`). Um multiplicador em ponto flutuante não mora
   * aqui de propósito — quem quiser MOSTRAR o bônus soma os marcos e multiplica por `p` (é o
   * que o cliente faz).
   */
  xpBonusPercent(config?: BestiaryConfig): number {
    if (config === undefined) return 0;
    return config.xpBonusPercentPerMilestone * this.milestonesReached(config);
  }

  /**
   * Absorve o estado de outro, ficando com o MAIOR de cada monstro (DT-02).
   *
   * Abate nunca desce, e é isso que torna o `max` a fusão certa — não uma escolha conservadora.
   * Existe para o extrato: um extrato antigo, processado fora de ordem, não pode rebaixar um
   * contador que já subiu. É `Skills.merge` para uma grandeza mais simples: sem nível, sem
   * desempate, e comutativa pela mesma razão — monotônica.
   */
  static merge(current: BestiaryState | undefined, incoming: BestiaryState): BestiaryState {
    const merged: Record<string, number> = { ...(current ?? {}) };
    for (const [monsterId, kills] of Object.entries(incoming)) {
      const existing = merged[monsterId];
      if (existing === undefined || kills > existing) merged[monsterId] = kills;
    }
    return merged;
  }
}
