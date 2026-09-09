// De personagem para sessão de Cidade (FUN-13).
//
// Todo personagem está sempre em EXATAMENTE uma sessão, cidade inclusive (invariante 8).
// Entrar no jogo, portanto, nunca é "ficar sem sessão até escolher uma hunt": é entrar na
// sessão de Cidade, que é orientada a evento e custa perto de zero.

import { randomUUID } from 'node:crypto';
import { CharacterRuntime, Rng, Session, createCityRuleset, huntRulesetFromSnapshot } from '@draconya/sim';
import type { Ruleset, SessionSnapshot } from '@draconya/sim';
import type { Content } from '@draconya/content';
import type { SessionFactory, SessionRestorer } from './host.js';

/**
 * Campos ainda não persistidos pela FUN-11. Nível e XP chegam no ticket autenticado; nenhum
 * dado enviado pelo cliente participa da criação da sessão.
 */
const INITIAL_RUNTIME = {
  position: { x: 0, y: 0, z: 7 },
  health: 185, maxHealth: 185,
  mana: 35, maxMana: 35,
  goldDelta: 0, alive: true,
  cooldowns: {},
} as const;

export function createCitySessionFactory(contentVersion: string): SessionFactory {
  return (characterId, initialCharacter = { level: 1, xp: 0 }): Session => {
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
    session.enter(new CharacterRuntime({
      id: characterId,
      ...INITIAL_RUNTIME,
      level: initialCharacter.level,
      xp: initialCharacter.xp,
    }));
    return session;
  };
}

/**
 * Reconstrói uma sessão a partir de um snapshot guardado (FUN-28).
 *
 * Recebe o conteúdo porque uma hunt não é reconstruível sem ele: mapa, rota e composição são
 * dados, e o ruleset precisa deles de volta antes de restaurar o estado.
 *
 * Devolve `null` quando o snapshot não pode ser reconstruído — formato de outra versão,
 * ruleset que este servidor não conhece, ou hunt que saiu do conteúdo. `null` é a resposta
 * certa: retomar errado é pior que não retomar, e quem chama sabe encerrar creditando.
 */
export function createSessionRestorer(content: Content): SessionRestorer {
  return (snapshot: SessionSnapshot, nowMs: number): Session | null => {
    const ruleset = rulesetFor(snapshot, content);
    if (ruleset === null) return null;
    try {
      const session = Session.fromSnapshot(snapshot, ruleset, Rng.fromSeed(snapshot.id));
      // O relógio do snapshot é de outro processo. Ver ADR 0018.
      session.rebaseClock(nowMs);
      return session;
    } catch {
      return null;
    }
  };
}

function rulesetFor(snapshot: SessionSnapshot, content: Content): Ruleset | null {
  // Cidade e hunt são as duas que existem. Treino, quest, boss e guild war ainda não têm
  // ruleset — e forçar um conhecido em cima produziria uma sessão que mente sobre o que é.
  if (snapshot.type === 'city') return createCityRuleset();
  if (snapshot.type === 'hunt') return huntRulesetFromSnapshot(snapshot, content);
  return null;
}
