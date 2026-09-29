import { useEffect, useRef } from 'react';
import type { MouseEvent } from 'react';
import type { AssetPack } from '../assets/pack.js';
import { sendIntent } from '../net/current.js';
import { targetTracker } from '../state/target.js';
import { useHudSlice } from '../state/useSlice.js';
import { world } from '../state/world.js';
import { TextureBook } from '../world/textures.js';
import { loadStackMap, sceneFromStack } from '../world/scene.js';
import type { Scene } from '../world/scene.js';
import { mountViewport } from '../world/viewport.js';
import type { ViewportHandle, ViewportStats } from '../world/viewport.js';
import { useAssetPack } from './AssetPackContext.js';
import { WorldStatusOverlay } from './WorldStatusOverlay.js';

/**
 * O global de desenvolvimento (M23 §40, D8): em `import.meta.env.DEV`, quem estiver com o
 * console aberto lê `window.__draconya.renderStats()` e vê os contadores do renderer. É
 * leitura sob demanda — o laço do Pixi nunca avisa ninguém (ADR 0007) —, e em produção o
 * objeto nunca é escrito.
 */
declare global {
  interface Window {
    __draconya?: { renderStats: () => ViewportStats };
  }
}

/**
 * De onde vem a cena de um `mapId`: de `things/<versão>/maps/<id>.json` — o mesmo caminho das
 * folhas (`VITE_THINGS_URL`). Todo mapa do conteúdo é importado desde a FUN-123 (Thais e o
 * bueiro real); um mapa autorado à mão voltaria por `sceneFromTilemap`, que fica para as
 * fixtures. Sem caminho, ou sem o arquivo, é `null`, e o viewport desenha a grade lisa de
 * reserva: mapa que não carrega não é razão de a tela não abrir, pela regra da arte que não
 * carrega.
 */
async function loadScene(mapId: string): Promise<Scene | null> {
  const baseUrl = import.meta.env.VITE_THINGS_URL;
  if (baseUrl === undefined || baseUrl === '') return null;
  const stack = await loadStackMap(baseUrl, mapId);
  return stack === null ? null : sceneFromStack(stack);
}

/**
 * O canvas. Este componente monta e desmonta o Pixi e também declara o overlay de status; o
 * mundo NÃO passa por prop nem por estado do React (ADR 0007). O laço de quadro lê `world`
 * direto — inclusive o `mapId` (FUN-121): a cena é buscada quando ele muda, pelo `loadScene`
 * acima.
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
  /** O último alvo que o HUD entregou — para o Pixi que ainda estava subindo. */
  const targetRef = useRef<number | null>(null);
  const targetId = useHudSlice((state) => state.targetId);

  useEffect(() => {
    targetRef.current = targetId;
    handleRef.current?.setTargetId(targetId);
  }, [targetId]);

  const onCanvasClick = (event: MouseEvent<HTMLDivElement>): void => {
    // O canvas é filho do Pixi; o overlay de status é irmão React. Só o clique no canvas escolhe.
    if (!(event.target instanceof HTMLCanvasElement)) return;
    const id = handleRef.current?.creatureAt(event.clientX, event.clientY) ?? null;
    if (id === null || id === world.selfId) return;
    // INTENÇÃO (invariante 4): o servidor confere se o id é alvo válido. O rastreador antecipa
    // a moldura no mesmo quadro e decide o toggle quando o clique é no alvo atual (#471).
    targetTracker.selectTarget(id, sendIntent);
  };

  useEffect(() => {
    const parent = holder.current;
    if (parent === null) return;
    let cancelled = false;

    const book = new TextureBook();
    bookRef.current = book;

    void (async () => {
      const mounted = await mountViewport(parent, { pack: null, book, loadScene });
      // Desmontado antes de o Pixi terminar de subir — o StrictMode faz isso em
      // desenvolvimento. Destruir na hora, senão sobra um canvas órfão desenhando.
      if (cancelled) {
        mounted.destroy();
        return;
      }
      handleRef.current = mounted;
      // O global aponta para o handle VIVO: o StrictMode monta duas vezes e a primeira
      // montagem apaga o dela no cleanup, então a segunda reescreve o global.
      if (import.meta.env.DEV) window.__draconya = { renderStats: () => mounted.stats() };
      // O pacote pode ter chegado enquanto o Pixi subia: o efeito de pacote já rodou, não
      // tinha a quem entregar, e deixou aqui.
      mounted.setPack(packRef.current);
      mounted.setTargetId(targetRef.current);
    })();

    return () => {
      cancelled = true;
      if (import.meta.env.DEV) delete window.__draconya;
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

  return (
    <div className="viewport" ref={holder} onClick={onCanvasClick}>
      {/* O canvas é anexado pelo Pixi; este filho React absoluto pinta o status por cima dele. */}
      <WorldStatusOverlay handleRef={handleRef} />
    </div>
  );
}
