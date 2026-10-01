// A esfola de cadáver (#626, M44-08; ADR 0048 d.5/d.6, ADR 0053 d.5): a matemática do
// `data-otservbr-global/scripts/actions/tools/skinning.lua` do Canary (`47dfd51`) e do charm
// Scavenge. PURO: sem sessão, sem relógio, sem escrita — quem decide QUANDO esfolar (o abate, no
// caso do bot; o `use-item-on`, no manual), de quem e para onde vai o material é o ruleset da
// hunt, com o `session.rng`. Só o mecanismo é transcrito (ADR 0019): a janela por estágio do
// cadáver, a escala da chance, o efeito do charm e a ordem do sorteio.
//
// **A janela é por ESTÁGIO, não pela vida inteira do cadáver.** O Canary confere o id do item
// que o cadáver é agora (`config[ferramenta][target.itemid]`), e o cadáver troca de id a cada
// estágio da cadeia de decaimento. O Dragon (`5973` 10 s → `4025` 300 s → `4026` 300 s → `4027`
// 60 s) é esfolável nos dois primeiros e não nos dois últimos: `Skinning.stages` guarda só os
// estágios esfoláveis, com a duração de cada um, e a janela termina quando eles acabam.
//
// **Um sorteio, uma tentativa.** `math.random(1, chanceRange)` e sucesso quando `random <= value`.
// Com sucesso ou sem ele o cadáver vira o "esfolado" (`topItem:transform(skin.after)`), que não é
// chave de tabela nenhuma — esfola-se uma vez só. O ruleset guarda isso em `CorpseState.skinned`.
//
// **A exceção é o ramo garantido da faca** (`guaranteedStageAt`): o `skinning.lua` confere
// `target.itemid == 4301` antes da tabela e rende o pé de coelho sem sorteio e sem `transform`, então
// o cadáver do coelho no 2º estágio (10 s a 310 s) rende a cada uso sem nunca ser gasto.

import {
  SKINNING_CHANCE_SCALE, type Charm, type Skinning, type SkinningGuaranteedStage, type SkinningStage,
} from '@draconya/content';
import type { Rng } from './rng.js';

/** O id do charm no catálogo importado (`content/data/charms/generated/charms.json`). */
export const SCAVENGE_CHARM_ID = 'scavenge';

/**
 * Quantos estágios do cadáver do monstro do charm a comparação do Scavenge enxerga: o próprio
 * id e o de DEPOIS dele (`charmCorpse == target.itemid or ItemType(charmCorpse):getDecayId() ==
 * target.itemid`, `skinning.lua`) — o segundo estágio da cadeia, e nenhum outro.
 */
const SCAVENGE_STAGES = 2;

/**
 * O estágio esfolável em que o cadáver está `ageMs` depois da morte, ou `null` quando a janela
 * já fechou. A fronteira pertence ao estágio SEGUINTE: no instante em que o cadáver decai para
 * o próximo id, é o id novo que a ferramenta encontra.
 */
export function skinningStageAt(entry: Skinning, ageMs: number): SkinningStage | null {
  if (ageMs < 0) return null;
  let end = 0;
  for (const stage of entry.stages) {
    end += stage.durationMs;
    if (ageMs < end) return stage;
  }
  return null;
}

/**
 * O estágio GARANTIDO em que o cadáver está `ageMs` depois da morte, ou `null`. É o ramo
 * `target.itemid == 4301` da faca, que o `skinning.lua` confere ANTES da tabela: o segundo estágio
 * do cadáver do coelho rende o pé de coelho sem sorteio, sem quest e sem transformar o cadáver —
 * quem chama NÃO marca `skinned`, NÃO reinicia o decaimento e NÃO toca o `session.rng`. A
 * fronteira pertence ao estágio seguinte, como em `skinningStageAt`; o cadáver já esfolado nunca
 * chega aqui (o `transform(skin.after)` o tirou do id que o ramo confere), e quem decide isso é o
 * chamador, pelo `CorpseState.skinned`.
 */
export function guaranteedStageAt(entry: Skinning, ageMs: number): SkinningGuaranteedStage | null {
  if (ageMs < 0) return null;
  for (const stage of entry.guaranteed ?? []) {
    if (ageMs >= stage.startMs && ageMs < stage.startMs + stage.durationMs) return stage;
  }
  return null;
}

/**
 * O charm Scavenge de quem esfola, quando ele vale para ESTE cadáver: a `chance` do tier
 * (`getCharmChance(CHARM_SCAVENGE)`, 60/90/120) ou `undefined`.
 *
 * O Canary decide pelo ITEM, não pelo monstro: o charm vale quando o cadáver que está sendo
 * esfolado é o do monstro escolhido — o `monster.corpse` dele — ou o estágio seguinte da cadeia
 * dele. Monstros que compartilham o cadáver compartilham o charm (o Scavenge no Minotaur vale
 * para o Minotaur Bruiser, e o do Demon para o Orshabaal). Por isso a comparação é pelo id do
 * item do estágio em que o alvo está agora, contra os dois primeiros estágios do monstro do charm.
 * Um monstro escolhido que não é esfolável não tem estágio nenhum a comparar — nenhum cadáver
 * esfolável passa por um id que ele não tem — e o charm não vale.
 */
export function scavengeChanceFor(
  charm: Charm | undefined, tier: number, assignedTo: Skinning | undefined, target: SkinningStage,
): number | undefined {
  if (charm === undefined || assignedTo === undefined || tier < 1 || tier > 3) return undefined;
  const ids = assignedTo.stages.slice(0, SCAVENGE_STAGES).map((stage) => stage.canaryItemId);
  if (!ids.includes(target.canaryItemId)) return undefined;
  return charm.chance[tier - 1];
}

/**
 * O `chanceRange` do sorteio. Sem o charm é a escala inteira (`100000`); com ele o Canary
 * ENCOLHE o intervalo — `chanceRange * charmChance / 100` — em vez de somar à chance: o
 * `value` (25 000) continua o mesmo, e a probabilidade vira `value / range`. Reproduzido como
 * está, inclusive o que o número tem de estranho: o charm vem como 60/90/120 e o intervalo
 * cresce com ele, então o tier 1 (60 → 41,7 %) é o melhor, o tier 2 (90 → 27,8 %) mal passa dos
 * 25 % e o tier 3 (120 → 20,8 %) fica ABAIXO da chance sem charm — a fórmula do `47dfd51`, e a
 * PR do #626 a lista para o dono rever. `charmChance == 0` vira `1` (o `guarantee that the chance
 * will never be 0` do Lua), e o intervalo é truncado como o `math.random` do LuaJIT o trunca.
 */
export function skinningChanceRange(scavengeChance: number | undefined): number {
  if (scavengeChance === undefined) return SKINNING_CHANCE_SCALE;
  const charm = scavengeChance === 0 ? 1 : scavengeChance;
  return Math.max(1, Math.floor((SKINNING_CHANCE_SCALE * charm) / 100));
}

/**
 * O sorteio: UMA rolagem de `session.rng`, `1..range`, sucesso quando `random <= chance`. Quem
 * chama já decidiu que há ferramenta, monstro esfolável e janela aberta — é isso que faz o
 * caminho sem ferramenta não consumir sorteio nenhum.
 */
export function rollSkinning(rng: Rng, entry: Skinning, range: number): boolean {
  return rng.integer(1, range) <= entry.chance;
}
