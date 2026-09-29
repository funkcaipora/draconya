// A postura de luta do jogador — o `fightMode` do Canary (M30-03, #550; ADR 0040 decisão 1).
//
// Três modos, e os TRÊS fatores que cada um liga vêm do Canary, cada um em uma escala própria
// (a mesma postura, três tabelas — por isso três funções, e não uma):
//
//   - `attackFactorFor`            → `Player::getAttackFactor`        (`player.cpp:840-851`):
//     multiplica o MÁXIMO do dano de arma (`Weapons::getMaxWeaponDamage`) — 1.0 / 0.75 / 0.5;
//   - `defenseFactorFor`           → `Player::getDefenseFactor(false)` (`player.cpp:853-872`):
//     multiplica a DEFESA de `Player::getDefense` — 0.5·0.75·1.0 SÓ enquanto o jogador bateu há
//     menos de um intervalo de ataque, senão 1.0 (ver `attackedRecently`);
//   - `mitigationFightFactorFor`   → o `fightFactor` de `PlayerWheel::calculateMitigation`
//     (`player_wheel.cpp:4078-4090`), o mesmo `Player::getCombatTacticsMitigation`
//     (`player.cpp:754-774`): 0.8 / 1.0 / 1.2, estático.
//
// O default do Canary é `FIGHTMODE_ATTACK` (`player.hpp:1857`). Chase mode e secure mode ficam de
// FORA (ADR 0037 d.2: a perseguição é do bot, e o modo seguro é regra de PvP).
//
// Fórmula ORIGINAL em TypeScript a partir do MECANISMO descrito pelo Canary — nunca código
// copiado, traduzido ou adaptado linha a linha (ADR 0019). Funções PURAS: sem relógio, sem RNG.

/** Os três modos, na ordem do Canary (`FIGHTMODE_ATTACK`=1, `BALANCED`=2, `DEFENSE`=3). */
export const FIGHT_MODES = ['attack', 'balanced', 'defense'] as const;
export type FightMode = (typeof FIGHT_MODES)[number];

/** O modo de quem nunca escolheu: `Player::fightMode = FIGHTMODE_ATTACK` (`player.hpp:1857`). */
export const DEFAULT_FIGHT_MODE: FightMode = 'attack';

/** Defensivo contra dado que vem de fora do `sim` (a coluna do banco, o ticket, o snapshot). */
export function isFightMode(value: unknown): value is FightMode {
  return typeof value === 'string' && (FIGHT_MODES as readonly string[]).includes(value);
}

/**
 * O fator do MÁXIMO do dano de arma (`Player::getAttackFactor`): ofensivo bate cheio, balanceado
 * perde um quarto, defensivo perde metade. Entra em `resolveWeaponPower` — corpo a corpo, punho e
 * distância (`weapons.cpp`: `getMaxWeaponDamage(…, attackFactor, …)`); wand/rod não o leem.
 */
export function attackFactorFor(fightMode: FightMode): number {
  switch (fightMode) {
    case 'attack': return 1;
    case 'balanced': return 0.75;
    case 'defense': return 0.5;
  }
}

/**
 * O fator da DEFESA (`Player::getDefenseFactor(sendToClient = false)`) — a variante DINÂMICA, a
 * que `Creature::blockHit` consome: nos modos ofensivo e balanceado a defesa cai (0.5 / 0.75)
 * enquanto o jogador está batendo — `recentlyAttacked` — e volta a 1.0 quando ele parou por um
 * intervalo de ataque inteiro; o modo defensivo é 1.0 sempre. (A variante ESTÁTICA, 0.5/0.75/1.0
 * sem olhar o relógio, é o que o Canary MANDA AO CLIENTE para o painel de stats — apresentação,
 * fora do resultado da caça.)
 */
export function defenseFactorFor(fightMode: FightMode, recentlyAttacked: boolean): number {
  switch (fightMode) {
    case 'attack': return recentlyAttacked ? 0.5 : 1;
    case 'balanced': return recentlyAttacked ? 0.75 : 1;
    case 'defense': return 1;
  }
}

/**
 * O `fightFactor` da mitigação percentual (`PlayerWheel::calculateMitigation`): DIFERENTE dos
 * dois acima — mesma postura, escala própria. Estático: não olha o relógio de ataque.
 */
export function mitigationFightFactorFor(fightMode: FightMode): number {
  switch (fightMode) {
    case 'attack': return 0.8;
    case 'balanced': return 1;
    case 'defense': return 1.2;
  }
}

/** O empate sem golpe pendente: a janela é a comparação estrita do Canary, sem exceção. */
const NO_SWING_DUE = (): boolean => false;

/**
 * `(OTSYS_TIME() - lastAttack) < getAttackSpeed()` — o jogador bateu há MENOS de um intervalo de
 * ataque? `lastAttackAtMs` é o instante LÓGICO da sessão em que o último golpe de arma saiu
 * (`Player::updateLastAttack`, só em `doAttacking` quando `useWeapon`/`useFist` devolve `true`);
 * `null` é "nunca bateu nesta sessão". `attackSpeedMs` é `Player::getAttackSpeed()` — o intervalo
 * entre golpes, o `combat.player.attackIntervalMs` do conteúdo (2000 ms no Canary).
 *
 * Comparação ESTRITA, como a do Canary: exatamente um intervalo depois, o jogador já não está
 * "batendo" — o golpe seguinte é que reabre a janela. Um carimbo NO FUTURO (`lastAttackAtMs >
 * nowMs`) nunca é recente: o relógio é da sessão que o gravou, e um carimbo de outra sessão —
 * cujo relógio já andou mais — não diz nada sobre esta (a entrada já o zera, ver `Session.enter`;
 * isto é o cinto por cima do suspensório, para a função ser total em qualquer relógio).
 *
 * **O empate exato (`agora − lastAttack == attackSpeed`) tem uma exceção, e ela é do relógio
 * discreto.** No Canary o golpe seguinte de quem bate sem parar corre `attackSpeed` DEPOIS do
 * anterior MAIS a latência do despachante — nunca antes —, e um golpe de monstro só cai nessa
 * fresta de poucos ms por ciclo: quem bate sem parar está, na prática, SEMPRE dentro da janela.
 * Aqui o monstro e o herói que chegaram juntos batem no MESMO ms para sempre (as duas cadências
 * nascem no mesmo instante), e a ordem de duas ações no mesmo ms é só a ordem da fila — sem esta
 * exceção, o golpe que sai da fila ANTES do golpe do herói veria a janela fechada TODA vez, e o
 * mesmo herói, com o mesmo monstro, teria a defesa cheia numa geometria e pela metade na outra.
 * `swingDueNow` diz se o golpe do herói está agendado para ESTE ms e ainda não rodou: só então o
 * empate conta como janela aberta. Sem golpe pendente (o herói parou) o empate é a comparação
 * estrita de sempre — e o reflexo do PRÓPRIO golpe, que roda depois de o evento do golpe ter
 * saído da fila, também a enxerga fechada, como o Canary (o carimbo é reescrito depois dele).
 * É uma função (e não um booleano) porque olhar a fila custa uma varredura, e só o empate exato
 * precisa dela.
 */
export function attackedRecently(
  lastAttackAtMs: number | null, nowMs: number, attackSpeedMs: number,
  swingDueNow: () => boolean = NO_SWING_DUE,
): boolean {
  if (lastAttackAtMs === null || lastAttackAtMs > nowMs) return false;
  const elapsedMs = nowMs - lastAttackAtMs;
  if (elapsedMs < attackSpeedMs) return true;
  return elapsedMs === attackSpeedMs && swingDueNow();
}
