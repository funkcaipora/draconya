// De personagem para sessão de Cidade (FUN-13).
//
// Todo personagem está sempre em EXATAMENTE uma sessão, cidade inclusive (invariante 8).
// Entrar no jogo, portanto, nunca é "ficar sem sessão até escolher uma hunt": é entrar na
// sessão de Cidade, que é orientada a evento e custa perto de zero.

import { randomUUID } from 'node:crypto';
import {
  CharacterRuntime, Rng, Session, createCityRuleset, huntRulesetFromSnapshot,
  materializeStamina, statsForLevel,
} from '@draconya/sim';
import type { Ruleset, SessionSnapshot } from '@draconya/sim';
import type { Content } from '@draconya/content';
import type { SessionFactory, SessionRestorer, SessionSuccessor } from './host.js';

/**
 * Campos ainda não persistidos pela FUN-11. Nível e XP chegam no ticket autenticado; nenhum
 * dado enviado pelo cliente participa da criação da sessão.
 *
 * HP e mana NÃO estão aqui: eles saem da tabela de progressão, como todo stat derivado de
 * level (FUN-34). Números fixos aqui davam um personagem que subia de level e ENCOLHIA — o
 * level up recalcula o máximo pela tabela (FUN-37), e um valor inventado na criação não
 * sobrevive ao primeiro abate que importa.
 */
const INITIAL_RUNTIME = {
  position: { x: 0, y: 0, z: 7 },
  goldDelta: 0, alive: true,
  cooldowns: {},
} as const;

export function createCitySessionFactory(
  content: Content,
  now: () => number = () => Date.now(),
): SessionFactory {
  return (characterId, initialCharacter = { level: 1, xp: 0 }): Session => {
    const id = randomUUID();
    const session = new Session({
      id,
      // Fixada na criação e imutável até o fim (invariante 7): a sessão termina na versão
      // de conteúdo em que começou, mesmo que um deploy aconteça no meio.
      contentVersion: content.version,
      ruleset: createCityRuleset(),
      // Semente derivada do id da sessão: o mesmo id reproduz a mesma sequência, que é o
      // que torna "por que esse loot não caiu" uma pergunta investigável.
      rng: Rng.fromSeed(id),
      createdAtMs: performance.now(),
    });
    // Vocação ainda não é persistida (§7.4 a coloca no level 8, e a escolha é FUN-30): até
    // lá, todo personagem cresce pela tabela base.
    const stats = statsForLevel(initialCharacter.level, null, content.progression);
    const character = new CharacterRuntime({
      id: characterId,
      ...INITIAL_RUNTIME,
      level: initialCharacter.level,
      xp: initialCharacter.xp,
      vocationId: null,
      health: stats.maxHealth, maxHealth: stats.maxHealth,
      mana: stats.maxMana, maxMana: stats.maxMana,
      staminaMs: initialCharacter.staminaMs ?? null,
      ...(initialCharacter.staminaUpdatedAtMs === undefined
        ? {}
        : { staminaUpdatedAtMs: initialCharacter.staminaUpdatedAtMs }),
    });
    // Materializa na ENTRADA (§10): o personagem esteve fora de hunt desde a última vez, e
    // esse tempo é recuperação. Fazer a conta aqui, e não na leitura de cada consulta, é o
    // que mantém "quanto de stamina ele tem" uma pergunta barata durante a sessão.
    materializeStamina(character, now(), content.stamina);
    session.enter(character);
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


/**
 * Para onde o personagem vai quando a sessão dele acaba (FUN-38): a Cidade, sempre.
 *
 * Todo personagem está em EXATAMENTE uma sessão (invariante 8), então "a hunt acabou" nunca
 * pode significar "ele ficou sem sessão". Vale para a morte e vale para a saída manual: sair
 * de uma hunt é voltar para a cidade, não sumir do mundo.
 *
 * O personagem é o MESMO objeto, não uma cópia reconstruída do banco. A penalidade de morte
 * (FUN-37) já mexeu no level e na XP dele quando isto roda, e reconstruir a partir de dados
 * duráveis que ainda não foram gravados devolveria o personagem de antes de morrer — a
 * penalidade sumiria, e ninguém ligaria uma coisa à outra.
 *
 * Quem cura é o `onEnter` da Cidade: voltar à PZ restaura HP e mana cheios (§26.1). Curar
 * aqui duplicaria a regra em dois lugares, e um dia só um dos dois mudaria.
 */
export function createCitySuccessor(
  content: Content,
  now: () => number = () => Date.now(),
): SessionSuccessor {
  return (ended: Session): Session | null => {
    // A Cidade não sucede a si mesma. Uma sessão de Cidade que acaba é um `logout` ou uma
    // drenagem, e nesses casos o personagem está mesmo saindo do nó.
    if (ended.ruleset.type === 'city') return null;

    const id = randomUUID();
    const session = new Session({
      id,
      contentVersion: content.version,
      ruleset: createCityRuleset(),
      rng: Rng.fromSeed(id),
      // O relógio da sessão nova continua o da antiga: elas são o mesmo personagem no mesmo
      // processo, e um `createdAtMs` de outra origem faria o primeiro `dtMs` sair absurdo.
      createdAtMs: ended.nowMs,
    });
    for (const character of ended.participants) {
      // Materializa na SAÍDA da hunt (§10). Sem isto, o `staminaUpdatedAtMs` continuaria
      // apontando para antes da hunt, e a próxima leitura devolveria como recuperação o
      // tempo que o personagem passou justamente gastando stamina.
      materializeStamina(character, now(), content.stamina);
      session.enter(character);
    }
    return session;
  };
}
