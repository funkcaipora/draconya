// A fala periódica do monstro (#620, `monster.voices` do Canary), em números.
//
// Puro, como `effects.ts`: é a conta de "quando este monstro fala, o quê, e quem ouve". **O sorteio
// é do CLIENTE**, e isso é a regra da issue — nunca o `Rng` da sessão, nunca o servidor. A fala não
// muda resultado nenhum (invariante 3), então ninguém além da tela precisa saber dela, e sortear
// fora da sessão é o que garante que olhar ou não olhar não mexe na hunt. O teste injeta o
// `random`; em produção é `Math.random`, como em `net/backoff.ts`.
//
// O mecanismo é o de `Monster::onThinkYell` do Canary: um relógio por monstro que acumula até
// `intervalMs`, zera, e então rola `chance >= uniform_random(1, 100)`; passou, diz UMA linha
// sorteada por igual. Os NÚMEROS (intervalo, chance, linhas) vêm do conteúdo; o que é
// apresentação pura e nossa é quanto o balão fica na tela e a cor, abaixo.
//
// **E dois portões, que o Canary tem e o `onThinkYell` sozinho não mostra:**
//
// - O relógio só ANDA com o monstro acordado. `Monster::onThink_async` devolve no topo quando
//   `isIdle`, e o `onThinkYell` só é alcançado depois dele: o monstro parado no spawn, sem ninguém
//   à vista, não acumula `yellTicks` nem fala. Aqui o "acordado" é a pergunta que o servidor já
//   responde para o movimento (`canSeePoint`, o quadrado de 11 tiles do `Creature::canSee`), feita
//   com o herói de quem olha — ver `monsterAwake` e a aproximação que ela é.
// - A fala só CHEGA a quem está perto. `Game::internalCreatureSay` manda o `say` aos jogadores a
//   até 8 colunas e 6 linhas do monstro, no mesmo andar; o `yell`, a 18 × 14 e em vários andares.
//   Fora disso a rolagem acontece e ninguém a vê — ver `speechHeard`.

import type { CreatureVoices } from '@draconya/protocol';
import { tibiaRgb } from './minimap.js';

/** Uma fala escolhida: o texto e se é grito (`TALKTYPE_MONSTER_YELL`). */
export interface Utterance {
  readonly text: string;
  readonly yell: boolean;
}

/**
 * O relógio de UM monstro: o `yellTicks` do Canary. `elapsedMs` é quanto do intervalo já correu
 * COM O MONSTRO ACORDADO; `lastMs` é o instante da última chamada, para medir o que correu desde
 * então.
 */
export interface SpeechState {
  elapsedMs: number;
  lastMs: number;
}

/**
 * O relógio de um monstro recém-visto: zerado, como o `yellTicks` do Canary — a primeira rolagem
 * é depois de `intervalMs` de monstro ACORDADO.
 */
export function startSpeech(nowMs: number): SpeechState {
  return { elapsedMs: 0, lastMs: nowMs };
}

/**
 * Anda o relógio e, se venceu, rola. Devolve a fala, ou `null` (ainda não venceu, o monstro está
 * ocioso, ou venceu e a chance não passou).
 *
 * **O monstro ocioso NÃO acumula** (`awake` falso): é o `if (isIdle) return` do topo de
 * `Monster::onThink_async`, que nunca chega ao `onThinkYell`. O tempo que passou fica de fora e o
 * que já tinha corrido fica guardado — acordar não zera o `yellTicks`, só o deixa andar de novo.
 *
 * **Vencer zera**, e nunca soma o atraso: um quadro que chega depois de uma aba em segundo plano
 * (o laço de quadro para) rola UMA vez, e não uma vez por intervalo perdido — o monstro não fala
 * dez vezes seguidas ao voltar. É o `yellTicks = 0` do Canary.
 *
 * `random` devolve `[0, 1)`. A rolagem é `uniform(1, 100) <= chance`, e a linha é
 * `uniform(0, n - 1)` — as duas conferidas em `Monster::onThinkYell`. Quem decide se a fala foi
 * OUVIDA é `speechHeard`: a rolagem acontece, e gasta o sorteio, ouvindo alguém ou não.
 */
export function rollSpeech(
  voices: CreatureVoices, state: SpeechState, nowMs: number, awake: boolean, random: () => number,
): Utterance | null {
  const elapsed = Math.max(0, nowMs - state.lastMs);
  state.lastMs = nowMs;
  if (!awake) return null;
  state.elapsedMs += elapsed;
  if (state.elapsedMs < voices.intervalMs) return null;
  state.elapsedMs = 0;
  const roll = Math.floor(random() * 100) + 1;
  if (roll > voices.chance) return null;
  const index = Math.min(voices.lines.length - 1, Math.floor(random() * voices.lines.length));
  const line = voices.lines[index];
  return line === undefined ? null : { text: line.text, yell: line.yell === true };
}

/** Um ponto do mundo para as perguntas de alcance: tile e andar. */
export interface SpeechPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** `MAP_INIT_SURFACE_LAYER` do Canary (`src/map/map_const.hpp`): o último andar de superfície. */
const SURFACE_LAYER = 7;
/** `MAP_LAYER_VIEW_LIMIT`: do subsolo, quantos andares acima e abaixo se enxerga. */
const LAYER_VIEW_LIMIT = 2;
/** `MAP_MAX_LAYERS - 1`: o último andar do mapa. */
const LAST_FLOOR = 15;

/**
 * O quadrado que o monstro ENXERGA, em tiles (`MAP_MAX_VIEW_PORT_X`/`_Y` = 11, o mesmo raio dos
 * dois eixos de `Creature::canSee`). É o `aggroRadius` do monstro: 11 em todo o catálogo, e o que o
 * `sim` usa para a lista de alvos e o ocioso (`canSeePoint`, `monster/step.ts`).
 */
export const MONSTER_VIEW_RANGE = 11;
/** O alcance do `say`, em tiles: `MAP_MAX_CLIENT_VIEW_PORT_X` (8) e `_Y` (6), no mesmo andar. */
export const SAY_RANGE = { x: 8, y: 6 } as const;
/** O do `yell`: `(MAP_MAX_CLIENT_VIEW_PORT + 1) * 2` — 18 × 14 —, em vários andares. */
export const YELL_RANGE = { x: 18, y: 14 } as const;

/**
 * O monstro em `monster` está ACORDADO para quem está em `hero`? É o `!isIdle` do Canary reduzido
 * ao que o cliente sabe: o herói de quem olha está no quadrado de 11 tiles que o monstro enxerga
 * (`Creature::canSee`, `creature.cpp:68-87`) — a lista de alvos não vazia.
 *
 * **É uma aproximação**, e o Canary diz outra coisa em dois casos: o monstro que não está no spawn
 * (voltando para casa) ou que tem uma condição ativa (fogo, veneno, haste) NÃO fica ocioso mesmo
 * sem alvo, e continua falando; e um alvo que seja OUTRO membro da party o acorda para quem está
 * longe dele. O cliente não sabe do spawn nem das condições do monstro, e o estado ocioso não
 * existe no protocolo — mandá-lo seria um evento novo do `sim` só para uma fala. O que se perde é
 * pouco: o `say` só chega a 8 × 6 tiles, sempre dentro dos 11 que acordam o monstro, então só o
 * GRITO (18 × 14) de quem está entre 12 e 18 tiles do herói pode faltar.
 */
export function monsterAwake(monster: SpeechPoint, hero: SpeechPoint): boolean {
  if (monster.z <= SURFACE_LAYER) {
    if (hero.z > SURFACE_LAYER) return false;
  } else if (Math.abs(monster.z - hero.z) > LAYER_VIEW_LIMIT) {
    return false;
  }
  // A caixa se desloca em `monster.z - hero.z` tiles por andar: é a perspectiva do cliente.
  const offsetZ = monster.z - hero.z;
  return hero.x >= monster.x - MONSTER_VIEW_RANGE + offsetZ && hero.x <= monster.x + MONSTER_VIEW_RANGE + offsetZ
    && hero.y >= monster.y - MONSTER_VIEW_RANGE + offsetZ && hero.y <= monster.y + MONSTER_VIEW_RANGE + offsetZ;
}

/**
 * Os andares que o grito alcança, a partir do andar do monstro (`Spectators::getSpectators`
 * multifloor, `spectators.cpp:125-139`): do subsolo, dois acima e dois abaixo; nos andares 6 e 7,
 * da superfície até dois abaixo dele; mais acima, só a superfície.
 */
function yellFloors(z: number): readonly [number, number] {
  if (z > SURFACE_LAYER) return [Math.max(z - LAYER_VIEW_LIMIT, 0), Math.min(z + LAYER_VIEW_LIMIT, LAST_FLOOR)];
  if (z === SURFACE_LAYER - 1 || z === SURFACE_LAYER) return [0, z + LAYER_VIEW_LIMIT];
  return [0, SURFACE_LAYER];
}

/**
 * A fala do monstro em `monster` CHEGA ao herói em `hero`? É o filtro de `Game::internalCreatureSay`
 * (`game.cpp:7634-7637`): o `say` vai a quem está a até 8 colunas e 6 linhas, NO MESMO andar; o
 * `yell`, a até 18 × 14, em vários andares — e aí a caixa se desloca por andar, como no
 * `monsterAwake`. A fronteira é inclusiva: 8 ouve, 9 não; 6 ouve, 7 não.
 */
export function speechHeard(monster: SpeechPoint, hero: SpeechPoint, yell: boolean): boolean {
  if (!yell) {
    return monster.z === hero.z
      && Math.abs(hero.x - monster.x) <= SAY_RANGE.x && Math.abs(hero.y - monster.y) <= SAY_RANGE.y;
  }
  const [lowest, highest] = yellFloors(monster.z);
  if (hero.z < lowest || hero.z > highest) return false;
  const offsetZ = monster.z - hero.z;
  return Math.abs(hero.x - offsetZ - monster.x) <= YELL_RANGE.x
    && Math.abs(hero.y - offsetZ - monster.y) <= YELL_RANGE.y;
}

/**
 * A cor da fala: o laranja do índice 198 da paleta de 216 cores do Tibia — a mesma do automapa e
 * da luz. **É escolha NOSSA, e não um valor do Canary:** o servidor manda só o tipo de fala
 * (`TALKTYPE_MONSTER_SAY`/`_YELL`), a posição e o texto (`ProtocolGame::sendCreatureSay`), e quem
 * escolhe a cor é o cliente do Tibia a partir do tipo. O 198 é só o laranja que aproxima o dele
 * (coincide com o `TEXTCOLOR_ORANGE` que o servidor usa em outro lugar, o dano de fogo).
 */
export const SPEECH_COLOR: number = (() => {
  const [r, g, b] = tibiaRgb(198);
  return (r << 16) | (g << 8) | b;
})();

/** O balão fica ao menos isto na tela — apresentação nossa, o Canary não tem um número. */
export const SPEECH_MIN_MS = 2500;
/** E mais isto por caractere, para a fala longa dar tempo de ler. */
export const SPEECH_MS_PER_CHARACTER = 50;

/** Quanto tempo a fala de `text` fica sobre o monstro. */
export function speechDurationMs(text: string): number {
  return SPEECH_MIN_MS + SPEECH_MS_PER_CHARACTER * text.length;
}
