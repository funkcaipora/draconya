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
//
// Efeito, projétil e número flutuante (FUN-106) são as três listas de transitórios do `world`,
// e ESTE laço é dono do ciclo de vida delas: é o único lugar que sabe que horas são, então é
// ele quem remove da lista o que acabou de tocar — e destrói o sprite junto. O número não
// depende de arte, como o nome; efeito e projétil viram um retângulo pequeno colorido sem
// pacote, pela mesma regra do resto: retângulo é a degradação, tela vazia não.

import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import {
  buildTilemap, isBlocked, wallSetOf, type Tilemap, type WallSet,
} from '@draconya/content';
import type { AssetPack } from '../assets/pack.js';
import {
  interpolate, world, type Creature, type Effect, type FloatingText, type Missile,
} from '../state/world.js';
import {
  TILE, VIEW_HEIGHT, VIEW_WIDTH, compareDrawOrder, toScreen, visibleTiles,
} from './camera.js';
import {
  FALLBACK_EFFECT_PHASES, effectPhaseAt, floatingTextColor, floatingTextOffset, missileProgress,
} from './effects.js';
import { facingOf, walkFrame } from './facing.js';
import {
  HEALTH_BAR_HEIGHT, HEALTH_BAR_WIDTH, HEALTH_FILL_HEIGHT, HEALTH_FILL_WIDTH,
  healthColor, healthPercent, healthWidth,
} from './health.js';
import {
  creatureKey, effectKey, effectKeysOf, groundCell, groundKey, missileKey,
} from './keys.js';
import { paintOf } from './outfit-colors.js';
import { TextureBook } from './textures.js';
import { wallPiece, wallsOf } from './walls.js';

const COLOR_FLOOR = 0x2b2b33;
const COLOR_WALL = 0x14141a;
const COLOR_GRID = 0x3a3a45;
const COLOR_CREATURE = 0xc25b4a;
const COLOR_SELF = 0x4ac26a;
const COLOR_HEALTH_FRAME = 0x000000;
/** Efeito e projétil sem quadro: um clarão e um ponto, para se ver que houve. */
const COLOR_EFFECT_FALLBACK = 0xf2d26b;
const COLOR_MISSILE_FALLBACK = 0xe8e8f0;
const EFFECT_FALLBACK_SIZE = 12;
const MISSILE_FALLBACK_SIZE = 6;
/** O número nasce a esta distância acima do TOPO do tile e sobe dali. */
const FLOATING_TEXT_ABOVE = 12;

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

/**
 * Um efeito no pool: o sprite e a linha do tempo dele, resolvida UMA vez ao nascer. As fases
 * são do pacote e não mudam durante o voo; consultá-las a cada quadro seria alocar um array por
 * efeito sessenta vezes por segundo para obter sempre a mesma resposta.
 */
interface EffectEntry {
  readonly sprite: Sprite;
  readonly phases: readonly number[];
}

/** De que o mapa é feito, pela tabela de aparências (FUN-94, `appearances.maps`). */
export interface MapTiles {
  readonly floor: number;
  /**
   * UMA peça — a mesma em todo tile bloqueado — ou as quatro, escolhidas pela vizinhança
   * (FUN-105). É o campo como está na tabela; `setMap` o normaliza com `wallSetOf`.
   */
  readonly wall: number | WallSet;
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
  /**
   * Troca o pacote de arte; `null` volta ao modo sem assets.
   *
   * Existe porque o Pixi sobe ANTES de a arte chegar (`shell/Viewport.tsx`, FUN-108): o
   * catálogo leva o que a rede levar, e a tela não espera por ele. O caminho normal é UMA
   * chamada, de `null` para o pacote, quando ele carrega.
   */
  setPack(pack: AssetPack | null): void;
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

  /** O pacote de agora. `let` porque ele pode chegar depois do Pixi (`setPack`). */
  let pack = options.pack ?? null;
  const book = options.book ?? new TextureBook();
  const view = { widthTiles: VIEW_WIDTH, heightTiles: VIEW_HEIGHT };

  // Camadas na ordem de desenho: terreno embaixo, criaturas em cima, efeitos sobre elas —
  // a explosão cobre o monstro, não o contrário — e a sobreposição por último.
  const terrain = new Container();
  const creatures = new Container();
  const effects = new Container();
  const overlay = new Container();
  app.stage.addChild(terrain, creatures, effects, overlay);

  let map: Tilemap | null = null;
  let tiles: MapTiles | null = null;
  /**
   * As quatro peças da parede, resolvidas UMA vez no `setMap` (FUN-105): um id vira as quatro
   * iguais, e o laço de pintura só indexa. Junto, o predicado de parede do mapa — `isBlocked`
   * com fora-do-mapa valendo "não é parede", senão a borda inteira sai como canto.
   */
  let wallPieces: WallSet | null = null;
  let walls: (x: number, y: number) => boolean = () => false;
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
  /**
   * Os transitórios, pelo id local de cada lista. Um sprite nasce no primeiro quadro em que o
   * item é desenhado e morre quando ele expira — ou quando some da lista por baixo dele, que
   * é o que uma troca de instância faz.
   */
  const effectSprites = new Map<number, EffectEntry>();
  const missileSprites = new Map<number, Sprite>();
  const textLabels = new Map<number, Text>();

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
    // Cópia local porque `pack` é `let` (`setPack`) e o narrowing não entra na closure.
    const art = pack;
    if (art === null) return null;
    const pattern = art.objectPattern(appearanceId);
    const cell = groundCell(x, y, pattern);
    return book.get(
      groundKey(appearanceId, x, y, pattern), () => art.object(appearanceId, cell.x, cell.y),
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
        // A parede é uma das quatro peças, pela vizinhança (FUN-105); o chão é o chão. As
        // peças têm padrão de 2×1 e 1×2, e `tileTexture` já pede por célula do padrão — a
        // chave continua sendo id + célula, e não há nada novo a repintar.
        const texture = tiles === null || wallPieces === null
          ? null
          : tileTexture(blocked ? wallPieces[wallPiece(walls, x, y)] : tiles.floor, x, y);
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
    const art = pack;
    if (art === null || creature.appearanceId <= 0) return null;
    const direction = facingOf(creature);
    const moving = creature.step !== null && walkFrame(creature, nowMs, 1).moving;
    const frames = art.framesOf(creature.appearanceId, moving);
    const { phase } = walkFrame(creature, nowMs, frames);
    // As cores são as DA CRIATURA, que o protocolo carrega desde a FUN-104; a reserva é para
    // quem chegou sem — um nó `game` anterior, ou monstro, que nunca traz (`paintOf`). Toda
    // criatura é pedida COM cores mesmo assim: o pacote devolve a base como está para quem
    // não tem template (monstro), então passar cores a ele é inofensivo, e a chave leva as
    // cores para o quadro pintado nunca cair na entrada do quadro cru.
    const colors = paintOf(creature);
    const key = creatureKey(creature.appearanceId, direction, moving, phase, colors);
    return book.get(
      key, () => art.outfit(creature.appearanceId, direction, phase, moving, colors),
    );
  }

  /**
   * Um texto do mundo — o nome da criatura, o número que flutua — no mesmo estilo.
   *
   * Rasterizado em dobro: o texto do Pixi é uma textura, e a 1× dez pixels de Verdana viram
   * borrão sobre um sprite nítido. `anchor` no meio horizontal é o que centra o texto no tile
   * sem medir a largura a cada quadro; a âncora vertical é de quem chama.
   */
  function createLabel(text: string, fill: number, anchorY: number): Text {
    return new Text({
      text,
      style: { fontFamily: 'Verdana, sans-serif', fontSize: 10, fontWeight: 'bold', fill },
      resolution: 2,
      roundPixels: true,
      anchor: { x: 0.5, y: anchorY },
    });
  }

  /** A barra e o nome de uma criatura, criados uma vez e reaproveitados a cada quadro. */
  function createOverlay(): CreatureOverlay {
    const bar = new Graphics();
    bar.roundPixels = true;
    // Âncora no meio de baixo: o nome termina um pixel acima da barra.
    const label = createLabel('', 0xffffff, 1);
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
   * Posiciona um sprite pela âncora do TILE — o canto inferior direito, como criatura e parede
   * —, ou desenha o retângulo de degradação centrado nele quando não há quadro.
   */
  function placeOnTile(
    sprite: Sprite, texture: Texture | null | undefined, screen: { x: number; y: number },
    fallbackSize: number, fallbackColor: number,
  ): void {
    if (texture instanceof Texture) {
      sprite.texture = texture;
      sprite.tint = 0xffffff;
      sprite.width = texture.width;
      sprite.height = texture.height;
      sprite.x = screen.x + TILE - texture.width;
      sprite.y = screen.y + TILE - texture.height;
      return;
    }
    sprite.texture = Texture.WHITE;
    sprite.width = fallbackSize;
    sprite.height = fallbackSize;
    sprite.x = screen.x + (TILE - fallbackSize) / 2;
    sprite.y = screen.y + (TILE - fallbackSize) / 2;
    sprite.tint = fallbackColor;
  }

  /**
   * Destrói o que está no pool e não está mais na lista — o que uma troca de instância ou um
   * `session-state` faz por baixo do viewport. A expiração normal já destrói ao remover; isto
   * é a rede para a remoção que não passou por aqui.
   */
  function prune<T>(pool: Map<number, T>, alive: Set<number>, destroy: (item: T) => void): void {
    for (const [id, item] of pool) {
      if (alive.has(id)) continue;
      destroy(item);
      pool.delete(id);
    }
  }

  /**
   * Os efeitos: fase pelo tempo decorrido, e quem acabou sai da LISTA, não só da tela.
   *
   * Sem pacote, ou com um id que o pacote não conhece, a linha do tempo é a de reserva e o
   * quadro é um retângulo: o efeito ainda "toca", para se ver que houve.
   *
   * **Todas as fases são pedidas ao livro quando o efeito NASCE, e quadro em voo não vira
   * retângulo.** Uma fase real tem 40 ms — os efeitos de combate têm de 17 a 22 delas — e um
   * quadro a 60 Hz tem 16: pedida só no quadro em que chegava, cada fase passava o primeiro
   * quadro sem textura, e a degradação de "não há quadro" desenhava um clarão amarelo antes
   * de cada uma — o efeito inteiro piscava, fase a fase, na primeira vez que tocava. Agora o
   * pedido é feito de uma vez (`effectKeysOf`): as fases moram na mesma folha e o fatiador
   * deduplica a folha em voo, então quando a fase 1 chega a textura dela já está no livro. E
   * enquanto uma textura ainda não chegou o sprite fica INVISÍVEL: o retângulo é para quadro
   * que não existe — sem pacote, ou id que o pacote não tem —, nunca para quadro a caminho.
   */
  function paintEffects(center: { x: number; y: number; z: number }, nowMs: number): void {
    const alive = new Set<number>();
    const list = world.effects;
    for (let i = list.length - 1; i >= 0; i--) {
      const effect = list[i] as Effect;
      let entry = effectSprites.get(effect.id);
      const phases = entry?.phases ?? timelineOf(effect);
      const phase = effectPhaseAt(phases, nowMs - effect.startedAtMs);
      if (phase === null) {
        entry?.sprite.destroy();
        effectSprites.delete(effect.id);
        list.splice(i, 1);
        continue;
      }
      if (entry === undefined) {
        const sprite = new Sprite(Texture.WHITE);
        sprite.roundPixels = true;
        entry = { sprite, phases };
        effectSprites.set(effect.id, entry);
        effects.addChild(sprite);
        const art = pack;
        if (art !== null) {
          const { effectId } = effect;
          for (const [p, key] of effectKeysOf(effectId, phases.length).entries()) {
            book.get(key, () => art.effect(effectId, p));
          }
        }
      }
      alive.add(effect.id);
      // Cópia local porque `pack` é `let` (`setPack`) e o narrowing não entra na closure.
      const art = pack;
      const texture = art === null
        ? null
        : book.get(effectKey(effect.effectId, phase), () => art.effect(effect.effectId, phase));
      entry.sprite.visible = texture !== undefined;
      if (texture === undefined) continue;
      placeOnTile(
        entry.sprite, texture, toScreen(effect.position, center, view),
        EFFECT_FALLBACK_SIZE, COLOR_EFFECT_FALLBACK,
      );
    }
    prune(effectSprites, alive, (entry) => entry.sprite.destroy());
  }

  function timelineOf(effect: Effect): readonly number[] {
    const phases = pack === null ? [] : pack.effectPhases(effect.effectId);
    return phases.length === 0 ? FALLBACK_EFFECT_PHASES : phases;
  }

  /** Os projéteis: posição interpolada de `from` a `to`, quadro pela direção do voo. */
  function paintMissiles(center: { x: number; y: number; z: number }, nowMs: number): void {
    const alive = new Set<number>();
    const list = world.missiles;
    for (let i = list.length - 1; i >= 0; i--) {
      const missile = list[i] as Missile;
      const progress = missileProgress(missile.startedAtMs, missile.durationMs, nowMs);
      if (progress === null) {
        missileSprites.get(missile.id)?.destroy();
        missileSprites.delete(missile.id);
        list.splice(i, 1);
        continue;
      }
      let sprite = missileSprites.get(missile.id);
      if (sprite === undefined) {
        sprite = new Sprite(Texture.WHITE);
        sprite.roundPixels = true;
        missileSprites.set(missile.id, sprite);
        effects.addChild(sprite);
      }
      alive.add(missile.id);
      const dx = missile.to.x - missile.from.x;
      const dy = missile.to.y - missile.from.y;
      const art = pack;
      const texture = art === null
        ? null
        : book.get(
          missileKey(missile.missileId, dx, dy), () => art.missile(missile.missileId, dx, dy),
        );
      // A mesma regra do efeito: quadro em VOO é sprite invisível, não um quadrado branco
      // voando. Um projétil vive ~300 ms e o primeiro de cada folha chega depois disso — o
      // retângulo fica só para "pacote ausente" ou id que o pacote não tem.
      sprite.visible = texture !== undefined;
      if (texture === undefined) continue;
      const at = { x: missile.from.x + dx * progress, y: missile.from.y + dy * progress };
      placeOnTile(
        sprite, texture, toScreen(at, center, view), MISSILE_FALLBACK_SIZE, COLOR_MISSILE_FALLBACK,
      );
    }
    prune(missileSprites, alive, (sprite) => sprite.destroy());
  }

  /**
   * Os números: sobem da posição INTERPOLADA da criatura, e continuam de onde ela estava se ela
   * sumir no meio. Não dependem de arte — como o nome, existem no modo sem pacote.
   */
  function paintTexts(center: { x: number; y: number; z: number }, nowMs: number): void {
    const alive = new Set<number>();
    const list = world.texts;
    for (let i = list.length - 1; i >= 0; i--) {
      const text = list[i] as FloatingText;
      const offset = floatingTextOffset(nowMs - text.startedAtMs);
      if (offset === null) {
        textLabels.get(text.id)?.destroy();
        textLabels.delete(text.id);
        list.splice(i, 1);
        continue;
      }
      const creature = world.creatures.get(text.creatureId);
      if (creature !== undefined) text.position = interpolate(creature, nowMs);
      // Criatura que este cliente nunca viu: não há onde desenhar, e o texto expira sozinho.
      if (text.position === null) continue;
      let label = textLabels.get(text.id);
      if (label === undefined) {
        // Âncora no TOPO: o número nasce logo acima do tile e sobe dali — a subida é o `dy`.
        label = createLabel(String(text.amount), floatingTextColor(text.kind), 0);
        textLabels.set(text.id, label);
        overlay.addChild(label);
      }
      alive.add(text.id);
      const screen = toScreen(text.position, center, view);
      label.x = screen.x + TILE / 2;
      label.y = screen.y - FLOATING_TEXT_ABOVE - offset.dy;
      label.alpha = offset.alpha;
    }
    prune(textLabels, alive, (label) => label.destroy());
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
    paintEffects(center, nowMs);
    paintMissiles(center, nowMs);
    paintTexts(center, nowMs);
  });

  return {
    setMap(next, nextTiles = null) {
      map = next;
      tiles = nextTiles;
      wallPieces = nextTiles === null ? null : wallSetOf(nextTiles.wall);
      walls = next === null ? () => false : wallsOf(next);
      painted = '';
    },
    setPack(next) {
      pack = next;
      // O terreno só repinta quando a chave muda, e a chave não sabe do pacote: sem isto, a
      // arte chegava e o chão continuava em retângulo até a câmera andar um tile.
      //
      // **O livro NÃO precisa ser limpo, porque com `pack === null` ele nunca é consultado**:
      // toda chamada a `book.get` está atrás de `pack === null`, então nada foi guardado
      // enquanto não havia arte — não existe entrada "não existe" envenenada para o pacote
      // que chega agora. (Limpar também não daria: `clear()` fecha o livro para sempre.)
      painted = '';
      // Os efeitos em voo nasceram com a linha do tempo de reserva; renascem no próximo
      // quadro com a do pacote, que é de onde as fases deles saem (`timelineOf`).
      for (const entry of effectSprites.values()) entry.sprite.destroy();
      effectSprites.clear();
    },
    destroy() {
      for (const sprite of sprites.values()) sprite.destroy();
      sprites.clear();
      for (const top of overlays.values()) {
        top.bar.destroy();
        top.label.destroy();
      }
      overlays.clear();
      for (const entry of effectSprites.values()) entry.sprite.destroy();
      effectSprites.clear();
      for (const sprite of missileSprites.values()) sprite.destroy();
      missileSprites.clear();
      for (const label of textLabels.values()) label.destroy();
      textLabels.clear();
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
