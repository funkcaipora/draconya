// Texturas do Pixi sobre os bitmaps do pacote (FUN-23).
//
// O ticker do viewport é SÍNCRONO e o pacote é assíncrono: um quadro não pode esperar um
// `await`. Este módulo é a ponte — pede uma vez por chave, guarda "pendente" enquanto não
// resolve, e devolve a textura pronta quando há uma. Quem chama desenha o fallback no meio.
//
// **`onEvict` é o outro lado do contrato.** O orçamento de bytes fecha o `ImageBitmap` ao
// despejar, e uma `Texture` construída sobre um bitmap fechado é textura inválida por baixo —
// desenha lixo, ou falha ao reenviar para a GPU. A chave aqui é o PRÓPRIO bitmap, num
// `WeakMap`: quando o pacote avisa que vai fechá-lo, a textura dele é destruída junto.

import { Texture } from 'pixi.js';
import type { Sprite as Bitmap } from '../assets/sprites.js';

export type TextureRequest = () => Promise<Bitmap | null>;

export class TextureBook {
  readonly #byBitmap = new WeakMap<Bitmap, Texture>();
  /** Por chave de pedido: a textura pronta, `null` para "não existe", ou a promessa em voo. */
  readonly #byKey = new Map<string, Texture | null | Promise<void>>();
  #closed = false;
  #version = 0;
  /** Métricas de desenvolvimento (M23 §40): `get` que devolveu uma `Texture` pronta. */
  #hits = 0;
  /** Métricas de desenvolvimento (M23 §40): `get` que disparou um pedido ao pacote. */
  #misses = 0;

  /**
   * Sobe a cada mudança no que está PRONTO: uma textura que chega, uma resposta "não existe",
   * um `forget`, um `clear`. É o que o viewport põe na chave de repintura do terreno — um
   * número, em vez de sondar cada célula do padrão a cada quadro para saber se algo mudou.
   */
  get version(): number { return this.#version; }

  /** `get` que devolveu uma `Texture` pronta. Métrica de desenvolvimento (M23 §40). */
  get hits(): number { return this.#hits; }

  /** `get` que disparou um pedido ao pacote. `null` (não existe) e pendente não contam. */
  get misses(): number { return this.#misses; }

  /**
   * A textura de uma chave, ou `undefined` enquanto ela não chega — e dispara o pedido na
   * primeira vez. `null` é resposta definitiva: o pacote disse que não há quadro.
   */
  get(key: string, request: TextureRequest): Texture | null | undefined {
    const known = this.#byKey.get(key);
    if (known instanceof Texture) {
      this.#hits += 1;
      return known;
    }
    if (known === null) return known;
    if (known !== undefined) return undefined;

    this.#misses += 1;
    const flight = request().then((bitmap) => {
      if (this.#closed) return;
      // O `.then` VERIFICA que a chave ainda é a mesma pendência: `clear()` no meio do voo
      // trocaria o mapa, e aplicar aqui reviveria uma entrada que ninguém pediu mais.
      if (this.#byKey.get(key) !== flight) return;
      this.#byKey.set(key, bitmap === null ? null : this.#textureOf(bitmap));
      this.#version += 1;
    }).catch(() => {
      // Folha que o servidor não tem, ou LZMA que não abriu: fica sem quadro, e o viewport
      // desenha o fallback. Rejeição não tratada por criatura por quadro derrubaria a aba.
      if (this.#byKey.get(key) === flight) {
        this.#byKey.set(key, null);
        this.#version += 1;
      }
    });
    this.#byKey.set(key, flight);
    return undefined;
  }

  /** O pacote vai fechar este bitmap: a textura dele morre ANTES, não depois. */
  forget(bitmap: Bitmap): void {
    const texture = this.#byBitmap.get(bitmap);
    if (texture === undefined) return;
    this.#byBitmap.delete(bitmap);
    for (const [key, value] of this.#byKey) {
      if (value === texture) this.#byKey.delete(key);
    }
    texture.destroy(true);
    this.#version += 1;
  }

  /** Esquece tudo. As texturas são destruídas; os bitmaps são do pacote, que os fecha. */
  clear(): void {
    this.#closed = true;
    for (const value of this.#byKey.values()) {
      if (value instanceof Texture) value.destroy(true);
    }
    this.#byKey.clear();
    this.#version += 1;
  }

  #textureOf(bitmap: Bitmap): Texture {
    const existing = this.#byBitmap.get(bitmap);
    if (existing !== undefined) return existing;
    // `ImageBitmap` satisfaz `Bitmap` por estrutura, e é o que o pacote entrega de verdade.
    const texture = Texture.from(bitmap as unknown as ImageBitmap);
    // Pixel art: qualquer suavização borra o sprite de 32 px e a causa é difícil de achar.
    texture.source.scaleMode = 'nearest';
    this.#byBitmap.set(bitmap, texture);
    return texture;
  }
}
