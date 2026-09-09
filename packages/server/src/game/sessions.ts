// De personagem para sessão de Cidade (FUN-13).
//
// Todo personagem está sempre em EXATAMENTE uma sessão, cidade inclusive (invariante 8).
// Entrar no jogo, portanto, nunca é "ficar sem sessão até escolher uma hunt": é entrar na
// sessão de Cidade, que é orientada a evento e custa perto de zero.

import { randomUUID } from 'node:crypto';
import {
  CharacterRuntime, Rng, Session, createCityRuleset, createHuntSession,
  huntRulesetFromSnapshot, materializeStamina, statsForLevel,
} from '@draconya/sim';
import type { HuntDifficultyName, Ruleset, SessionSnapshot } from '@draconya/sim';
import type { Content } from '@draconya/content';
import type {
  SessionBuilder, SessionFactory, SessionRestorer, TransitionRequest,
} from './host.js';

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
      createdAtMs: now(),
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
  return (snapshot: SessionSnapshot): Session | null => {
    // A versão de conteúdo é fixada na sessão e não muda no meio dela (invariante 7).
    //
    // O ruleset é montado com o conteúdo DESTE processo, e a sessão retomada preserva a
    // versão que estava no snapshot. Se as duas diferirem, ela passaria a se declarar N — no
    // `welcome`, no extrato, no ledger — enquanto simula com os dados de N+1: stats de
    // monstro, curva de XP, coeficientes de combate, densidade de spawn.
    //
    // É exatamente o que o §7 existe para impedir. O caminho não é o deploy normal, que drena
    // creditando (ADR 0010) e não deixa snapshot para trás: é a QUEDA sem drenagem num nó
    // cujo substituto já subiu com conteúdo novo.
    //
    // Recusar aqui não perde nada, porque quem chama credita antes de descartar.
    if (snapshot.contentVersion !== content.version) return null;

    const ruleset = rulesetFor(snapshot, content);
    if (ruleset === null) return null;
    try {
      // Sem rebase de relógio desde a FUN-68: o tempo da sessão é LÓGICO e é dela, então
      // retomar é continuar de onde parou. O intervalo em que o nó esteve fora nunca chega a
      // ser oferecido à simulação, porque quem guarda relógio de processo é o hospedeiro —
      // o ADR 0018 deixou de precisar de uma operação para ser cumprido.
      return Session.fromSnapshot(snapshot, ruleset, Rng.fromSeed(snapshot.id));
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
 * Constrói a sessão de destino de uma transição (FUN-30, FUN-38).
 *
 * É a MESMA função para a morte que devolve à cidade e para o jogador que entra numa hunt.
 * Dois caminhos separados dariam duas chances de o estado exclusivo furar, e é o estado
 * exclusivo que dispensa lock sobre o gold (invariante 9).
 *
 * O personagem que atravessa é o MESMO objeto, não uma cópia reconstruída do banco. A
 * penalidade de morte (FUN-37) já mexeu no level e na XP dele quando isto roda, e reconstruir
 * a partir de dados duráveis que ainda não foram gravados devolveria o personagem de antes de
 * morrer — a penalidade sumiria, e ninguém ligaria uma coisa à outra.
 */
export function createSessionBuilder(
  content: Content,
  now: () => number = () => Date.now(),
): SessionBuilder {
  return (request, from): Session | null => {
    // Materializar a stamina é da FRONTEIRA, e toda transição é uma (§10). Fazer aqui, e não
    // dentro de cada destino, é o que garante que nenhum caminho novo esqueça.
    for (const character of from.participants) {
      materializeStamina(character, now(), content.stamina);
    }

    if (request.to === 'city') return cityFor(content, from, now);
    if (request.to === 'hunt') return huntFor(content, request, from, now);
    // Treino, quest, boss e guild war ainda não têm ruleset. `null` recusa a transição com
    // erro claro, que é melhor que construir uma sessão que mente sobre o que é.
    return null;
  };
}

/**
 * A Cidade não sucede a si mesma: uma sessão de Cidade que acaba é logout ou drenagem, e aí o
 * personagem está mesmo saindo do nó.
 *
 * Quem cura é o `onEnter` da Cidade — voltar à PZ restaura HP e mana cheios (§26.1). Curar
 * aqui duplicaria a regra em dois lugares, e um dia só um dos dois mudaria.
 */
function cityFor(content: Content, from: Session, now: () => number): Session | null {
  if (from.ruleset.type === 'city') return null;
  const id = randomUUID();
  const session = new Session({
    id,
    contentVersion: content.version,
    ruleset: createCityRuleset(),
    rng: Rng.fromSeed(id),
    // Marca de quando a sessão passou a existir, para quem investiga. Desde a FUN-68 não
    // alimenta simulação nenhuma — o relógio de dentro é lógico e nasce em zero —, então
    // aqui vale a hora de verdade, que é a que serve para ler um log.
    createdAtMs: now(),
  });
  for (const character of from.participants) session.enter(character);
  return session;
}

function huntFor(
  content: Content,
  request: TransitionRequest,
  from: Session,
  now: () => number,
): Session | null {
  if (request.huntId === undefined || request.difficulty === undefined) return null;
  try {
    const session = createHuntSession({
      id: randomUUID(),
      content,
      huntId: request.huntId,
      // A dificuldade chega como string do cliente e é validada pelo CONTEÚDO, não por um
      // enum no protocolo: uma hunt define as dificuldades que fazem sentido para ela.
      difficulty: request.difficulty as HuntDifficultyName,
      createdAtMs: now(),
    });
    for (const character of from.participants) session.enter(character);
    return session;
  } catch {
    // Hunt inexistente, dificuldade que ela não define, rota que saiu do conteúdo. Recusar é
    // a resposta certa: o personagem fica onde estava, e o jogador vê o motivo.
    return null;
  }
}
