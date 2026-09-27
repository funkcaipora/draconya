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

import type { Progression, Skill, Vocation } from '@draconya/content';

/** Onde uma skill está: o nível e quanto já se acumulou rumo ao próximo. */
export interface SkillState {
  readonly level: number;
  readonly points: number;
}

/** Progresso até o próximo nível de uma skill: nível atual e percentual acumulado (#340, SV-04). */
export interface SkillProgress {
  readonly level: number;
  readonly percentToNext: number;
}

/** `skillId` → estado. Entra no snapshot e no extrato. */
export type SkillsState = Readonly<Record<string, SkillState>>;

/**
 * Mudança de nível de UMA skill — a mesma forma de `LevelChange` (`progression.ts`), duplicada
 * aqui de propósito: `progression.ts` já importa deste arquivo (`pointsForLevel`,
 * `skillFactorFor`), e importar `LevelChange` de volta criaria um ciclo só para reusar um
 * `{ from, to }`. `applyDeathPenalty` (#569) devolve esta forma para cada skill que perdeu nível.
 */
export interface SkillLevelChange {
  readonly from: number;
  readonly to: number;
}

/**
 * Quantos pontos faltam para sair de `level`.
 *
 * Fórmula e não tabela: tabela precisa ter fim, e o fim vira teto acidental que ninguém
 * decidiu. O expoente conta a partir do nível INICIAL — sem isso, uma skill que começa em 10
 * cobraria pelo décimo nível já no primeiro uso.
 *
 * **O custo é INTEIRO, e é TRUNCADO, não arredondado** (#521, ADR 0037 — correção de revisão).
 * `50 * 1.1` dá `55.000000000000007` em ponto flutuante; sem inteirar, o resto que sobra ao
 * fechar um nível carregaria esse lixo para o próximo, e para o seguinte — a mesma armadilha
 * que o `AGENTS.md` deste pacote registra sobre acumular `0,1` dez vezes. Mas o Tibia TRUNCA,
 * não arredonda: `Vocation::getReqSkillTries` do Canary faz
 * `static_cast<uint64_t>(skillBase[skill] * pow(multiplier, level - 11))`, e
 * `Vocation::getReqMana` faz `std::floor<uint64_t>(1600 * pow(manaMultiplier, magLevel - 1))` —
 * as duas descartam a fração, nunca arredondam para cima. `Math.round` aqui divergia do Tibia
 * sempre que o resultado exato cai acima de `,5`: um Knight subindo corpo a corpo do level 15
 * para o 16 precisa de `floor(50 × 1,1⁵) = 80` tries no Canary, e `Math.round` pedia 81 — um a
 * mais, todo nível, em quase toda vocação (só quem tem fator inteiro, como o Sorcerer/Druid em
 * algumas skills, escapava por coincidência). `Math.floor` é equivalente a `Math.trunc` aqui
 * porque o valor nunca é negativo.
 *
 * `factor` é OPCIONAL e por padrão cai no `curve.factor` do próprio conteúdo — o comportamento
 * de antes da #521. Quem sabe a vocação do personagem passa o fator dela (`skillFactorFor`,
 * abaixo): é o `<skill id multiplier="…">` do Tibia por vocação, e é ONDE ele muda a conta —
 * `base` continua vindo só do conteúdo da skill.
 */
export function pointsForLevel(
  definition: Skill, level: number, factor: number = definition.curve.factor,
): number {
  const steps = Math.max(0, level - definition.startingLevel);
  return Math.floor(definition.curve.base * factor ** steps);
}

/**
 * O fator de crescimento desta skill PARA a vocação dada — ou para "sem vocação nenhuma", à
 * moda do Tibia (#521, ADR 0037): `vocations.xml` tem um `<skill id multiplier="…">` por
 * vocação, e a vocação `None` (levels 1–7) tem o dela também. Aqui isso vira
 * `vocation.skillMultipliers`/`progression.skillMultipliers`, indexados pelo `id` da skill —
 * a mesma tabela cobre magic level, porque ML é só mais uma entrada dela no Canary
 * (`manamultiplier`).
 *
 * Ausente para este `skillId` nos dois: cai no `curve.factor` do próprio conteúdo da skill — o
 * padrão de quem não distingue vocação nenhuma (conteúdo de teste antigo).
 */
export function skillFactorFor(
  definition: Skill, vocation: Vocation | null, progression: Progression,
): number {
  const table = vocation?.skillMultipliers ?? progression.skillMultipliers;
  return table[definition.id] ?? definition.curve.factor;
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
  /**
   * Os pontos CRUS já acumulados rumo ao próximo nível — diferente de `progressOf`, que devolve
   * um PERCENTUAL inteiro tetado em 99 (feito para HUD). A penalidade de morte (#569) precisa do
   * valor exato para somar ao custo dos níveis já ultrapassados (`applyDeathPenalty`,
   * `progression.ts`); arredondar por um percentual erraria a soma total em até 1% do custo do
   * nível corrente.
   */
  pointsOf(definition: Skill): number {
    return this.#points.get(definition.id) ?? 0;
  }

  levelOf(definition: Skill): number {
    return this.#levels.get(definition.id) ?? definition.startingLevel;
  }

  progressOf(definition: Skill, factor?: number): SkillProgress {
    const level = this.levelOf(definition);
    const points = this.#points.get(definition.id) ?? 0;
    const needed = pointsForLevel(definition, level, factor);
    const percentToNext = needed > 0 ? Math.floor((points / needed) * 100) : 0;
    return { level, percentToNext: Math.min(99, percentToNext) };
  }

  /**
   * Soma pontos e sobe os níveis que couberem. Devolve quantos níveis subiram.
   *
   * Um laço, e não uma divisão: a curva é exponencial, então "quantos níveis cabem em N
   * pontos" não tem forma fechada barata. Na prática o laço roda zero ou uma vez — um golpe
   * não sobe dois níveis —, e o caso de muitos é um extrato antigo sendo aplicado.
   */
  gain(definition: Skill, points: number, factor?: number): number {
    if (points <= 0) return 0;
    let level = this.levelOf(definition);
    let total = (this.#points.get(definition.id) ?? 0) + points;

    let gained = 0;
    for (let needed = pointsForLevel(definition, level, factor); total >= needed;) {
      total -= needed;
      level += 1;
      gained += 1;
      needed = pointsForLevel(definition, level, factor);
    }

    this.#levels.set(definition.id, level);
    this.#points.set(definition.id, total);
    return gained;
  }

  /**
   * Perde `amount` pontos acumulados, descendo de nível quando faltar — o oposto de `gain`
   * (#569, `Player::death` do Canary/TFS). O piso é `definition.startingLevel`: para as skills
   * corpo a corpo isso é 10 (o `skills[i].level <= 10` do Canary), e para `magic` é 0 (o
   * `while (magLevel > 0)` do mesmo trecho) — o MESMO piso, generalizado pelo campo que já
   * distingue as duas, sem precisar de um caso especial para magia.
   *
   * O laço espelha o C++ ponto a ponto: enquanto a perda que falta aplicar for MAIOR que os
   * pontos que a skill tem, desconta os pontos inteiros, desce um nível e RECARREGA os pontos
   * com o custo cheio do nível novo (`pointsForLevel`, o `vocation->getReqSkillTries` de lá) —
   * é o que faz "cair um nível" custar exatamente o que ele custou para subir, nunca deixar um
   * resto negativo escondido. No piso, a perda que sobra é descartada: não existe nível abaixo
   * dele para "emprestar" pontos.
   *
   * **`Skills.merge` (fundir pelo maior) não protege mais o caminho durável do extrato.** A
   * morte quebra a monotonicidade que o merge assumia, e o ledger (#569,
   * `packages/server/src/jobs/ledger.ts`) passou a gravar o valor ABSOLUTO da sessão, guardado
   * por instante — a mesma solução que a XP já tinha por outra via (delta aditivo, que não
   * depende de ordem) e que a stamina já tinha por instante explícito.
   */
  lose(definition: Skill, amount: number, factor?: number): SkillLevelChange | null {
    if (amount <= 0) return null;
    const from = this.levelOf(definition);
    let level = from;
    let points = this.#points.get(definition.id) ?? 0;
    let remaining = amount;

    while (remaining > points && level > definition.startingLevel) {
      remaining -= points;
      level -= 1;
      points = pointsForLevel(definition, level, factor);
    }
    points = Math.max(0, points - remaining);

    this.#levels.set(definition.id, level);
    this.#points.set(definition.id, points);
    return level === from ? null : { from, to: level };
  }

  /**
   * Absorve o estado de outro, ficando com o MAIOR de cada skill.
   *
   * **Não é mais usado pelo caminho durável do extrato** (`packages/server/src/jobs/ledger.ts`)
   * desde o #569: a penalidade de morte pode DERRUBAR tries, e fundir pelo MAIOR reergueria a
   * perda se um extrato mais antigo chegasse depois de um mais novo já aplicado. O ledger
   * passou a gravar o valor ABSOLUTO da sessão, guardado por instante (`endedAtMs`), como a
   * stamina já fazia — não porque skill deixou de precisar de proteção contra extrato fora de
   * ordem, mas porque a proteção certa agora é "qual sessão terminou por último", não "qual
   * valor é maior".
   *
   * Continua existindo como utilidade pura: fundir pelo maior é a operação certa sempre que se
   * sabe, de antemão, que a grandeza só sobe (o Bestiário, por exemplo — `Bestiary.merge` — que
   * abate nunca desce). Para skill especificamente, essa premissa não vale mais.
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
