// Stamina (FUN-39, §10).
//
// **Não é um recurso "ticado".** Não existe job decrementando nada: guarda-se quanto sobra e
// o instante em que aquele valor valia, e o valor de agora é CALCULADO quando alguém pergunta.
// Um personagem parado três dias custa exatamente zero.
//
// Isso importa além da regra de jogo: a stamina é o principal freio de custo de infraestrutura
// do projeto, porque o teto de simulação é `2 × contas ativas` (ADR 0001). Um mecanismo que
// custasse por personagem parado atacaria justamente o número que ele existe para proteger.
//
// Há DOIS relógios aqui, e confundi-los é o erro:
//
//   dentro da hunt   o consumo é por `dtMs` simulado, como tudo mais em `sim` (invariante 2)
//   fora da hunt     a recuperação é por tempo de RELÓGIO, e o relógio entra por parâmetro
//
// A separação é o que permite as duas coisas ao mesmo tempo: uma hunt desanexada a 1 Hz
// consome stamina igual à anexada a 10 Hz, e um personagem deslogado recupera sem ninguém
// simular nada.

import type { Stamina } from '@draconya/content';
import type { CharacterRuntime } from './character.js';

/**
 * Quanta stamina o personagem tem AGORA, estando fora de hunt.
 *
 * O teto é aplicado na LEITURA, não só na escrita: parado três dias, o personagem não pode
 * ler 72 horas. Aplicar só na escrita funciona enquanto alguém escreve, e o caso inteiro
 * desta função é justamente ninguém ter escrito nada.
 */
export function recoveredStaminaMs(
  staminaMs: number,
  updatedAtMs: number,
  nowMs: number,
  rules: Stamina,
): number {
  // Relógio para trás não devolve stamina. Acontece com ajuste de horário e com NTP, e a
  // alternativa — deixar a subtração passar — daria stamina de graça a quem mexesse no
  // relógio da própria máquina, se algum dia o instante viesse do cliente.
  const elapsedMs = Math.max(0, nowMs - updatedAtMs);
  return clampStamina(staminaMs + elapsedMs * rules.recoveryRatio, rules);
}

/** Fixa a stamina no instante dado. É o "materializar" ao entrar e ao sair de hunt. */
export function materializeStamina(
  character: CharacterRuntime,
  nowMs: number,
  rules: Stamina,
): void {
  if (character.staminaMs === null) return;
  character.staminaMs = recoveredStaminaMs(
    character.staminaMs, character.staminaUpdatedAtMs, nowMs, rules,
  );
  character.staminaUpdatedAtMs = nowMs;
}

/**
 * Consome o tempo decorrido de hunt. Devolve `true` quando ESTA chamada zerou a stamina.
 *
 * Por `dtMs`, nunca por tick (invariante 2), e por isso não toca em `staminaUpdatedAtMs`:
 * aquele campo é o marco da recuperação FORA da hunt, e mexer nele aqui faria o tempo de
 * hunt contar duas vezes — uma consumindo, outra recuperando.
 */
export function drainStamina(
  character: CharacterRuntime,
  dtMs: number,
  rules: Stamina,
): boolean {
  if (character.staminaMs === null || character.staminaMs === 0) return false;
  character.staminaMs = clampStamina(character.staminaMs - dtMs, rules);
  return character.staminaMs === 0;
}

/** `true` quando a stamina zerou — o que bloqueia recompensa e NÃO encerra a hunt (§10.2). */
export function isExhausted(character: CharacterRuntime): boolean {
  return character.staminaMs === 0;
}

const clampStamina = (value: number, rules: Stamina): number =>
  Math.min(rules.maxMs, Math.max(0, Math.round(value)));
