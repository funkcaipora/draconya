// A `Sessao` é a unidade de simulação, e é o coração da arquitetura (ADR 0001).
//
// Todo personagem está sempre em exatamente uma sessão, cidade inclusive (invariante 8) — o
// que transforma o estado exclusivo de regra policiada em propriedade estrutural, e serve de
// controle de concorrência sobre o estado quente sem lock nenhum.
//
// A sessão roda com ZERO visualizadores. Se algum caminho presumir que existe um, quebra na
// primeira hunt AFK — que é o modo padrão do jogo.

import { CharacterRuntime } from './personagem.js';
import type { EstadoDePersonagem } from './personagem.js';
import type { Rng, EstadoDeRng } from './rng.js';

/**
 * Versão do FORMATO de snapshot — não do conteúdo, não do servidor.
 *
 * Existe desde o primeiro snapshot de propósito: sem ela, o primeiro deploy que mudar o
 * formato descarta em silêncio milhares de sessões em voo, e ninguém liga uma coisa à outra.
 * Mudou o formato, sobe o número e decide explicitamente entre migrar e descartar.
 */
export const VERSAO_DO_FORMATO_DE_SNAPSHOT = 1;

export interface SnapshotDeSessao {
  readonly versaoDoFormato: number;
  readonly versaoDeConteudo: string;
  readonly id: string;
  readonly tipo: TipoDeSessao;
  readonly criadaEmMs: number;
  readonly ultimoTickMs: number;
  readonly rng: EstadoDeRng;
  readonly participantes: readonly EstadoDePersonagem[];
  readonly agregados: Agregados;
  readonly eventosNotaveis: readonly EventoNotavel[];
  readonly ledgerSeq: number;
  readonly encerradaPor: MotivoDeEncerramento | null;
  /** Opaco: quem entende do formato é o próprio ruleset. */
  readonly ruleset?: unknown;
}

export type TipoDeSessao = 'cidade' | 'hunt' | 'treino' | 'quest' | 'boss' | 'guild-war';

export type MotivoDeEncerramento =
  | 'saida-manual'
  | 'regra-de-saida'
  | 'morte'
  | 'drenagem'
  | 'concluida';

export interface EventoNotavel {
  readonly emMs: number;
  readonly tipo: string;
  readonly detalhe?: string;
}

export interface Agregados {
  duracaoMs: number;
  xpGanha: number;
  goldGanho: number;
  goldGasto: number;
  abates: number;
  mortes: number;
}

export interface Extrato {
  readonly sessaoId: string;
  readonly motivo: MotivoDeEncerramento;
  readonly agregados: Agregados;
  readonly eventosNotaveis: readonly EventoNotavel[];
}

/**
 * O que um ruleset define — e são as MESMAS quatro coisas para hunt, treino, quest, boss e
 * guild war. Se a Guild War não couber aqui depois, ela foi modelada em cima de hunt, e
 * descobrir isso na F5 custa semanas.
 */
export interface Ruleset {
  readonly tipo: TipoDeSessao;

  /**
   * Taxa de tick desejada, em Hz. `0` significa orientada a evento — sem laço.
   *
   * A política do ADR 0003 mora aqui, e não num `switch` em outro lugar: cada ruleset conhece
   * o próprio custo. Cidade e treino devolvem 0; hunt cai de 10 para 1–2 ao desanexar; quest,
   * boss e guild war ficam em 10 mesmo desanexados, porque o §6.2 mantém o personagem no mapa
   * e vulnerável.
   */
  hz(anexada: boolean): number;

  aoEntrar(sessao: Sessao, personagem: CharacterRuntime): void;
  aoTick(sessao: Sessao, dtMs: number): void;
  aoMorrer(sessao: Sessao, personagem: CharacterRuntime): void;
  aoEncerrar(sessao: Sessao, motivo: MotivoDeEncerramento): void;

  /**
   * Estado próprio do ruleset, para entrar no snapshot. Ruleset sem estado pode omitir.
   * O serializador trata o retorno como opaco — quem entende do formato é o ruleset.
   */
  estado?(): unknown;
  restaurar?(estado: unknown): void;
}

export interface OpcoesDeSessao {
  readonly id: string;
  readonly versaoDeConteudo: string;
  readonly ruleset: Ruleset;
  readonly rng: Rng;
  readonly criadaEmMs: number;
}

export class Sessao {
  readonly id: string;
  /** Congelada na criação (invariante 7): a sessão termina na versão em que começou. */
  readonly versaoDeConteudo: string;
  readonly ruleset: Ruleset;
  readonly rng: Rng;
  readonly criadaEmMs: number;

  readonly participantes: CharacterRuntime[] = [];
  readonly eventosNotaveis: EventoNotavel[] = [];
  readonly agregados: Agregados = {
    duracaoMs: 0, xpGanha: 0, goldGanho: 0, goldGasto: 0, abates: 0, mortes: 0,
  };

  /** Sequência para idempotência econômica: `UNIQUE (session_id, seq)` (invariante 10). */
  ledgerSeq = 0;

  #visualizadores = new Set<string>();
  #ultimoTickMs: number;
  #encerradaPor: MotivoDeEncerramento | null = null;

  /**
   * Reconstrói uma sessão a partir de um snapshot (FUN-27, FUN-28).
   *
   * Visualizadores NÃO são restaurados: são conexões, e conexão não sobrevive à queda de um
   * nó. Uma sessão retomada nasce desanexada, que é o estado correto — quem estava olhando
   * vai reanexar por conta própria.
   */
  static deSnapshot(snapshot: SnapshotDeSessao, ruleset: Ruleset, rng: Rng): Sessao {
    if (snapshot.versaoDoFormato !== VERSAO_DO_FORMATO_DE_SNAPSHOT) {
      throw new Error(
        `snapshot na versão ${snapshot.versaoDoFormato}; este servidor lê ` +
          `${VERSAO_DO_FORMATO_DE_SNAPSHOT}. Migre ou descarte explicitamente.`,
      );
    }
    if (ruleset.tipo !== snapshot.tipo) {
      throw new Error(`ruleset "${ruleset.tipo}" não corresponde ao snapshot "${snapshot.tipo}"`);
    }

    const sessao = new Sessao({
      id: snapshot.id,
      versaoDeConteudo: snapshot.versaoDeConteudo,
      ruleset,
      rng,
      criadaEmMs: snapshot.criadaEmMs,
    });
    sessao.#ultimoTickMs = snapshot.ultimoTickMs;
    sessao.#encerradaPor = snapshot.encerradaPor;
    sessao.ledgerSeq = snapshot.ledgerSeq;
    Object.assign(sessao.agregados, snapshot.agregados);
    sessao.eventosNotaveis.push(...snapshot.eventosNotaveis);
    for (const estado of snapshot.participantes) {
      sessao.participantes.push(new CharacterRuntime(estado));
    }
    if (snapshot.ruleset !== undefined) ruleset.restaurar?.(snapshot.ruleset);
    return sessao;
  }

  constructor(opcoes: OpcoesDeSessao) {
    this.id = opcoes.id;
    this.versaoDeConteudo = opcoes.versaoDeConteudo;
    this.ruleset = opcoes.ruleset;
    this.rng = opcoes.rng;
    this.criadaEmMs = opcoes.criadaEmMs;
    this.#ultimoTickMs = opcoes.criadaEmMs;
  }

  get anexada(): boolean {
    return this.#visualizadores.size > 0;
  }

  get encerrada(): MotivoDeEncerramento | null {
    return this.#encerradaPor;
  }

  /** Anexar e desanexar não têm efeito nenhum sobre a simulação — é o ADR 0001 em uma linha. */
  anexar(visualizadorId: string): void {
    this.#visualizadores.add(visualizadorId);
  }

  desanexar(visualizadorId: string): void {
    this.#visualizadores.delete(visualizadorId);
  }

  /** Hz atual, dado quem está olhando. `0` = orientada a evento. */
  hzAtual(): number {
    return this.ruleset.hz(this.anexada);
  }

  entrar(personagem: CharacterRuntime): void {
    if (this.#encerradaPor) throw new Error(`sessão ${this.id} já encerrada`);
    this.participantes.push(personagem);
    this.ruleset.aoEntrar(this, personagem);
  }

  /**
   * Avança a simulação até `agoraMs`.
   *
   * Recebe o INSTANTE, não o intervalo, de propósito: o `dtMs` é derivado do último tick, então
   * uma troca de taxa (anexar ou desanexar) não perde nem ganha tempo. Passar o intervalo
   * nominal da taxa nova faria a sessão derivar a cada troca — e trocar de taxa acontece o dia
   * inteiro, então o erro acumula até virar diferença visível de XP.
   */
  tick(agoraMs: number): void {
    if (this.#encerradaPor) return;
    const dtMs = agoraMs - this.#ultimoTickMs;
    if (dtMs <= 0) return;
    this.#ultimoTickMs = agoraMs;
    this.agregados.duracaoMs += dtMs;
    this.ruleset.aoTick(this, dtMs);
  }

  /** Instante do último tick. É o "agora" da simulação — não use relógio de parede aqui. */
  get agoraMs(): number {
    return this.#ultimoTickMs;
  }

  matar(personagem: CharacterRuntime): void {
    personagem.vivo = false;
    personagem.vida = 0;
    this.agregados.mortes++;
    this.registrar('morte', personagem.id);
    this.ruleset.aoMorrer(this, personagem);
  }

  /** Lista curta para a tela de retorno (§16.2). Não é log: guarda só o que vale contar. */
  registrar(tipo: string, detalhe?: string): void {
    this.eventosNotaveis.push(
      detalhe === undefined
        ? { emMs: this.#ultimoTickMs, tipo }
        : { emMs: this.#ultimoTickMs, tipo, detalhe },
    );
  }

  encerrar(motivo: MotivoDeEncerramento): Extrato {
    if (!this.#encerradaPor) {
      this.#encerradaPor = motivo;
      this.ruleset.aoEncerrar(this, motivo);
      this.registrar('encerrada', motivo);
    }
    return {
      sessaoId: this.id,
      motivo: this.#encerradaPor,
      agregados: { ...this.agregados },
      eventosNotaveis: [...this.eventosNotaveis],
    };
  }

  estadoDoRng(): EstadoDeRng {
    return this.rng.estado();
  }

  /**
   * Snapshot para o Redis (FUN-27). Precisa reconstruir a sessão EXATAMENTE — cooldowns,
   * temporizadores em curso e o estado do gerador aleatório inclusive. Sem o gerador, a
   * sessão retomada continua com outra sequência de loot, e nenhuma investigação de "por
   * que não caiu" fica possível.
   */
  snapshot(): SnapshotDeSessao {
    const estadoDoRuleset = this.ruleset.estado?.();
    return {
      versaoDoFormato: VERSAO_DO_FORMATO_DE_SNAPSHOT,
      versaoDeConteudo: this.versaoDeConteudo,
      id: this.id,
      tipo: this.ruleset.tipo,
      criadaEmMs: this.criadaEmMs,
      ultimoTickMs: this.#ultimoTickMs,
      rng: this.rng.estado(),
      participantes: this.participantes.map((p) => p.estado()),
      agregados: { ...this.agregados },
      eventosNotaveis: [...this.eventosNotaveis],
      ledgerSeq: this.ledgerSeq,
      encerradaPor: this.#encerradaPor,
      ...(estadoDoRuleset === undefined ? {} : { ruleset: estadoDoRuleset }),
    };
  }
}
