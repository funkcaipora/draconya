import { describe, expect, it } from 'vitest';
import { CharacterRuntime } from './personagem.js';
import { Rng } from './rng.js';
import { Sessao, VERSAO_DO_FORMATO_DE_SNAPSHOT } from './sessao.js';
import type { Ruleset } from './sessao.js';
import { rulesetDeCidade } from './rulesets/cidade.js';

/** Mesmo ruleset do teste de equivalência: contínuo, periódico e sorteio. */
function rulesetDeTeste(): Ruleset {
  return {
    tipo: 'hunt',
    hz: (anexada) => (anexada ? 10 : 1),
    aoEntrar: () => {},
    aoMorrer: () => {},
    aoEncerrar: () => {},
    aoTick(sessao, dtMs) {
      for (const p of sessao.participantes) {
        p.mana = Math.min(p.manaMaxima, p.mana + (2 * dtMs) / 1000);
        const ataques = p.cooldowns.vezesQueCoube('atacar', dtMs, 350);
        for (let i = 0; i < ataques; i++) {
          sessao.agregados.xpGanha += sessao.rng.inteiro(10, 20);
          sessao.agregados.abates++;
          if (sessao.rng.chance(0.1)) sessao.agregados.goldGanho += sessao.rng.inteiro(1, 50);
        }
      }
    },
  };
}

function personagem(): CharacterRuntime {
  return new CharacterRuntime({
    id: 'p1', posicao: { x: 0, y: 0, z: 7 },
    vida: 500, vidaMaxima: 500, mana: 0, manaMaxima: 1000,
    level: 20, xp: 0, deltaDeGold: 0, vivo: true, cooldowns: {},
  });
}

function novaSessao(semente = 's'): Sessao {
  const sessao = new Sessao({
    id: 'sessao-1', versaoDeConteudo: 'conteudo-v3',
    ruleset: rulesetDeTeste(), rng: Rng.deSemente(semente), criadaEmMs: 0,
  });
  sessao.entrar(personagem());
  return sessao;
}

describe('fidelidade do snapshot', () => {
  it('snapshot, restaura e continua dá o mesmo que rodar sem interrupção', () => {
    // O SEGUNDO PILAR DA FASE 1. Se este teste quebrar, a retomada de sessão (FUN-28) e a
    // drenagem em deploy (FUN-29) passam a perder estado sem ninguém perceber — e o que
    // se perde aparece como XP e loot faltando no extrato de quem não estava olhando.
    const semInterrupcao = novaSessao();
    for (let t = 1000; t <= 60_000; t += 1000) semInterrupcao.tick(t);

    const comInterrupcao = novaSessao();
    for (let t = 1000; t <= 30_000; t += 1000) comInterrupcao.tick(t);
    const snap = comInterrupcao.snapshot();

    const retomada = Sessao.deSnapshot(snap, rulesetDeTeste(), new Rng(snap.rng));
    for (let t = 31_000; t <= 60_000; t += 1000) retomada.tick(t);

    expect({ ...retomada.agregados }).toEqual({ ...semInterrupcao.agregados });
    expect(retomada.estadoDoRng()).toEqual(semInterrupcao.estadoDoRng());
  });

  it('cooldowns e temporizadores em curso sobrevivem', () => {
    const sessao = novaSessao('cd');
    // Para no meio de um período de 350 ms, com acumulado parcial.
    sessao.tick(500);
    const snap = sessao.snapshot();
    const retomada = Sessao.deSnapshot(snap, rulesetDeTeste(), new Rng(snap.rng));

    sessao.tick(1000);
    retomada.tick(1000);
    expect({ ...retomada.agregados }).toEqual({ ...sessao.agregados });
  });

  it('preserva id, versão de conteúdo, ledgerSeq e eventos notáveis', () => {
    const sessao = novaSessao('meta');
    sessao.ledgerSeq = 7;
    sessao.registrar('subiu-de-level', '21');
    sessao.tick(1000);

    const snap = sessao.snapshot();
    const retomada = Sessao.deSnapshot(snap, rulesetDeTeste(), new Rng(snap.rng));

    expect(retomada.id).toBe('sessao-1');
    expect(retomada.versaoDeConteudo).toBe('conteudo-v3');
    expect(retomada.ledgerSeq).toBe(7);
    expect(retomada.eventosNotaveis).toEqual(sessao.eventosNotaveis);
  });

  it('a versão de conteúdo é a da criação, não a de quem restaura', () => {
    // Invariante 7: a hunt termina na versão em que começou, mesmo com deploy no meio.
    const snap = novaSessao().snapshot();
    expect(Sessao.deSnapshot(snap, rulesetDeTeste(), new Rng(snap.rng)).versaoDeConteudo)
      .toBe('conteudo-v3');
  });

  it('nasce desanexada — conexão não sobrevive à queda de um nó', () => {
    const sessao = novaSessao();
    sessao.anexar('visualizador-1');
    const snap = sessao.snapshot();
    expect(Sessao.deSnapshot(snap, rulesetDeTeste(), new Rng(snap.rng)).anexada).toBe(false);
  });

  it('sobrevive a passar por JSON, que é como vai para o Redis', () => {
    const sessao = novaSessao('json');
    sessao.tick(5000);
    const viaJson = JSON.parse(JSON.stringify(sessao.snapshot())) as ReturnType<Sessao['snapshot']>;
    const retomada = Sessao.deSnapshot(viaJson, rulesetDeTeste(), new Rng(viaJson.rng));
    sessao.tick(10_000);
    retomada.tick(10_000);
    expect({ ...retomada.agregados }).toEqual({ ...sessao.agregados });
  });
});

describe('proteções do formato', () => {
  it('recusa versão de formato desconhecida em vez de ler errado', () => {
    const snap = { ...novaSessao().snapshot(), versaoDoFormato: 999 };
    expect(() => Sessao.deSnapshot(snap, rulesetDeTeste(), Rng.deSemente('x')))
      .toThrow(/versão 999/);
  });

  it('recusa ruleset de tipo diferente do snapshot', () => {
    const snap = novaSessao().snapshot();
    expect(() => Sessao.deSnapshot(snap, rulesetDeCidade(), Rng.deSemente('x')))
      .toThrow(/não corresponde/);
  });

  it('declara a versão de formato vigente', () => {
    expect(novaSessao().snapshot().versaoDoFormato).toBe(VERSAO_DO_FORMATO_DE_SNAPSHOT);
  });
});

describe('ruleset da Cidade — prova que a interface é genérica', () => {
  it('é orientada a evento', () => {
    const cidade = rulesetDeCidade();
    expect(cidade.hz(true)).toBe(0);
    expect(cidade.hz(false)).toBe(0);
  });

  it('entrar na cidade cura, que é para onde a morte devolve', () => {
    const sessao = new Sessao({
      id: 'c1', versaoDeConteudo: 'v1', ruleset: rulesetDeCidade(),
      rng: Rng.deSemente('c'), criadaEmMs: 0,
    });
    const p = personagem();
    p.vida = 1;
    p.vivo = false;
    sessao.entrar(p);
    expect(p.vida).toBe(p.vidaMaxima);
    expect(p.vivo).toBe(true);
  });

  it('morrer em protect zone falha alto, em vez de virar morte impossível no extrato', () => {
    const sessao = new Sessao({
      id: 'c1', versaoDeConteudo: 'v1', ruleset: rulesetDeCidade(),
      rng: Rng.deSemente('c'), criadaEmMs: 0,
    });
    const p = personagem();
    sessao.entrar(p);
    expect(() => sessao.matar(p)).toThrow(/protect zone/);
  });

  it('receber tick é bug, e falha alto', () => {
    const sessao = new Sessao({
      id: 'c1', versaoDeConteudo: 'v1', ruleset: rulesetDeCidade(),
      rng: Rng.deSemente('c'), criadaEmMs: 0,
    });
    expect(() => sessao.tick(1000)).toThrow(/orientada a evento/);
  });
});
