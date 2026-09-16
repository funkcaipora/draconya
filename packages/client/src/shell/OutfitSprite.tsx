// O sprite de um outfit de monstro, num canvas de 32 px — a mesma ideia do `ItemSprite`
// (FUN-108), só que por `pack.outfit()` em vez de `pack.object()` (#259). Parado, olhando para
// o sul, sem cores: é o retrato que a lista de hunts mostra antes de a criatura existir no
// mundo. O `world/` desenha o outfit de verdade, colorido e animado, quando ela aparece — isto
// aqui NÃO é o retrato do próprio personagem (esse é SV-14, M15, outro componente).

import { useEffect, useRef, useState } from 'react';
import { useAssetPack } from './AssetPackContext.js';
import { fitInSquare, ITEM_SPRITE_SIZE } from './ItemSprite.js';

export function OutfitSprite({ outfitId, name }: {
  readonly outfitId: number | undefined;
  readonly name: string | undefined;
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
    // Parado ('south', fase 0, `moving = false`), sem `colors`: é a base do outfit, igual ao
    // que `warmOutfit` já aqueceu na Cidade (FUN-112) — nenhum pedido novo à rede.
    void pack.outfit(outfitId, 'south', 0, false).then((sprite) => {
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
  }, [pack, outfitId]);

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
