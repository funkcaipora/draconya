// De personagem para sessão de Cidade (FUN-13).
//
// Todo personagem está sempre em EXATAMENTE uma sessão, cidade inclusive (invariante 8).
// Entrar no jogo, portanto, nunca é "ficar sem sessão até escolher uma hunt": é entrar na
// sessão de Cidade, que é orientada a evento e custa perto de zero.

import { randomUUID } from 'node:crypto';
import { CharacterRuntime, Rng, Session, createCityRuleset } from '@draconya/sim';
import type { SessionFactory } from './host.js';

/**
 * Estado inicial de PLACEHOLDER. O personagem de verdade vem do banco na FUN-11; até lá
 * todo mundo entra igual. Está aqui, num lugar só e com nome que denuncia o que é, para não
 * virar constante espalhada que alguém confunde com balanceamento.
 */
const PLACEHOLDER_CHARACTER = {
  position: { x: 0, y: 0, z: 7 },
  health: 185, maxHealth: 185,
  mana: 35, maxMana: 35,
  level: 8, xp: 4200,
  goldDelta: 0, alive: true,
  cooldowns: {},
} as const;

export function createCitySessionFactory(contentVersion: string): SessionFactory {
  return (characterId: string): Session => {
    const id = randomUUID();
    const session = new Session({
      id,
      // Fixada na criação e imutável até o fim (invariante 7): a sessão termina na versão
      // de conteúdo em que começou, mesmo que um deploy aconteça no meio.
      contentVersion,
      ruleset: createCityRuleset(),
      // Semente derivada do id da sessão: o mesmo id reproduz a mesma sequência, que é o
      // que torna "por que esse loot não caiu" uma pergunta investigável.
      rng: Rng.fromSeed(id),
      createdAtMs: performance.now(),
    });
    session.enter(new CharacterRuntime({ id: characterId, ...PLACEHOLDER_CHARACTER }));
    return session;
  };
}
