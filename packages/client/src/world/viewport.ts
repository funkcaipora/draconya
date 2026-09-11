// O mundo em canvas (FUN-23).
//
// Este arquivo NÃO renderiza através do React (ADR 0007). Ele lê `world` direto no laço de
// quadro; nenhum estado de mundo entra por prop. Se um dia precisar de um `useEffect` para
// saber onde uma criatura está, o desenho está errado.
//
// SPRITES, com retângulo como degradação. O pacote de arte entra por `AssetPack` e cada quadro
// vira `Texture` pelo `TextureBook`; enquanto um quadro não chega — ou quando o pacote não tem
// aquele id — o lugar dele é um retângulo, e a tela nunca fica preta por causa de arte. A parte
// difícil continua a mesma de antes: câmera, camadas, ordem de desenho, pool e interpolação.
//
// A barra de vida e o nome NÃO dependem de arte: existem no modo sem pacote também. São
// `Graphics` e `Text` na camada `overlay`, um par por criatura, no mesmo pool por id que os
// sprites — nascem no appear e morrem quando a criatura some.

import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { buildTilemap, isBlocked, type Tilemap } from '@draconya/content';
import type { AssetPack } from '../assets/pack.js';
import { interpolate, world, type Creature } from '../state/world.js';
import {
  TILE, VIEW_HEIGHT, VIEW_WIDTH, compareDrawOrder, toScreen, visibleTiles,
} from './camera.js';
import { facingOf, walkFrame } from './facing.js';
import {
  HEALTH_BAR_HEIGHT, HEALTH_BAR_WIDTH, HEALTH_FILL_HEIGHT, HEALTH_FILL_WIDTH,
  healthColor, healthPercent, healthWidth,
} from './health.js';
import { creatureKey, groundCell, groundKey } from './keys.js';
import { DEFAULT_OUTFIT_COLORS } from './outfit-colors.js';
import { TextureBook } from './textures.js';

const COLOR_FLOOR = 0x2b2b33;
const COLOR_WALL = 0x14141a;
const COLOR_GRID = 0x3a3a45;
const COLOR_CREATURE = 0xc25b4a;
const COLOR_SELF = 0x4ac26a;
const COLOR_HEALTH_FRAME = 0x000000;

/**
 * Onde a barra fica em relação ao TILE, não ao quadro: um quadro de 64 px transborda para
 * cima, e ancorar nele faria a barra pular quando a criatura troca de quadro.
 */
const HEALTH_BAR_ABOVE = 8;
/** O nome termina um pixel acima da barra. */
const NAME_GAP = 1;
/** Metade da barra, arredondada para baixo: ver o comentário em `paintOverlay`. */
const HEALTH_BAR_HALF = Math.floor(HEALTH_BAR_WIDTH / 2);

/**
 * O que fica sobre a criatura: barra e nome, e o último estado desenhado de cada um.
 *
 * Redesenhar a barra é refazer a geometria e o nome é rasterizar texto de novo — os dois a
 * cada quadro, por criatura, é o custo que uma hunt com dezenas de monstros não paga. Só a
 * POSIÇÃO anda todo quadro, junto do sprite.
 */
interface CreatureOverlay {
  readonly bar: Graphics;
  readonly label: Text;
  drawnHealth: number;
  drawnMaxHealth: number;
  drawnName: string;
  drawnColor: number;
}

/** De que o mapa é feito, pela tabela de aparências (FUN-94, `appearances.maps`). */
export interface MapTiles {
  readonly floor: number;
  readonly wall: number;
}

export interface ViewportOptions {
  /** O pacote de arte. `null` desenha só retângulos — é o modo sem assets, e continua válido. */
  readonly pack?: AssetPack | null;
  /** O livro de texturas, criado por quem criou o pacote: é ele que recebe o `onEvict`. */
  readonly book?: TextureBook;
}

export interface ViewportHandle {
  /** Troca o mapa desenhado, e diz de que ele é feito. */
  setMap(map: Tilemap | null, tiles?: MapTiles | null): void;
  destroy(): void;
}

export async function mountViewport(
  parent: HTMLElement, options: ViewportOptions = {},
): Promise<ViewportHandle> {
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

  const pack = options.pack ?? null;
  const book = options.book ?? new TextureBook();
  const view = { widthTiles: VIEW_WIDTH, heightTiles: VIEW_HEIGHT };

  // Camadas na ordem de desenho: terreno embaixo, criaturas em cima, sobreposição por último.
  const terrain = new Container();
  const creatures = new Container();
  const overlay = new Container();
  app.stage.addChild(terrain, creatures, overlay);

  let map: Tilemap | null = null;
  let tiles: MapTiles | null = null;
  // Última janela desenhada. O terreno só é redesenhado quando ela muda — redesenhar a cada
  // quadro é o desperdício óbvio, e num mapa grande é o que come o orçamento de quadro.
  let painted = '';
  /** Assinatura das posições INTEIRAS. A ordem de desenho só muda quando ela muda. */
  let ordered = '';

  /**
   * Pool de sprites de terreno, um por tile da janela. Reaproveitado a cada troca de janela:
   * recriar Sprites a cada tile cruzado é a fragmentação que o pool de criaturas já evita.
   */
  const ground: Sprite[] = [];
  const groundFallback = new Graphics();
  terrain.addChild(groundFallback);

  /**
   * Pool de sprites por id de criatura.
   *
   * Criar e destruir a cada `creature-appear` fragmenta memória numa hunt com respawn
   * constante, que é o caso NORMAL do jogo, não a exceção.
   */
  const sprites = new Map<number, Sprite>();
  /** Barra e nome, pelo mesmo id. Nascem e morrem junto do sprite. */
  const overlays = new Map<number, CreatureOverlay>();

  function target(): { x: number; y: number; z: number } {
    const self = world.selfId === null ? undefined : world.creatures.get(world.selfId);
    if (self !== undefined) return interpolate(self, performance.now());
    // Sem `selfId` ainda (FUN-32), a câmera fica no centro do mapa: é melhor mostrar o mapa
    // do que mostrar o canto (0,0), que num mapa cercado por parede é só parede.
    if (map !== null) return { x: (map.width - 1) / 2, y: (map.height - 1) / 2, z: map.z };
    return { x: 0, y: 0, z: 0 };
  }

  /**
   * A textura de um objeto do mapa NO TILE `(x, y)`, ou `undefined` enquanto não chega.
   *
   * A chave e o pedido são pela CÉLULA do padrão: um chão de 4×4 são dezesseis texturas no
   * livro, não uma por tile — e vizinhos ganham quadros diferentes, que é o que faz o chão do
   * Tibia não parecer azulejo.
   */
  function tileTexture(appearanceId: number, x: number, y: number): Texture | null | undefined {
    if (pack === null) return null;
    const pattern = pack.objectPattern(appearanceId);
    const cell = groundCell(x, y, pattern);
    return book.get(
      groundKey(appearanceId, x, y, pattern), () => pack.object(appearanceId, cell.x, cell.y),
    );
  }

  function paintTerrain(center: { x: number; y: number }): void {
    if (map === null) {
      groundFallback.clear();
      for (const sprite of ground) sprite.visible = false;
      painted = '';
      return;
    }
    const window = visibleTiles({ ...center, z: map.z }, view);

    // **O terreno é pintado em coordenada RELATIVA à janela e o CONTAINER é que anda.** Pintar
    // com o centro fracionário só quando a janela vira faria o chão pular um tile inteiro
    // enquanto as criaturas — posicionadas a cada quadro — deslizam: cisalhamento de até 32 px
    // assim que a câmera seguir o personagem.
    const origin = toScreen({ x: window.minX, y: window.minY }, { ...center, z: map.z }, view);
    terrain.x = Math.round(origin.x);
    terrain.y = Math.round(origin.y);

    // A chave inclui a VERSÃO do livro de texturas: o primeiro quadro pinta retângulo, e o
    // quadro em que uma folha resolve — ou em que um despejo esquece uma célula — precisa
    // repintar mesmo com a janela parada. Um número, e não uma sondagem célula a célula: a
    // pergunta "mudou algo?" só muda quando o livro muda, e custar 17 consultas por quadro
    // para respondê-la era pagar a 60 Hz por um evento raro.
    const key = `${map.id}:${window.minX},${window.minY},${window.maxX},${window.maxY}:${book.version}`;
    if (key === painted) return;
    painted = key;

    groundFallback.clear();
    let used = 0;
    for (let y = window.minY; y <= window.maxY; y++) {
      for (let x = window.minX; x <= window.maxX; x++) {
        const outside = x < 0 || y < 0 || x >= map.width || y >= map.height;
        if (outside) continue;
        const local = { x: (x - window.minX) * TILE, y: (y - window.minY) * TILE };
        const blocked = isBlocked(map, x, y);
        const texture = tiles === null
          ? null
          : tileTexture(blocked ? tiles.wall : tiles.floor, x, y);
        if (texture instanceof Texture) {
          let sprite = ground[used];
          if (sprite === undefined) {
            sprite = new Sprite();
            sprite.roundPixels = true;
            ground.push(sprite);
            terrain.addChild(sprite);
          }
          sprite.texture = texture;
          // Parede maior que o tile transborda para CIMA e para a ESQUERDA, como no Tibia:
          // a âncora é o canto inferior direito do tile.
          sprite.x = local.x + TILE - texture.width;
          sprite.y = local.y + TILE - texture.height;
          sprite.visible = true;
          used += 1;
          continue;
        }
        groundFallback
          .rect(local.x, local.y, TILE, TILE)
          .fill(blocked ? COLOR_WALL : COLOR_FLOOR)
          .stroke({ width: 1, color: COLOR_GRID, alignment: 0 });
      }
    }
    for (let i = used; i < ground.length; i++) (ground[i] as Sprite).visible = false;
  }

  /** O quadro de uma criatura agora: direção, fase e parado/andando saem do passo dela. */
  function creatureTexture(creature: Creature, nowMs: number): Texture | null | undefined {
    if (pack === null || creature.appearanceId <= 0) return null;
    const direction = facingOf(creature);
    const moving = creature.step !== null && walkFrame(creature, nowMs, 1).moving;
    const frames = pack.framesOf(creature.appearanceId, moving);
    const { phase } = walkFrame(creature, nowMs, frames);
    // Toda criatura é pedida COM cores — as padrão, até o protocolo carregar as de cada uma.
    // O pacote devolve a base como está para quem não tem template (monstro), e a chave leva
    // as cores para o quadro pintado nunca cair na entrada do quadro cru.
    const colors = DEFAULT_OUTFIT_COLORS;
    const key = creatureKey(creature.appearanceId, direction, moving, phase, colors);
    return book.get(
      key, () => pack.outfit(creature.appearanceId, direction, phase, moving, colors),
    );
  }

  /** A barra e o nome de uma criatura, criados uma vez e reaproveitados a cada quadro. */
  function createOverlay(): CreatureOverlay {
    const bar = new Graphics();
    bar.roundPixels = true;
    const label = new Text({
      text: '',
      style: {
        fontFamily: 'Verdana, sans-serif', fontSize: 10, fontWeight: 'bold', fill: 0xffffff,
      },
      // Rasterizado em dobro: o texto do Pixi é uma textura, e a 1× dez pixels de Verdana
      // viram borrão sobre um sprite nítido. `anchor` no meio de baixo é o que centra o nome
      // no tile sem medir o texto a cada quadro.
      resolution: 2,
      roundPixels: true,
      anchor: { x: 0.5, y: 1 },
    });
    overlay.addChild(bar, label);
    return { bar, label, drawnHealth: -1, drawnMaxHealth: -1, drawnName: '', drawnColor: -1 };
  }

  /**
   * Redesenha o que MUDOU, e move o que sempre anda.
   *
   * A cor do nome segue a da barra: é a leitura de relance do Tibia — um nome vermelho é uma
   * criatura quase morta, sem olhar a barra.
   */
  function paintOverlay(
    entry: CreatureOverlay, creature: Creature, screen: { x: number; y: number },
  ): void {
    const { health, maxHealth, name } = creature;
    const color = healthColor(healthPercent(health, maxHealth));
    if (health !== entry.drawnHealth || maxHealth !== entry.drawnMaxHealth) {
      entry.drawnHealth = health;
      entry.drawnMaxHealth = maxHealth;
      entry.bar
        .clear()
        .rect(0, 0, HEALTH_BAR_WIDTH, HEALTH_BAR_HEIGHT)
        .fill(COLOR_HEALTH_FRAME);
      const width = healthWidth(health, maxHealth, HEALTH_FILL_WIDTH);
      if (width > 0) entry.bar.rect(1, 1, width, HEALTH_FILL_HEIGHT).fill(color);
    }
    if (name !== entry.drawnName) {
      entry.drawnName = name;
      entry.label.text = name;
    }
    if (color !== entry.drawnColor) {
      entry.drawnColor = color;
      entry.label.style.fill = color;
    }
    const centerX = screen.x + TILE / 2;
    const barTop = screen.y - HEALTH_BAR_ABOVE;
    // Deslocamento INTEIRO em relação ao tile. A barra tem 27 px, e centrá-la a 13,5 px
    // punha o vértice dela meio pixel fora da grade do sprite: `roundPixels` arredonda cada
    // um por si, e a barra oscilava um pixel para os lados a cada meio tile de rolagem.
    entry.bar.x = centerX - HEALTH_BAR_HALF;
    entry.bar.y = barTop;
    entry.label.x = centerX;
    entry.label.y = barTop - NAME_GAP;
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
      const gone = overlays.get(id);
      if (gone !== undefined) {
        gone.bar.destroy();
        gone.label.destroy();
        overlays.delete(id);
      }
    }

    for (const entry of drawable) {
      let sprite = sprites.get(entry.creature.id);
      if (sprite === undefined) {
        sprite = new Sprite(Texture.WHITE);
        sprite.roundPixels = true;
        sprites.set(entry.creature.id, sprite);
        creatures.addChild(sprite);
      }
      let top = overlays.get(entry.creature.id);
      if (top === undefined) {
        top = createOverlay();
        overlays.set(entry.creature.id, top);
      }
      const screen = toScreen(entry, center, view);
      paintOverlay(top, entry.creature, screen);
      const texture = creatureTexture(entry.creature, nowMs);
      if (texture instanceof Texture) {
        sprite.texture = texture;
        sprite.tint = 0xffffff;
        // Em Pixi `width`/`height` são ESCALA. Um quadro de 64×64 tem que ficar 64×64 — e
        // transbordar para cima e para a esquerda, ancorado no canto inferior direito do tile.
        sprite.width = texture.width;
        sprite.height = texture.height;
        sprite.x = screen.x + TILE - texture.width;
        sprite.y = screen.y + TILE - texture.height;
        continue;
      }
      // Sem quadro (ainda, ou nunca): o retângulo de antes. É a degradação, não o erro.
      sprite.texture = Texture.WHITE;
      sprite.width = TILE - 6;
      sprite.height = TILE - 6;
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
    setMap(next, nextTiles = null) {
      map = next;
      tiles = nextTiles;
      painted = '';
    },
    destroy() {
      for (const sprite of sprites.values()) sprite.destroy();
      sprites.clear();
      for (const top of overlays.values()) {
        top.bar.destroy();
        top.label.destroy();
      }
      overlays.clear();
      for (const sprite of ground) sprite.destroy();
      ground.length = 0;
      overlay.destroy();
      book.clear();
      app.destroy(true, { children: true });
    },
  };
}

/** Constrói o `Tilemap` a partir do JSON de `content`. Ver a nota em `main.tsx`. */
export function tilemapFrom(data: Parameters<typeof buildTilemap>[0]): Tilemap {
  return buildTilemap(data);
}
