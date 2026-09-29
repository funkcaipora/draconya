// O sprite de um outfit (monstro ou personagem, SV-14 #350), num canvas de 32 px — a mesma ideia
// do `ItemSprite` (FUN-108), só que por `pack.outfit()` em vez de `pack.object()` (#259). Parado,
// olhando para o sul; com cores para o retrato do personagem, ou sem cores para a lista de hunts.

import { useEffect, useRef, useState } from 'react';
import type { OutfitColors } from '../assets/outfit.js';
import { useAssetPack } from './AssetPackContext.js';
import { fitInSquare, ITEM_SPRITE_SIZE } from './ItemSprite.js';

export function OutfitSprite({ outfitId, name, colors }: {
  readonly outfitId: number | undefined;
  readonly name: string | undefined;
  readonly colors?: OutfitColors;
}) {
  const loaded = useAssetPack();
  const pack = loaded?.pack ?? null;
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    const target = canvas.current;
    if (target === null || pack === null || outfitId === undefined) {
      setDrawn(false);
      return;
    }
    let cancelled = false;
    void pack.outfit(outfitId, 'south', 0, false, colors).then((sprite) => {
      if (cancelled) return;
      const context = target.getContext('2d');
      if (sprite === null || context === null) { setDrawn(false); return; }
      const at = fitInSquare(sprite.width, sprite.height, ITEM_SPRITE_SIZE);
      try {
        context.clearRect(0, 0, ITEM_SPRITE_SIZE, ITEM_SPRITE_SIZE);
        context.imageSmoothingEnabled = false;
        context.drawImage(sprite as unknown as ImageBitmap, at.x, at.y, at.width, at.height);
        setDrawn(true);
      } catch {
        setDrawn(false);
      }
    }).catch(() => { if (!cancelled) setDrawn(false); });
    return () => { cancelled = true; };
  }, [pack, outfitId, colors]);

  // Mesma classe do `ItemSprite` (`.item-sprite`/`.item-initial`): é o mesmo desenho de slot com
  // arte opcional, e duplicar a folha de estilo para um retângulo igual seria o único ganho de
  // um nome novo.
  return (
    <span className="item-sprite">
      {!drawn && <span className="item-initial" aria-hidden="true">{(name ?? '?').slice(0, 1).toUpperCase()}</span>}
      <canvas ref={canvas} width={ITEM_SPRITE_SIZE} height={ITEM_SPRITE_SIZE} hidden={!drawn}
        role="img" aria-label={name ?? 'monstro desconhecido'} />
    </span>
  );
}
