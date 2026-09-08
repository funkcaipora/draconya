// O mundo em canvas (FUN-23).
//
// Este arquivo NÃO renderiza através do React (ADR 0007). Ele lê `world` direto no laço de
// quadro; nenhum estado de mundo entra por prop. Se um dia precisar de um `useEffect` para
// saber onde uma criatura está, o desenho está errado.
//
// RETÂNGULOS, não sprites. O pacote de arte do cliente Tibia não está no repositório e o
// pipeline dele é a FUN-16..21. O que existe aqui é tudo o que NÃO depende de arte — câmera,
// camadas, ordem de desenho, reaproveitamento de sprite e interpolação de passo —, que é
// justamente a parte difícil. Trocar retângulo por sprite depois é trocar a textura e ligar
// os `frameGroups`, não reescrever isto.

import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { buildTilemap, isBlocked, type Tilemap } from '@draconya/content';
import { interpolate, world, type Creature } from '../state/world.js';
import {
  TILE, VIEW_HEIGHT, VIEW_WIDTH, compareDrawOrder, toScreen, visibleTiles,
} from './camera.js';

const COLOR_FLOOR = 0x2b2b33;
const COLOR_WALL = 0x14141a;
const COLOR_GRID = 0x3a3a45;
const COLOR_CREATURE = 0xc25b4a;
const COLOR_SELF = 0x4ac26a;

export interface ViewportHandle {
  /** Troca o mapa desenhado. A FUN-32 vai chamar isto ao receber `instance-enter`. */
  setMap(map: Tilemap | null): void;
  destroy(): void;
}

export async function mountViewport(parent: HTMLElement): Promise<ViewportHandle> {
  const app = new Application();
  await app.init({
    width: VIEW_WIDTH * TILE,
    height: VIEW_HEIGHT * TILE,
    background: 0x101014,
    antialias: false,
    // Pixel art em coordenada fracionária fica borrada, e a causa é difícil de achar depois.
    roundPixels: true,
  });
  parent.appendChild(app.canvas);

  const view = { widthTiles: VIEW_WIDTH, heightTiles: VIEW_HEIGHT };

  // Camadas na ordem de desenho: terreno embaixo, criaturas em cima, sobreposição por último.
  const terrain = new Graphics();
  const creatures = new Container();
  const overlay = new Container();
  app.stage.addChild(terrain, creatures, overlay);

  let map: Tilemap | null = null;
  // Última janela desenhada. O terreno só é redesenhado quando ela muda — redesenhar a cada
  // quadro é o desperdício óbvio, e num mapa grande é o que come o orçamento de quadro.
  let painted = '';
  /** Assinatura das posições INTEIRAS. A ordem de desenho só muda quando ela muda. */
  let ordered = '';

  /**
   * Pool de sprites por id de criatura.
   *
   * Criar e destruir a cada `creature-appear` fragmenta memória numa hunt com respawn
   * constante, que é o caso NORMAL do jogo, não a exceção.
   */
  const sprites = new Map<number, Sprite>();

  function target(): { x: number; y: number; z: number } {
    const self = world.selfId === null ? undefined : world.creatures.get(world.selfId);
    if (self !== undefined) return interpolate(self, performance.now());
    // Sem `selfId` ainda (FUN-32), a câmera fica no centro do mapa: é melhor mostrar o mapa
    // do que mostrar o canto (0,0), que num mapa cercado por parede é só parede.
    if (map !== null) return { x: (map.width - 1) / 2, y: (map.height - 1) / 2, z: map.z };
    return { x: 0, y: 0, z: 0 };
  }

  function paintTerrain(center: { x: number; y: number }): void {
    if (map === null) {
      terrain.clear();
      painted = '';
      return;
    }
    const window = visibleTiles({ ...center, z: map.z }, view);
    const key = `${map.id}:${window.minX},${window.minY},${window.maxX},${window.maxY}`;
    if (key === painted) return;
    painted = key;

    terrain.clear();
    for (let y = window.minY; y <= window.maxY; y++) {
      for (let x = window.minX; x <= window.maxX; x++) {
        const outside = x < 0 || y < 0 || x >= map.width || y >= map.height;
        if (outside) continue;
        const screen = toScreen({ x, y }, { ...center, z: map.z }, view);
        terrain
          .rect(Math.round(screen.x), Math.round(screen.y), TILE, TILE)
          .fill(isBlocked(map, x, y) ? COLOR_WALL : COLOR_FLOOR)
          .stroke({ width: 1, color: COLOR_GRID, alignment: 0 });
      }
    }
  }

  function paintCreatures(center: { x: number; y: number; z: number }, nowMs: number): void {
    const seen = new Set<number>();
    const drawable: Array<{ creature: Creature; x: number; y: number }> = [];

    for (const creature of world.creatures.values()) {
      const position = interpolate(creature, nowMs);
      drawable.push({ creature, x: position.x, y: position.y });
      seen.add(creature.id);
    }

    for (const [id, sprite] of sprites) {
      if (seen.has(id)) continue;
      sprite.destroy();
      sprites.delete(id);
    }

    for (const entry of drawable) {
      let sprite = sprites.get(entry.creature.id);
      if (sprite === undefined) {
        sprite = new Sprite(Texture.WHITE);
        sprite.width = TILE - 6;
        sprite.height = TILE - 6;
        sprite.roundPixels = true;
        sprites.set(entry.creature.id, sprite);
        creatures.addChild(sprite);
      }
      const screen = toScreen(entry, center, view);
      sprite.x = screen.x + 3;
      sprite.y = screen.y + 3;
      sprite.tint = entry.creature.id === world.selfId ? COLOR_SELF : COLOR_CREATURE;
    }

    reorder(drawable);
  }

  /**
   * Quem está mais ao sul cobre quem está ao norte — mas SÓ quando alguém troca de tile.
   *
   * A ordem só pode mudar quando a posição inteira muda; dentro de um passo, as criaturas
   * deslizam sem se ultrapassar. Ordenar a cada quadro seria refazer o mesmo trabalho 60
   * vezes por segundo numa hunt com dezenas de criaturas — e é exatamente o custo que o
   * orçamento de quadro não tem para dar.
   */
  function reorder(drawable: ReadonlyArray<{ creature: Creature; x: number; y: number }>): void {
    const signature = drawable
      .map((entry) => `${entry.creature.id}:${Math.round(entry.x)},${Math.round(entry.y)}`)
      .join('|');
    if (signature === ordered) return;
    ordered = signature;

    const sorted = [...drawable].sort((a, b) => compareDrawOrder(
      { x: Math.round(a.x), y: Math.round(a.y) },
      { x: Math.round(b.x), y: Math.round(b.y) },
    ));
    for (const [index, entry] of sorted.entries()) {
      const sprite = sprites.get(entry.creature.id);
      // `zIndex` sozinho não basta sem `sortableChildren`; reordenar o filho é mais barato
      // que ligar ordenação automática num container inteiro.
      if (sprite !== undefined) creatures.setChildIndex(sprite, index);
    }
  }

  app.ticker.add(() => {
    const nowMs = performance.now();
    const center = target();
    paintTerrain(center);
    paintCreatures(center, nowMs);
  });

  return {
    setMap(next) {
      map = next;
      painted = '';
    },
    destroy() {
      for (const sprite of sprites.values()) sprite.destroy();
      sprites.clear();
      overlay.destroy();
      app.destroy(true, { children: true });
    },
  };
}

/** Constrói o `Tilemap` a partir do JSON de `content`. Ver a nota em `main.tsx`. */
export function tilemapFrom(data: Parameters<typeof buildTilemap>[0]): Tilemap {
  return buildTilemap(data);
}
