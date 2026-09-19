// O mundo em canvas (FUN-23).
//
// Este arquivo NÃO renderiza através do React (ADR 0007). Ele lê `world` direto no laço de
// quadro; nenhum estado de mundo entra por prop. Se um dia precisar de um `useEffect` para
// saber onde uma criatura está, o desenho está errado.
//
// SPRITES, com retângulo como degradação. O pacote de arte entra por `WorldArt` (a interface que
// o pacote real de assets satisfaz por estrutura — issue #381) e cada quadro vira `Texture` pelo
// `TextureBook`; enquanto um quadro não chega — ou quando o pacote não tem aquele id — o lugar
// dele é um retângulo, e a tela nunca fica preta por causa de arte. A parte difícil continua a
// mesma de antes: câmera, camadas, ordem de desenho, pool e interpolação.
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
import { buildTilemap, type Tilemap } from '@draconya/content';
import { NO_FLAGS } from '../assets/appearances.js';
import type { AssetPack } from '../assets/pack.js';
import {
  interpolate, world, type Creature, type Effect, type FloatingText, type Missile,
} from '../state/world.js';
import {
  TILE, prefetchTiles, renderTiles, sameWindow, tilesEntering, toScreen, viewFor, zoomFor,
  type TileWindow,
} from './camera.js';
import { CREATURE_SLOT, sceneZIndex } from './depth.js';
import {
  FALLBACK_EFFECT_PHASES, effectPhaseAt, floatingTextColor, floatingTextOffset, missileProgress,
} from './effects.js';
import { facingOf, walkFrame } from './facing.js';
import { createFpsMeter } from './fps.js';
import { floorsBelow, shade, veilTint } from './floors.js';
import {
  HEALTH_BAR_HEIGHT, HEALTH_BAR_WIDTH, HEALTH_FILL_HEIGHT, HEALTH_FILL_WIDTH,
  healthColor, healthPercent, healthWidth,
} from './health.js';
import {
  creatureKey, effectKey, effectKeysOf, missileKey, objectKey,
} from './keys.js';
import { paintOf } from './outfit-colors.js';
import type { Scene, StackedItem, TileStack } from './scene.js';
import { TextureBook } from './textures.js';
import { drawTile, type DrawLayer, type ObjectInfo } from './tile-stack.js';
import { NO_DISPLACEMENT, walkingTile } from './walking-tile.js';

export type { MapTiles } from './scene.js';

/**
 * O que o viewport pede à arte. É uma INTERFACE, e não a classe, para o teste entregar uma
 * arte sintética e para o contrato do viewport ficar visível num lugar só. O pacote real a
 * satisfaz por estrutura — `shell/Viewport.tsx` não muda (issue #381).
 */
export type WorldArt = Pick<AssetPack, 'object' | 'objectPattern' | 'objectFlags' | 'objectSize'
  | 'outfit' | 'framesOf' | 'effect' | 'effectPhases' | 'missile' | 'warmObjects' | 'warmOutfit'
  | 'outfitDisplacement'>;

const COLOR_FLOOR = 0x2b2b33;
const COLOR_WALL = 0x14141a;
const COLOR_GRID = 0x3a3a45;
/** O tom do bueiro (`ambience: 'cavern'`): o mundo inteiro, sob uma luz fria. */
const CAVERN_TINT = 0x8e8eb0;
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

/** A última janela de prefetch aquecida, com a cena e o andar dela. `null` força a janela inteira. */
interface Warmed {
  readonly window: TileWindow;
  readonly sceneId: string;
  readonly floor: number;
}

/**
 * As três camadas de UM andar, com os pools presos a elas (ADR 0033). `ground` e `top` seguem a
 * ordem de inserção; `scene` tem `sortableChildren` e ordena parede, objeto alto e criatura por
 * `zIndex = sceneZIndex(x, y, slot)` (`world/depth.ts`, puro). O `fallback` é filho 0 de
 * `ground`: a grade lisa e os retângulos de reserva daquele andar.
 */
interface FloorLayers {
  readonly z: number;
  readonly ground: Container;
  readonly scene: Container;
  readonly top: Container;
  readonly fallback: Graphics;
  readonly pools: { readonly ground: Sprite[]; readonly scene: Sprite[]; readonly top: Sprite[] };
  used: { ground: number; scene: number; top: number };
}

export interface ViewportOptions {
  /** O pacote de arte. `null` desenha só retângulos — é o modo sem assets, e continua válido. */
  readonly pack?: WorldArt | null;
  /** O livro de texturas, criado por quem criou o pacote: é ele que recebe o `onEvict`. */
  readonly book?: TextureBook;
  /**
   * De onde vem a cena de um `mapId` (FUN-121): o `instance-enter` manda o ID, e é o laço de
   * quadro que nota a troca (`world.mapId`) e pede a cena — o `world` não tem `subscribe`
   * (ADR 0007). `null` é mapa que não há: a tela mostra a grade lisa de reserva.
   */
  readonly loadScene?: (mapId: string) => Promise<Scene | null>;
  /** O relógio do quadro. `performance.now` por padrão; o teste injeta o dele (issue #381). */
  readonly now?: () => number;
}

export interface ViewportHandle {
  /** Troca a cena desenhada. O caminho normal é o `loadScene`; isto é para quem já a tem. */
  setScene(scene: Scene | null): void;
  /**
   * Troca o pacote de arte; `null` volta ao modo sem assets.
   *
   * Existe porque o Pixi sobe ANTES de a arte chegar (`shell/Viewport.tsx`, FUN-108): o
   * catálogo leva o que a rede levar, e a tela não espera por ele. O caminho normal é UMA
   * chamada, de `null` para o pacote, quando ele carrega.
   */
  setPack(pack: WorldArt | null): void;
  /**
   * FPS médio dos últimos quadros, arredondado. É só leitura: o overlay consulta no próprio
   * ritmo, sem o laço do Pixi disparar renderização React.
   */
  getFps(): number;
  destroy(): void;
}

export async function mountViewport(
  parent: HTMLElement, options: ViewportOptions = {},
): Promise<ViewportHandle> {
  const app = new Application();
  await app.init({
    // O mundo ocupa o elemento INTEIRO (FUN-115): o canvas acompanha o tamanho dele, e os
    // painéis flutuam por cima — como no Huntera, que é a referência visual. Antes era um
    // canvas de 18×14 tiles a 1× no meio de uma tela preta, e o rato tinha tamanho de formiga.
    resizeTo: parent,
    background: 0x000000,
    antialias: false,
    // Pixel art em coordenada fracionária fica borrada, e a causa é difícil de achar depois.
    roundPixels: true,
  });
  parent.appendChild(app.canvas);

  /** O pacote de agora. `let` porque ele pode chegar depois do Pixi (`setPack`). */
  let pack = options.pack ?? null;
  const book = options.book ?? new TextureBook();
  /** O relógio do quadro — injetável para o teste dirigir o laço sem `performance` (issue #381). */
  const now = options.now ?? (() => performance.now());
  /**
   * O zoom inteiro e a vista em tiles, DA TELA DE AGORA. O stage é escalado pelo zoom, então
   * todo o resto continua em pixels de tile (32) e só o resultado é ampliado — é o que mantém
   * `toScreen`, as barras e os quadros iguais em qualquer zoom.
   */
  let zoom = zoomFor(app.screen.width, app.screen.height);
  let view = viewFor(app.screen.width, app.screen.height, zoom);
  app.stage.scale.set(zoom);
  app.renderer.on('resize', (width: number, height: number) => {
    zoom = zoomFor(width, height);
    view = viewFor(width, height, zoom);
    app.stage.scale.set(zoom);
    // O texto NÃO acompanha o zoom (ver `createLabel`); o que já existe é reescalado aqui.
    for (const entry of overlays.values()) entry.label.scale.set(1 / zoom);
    for (const label of textLabels.values()) label.scale.set(1 / zoom);
    // O terreno só repinta quando a chave muda, e a chave não sabe do tamanho da tela.
    painted = '';
    // A vista mudou de tamanho: a janela de prefetch é outra, e o delta contra a antiga
    // aqueceria só as bordas — a tela nova pode ser um zoom a menos e o dobro de tiles.
    warmed = null;
  });

  // A raiz dos andares anda com a janela (o que `terrain` fazia); efeitos e overlay continuam
  // absolutos, por cima de todos os andares. Cada andar tem `ground` → `scene` → `top`
  // (ADR 0033): parede, objeto alto e criatura no MESMO `scene`, ordenados por `zIndex`.
  const floorsRoot = new Container();
  const effects = new Container();
  const overlay = new Container();
  app.stage.addChild(floorsRoot, effects, overlay);

  /** Camadas por andar, criadas uma vez. Trocar de andar re-anexa; nunca destrói. */
  const floorLayers = new Map<number, FloorLayers>();
  function layersFor(z: number): FloorLayers {
    let layers = floorLayers.get(z);
    if (layers !== undefined) return layers;
    const ground = new Container();
    const scene = new Container();
    // A ÚNICA ordenação automática do viewport: o Pixi só reordena `scene` quando um filho
    // entra ou um `zIndex` muda (`sortDirty`), nunca por quadro sem mudança.
    scene.sortableChildren = true;
    const top = new Container();
    const fallback = new Graphics();
    ground.addChild(fallback);
    layers = {
      z, ground, scene, top, fallback,
      pools: { ground: [], scene: [], top: [] }, used: { ground: 0, scene: 0, top: 0 },
    };
    floorLayers.set(z, layers);
    return layers;
  }

  /** Um sprite do pool de UMA camada, criado se o pool acabou — preso àquele container. */
  function take(layers: FloorLayers, layer: DrawLayer): Sprite {
    const pool = layers.pools[layer];
    const index = layers.used[layer]++;
    let sprite = pool[index];
    if (sprite === undefined) {
      sprite = new Sprite();
      sprite.roundPixels = true;
      pool.push(sprite);
      layers[layer].addChild(sprite);
    }
    sprite.visible = true;
    return sprite;
  }

  /** A cena de agora, e o `mapId` que foi pedido por último — para a resposta atrasada de outro mapa não entrar. */
  let scene: Scene | null = null;
  let requested: string | null = null;
  // Última janela desenhada. O terreno só é redesenhado quando ela muda — redesenhar a cada
  // quadro é o desperdício óbvio, e num mapa grande é o que come o orçamento de quadro.
  let painted = '';
  /**
   * A última janela de prefetch aquecida, com a cena e o andar dela. `null` é "aqueça tudo":
   * é o que cena nova, pacote novo, andar novo e `resize` fazem. Comparar quatro inteiros por
   * quadro é o custo de saber que nada mudou — a varredura dos tiles só roda quando mudou.
   */
  let warmed: Warmed | null = null;
  /**
   * Os outfits já pedidos ao pacote DE AGORA. Zera em `setPack`: um pacote novo tem folhas
   * novas, e o que o anterior aqueceu não vale para ele.
   */
  const warmedOutfits = new Set<number>();
  /** RC-13: recebe um delta por quadro e só é lido uma vez por segundo no overlay DOM. */
  const fps = createFpsMeter();
  /**
   * A elevação de cada tile da janela pintada, por chave `x,y,z`: a criatura em cima da caixa
   * sobe o que a caixa mede. Refeita a cada repintura; consultada por criatura por quadro.
   */
  const elevations = new Map<string, number>();

  /**
   * As flags, o padrão e a DIMENSÃO que a pilha precisa, pelo pacote de agora — `NO_FLAGS` e
   * `{1, 1}` sem pacote. A camada `scene` que sai daqui é desenhada no `scene` do andar dela,
   * com `zIndex` espacial desde 385 (ADR 0033).
   */
  const objectInfo: ObjectInfo = {
    flagsOf: (id) => pack?.objectFlags(id) ?? NO_FLAGS,
    patternOf: (id) => pack?.objectPattern(id) ?? { width: 1, height: 1 },
    sizeOf: (id) => pack?.objectSize(id) ?? { width: 1, height: 1 },
  };

  /**
   * Pool de sprites por id de criatura.
   *
   * Criar e destruir a cada `creature-appear` fragmenta memória numa hunt com respawn
   * constante, que é o caso NORMAL do jogo, não a exceção.
   */
  const sprites = new Map<number, Sprite>();
  /**
   * O `zIndex` de criatura escrito por último, pelo id. O walking tile só muda uma vez por
   * passo, então comparar com este número evita reescrever o `zIndex` a cada quadro — o Pixi
   * marca `sortDirty` a cada escrita, e reordenar 60 vezes por segundo é refazer o mesmo
   * trabalho. Limpo junto de `sprites`.
   */
  const walkingTiles = new Map<number, number>();
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
    if (self !== undefined) return interpolate(self, now());
    // Sem `selfId` ainda (FUN-32), a câmera fica no centro do mapa: é melhor mostrar o mapa
    // do que mostrar o canto (0,0), que num mapa cercado por parede é só parede.
    if (scene !== null) return { x: (scene.width - 1) / 2, y: (scene.height - 1) / 2, z: scene.defaultZ };
    return { x: 0, y: 0, z: 0 };
  }

  /**
   * A textura de um objeto do mapa numa CÉLULA do padrão, ou `undefined` enquanto não chega.
   *
   * A chave e o pedido são pela célula: um chão de 4×4 são dezesseis texturas no livro, não
   * uma por tile — e vizinhos ganham quadros diferentes, que é o que faz o chão do Tibia não
   * parecer azulejo. Qual célula é de `tile-stack.ts`: posição, contagem ou gancho.
   */
  function objectTexture(
    appearanceId: number, cell: { readonly x: number; readonly y: number },
  ): Texture | null | undefined {
    // Cópia local porque `pack` é `let` (`setPack`) e o narrowing não entra na closure.
    const art = pack;
    if (art === null) return null;
    return book.get(objectKey(appearanceId, cell), () => art.object(appearanceId, cell.x, cell.y));
  }

  /**
   * A elevação do tile em que uma criatura está — e, no meio de um passo, a INTERPOLAÇÃO entre
   * a do tile de onde ela vem e a do tile aonde vai. Ler só pelo tile arredondado fazia o
   * personagem pular até 24 px no meio do passo ao subir numa caixa; agora ele sobe com o
   * passo. Só no andar do jogador: `elevations` é da janela pintada, que é dele.
   */
  function liftOf(creature: Creature, at: { x: number; y: number; z: number }, nowMs: number): number {
    const lift = (x: number, y: number): number => elevations.get(`${Math.round(x)},${Math.round(y)},${at.z}`) ?? 0;
    const step = creature.step;
    if (step === null || step.durationMs <= 0) return lift(at.x, at.y);
    const t = Math.min(1, Math.max(0, (nowMs - step.startedAtMs) / step.durationMs));
    const from = lift(step.from.x, step.from.y);
    const to = lift(step.to.x, step.to.y);
    return from + (to - from) * t;
  }

  /** Os ids de chão e item das faixas, nos andares que `paintTerrain` desenha para este `z`. */
  function idsIn(scene: Scene, tiles: ReadonlyArray<{ x: number; y: number }>, floors: readonly number[]): Set<number> {
    const ids = new Set<number>();
    for (const z of floors) {
      for (const { x, y } of tiles) {
        const stack = scene.tileAt(x, y, z);
        if (stack === null) continue;
        if (stack.ground > 0) ids.add(stack.ground);
        for (const item of stack.items) ids.add(item.id);
      }
    }
    return ids;
  }

  /**
   * Prefetch CONTÍNUO (M23, D5): a cada quadro compara a janela de prefetch de agora com a
   * última aquecida e pede ao pacote só o que ENTROU — a coluna nova quando o personagem anda
   * um tile, a janela inteira quando cena, andar, pacote ou tela mudaram. A margem de prefetch
   * está dois tiles além da de render: são dois passos (~800 ms) para a folha sair do Worker
   * antes de o tile ser desenhado, e é isso que tira o retângulo de reserva da borda da tela.
   *
   * **Só o que entrou, e uma chamada por mudança.** Pedir a janela inteira a cada tile seria
   * `warmObjects` sobre ~700 ids por passo — o pacote deduplica em voo, mas a varredura da cena
   * e a alocação do `Set` são por chamada, e o passo é o caso NORMAL de uma hunt, não a exceção.
   *
   * Sem pacote não há o que aquecer, e `warmed` fica `null` de propósito: o pacote que chegar
   * depois encontra "aqueça tudo", não uma janela que ninguém aqueceu.
   */
  function warmWindow(center: { x: number; y: number; z: number }): void {
    const art = pack;
    if (art === null || scene === null) {
      warmed = null;
      return;
    }
    const floor = Math.round(center.z);
    const next = prefetchTiles(center, view);
    const previous = warmed;
    const sameContext = previous !== null && previous.sceneId === scene.id && previous.floor === floor;
    if (sameContext && sameWindow(previous.window, next)) return;

    const tiles = tilesEntering(sameContext ? previous.window : null, next);
    warmed = { window: next, sceneId: scene.id, floor };
    const ids = idsIn(scene, tiles, floorsBelow(scene.floors, floor));
    // Tile fora do mapa (borda) não vira pedido: `warmObjects([])` seria uma promessa por
    // quadro de borda, e o teste conta chamadas.
    if (ids.size > 0) void art.warmObjects(ids);
  }

  /**
   * Os outfits de quem está por perto (M23, D5). O `warmOutfit` da FUN-112 roda na Cidade pelo
   * catálogo da hunt; este roda na hunt pelo que o servidor mandou — o monstro que apareceu na
   * borda do raio de interesse tem a janela de prefetch inteira para chegar antes de ser
   * desenhado. Um `Set.has` por criatura por quadro; o pedido só sai uma vez por outfit.
   *
   * A posição é o DESTINO do passo: é onde a criatura vai estar quando o quadro dela importar.
   */
  function warmOutfitsNear(window: TileWindow): void {
    const art = pack;
    if (art === null) return;
    for (const creature of world.creatures.values()) {
      const { appearanceId } = creature;
      if (appearanceId <= 0 || warmedOutfits.has(appearanceId)) continue;
      const at = creature.step?.to ?? creature.position;
      if (at.x < window.minX || at.x > window.maxX || at.y < window.minY || at.y > window.maxY) continue;
      warmedOutfits.add(appearanceId);
      void art.warmOutfit(appearanceId);
    }
  }

  function paintTerrain(center: { x: number; y: number; z: number }): void {
    // A janela de RENDER (M23): três tiles além de cada borda visível já estão pintados, e é
    // ao pintá-los que a textura deles é pedida ao livro — três tiles antes de entrarem na
    // tela, que é o tempo que a folha tem para sair do Worker. A chave abaixo muda quando ESTA
    // janela muda, exatamente como antes mudava com a visível: uma vez por tile cruzado.
    const window = renderTiles(center, view);
    // **O terreno é pintado em coordenada RELATIVA à janela e o CONTAINER é que anda.** Pintar
    // com o centro fracionário só quando a janela vira faria o chão pular um tile inteiro
    // enquanto as criaturas — posicionadas a cada quadro — deslizam: cisalhamento de até 32 px
    // assim que a câmera seguir o personagem.
    const origin = toScreen({ x: window.minX, y: window.minY }, center, view);
    floorsRoot.x = Math.round(origin.x);
    floorsRoot.y = Math.round(origin.y);
    // O ambiente é um tom sobre as camadas inteiras (FUN-121): o bueiro é escuro, a rua não. O
    // tint do container multiplica o dos filhos, então `ambiente × véu` sai igual ao de hoje.
    floorsRoot.tint = world.ambience === 'cavern' ? CAVERN_TINT : 0xffffff;

    // A chave inclui a VERSÃO do livro de texturas: o primeiro quadro pinta retângulo, e o
    // quadro em que uma folha resolve — ou em que um despejo esquece uma célula — precisa
    // repintar mesmo com a janela parada. Um número, e não uma sondagem célula a célula: a
    // pergunta "mudou algo?" só muda quando o livro muda, e custar 17 consultas por quadro
    // para respondê-la era pagar a 60 Hz por um evento raro. E o ANDAR do jogador: subir a
    // escada troca a cena inteira sem a janela andar.
    const floor = Math.round(center.z);
    // E os itens do chão (FUN-123): um cadáver que cai repinta o tile dele.
    const key = `${scene?.id ?? '-'}:${floor}:${window.minX},${window.minY},${window.maxX},${window.maxY}:${book.version}:${world.groundItemsVersion}`;
    if (key === painted) return;
    painted = key;

    // Os itens do chão por tile, para entrarem na pilha como itens comuns — o mais recente por
    // cima. São poucos (cadáveres com prazo), e a varredura é só na repintura.
    const groundItemsAt = new Map<string, StackedItem[]>();
    for (const item of world.groundItems.values()) {
      const at = `${item.position.x},${item.position.y},${item.position.z}`;
      const list = groundItemsAt.get(at) ?? [];
      list.push({ id: item.appearanceId });
      groundItemsAt.set(at, list);
    }
    const stackAt = (x: number, y: number, z: number): TileStack | null => {
      const base = scene?.tileAt(x, y, z) ?? null;
      const extra = groundItemsAt.get(`${x},${y},${z}`);
      if (extra === undefined) return base;
      return base === null ? { ground: 0, items: extra } : { ground: base.ground, items: [...base.items, ...extra] };
    };

    // Re-anexa os andares desta repintura, do fundo ao topo: `ground` → `scene` → `top` de
    // cada um. Um andar que saiu da lista sai do stage mas fica no Map, com os pools.
    floorsRoot.removeChildren();
    const drawnFloors = scene === null ? [floor] : floorsBelow(scene.floors, floor);
    for (const z of drawnFloors) {
      const layers = layersFor(z);
      layers.fallback.clear();
      layers.used = { ground: 0, scene: 0, top: 0 };
      floorsRoot.addChild(layers.ground, layers.scene, layers.top);
    }

    elevations.clear();

    if (scene === null) {
      // Sem cena — o mapa ainda não chegou, ou não há — a grade lisa de reserva em volta da
      // câmera: o personagem continua visível num chão, em vez de flutuar no preto.
      const layers = layersFor(floor);
      for (let y = window.minY; y <= window.maxY; y++) {
        for (let x = window.minX; x <= window.maxX; x++) {
          layers.fallback
            .rect((x - window.minX) * TILE, (y - window.minY) * TILE, TILE, TILE)
            .fill(COLOR_FLOOR)
            .stroke({ width: 1, color: COLOR_GRID, alignment: 0 });
        }
      }
    }

    /**
     * Pinta a pilha de um tile na posição de tela `local`, sob o véu de `below` andares. É o
     * mesmo pintor para o tile do mapa e para o item do chão sem mapa (o cadáver que caiu
     * antes de a cena chegar): um caminho de desenho.
     */
    const paintStack = (
      stack: TileStack, mx: number, my: number, below: number, local: { x: number; y: number },
      withPlaceholder: boolean, layers: FloorLayers,
    ): number => {
      const tint = veilTint(below);
      const drawn = drawTile(stack, mx, my, objectInfo);
      const color = shade(drawn.blocked || stack.ground === 0 ? COLOR_WALL : COLOR_FLOOR, below);
      let sceneSlot = 0;
      // O lugar do PRIMEIRO objeto enquanto o quadro dele não chega — ou sem pacote — na camada
      // DELE: chão em voo é um retângulo no `Graphics` do `ground`, como sempre; parede em voo
      // num tile sem chão é um Sprite branco no `scene`, com o zIndex que a parede vai ter, para
      // a criatura ao norte já ficar atrás do lugar dela. Um item de cima sem quadro não é nada.
      const placeholder = (layer: DrawLayer): void => {
        if (!withPlaceholder) return;
        if (layer === 'ground') {
          layers.fallback
            .rect(local.x, local.y, TILE, TILE)
            .fill(color)
            .stroke({ width: 1, color: COLOR_GRID, alignment: 0 });
          return;
        }
        const sprite = take(layers, layer);
        sprite.texture = Texture.WHITE;
        sprite.tint = color;
        sprite.width = TILE;
        sprite.height = TILE;
        sprite.x = local.x;
        sprite.y = local.y;
        if (layer === 'scene') sprite.zIndex = sceneZIndex(mx, my, sceneSlot);
      };
      if (pack === null) {
        placeholder(drawn.objects[0]?.layer ?? 'ground');
        return drawn.creatureElevation;
      }
      for (const [index, object] of drawn.objects.entries()) {
        const texture = objectTexture(object.appearanceId, object.cell);
        if (!(texture instanceof Texture)) {
          if (index === 0) placeholder(object.layer);
          if (object.layer === 'scene') sceneSlot++;
          continue;
        }
        const sprite = take(layers, object.layer);
        sprite.texture = texture;
        sprite.tint = tint;
        // Ancorado no canto INFERIOR DIREITO do tile, transbordando para cima e para a
        // esquerda, como no Tibia; a elevação e o shift deslocam mais para lá.
        sprite.width = texture.width;
        sprite.height = texture.height;
        sprite.x = local.x + TILE - texture.width + object.dx;
        sprite.y = local.y + TILE - texture.height + object.dy;
        if (object.layer === 'scene') sprite.zIndex = sceneZIndex(mx, my, sceneSlot++);
      }
      return drawn.creatureElevation;
    };

    // Do andar mais fundo ao do jogador (FUN-121): o de cima cobre o de baixo. Um andar `below`
    // níveis abaixo aparece deslocado `below` tiles para baixo e para a direita — a perspectiva
    // do Tibia —, e sob um véu que escurece a cada nível. As coordenadas de `sceneZIndex` são
    // as do MAPA (`mx`, `my`): dentro de um andar o deslocamento é uniforme e não muda a ordem.
    for (const z of drawnFloors) {
      const below = z - floor;
      const layers = layersFor(z);
      for (let sy = window.minY; sy <= window.maxY; sy++) {
        for (let sx = window.minX; sx <= window.maxX; sx++) {
          const stack = stackAt(sx - below, sy - below, z);
          if (stack === null) continue;
          const local = { x: (sx - window.minX) * TILE, y: (sy - window.minY) * TILE };
          const elevation = paintStack(stack, sx - below, sy - below, below, local, true, layers);
          if (below === 0 && elevation > 0) elevations.set(`${sx},${sy},${z}`, elevation);
        }
      }
    }
    // Esconde o que sobrou de cada pool do andar desenhado — a repintura de agora usou menos.
    for (const z of drawnFloors) {
      const { pools, used } = layersFor(z);
      for (const layer of ['ground', 'scene', 'top'] as const) {
        for (let i = used[layer]; i < pools[layer].length; i++) (pools[layer][i] as Sprite).visible = false;
      }
    }
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
    const label = new Text({
      text,
      style: { fontFamily: 'Verdana, sans-serif', fontSize: 10, fontWeight: 'bold', fill },
      resolution: 2,
      roundPixels: true,
      anchor: { x: 0.5, y: anchorY },
    });
    // O texto tem o tamanho DA TELA, não do mundo (FUN-115): o stage amplia tudo pelo zoom, e
    // um nome de dez pixels ampliado a 3× é um letreiro sobre a criatura. Dividir a escala
    // pelo zoom o devolve aos dez pixels de tela — como o Tibia, em que o nome não cresce com
    // o tamanho da janela. A posição continua em pixels de tile, e o stage a amplia como
    // amplia o sprite.
    label.scale.set(1 / zoom);
    return label;
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
    const floor = Math.round(center.z);
    // A janela de RENDER (M23) e os andares DESENHADOS: fora deles o sprite fica invisível, no
    // pool, sem ser destruído — volta ao entrar sem `addChild` nem textura nova.
    const window = renderTiles(center, view);
    const drawn = new Set(scene === null ? [floor] : floorsBelow(scene.floors, floor));

    for (const creature of world.creatures.values()) {
      seen.add(creature.id);
      const position = interpolate(creature, nowMs);
      const below = position.z - floor;
      let sprite = sprites.get(creature.id);
      if (sprite === undefined) {
        sprite = new Sprite(Texture.WHITE);
        sprite.roundPixels = true;
        sprites.set(creature.id, sprite);
      }
      let head = overlays.get(creature.id);
      if (head === undefined) {
        head = createOverlay();
        overlays.set(creature.id, head);
      }
      // O container do andar DELA. Reparentar é o que "trocar de andar" significa aqui; a
      // criatura sempre mora no `scene` do próprio andar, mesmo invisível (fica no pool).
      const layers = layersFor(position.z);
      if (sprite.parent !== layers.scene) layers.scene.addChild(sprite);

      // Coordenadas de TELA (deslocadas pelo andar) só para o culling e para o overlay.
      const sx = position.x + below;
      const sy = position.y + below;
      const outside = !drawn.has(position.z)
        || Math.round(sx) < window.minX || Math.round(sx) > window.maxX
        || Math.round(sy) < window.minY || Math.round(sy) > window.maxY;
      sprite.visible = !outside;
      head.bar.visible = !outside;
      head.label.visible = !outside;
      if (outside) continue;

      // Onde a criatura ESTÁ (interpolado) e a que tile ela PERTENCE para a ordem — que não
      // são o mesmo tile durante metade do passo. `logical` é o destino do passo em curso: é
      // em volta dele que o OTClient procura, e é ele que a criatura parada devolve.
      const art = pack;
      const displacement = art === null
        ? NO_DISPLACEMENT
        : art.outfitDisplacement(creature.appearanceId);
      const tile = walkingTile({
        position,
        logical: creature.step?.to ?? creature.position,
        displacement,
      });
      // Deslocado pelo andar, como `sx`/`sy`: a ordem é pela posição de TELA (FUN-121). O
      // `zIndex` é escrito SÓ quando o walking tile muda — uma vez por passo, nunca por quadro.
      const order = sceneZIndex(tile.x + below, tile.y + below, CREATURE_SLOT);
      if (walkingTiles.get(creature.id) !== order) {
        walkingTiles.set(creature.id, order);
        sprite.zIndex = order;
      }

      const screen = toScreen({ x: sx, y: sy }, center, view);
      // Em cima de uma caixa, a criatura sobe o que a caixa mede — a elevação do tile
      // (`tile-stack.ts`), lida da última repintura e interpolada ao longo do passo.
      const lift = below === 0 ? liftOf(creature, position, nowMs) : 0;
      const lifted = { x: screen.x - lift, y: screen.y - lift };
      paintOverlay(head, creature, lifted);
      // O sprite mora num container que ANDA com a janela: posição local = tela − raiz.
      const local = { x: lifted.x - floorsRoot.x, y: lifted.y - floorsRoot.y };
      const texture = creatureTexture(creature, nowMs);
      if (texture instanceof Texture) {
        sprite.texture = texture;
        sprite.tint = veilTint(below);
        // Em Pixi `width`/`height` são ESCALA. Um quadro de 64×64 tem que ficar 64×64 — e
        // transbordar para cima e para a esquerda, ancorado no canto inferior direito do tile.
        sprite.width = texture.width;
        sprite.height = texture.height;
        sprite.x = local.x + TILE - texture.width - displacement.x;
        sprite.y = local.y + TILE - texture.height - displacement.y;
        continue;
      }
      // Sem quadro (ainda, ou nunca): o retângulo de antes — no mesmo lugar e sob o mesmo
      // véu que o quadro teria. É a degradação, não o erro.
      sprite.texture = Texture.WHITE;
      sprite.width = TILE - 6;
      sprite.height = TILE - 6;
      sprite.x = local.x + 3;
      sprite.y = local.y + 3;
      sprite.tint = shade(creature.id === world.selfId ? COLOR_SELF : COLOR_CREATURE, below);
    }

    for (const [id, sprite] of sprites) {
      if (seen.has(id)) continue;
      sprite.destroy();
      sprites.delete(id);
      walkingTiles.delete(id);
      const gone = overlays.get(id);
      if (gone !== undefined) {
        gone.bar.destroy();
        gone.label.destroy();
        overlays.delete(id);
      }
    }
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

  app.ticker.add(() => {
    fps.record(app.ticker.deltaMS);
    const nowMs = now();
    // A troca de cena é notada AQUI (FUN-121): o `instance-enter` põe o `mapId` no `world`, o
    // `world` não avisa ninguém (ADR 0007), e o laço de quadro é quem olha. A resposta que
    // chegar depois de outro pedido é de outro mapa, e é descartada.
    if (world.mapId !== requested) {
      const mapId = world.mapId;
      requested = mapId;
      scene = null;
      painted = '';
      warmed = null;
      if (mapId !== null && options.loadScene !== undefined) {
        void options.loadScene(mapId).then((next) => {
          if (requested !== mapId) return;
          scene = next;
          painted = '';
          warmed = null;   // era `if (next !== null) warm(next);` — o próximo quadro aquece tudo
        });
      }
    }
    const center = target();
    warmWindow(center);
    if (warmed !== null) warmOutfitsNear(warmed.window);
    paintTerrain(center);
    paintCreatures(center, nowMs);
    paintEffects(center, nowMs);
    paintMissiles(center, nowMs);
    paintTexts(center, nowMs);
  });

  return {
    setScene(next) {
      scene = next;
      requested = world.mapId;
      painted = '';
      warmed = null;       // era `if (next !== null) warm(next);`
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
      // Pacote novo, folhas novas: o que o anterior aqueceu não conta, e a janela é aquecida
      // inteira no próximo quadro. `null` também zera — não fica nada pendente para o próximo.
      warmed = null;       // era `if (next !== null && scene !== null) warm(scene);`
      warmedOutfits.clear();
      // Os efeitos em voo nasceram com a linha do tempo de reserva; renascem no próximo
      // quadro com a do pacote, que é de onde as fases deles saem (`timelineOf`).
      for (const entry of effectSprites.values()) entry.sprite.destroy();
      effectSprites.clear();
    },
    getFps() {
      return fps.read();
    },
    destroy() {
      for (const sprite of sprites.values()) sprite.destroy();
      sprites.clear();
      walkingTiles.clear();
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
      // Cada andar tem os próprios pools e as próprias camadas; trocar de andar nunca as
      // destrói, mas o `destroy` do viewport leva todas.
      for (const layers of floorLayers.values()) {
        for (const layer of ['ground', 'scene', 'top'] as const) {
          for (const sprite of layers.pools[layer]) sprite.destroy();
        }
        layers.fallback.destroy();
        layers.ground.destroy();
        layers.scene.destroy();
        layers.top.destroy();
      }
      floorLayers.clear();
      floorsRoot.destroy();
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
