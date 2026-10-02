import { describe, expect, it } from 'vitest';
import { createCityRuleset, createHuntSession } from '@draconya/sim';
import type { Ruleset } from '@draconya/sim';
import { testContent } from '../testing/content.js';
import {
  checkpointsProgress, creditsAggregates, keepsSnapshot, leavesOnExit, offersCityServices, usesAreaOfInterest,
} from './ruleset-traits.js';
import type { RulesetTraits } from './ruleset-traits.js';

// As cinco perguntas que o hospedeiro faz a um ruleset (OW-04, ADR 0060 d.10c). A tabela abaixo é
// a MESMA de `packages/server/AGENTS.md`: quem muda uma resposta muda as duas, e este teste é o que
// obriga.

/** Os quatro rulesets que existem — ou vão existir — e o que cada um declara. */
const PRIVATE: RulesetTraits = {}; // a hunt, o treino: nem `shared` nem `progress`
const CITY: RulesetTraits = { shared: true }; // o shard de hoje: não declara `progress`
const WORLD: RulesetTraits = { shared: true, progress: 'checkpointed' }; // o shard que credita

describe('os predicados que o hospedeiro lê no ruleset (OW-04)', () => {
  it.each([
    // nome do ruleset, traços, [leavesOnExit, creditsAggregates, keepsSnapshot, usesAreaOfInterest, offersCityServices]
    ['hunt / treino (privada)', PRIVATE, [false, true, true, false, false]],
    ['Cidade (shard)', CITY, [true, false, false, true, true]],
    ['mundo (shard checkpointed)', WORLD, [true, true, false, true, true]],
  ] as const)('%s', (_name, traits, [leaves, credits, snapshot, interest, services]) => {
    expect(leavesOnExit(traits)).toBe(leaves);
    expect(creditsAggregates(traits)).toBe(credits);
    expect(keepsSnapshot(traits)).toBe(snapshot);
    expect(usesAreaOfInterest(traits)).toBe(interest);
    expect(offersCityServices(traits)).toBe(services);
  });

  it.each([
    // nome, traços, checkpointsProgress (OW-16): só o shard que credita grava em lote
    ['hunt / treino (privada)', PRIVATE, false],
    ['Cidade (shard)', CITY, false],
    ['mundo (shard checkpointed)', WORLD, true],
    ['shard com `progress: "none"` declarado', { shared: true, progress: 'none' } as const, false],
  ] as const)('o checkpoint em lote é só do mundo (OW-16): %s', (_name, traits, checkpoints) => {
    expect(checkpointsProgress(traits)).toBe(checkpoints);
  });

  it('a sessão privada que declara `checkpointed` não vira lote: `progress` só tem leitura em quem sai por personagem', () => {
    // Mesma regra de `creditsAggregates`: a hunt credita no `end`, e o hospedeiro grava o extrato dela
    // uma vez só. Um `checkpointed` num ruleset privado não pode fazê-la gravar em lote.
    expect(checkpointsProgress({ shared: false, progress: 'checkpointed' })).toBe(false);
    expect(checkpointsProgress({ progress: 'checkpointed' })).toBe(false);
  });

  it('`progress: "none"` declarado num shard é o mesmo que ausente: não credita', () => {
    expect(creditsAggregates({ shared: true, progress: 'none' })).toBe(false);
    expect(creditsAggregates(CITY)).toBe(false);
  });

  it('a sessão privada sempre credita: `progress` só tem leitura em quem sai por personagem', () => {
    // O `end` é o ÚNICO caminho do que uma sessão privada rendeu até o ledger. Um `progress: 'none'`
    // nela não pode virar "não credita" — o gold iria como `goldDelta` de um extrato de estado que a
    // sessão privada nunca grava, e a venda sumiria.
    expect(creditsAggregates({ progress: 'none' })).toBe(true);
    expect(creditsAggregates({ shared: false, progress: 'none' })).toBe(true);
    expect(creditsAggregates({ shared: false, progress: 'checkpointed' })).toBe(true);
  });

  it('sair por personagem e guardar snapshot são opostos — nenhuma sessão é as duas coisas', () => {
    for (const traits of [PRIVATE, CITY, WORLD, { shared: false }, { shared: true, progress: 'none' } as const]) {
      expect(keepsSnapshot(traits)).toBe(!leavesOnExit(traits));
    }
  });

  it('o mundo troca UMA resposta da Cidade: a do agregado — as outras quatro não mudam', () => {
    // É a razão de os predicados existirem. Se a diferença entre Cidade e mundo vazar para outra
    // pergunta, um ramo do hospedeiro passou a decidir por `progress` sem que ninguém tenha dito.
    // (`checkpointsProgress`, da OW-16, é a MESMA diferença — shard que credita — lida por outro lado.)
    expect(leavesOnExit(WORLD)).toBe(leavesOnExit(CITY));
    expect(keepsSnapshot(WORLD)).toBe(keepsSnapshot(CITY));
    expect(usesAreaOfInterest(WORLD)).toBe(usesAreaOfInterest(CITY));
    expect(offersCityServices(WORLD)).toBe(offersCityServices(CITY));
    expect(creditsAggregates(WORLD)).not.toBe(creditsAggregates(CITY));
  });

  it('os rulesets de verdade — a Cidade e a hunt — respondem como a tabela, sem declarar `progress`', () => {
    // Zero mudança observável: nenhum ruleset real declara `progress` (ADR 0060 d.10b), então
    // Cidade e hunt continuam resolvendo só por `shared`.
    const content = testContent();
    const city: Ruleset = createCityRuleset();
    const hunt: Ruleset = createHuntSession({
      id: 'h', content, huntId: 'arena', difficulty: 'cautious', createdAtMs: 0,
    }).ruleset;

    expect(city.progress).toBeUndefined();
    expect(hunt.progress).toBeUndefined();
    expect([leavesOnExit(city), creditsAggregates(city), keepsSnapshot(city)]).toEqual([true, false, false]);
    expect([leavesOnExit(hunt), creditsAggregates(hunt), keepsSnapshot(hunt)]).toEqual([false, true, true]);
  });
});
