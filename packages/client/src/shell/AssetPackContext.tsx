// O pacote de arte, compartilhado pela casca (FUN-108).
//
// Ele nasceu dentro do `Viewport`, e o inventário passou a precisar dele também: o sprite do
// item é o mesmo quadro que o mundo desenha. Um pacote por consumidor seria dois workers de
// LZMA, dois orçamentos de bitmap e o mesmo catálogo lido duas vezes — então ele sobe para o
// `Shell`, e desce por contexto.
//
// **Contexto do React é aceitável AQUI, e não é exceção ao ADR 0007.** O ADR é sobre o MUNDO:
// criaturas, posição, movimento — o que muda sessenta vezes por segundo e não pode causar
// render. O pacote muda UMA vez, ao carregar, e o que ele entrega é apresentação DOM (um
// canvas de 32 px por item). Nada de estado de jogo passa por aqui.

import { createContext, useContext } from 'react';
import type { AssetPack } from '../assets/pack.js';
import type { Sprite } from '../assets/sprites.js';

export type EvictionListener = (bitmap: Sprite) => void;

export interface AssetPackState {
  /** `null` quando não há pacote — a tela desenha sem arte, e continua válida. */
  readonly pack: AssetPack | null;
  /**
   * Avisa que o pacote vai FECHAR um bitmap. É o `onEvict` do pacote, redistribuído.
   *
   * Quem constrói textura sobre um bitmap precisa saber quando ele morre — uma `Texture` do
   * Pixi sobre um `ImageBitmap` fechado é textura inválida. O `TextureBook` que precisa disso
   * é do VIEWPORT, e morre com ele (`destroy()` o fecha para sempre); o pacote é um só e vive
   * com o Shell. A inscrição é o que deixa cada montagem do viewport ter o livro dela, sem o
   * pacote saber quantas houve — o StrictMode monta duas.
   *
   * Devolve a função que desinscreve.
   */
  readonly subscribeEvictions: (listener: EvictionListener) => () => void;
}

/**
 * `null` enquanto o pacote CARREGA; depois, o estado — com `pack: null` se não houver arte.
 *
 * A distinção importa para o viewport: ele monta o Pixi UMA vez, com o pacote em mãos, e
 * montar antes de saber se há pacote seria montar duas vezes.
 */
export const AssetPackContext = createContext<AssetPackState | null>(null);

/** O pacote, ou `null` enquanto carrega. Ver `AssetPackContext`. */
export function useAssetPack(): AssetPackState | null {
  return useContext(AssetPackContext);
}
