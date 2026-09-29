// O sprite de um item, num canvas de 32 px (FUN-108).
//
// É o MESMO quadro que o mundo desenha — `pack.object(appearanceId)` —, só que em DOM: um
// canvas por item, pintado uma vez, sem Pixi. O inventário é HUD, e HUD é DOM (ADR 0007);
// montar uma `Application` do Pixi por slot para desenhar um quadro parado seria pagar um
// contexto de GPU por ícone.
//
// **Sem pacote, a inicial do nome** — o placeholder de antes, que não finge ser arte. E é o
// que aparece também enquanto o quadro está em voo e quando o pacote não tem a aparência.

import { useEffect, useRef, useState } from 'react';
import { useAssetPack } from './AssetPackContext.js';

/** O lado do canvas. Um quadro do pacote é 32 ou 64; o slot mostra em 32. */
export const ITEM_SPRITE_SIZE = 32;

export interface Placement {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Onde um quadro de `width × height` cai dentro de um quadrado de `size`.
 *
 * Um 32×32 sai 1:1; um 64×64 (item grande) é reduzido para caber, e um quadro retangular
 * mantém a proporção e fica centrado. **Nunca amplia**: um quadro menor que o slot — não
 * existe no pacote, mas é o caso que uma conta de "escala para caber" acerta ao contrário —
 * sairia borrado, e pixel art borrada é o defeito que `imageSmoothingEnabled = false` existe
 * para evitar.
 *
 * Não há guarda contra dimensão zero, de propósito: `size / 0` é `Infinity`, o `Math.min`
 * com `1` devolve `1`, e `0 × 1` é `0` — um quadro vazio sai vazio e centrado, sem NaN. Um
 * `Math.max(1, width)` aqui já existiu e era código morto: dava o mesmo resultado.
 */
export function fitInSquare(width: number, height: number, size: number): Placement {
  const scale = Math.min(1, size / width, size / height);
  const fitted = { width: Math.round(width * scale), height: Math.round(height * scale) };
  return {
    x: Math.floor((size - fitted.width) / 2),
    y: Math.floor((size - fitted.height) / 2),
    ...fitted,
  };
}

export function ItemSprite({ appearanceId, name }: {
  readonly appearanceId: number | undefined;
  readonly name: string | undefined;
}) {
  const loaded = useAssetPack();
  const pack = loaded?.pack ?? null;
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    const target = canvas.current;
    if (target === null || pack === null || appearanceId === undefined) {
      setDrawn(false);
      return;
    }
    let cancelled = false;
    void pack.object(appearanceId).then((sprite) => {
      // Desmontou, ou o slot já mostra outro item: o quadro que chegou é de ninguém.
      if (cancelled) return;
      const context = target.getContext('2d');
      if (sprite === null || context === null) { setDrawn(false); return; }
      const at = fitInSquare(sprite.width, sprite.height, ITEM_SPRITE_SIZE);
      try {
        context.clearRect(0, 0, ITEM_SPRITE_SIZE, ITEM_SPRITE_SIZE);
        // Pixel art: qualquer suavização borra o quadro, e a causa é difícil de achar depois.
        context.imageSmoothingEnabled = false;
        // `ImageBitmap` satisfaz `Sprite` por estrutura, e é o que o pacote entrega de verdade.
        context.drawImage(sprite as unknown as ImageBitmap, at.x, at.y, at.width, at.height);
        setDrawn(true);
      } catch {
        // O orçamento de bitmaps pode ter fechado o quadro entre resolver e desenhar. É
        // raro, e a resposta é a mesma de "não há quadro": a inicial, não uma exceção.
        setDrawn(false);
      }
    }).catch(() => { if (!cancelled) setDrawn(false); });
    return () => { cancelled = true; };
  }, [pack, appearanceId]);

  // Sem `title` aqui: o slot em volta é quem diz "Tirar X" ou "Vestir X", e o `title` mais
  // interno ganharia o tooltip. O nome fica no `aria-label`, que não compete.
  return (
    <span className="item-sprite">
      {!drawn && <span className="item-initial" aria-hidden="true">{(name ?? '?').slice(0, 1).toUpperCase()}</span>}
      <canvas
        ref={canvas}
        width={ITEM_SPRITE_SIZE}
        height={ITEM_SPRITE_SIZE}
        hidden={!drawn}
        role="img"
        aria-label={name ?? 'item desconhecido'}
      />
    </span>
  );
}
