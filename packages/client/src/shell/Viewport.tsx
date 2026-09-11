import { useEffect, useRef } from 'react';
import appearances from '@draconya/content/data/appearances/baseline.json';
import mapData from '@draconya/content/data/maps/rat-cellars.json';
import type { AssetPack } from '../assets/pack.js';
import { TextureBook } from '../world/textures.js';
import { mountViewport, tilemapFrom } from '../world/viewport.js';
import type { MapTiles, ViewportHandle } from '../world/viewport.js';
import { useAssetPack } from './AssetPackContext.js';

/**
 * O canvas. Este componente monta e desmonta o Pixi e nada mais — o mundo NÃO passa por
 * prop nem por estado do React (ADR 0007). O laço de quadro lê `world` direto.
 *
 * **O Pixi sobe IMEDIATAMENTE, sem pacote, e a arte entra quando chega** (`setPack`). O
 * pacote vem do contexto, montado pelo `Shell` (FUN-108), e leva o que a rede levar para
 * baixar o catálogo — numa conexão ruim, segundos. Esperar por ele deixava a área do mundo
 * VAZIA esse tempo inteiro: sem chão, sem criaturas, sem sequer os retângulos — a tela abria
 * sem o jogo. Arte que carrega devagar não é razão de a tela não abrir, pela mesma regra de
 * arte que não carrega: o viewport desenha retângulos até o pacote chegar, e sprites depois.
 * Se o pacote falhou, o contexto chega com `pack: null` e nada muda.
 *
 * São DOIS efeitos porque são dois ciclos de vida: o Pixi vive com a MONTAGEM e a entrega do
 * pacote vive com o CONTEXTO. Um efeito só, dependente de `loaded`, desmontaria e remontaria
 * o Pixi quando o pacote chegasse — o canvas piscaria e o mapa seria repintado do zero. Os
 * dois se falam por refs, e cada lado tolera o outro ainda não existir: o Pixi sobe de forma
 * assíncrona, então o pacote pode chegar antes dele (fica em `packRef`, e a montagem o aplica
 * ao terminar) ou depois (`setPack` direto no handle).
 *
 * **O livro de texturas é DESTA montagem**, não do contexto. `destroy()` o fecha para sempre
 * (`book.clear()`), e o StrictMode monta o viewport duas vezes com o mesmo contexto — um livro
 * compartilhado chegaria fechado à segunda montagem, e a tela ficaria em retângulos sem nenhum
 * erro. O pacote avisa os despejos pelo contexto, e é aqui que cada livro se inscreve. O livro
 * sobrevive à chegada do pacote sem limpeza porque sem pacote ele nunca é consultado — ver
 * `setPack` em `world/viewport.ts`.
 */
export function Viewport() {
  const holder = useRef<HTMLDivElement>(null);
  const loaded = useAssetPack();
  /** O Pixi montado — `null` enquanto sobe (é assíncrono) e depois de desmontar. */
  const handleRef = useRef<ViewportHandle | null>(null);
  /** O livro desta montagem. Nasce SÍNCRONO no efeito de montagem, para o de pacote assinar. */
  const bookRef = useRef<TextureBook | null>(null);
  /** O último pacote que o contexto entregou — para o Pixi que ainda estava subindo. */
  const packRef = useRef<AssetPack | null>(null);

  useEffect(() => {
    const parent = holder.current;
    if (parent === null) return;
    let cancelled = false;

    const book = new TextureBook();
    bookRef.current = book;
    // A tabela vem do JSON direto, como o mapa: é o mesmo caminho e a mesma versão.
    const tiles: MapTiles | null = appearances.maps[mapData.id as keyof typeof appearances.maps] ?? null;

    void (async () => {
      const mounted = await mountViewport(parent, { pack: null, book });
      // Desmontado antes de o Pixi terminar de subir — o StrictMode faz isso em
      // desenvolvimento. Destruir na hora, senão sobra um canvas órfão desenhando.
      if (cancelled) {
        mounted.destroy();
        return;
      }
      handleRef.current = mounted;
      // O mapa vem empacotado por enquanto: o `instance-enter` manda o ID, não o conteúdo.
      mounted.setMap(tilemapFrom(mapData), tiles);
      // O pacote pode ter chegado enquanto o Pixi subia: o efeito de pacote já rodou, não
      // tinha a quem entregar, e deixou aqui.
      mounted.setPack(packRef.current);
    })();

    return () => {
      cancelled = true;
      handleRef.current?.destroy();
      handleRef.current = null;
      bookRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (loaded === null) return;
    const book = bookRef.current;
    const unsubscribe = book === null
      ? null
      : loaded.subscribeEvictions((bitmap) => { book.forget(bitmap); });
    packRef.current = loaded.pack;
    handleRef.current?.setPack(loaded.pack);

    return () => {
      unsubscribe?.();
      // O contexto voltou a `null` — o `Shell` fechou o pacote (o StrictMode faz isso em
      // desenvolvimento). Um pacote fechado não resolve mais nada; ficar apontando para ele
      // deixaria pedidos pendentes para sempre no livro.
      packRef.current = null;
      handleRef.current?.setPack(null);
    };
  }, [loaded]);

  return <div className="viewport" ref={holder} />;
}
