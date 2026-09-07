import { describe, expect, it } from 'vitest';
import { CharacterRuntime } from './personagem.js';
import { Rng } from './rng.js';
import { Sessao } from './sessao.js';
import type { MotivoDeEncerramento, Ruleset } from './sessao.js';

/**
 * Ruleset de teste que exercita os três padrões que aparecem em combate de verdade:
 * regeneração contínua, ação periódica com cooldown, e sorteio de loot.
 *
 * Se ele produzir resultados diferentes conforme a taxa de tick, é porque alguma fórmula
 * conta ticks em vez de tempo — e a otimização mais valiosa do projeto (ADR 0003) morreu.
 */
function rulesetDeTeste(): Ruleset {
  return {
    tipo: 'hunt',
    hz: (anexada) => (anexada ? 10 : 1),
    aoEntrar: () => {},
    aoMorrer: () => {},
    aoEncerrar: () => {},
    aoTick(sessao, dtMs) {
      for (const p of sessao.participantes) {
        // Contínuo: função do tempo decorrido, nunca "por tick".
        p.mana = Math.min(p.manaMaxima, p.mana + (2 * dtMs) / 1000);

        // Periódico: quantas vezes coube, não "uma se estiver pronto".
        const ataques = p.cooldowns.vezesQueCoube('atacar', dtMs, 350);
        for (let i = 0; i < ataques; i++) {
          const dano = sessao.rng.inteiro(10, 20);
          sessao.agregados.xpGanha += dano;
          sessao.agregados.abates++;
          if (sessao.rng.chance(0.1)) {
            sessao.agregados.goldGanho += sessao.rng.inteiro(1, 50);
          }
        }
      }
    },
  };
}

function personagem(): CharacterRuntime {
  return new CharacterRuntime({
    id: 'p1',
    posicao: { x: 0, y: 0, z: 7 },
    vida: 500, vidaMaxima: 500,
    mana: 0, manaMaxima: 1000,
    level: 20, xp: 0,
    deltaDeGold: 0, vivo: true,
    cooldowns: {},
  });
}

function rodar(hz: number, duracaoMs: number, semente: string) {
  const sessao = new Sessao({
    id: 's1',
    versaoDeConteudo: 'v1',
    ruleset: rulesetDeTeste(),
    rng: Rng.deSemente(semente),
    criadaEmMs: 0,
  });
  sessao.entrar(personagem());

  const passoMs = 1000 / hz;
  for (let t = passoMs; t <= duracaoMs; t += passoMs) sessao.tick(t);

  return {
    agregados: { ...sessao.agregados },
    mana: Math.round((sessao.participantes[0] as CharacterRuntime).mana),
    rng: sessao.estadoDoRng(),
  };
}

describe('equivalência entre taxas de tick', () => {
  it('10 Hz e 1 Hz produzem o mesmo resultado', () => {
    // O TESTE QUE DEFINE O PROJETO. Se ele quebrar, alguma fórmula passou a contar ticks,
    // e a hunt desanexada deixou de valer o mesmo que a anexada (invariante 2 e 3).
    expect(rodar(1, 60_000, 'semente-42')).toEqual(rodar(10, 60_000, 'semente-42'));
  });

  it('vale também para 2 Hz e 20 Hz', () => {
    expect(rodar(2, 60_000, 'x')).toEqual(rodar(20, 60_000, 'x'));
  });

  it('o gerador aleatório termina no mesmo estado', () => {
    // Mesmo número de saques nas duas taxas — é o que mantém o loot idêntico.
    expect(rodar(1, 30_000, 'y').rng).toEqual(rodar(10, 30_000, 'y').rng);
  });

  it('sementes diferentes divergem, senão o teste acima não provaria nada', () => {
    expect(rodar(10, 30_000, 'a')).not.toEqual(rodar(10, 30_000, 'b'));
  });
});

describe('troca de taxa no meio da sessão', () => {
  it('desanexar no meio não perde nem ganha tempo', () => {
    // O `tick` recebe o INSTANTE, não o intervalo: o dtMs cobre o intervalo real, então
    // trocar de taxa não faz a sessão derivar.
    const continua = rodar(10, 60_000, 'z');

    const sessao = new Sessao({
      id: 's1', versaoDeConteudo: 'v1', ruleset: rulesetDeTeste(),
      rng: Rng.deSemente('z'), criadaEmMs: 0,
    });
    sessao.entrar(personagem());
    sessao.anexar('v');
    for (let t = 100; t <= 30_000; t += 100) sessao.tick(t);
    sessao.desanexar('v');
    for (let t = 31_000; t <= 60_000; t += 1000) sessao.tick(t);

    expect({ ...sessao.agregados }).toEqual(continua.agregados);
  });

  it('hz acompanha quem está olhando', () => {
    const sessao = new Sessao({
      id: 's1', versaoDeConteudo: 'v1', ruleset: rulesetDeTeste(),
      rng: Rng.deSemente('w'), criadaEmMs: 0,
    });
    expect(sessao.anexada).toBe(false);
    expect(sessao.hzAtual()).toBe(1);
    sessao.anexar('v1');
    sessao.anexar('v2');
    expect(sessao.hzAtual()).toBe(10);
    sessao.desanexar('v1');
    expect(sessao.hzAtual()).toBe(10); // ainda há um olhando
    sessao.desanexar('v2');
    expect(sessao.hzAtual()).toBe(1);
  });
});

describe('ciclo de vida', () => {
  it('roda com zero visualizadores', () => {
    // O modo padrão do jogo. Se algum caminho presumir que existe um, quebra na primeira AFK.
    const r = rodar(1, 10_000, 'afk');
    expect(r.agregados.abates).toBeGreaterThan(0);
  });

  it('tick para trás ou repetido não avança nada', () => {
    const sessao = new Sessao({
      id: 's', versaoDeConteudo: 'v1', ruleset: rulesetDeTeste(),
      rng: Rng.deSemente('t'), criadaEmMs: 0,
    });
    sessao.entrar(personagem());
    sessao.tick(1000);
    const depois = { ...sessao.agregados };
    sessao.tick(1000);
    sessao.tick(500);
    expect({ ...sessao.agregados }).toEqual(depois);
  });

  it('encerrar é idempotente e congela o motivo', () => {
    const sessao = new Sessao({
      id: 's', versaoDeConteudo: 'v1', ruleset: rulesetDeTeste(),
      rng: Rng.deSemente('e'), criadaEmMs: 0,
    });
    sessao.entrar(personagem());
    const primeiro = sessao.encerrar('morte');
    const segundo = sessao.encerrar('drenagem' as MotivoDeEncerramento);
    expect(primeiro.motivo).toBe('morte');
    expect(segundo.motivo).toBe('morte');
    expect(sessao.encerrada).toBe('morte');
  });

  it('sessão encerrada não avança mais', () => {
    const sessao = new Sessao({
      id: 's', versaoDeConteudo: 'v1', ruleset: rulesetDeTeste(),
      rng: Rng.deSemente('f'), criadaEmMs: 0,
    });
    sessao.entrar(personagem());
    sessao.tick(1000);
    sessao.encerrar('saida-manual');
    const congelado = { ...sessao.agregados };
    sessao.tick(60_000);
    expect({ ...sessao.agregados }).toEqual(congelado);
  });

  it('a versão de conteúdo é congelada na criação', () => {
    const sessao = new Sessao({
      id: 's', versaoDeConteudo: 'conteudo-v7', ruleset: rulesetDeTeste(),
      rng: Rng.deSemente('g'), criadaEmMs: 0,
    });
    expect(sessao.versaoDeConteudo).toBe('conteudo-v7');
  });
});
