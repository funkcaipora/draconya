// Estado quente do personagem. A sessão dona é o único objeto que escreve aqui
// (invariante 9) — é também o que dispensa lock sobre o gold.

import { Cooldowns } from './cooldown.js';
import type { EstadoDeCooldowns } from './cooldown.js';

export interface Ponto {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface EstadoDePersonagem {
  readonly id: string;
  readonly posicao: Ponto;
  readonly vida: number;
  readonly vidaMaxima: number;
  readonly mana: number;
  readonly manaMaxima: number;
  readonly level: number;
  readonly xp: number;
  /** Variação de gold desta sessão. Vira linha de ledger ao encerrar (invariante 10). */
  readonly deltaDeGold: number;
  readonly vivo: boolean;
  readonly cooldowns: Partial<EstadoDeCooldowns>;
}

export class CharacterRuntime {
  readonly id: string;
  posicao: Ponto;
  vida: number;
  vidaMaxima: number;
  mana: number;
  manaMaxima: number;
  level: number;
  xp: number;
  deltaDeGold: number;
  vivo: boolean;
  readonly cooldowns: Cooldowns;

  constructor(estado: EstadoDePersonagem) {
    this.id = estado.id;
    this.posicao = estado.posicao;
    this.vida = estado.vida;
    this.vidaMaxima = estado.vidaMaxima;
    this.mana = estado.mana;
    this.manaMaxima = estado.manaMaxima;
    this.level = estado.level;
    this.xp = estado.xp;
    this.deltaDeGold = estado.deltaDeGold;
    this.vivo = estado.vivo;
    this.cooldowns = Cooldowns.deEstado(estado.cooldowns);
  }

  estado(): EstadoDePersonagem {
    return {
      id: this.id,
      posicao: this.posicao,
      vida: this.vida,
      vidaMaxima: this.vidaMaxima,
      mana: this.mana,
      manaMaxima: this.manaMaxima,
      level: this.level,
      xp: this.xp,
      deltaDeGold: this.deltaDeGold,
      vivo: this.vivo,
      cooldowns: this.cooldowns.estado(),
    };
  }

  /** Aplica dano e devolve quanto foi de fato aplicado. Morrer é decisão do ruleset. */
  receberDano(quantidade: number): number {
    const aplicado = Math.min(quantidade, this.vida);
    this.vida -= aplicado;
    if (this.vida <= 0) {
      this.vida = 0;
      this.vivo = false;
    }
    return aplicado;
  }

  curar(quantidade: number): number {
    const aplicado = Math.min(quantidade, this.vidaMaxima - this.vida);
    this.vida += aplicado;
    return aplicado;
  }
}
