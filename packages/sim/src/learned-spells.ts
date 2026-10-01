// As magias aprendidas do personagem (#624, ADR 0058, ADR 0052 decisão 1) — o
// `Player::learnInstantSpell`/`hasLearnedInstantSpell` do Canary (`player.cpp`), que o
// `StdModule.learnSpell` dos NPCs chama depois de cobrar.
//
// **O cast confere isto** (`casting.ts`): no Canary o `toggleLearnSpells` vem ligado, então TODA
// magia instantânea exige `hasLearnedInstantSpell` (`Spell::playerSpellCheck`), e a runa não —
// runa é item (`supply` aqui) e exige só level e magic level. A CONJURAÇÃO de runa, que é magia,
// exige o aprendizado como qualquer outra.
//
// **É registro, não catálogo.** A lista guarda os ids de `content.spells` que o personagem
// comprou; o que cada magia custa (`learnPrice`), exige (`minLevel`, `vocationId`) e faz vive no
// conteúdo, fixado na sessão (invariante 7). Um id que sai do catálogo continua no registro — é
// dado do jogador (ADR 0014), e simplesmente não resolve nada.
//
// **Comprar é serviço, e o gold sai pelo `goldDelta`** (ADR 0052 d.3): `CharacterRuntime
// .learnSpell` confere e cobra numa transação só, e o host liquida `goldDelta` no mesmo extrato
// que grava este registro (invariante 10). Aprender duas vezes é recusado SEM cobrar — a
// idempotência que a issue pede é estrutural: o segundo pedido nunca chega ao débito.

import type { Spell } from '@draconya/content';

export interface LearnedSpellsState {
  /** Os ids de `content.spells` já aprendidos, sem repetição, na ordem em que foram comprados. */
  readonly spellIds: readonly string[];
  readonly version: number;
}

/** Versão do registro (ADR 0052 d.1, como `botConfig.version`) — migra sem coluna nova. */
export const LEARNED_SPELLS_STATE_VERSION = 1;

export function emptyLearnedSpellsState(): LearnedSpellsState {
  return { spellIds: [], version: LEARNED_SPELLS_STATE_VERSION };
}

/** O registro para um conjunto de ids — a forma que o teste e a migração de dado usam. */
export function learnedSpellsStateOf(spellIds: Iterable<string>): LearnedSpellsState {
  return { spellIds: [...new Set(spellIds)], version: LEARNED_SPELLS_STATE_VERSION };
}

/**
 * Por que `learn-spell` não aconteceu. A ordem é a do `StdModule.learnSpell` do Canary — "já
 * sabe", "não pode aprender" (vocação, level), "sem dinheiro" —, com `not-for-sale` na frente:
 * magia sem `learnPrice` não tem quem a ensine (Great Death Beam, que só a Wheel concede).
 */
export type LearnSpellRefusal =
  | 'unknown-spell'
  | 'not-for-sale'
  | 'already-learned'
  | 'wrong-vocation'
  | 'level-too-low'
  | 'insufficient-gold';

export type LearnSpellResult =
  | { readonly ok: true; readonly price: number }
  | { readonly ok: false; readonly reason: LearnSpellRefusal };

/** Quem aprende: só o que a regra lê, para o registro não conhecer `CharacterRuntime`. */
export interface Learner {
  readonly level: number;
  readonly vocationId: string | null;
  /** O saldo DISPONÍVEL — `gold + goldDelta`: um gasto anterior na mesma sessão já baixou o que sobra. */
  readonly gold: number;
}

export class LearnedSpells {
  readonly #ids = new Set<string>();
  #recorded: boolean;

  private constructor(state: LearnedSpellsState | undefined) {
    // `recorded`: este registro é a VERDADE do personagem, e não só o "nada" de quem chegou sem
    // registro nenhum (snapshot anterior a esta issue, ticket de um `api` antigo). A diferença
    // importa no extrato: o ledger funde por UNIÃO (`merge`), então um registro parcial não apaga
    // mais as magias que a migração 0024 concedeu (ADR 0014) — mas gravar o vazio de quem nunca
    // leu o registro seria inventar `{ spellIds: [] }` onde a linha diz `null`, e afirmar uma
    // verdade que a sessão não tem. O campo só viaja quando ela tem.
    this.#recorded = state !== undefined;
    for (const id of state?.spellIds ?? []) this.#ids.add(id);
  }

  static fromState(state?: LearnedSpellsState): LearnedSpells {
    return new LearnedSpells(state);
  }

  /**
   * Absorve o registro de outro extrato ao que já está gravado, ficando com a UNIÃO dos ids.
   *
   * Existe para o ledger, por duas razões que a última-escrita-vence NÃO cobre: (1) extratos
   * pendentes se aplicam em ordem qualquer (o `SCAN` do Redis não ordena), e o mais antigo
   * chegando depois do mais novo derrubaria a magia já paga; (2) um extrato que parte de uma
   * base DESCONHECIDA (sessão retomada de um snapshot sem registro que depois comprou uma
   * magia) carrega só as compras dela, e escreveria por cima da concessão da migração (ADR
   * 0014).
   *
   * O registro só CRESCE: o único caminho que esquece magia no Canary é a Wheel of Destiny
   * (`forgetInstantSpell` em `player_wheel.cpp`, ao refazer a Roda), e a Roda está fora do jogo
   * (ADR 0058, Emenda 2026-09-29). É isso que torna a união a fusão certa, não uma escolha
   * conservadora — e o dia em que uma magia puder ser revogada, a revogação é uma migração de
   * dado VERSIONADA (ADR 0014), não um efeito colateral da última-escrita-vence. Comutativa,
   * associativa e idempotente, como `Bestiary.merge` e `Skills.merge`.
   *
   * A ordem é a de quem já estava gravado, seguida pelas novas na ordem do extrato: o registro
   * continua na ordem em que as magias foram aprendidas.
   */
  static merge(current: LearnedSpellsState | undefined, incoming: LearnedSpellsState): LearnedSpellsState {
    return learnedSpellsStateOf([...(current?.spellIds ?? []), ...incoming.spellIds]);
  }

  /**
   * O registro chegou com a sessão (`fromState` com estado), ou mudou nela (`learn`/`grant`) — e
   * então vale ser gravado. Falso é "esta sessão não sabe o que o personagem aprendeu": o extrato
   * OMITE o campo e o ledger não toca na coluna.
   */
  get recorded(): boolean {
    return this.#recorded;
  }

  /** Uma CÓPIA — quem guarda para um snapshot não vê a compra seguinte aparecer nele. */
  getState(): LearnedSpellsState {
    return { spellIds: [...this.#ids], version: LEARNED_SPELLS_STATE_VERSION };
  }

  has(spellId: string): boolean {
    return this.#ids.has(spellId);
  }

  get size(): number {
    return this.#ids.size;
  }

  /**
   * Confere se `learner` pode aprender `spell` agora, SEM mutar nada. É a mesma checagem que
   * `learn` faz — separada para a tela poder perguntar sem comprar, e para a regra existir num
   * lugar só (invariante 4 vale do mesmo jeito: quem decide de verdade é o servidor).
   */
  check(spell: Spell | undefined, learner: Learner): LearnSpellResult {
    if (spell === undefined) return { ok: false, reason: 'unknown-spell' };
    if (spell.learnPrice === undefined) return { ok: false, reason: 'not-for-sale' };
    if (this.#ids.has(spell.id)) return { ok: false, reason: 'already-learned' };
    // A mesma régua do cast (`castSpell`): vocação exigida, e só depois o level.
    if (spell.vocationId !== undefined && learner.vocationId !== spell.vocationId) {
      return { ok: false, reason: 'wrong-vocation' };
    }
    if (learner.level < spell.minLevel) return { ok: false, reason: 'level-too-low' };
    if (learner.gold < spell.learnPrice) return { ok: false, reason: 'insufficient-gold' };
    return { ok: true, price: spell.learnPrice };
  }

  /**
   * Concede a magia SEM conferir nem cobrar nada — o `Player::learnInstantSpell` do Canary puro,
   * que o `StdModule.learnSpell` chama depois de cobrar e que o Wheel of Destiny chama direto
   * (`player_wheel.cpp`, como concede a Great Death Beam). Hoje ninguém a usa em produção: a
   * compra passa por `learn`, e a migração de dado é SQL. Existe para o dia em que uma fonte
   * que não é NPC entrar — e para o teste montar o personagem que já sabe a magia. Devolve se a
   * magia era NOVA; conceder duas vezes não muda nada.
   */
  grant(spellId: string): boolean {
    this.#recorded = true;
    if (this.#ids.has(spellId)) return false;
    this.#ids.add(spellId);
    return true;
  }

  /**
   * Marca a magia como aprendida SE `check` deixar. Não cobra: o gold é do
   * `CharacterRuntime.learnSpell`, que chama isto e debita `goldDelta` na mesma transação.
   */
  learn(spell: Spell | undefined, learner: Learner): LearnSpellResult {
    const verdict = this.check(spell, learner);
    if (verdict.ok && spell !== undefined) {
      this.#ids.add(spell.id);
      this.#recorded = true;
    }
    return verdict;
  }
}
