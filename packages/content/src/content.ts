// Montagem e validação do conteúdo. PURO: nenhuma leitura de disco acontece aqui, para este
// módulo poder ser importado por `sim` sem arrastar `node:fs` junto (invariante 1).
// Quem lê arquivo é `@draconya/content/load`, e o lint impede `sim` de importar de lá.

import { z } from 'zod';
import { buildRoute, buildTilemap, isBlocked } from './map.js';
import type { Route, Tilemap } from './map.js';
import {
  BOT_VOCABULARY_VERSION,
  appearancesSchema,
  packSchema,
  botSchema, combatSchema, huntSchema, monsterSchema, progressionSchema, routeSchema,
  bestiarySchema, itemSchema, skillSchema, spellSchema, staminaSchema, supplySchema,
  tilemapSchema, vocationSchema,
} from './schemas.js';
import type {
  Appearances, Bestiary, BotLimits, Combat, Hunt, Item, Monster, Pack, Progression, Skill, Spell,
  Stamina, Supply, Vocation,
} from './schemas.js';
import { packProblems } from './pack.js';
import { advancedFeaturesUsed, validateBotConfig } from './bot.js';

export interface Content {
  /**
   * Identidade do conjunto. É ela que a sessão congela na criação (invariante 7): uma hunt
   * iniciada na versão N termina na versão N, mesmo com deploy no meio.
   */
  readonly version: string;
  readonly monsters: ReadonlyMap<string, Monster>;
  readonly hunts: ReadonlyMap<string, Hunt>;
  readonly vocations: ReadonlyMap<string, Vocation>;
  /** Base de progressão: sem ela não há como saber os stats de quem ainda não tem vocação. */
  readonly progression: Progression;
  /** Coeficientes de combate. O §12.1 os quer em conteúdo, nunca em código. */
  readonly combat: Combat;
  /** Teto e taxa de recuperação da stamina (§10). */
  readonly stamina: Stamina;
  /**
   * Os marcos do Bestiário e o bônus por marco (§18, FUN-113). Opcional: sem ele o abate
   * continua contado no personagem, só não há marco nem bônus — é o conteúdo de teste que
   * não fala de progressão permanente. O conteúdo REAL o tem, e `load.test.ts` prende.
   */
  readonly bestiary?: Bestiary;
  /** Vocabulário e limites do bot (§13). Sem ele não há automação, que é o produto. */
  readonly bot: BotLimits;
  /** Catálogo de magias (§4.1). Custo, cooldown e efeito são conteúdo, nunca motor. */
  readonly spells: ReadonlyMap<string, Spell>;
  /** Catálogo de supplies (§20.1). Poção e runa debitam gold; não são itens físicos. */
  readonly supplies: ReadonlyMap<string, Supply>;
  /** Skills que sobem por uso (§9.4). Vazio é um jogo em que nada sobe por fazer. */
  readonly skills: ReadonlyMap<string, Skill>;
  /** Catálogo de itens (§21.2). Atributos base fixos: item melhor é item diferente. */
  readonly items: ReadonlyMap<string, Item>;
  readonly maps: ReadonlyMap<string, Tilemap>;
  readonly routes: ReadonlyMap<string, Route>;
  /**
   * A tabela de aparências (FUN-94), agora com quem a use (FUN-103, FUN-23, FUN-109): o
   * `game` lê o outfit padrão do jogador e os efeitos de magia, supply e golpe que o `sim`
   * emite; o cliente lê chão e parede por mapa. Monstro e item NÃO se consultam por aqui —
   * eles já saem resolvidos em `monsters` e `items`.
   *
   * `undefined` só em conteúdo de teste sem monstro nem item, que dispensa a tabela.
   */
  readonly appearances?: Appearances;
  /**
   * O inventário do pacote que a tabela cita (FUN-21), e contra o qual ela foi conferida. O
   * `game` compara `pack.version` com o pacote que o deploy SERVE (`THINGS_VERSION`) e recusa
   * subir se divergem: a conferência contra a sombra de um pacote só vale para quem carrega
   * esse pacote. `undefined` sem inventário — o conteúdo de teste.
   */
  readonly pack?: Pack;
  /**
   * O mapa da Cidade, com ponto de entrada (FUN-60). Opcional porque conteúdo de teste que só
   * fala de hunt não precisa dele — mas o conteúdo REAL precisa, e `load.ts` exige.
   */
  readonly city?: Tilemap;
  /** Presente sempre que `city` está: o passo fixo da Cidade (FUN-119). */
  readonly citySettings?: CitySettings;
  /** Valores marcados como não decididos no PRD, para o boot conseguir avisar. */
  readonly openValues: readonly string[];
}

export interface RawContent {
  readonly monsters: readonly unknown[];
  readonly hunts: readonly unknown[];
  readonly vocations: readonly unknown[];
  readonly progression?: readonly unknown[];
  readonly combat?: readonly unknown[];
  readonly stamina?: readonly unknown[];
  readonly bestiary?: readonly unknown[];
  readonly bot?: readonly unknown[];
  readonly spells?: readonly unknown[];
  readonly supplies?: readonly unknown[];
  readonly skills?: readonly unknown[];
  readonly items?: readonly unknown[];
  readonly appearances?: readonly unknown[];
  /** Inventários de pacote (FUN-21), `packs/<pack>.json`. Só o conteúdo real os tem. */
  readonly packs?: readonly unknown[];
  readonly maps?: readonly unknown[];
  readonly routes?: readonly unknown[];
  /** `{ mapId }` — qual dos mapas é a Cidade. Explícito, e não um id mágico `"city"`. */
  readonly city?: unknown;
}

/**
 * `data/city.json`. Explícito, e não um id mágico: o boot diz qual mapa é a Cidade — e a que
 * ritmo se anda nela. `stepDurationMs` é FIXO (FUN-119, ADR 0025): a Cidade é navegação, não
 * simulação, e o passo não depende do chão nem da velocidade do personagem.
 */
const citySchema = z.object({
  mapId: z.string().min(1),
  stepDurationMs: z.number().int().positive(),
});

/** O que `city.json` decide além do mapa. */
export interface CitySettings {
  readonly stepDurationMs: number;
}

export class ContentError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`conteúdo inválido:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ContentError';
  }
}

/**
 * Valida, resolve referências cruzadas e devolve o conteúdo pronto.
 *
 * Lança em qualquer problema, e é para isso que serve: conteúdo inválido tem que impedir o
 * processo de subir. Degradar aqui — pular o monstro quebrado, usar um valor padrão — é como
 * um erro de digitação vira bug de balanceamento que ninguém liga à causa.
 */
export function buildContent(raw: RawContent): Content {
  const problems: string[] = [];

  const monsterDefinitions = parseAll('monster', raw.monsters, monsterSchema, problems);
  const hunts = parseAll('hunt', raw.hunts, huntSchema, problems);
  const vocations = parseAll('vocation', raw.vocations, vocationSchema, problems);
  const progressions = parseAll('progression', raw.progression ?? [], progressionSchema, problems);
  const progression = progressions.get('baseline');
  // Ausente é ERRO, não conjunto vazio: sem a base não há como calcular os stats de quem
  // ainda não tem vocação, e todo personagem nasce assim (§7.4). Um default em código seria
  // exatamente o "nada em código" que esta issue proíbe.
  if (progression === undefined) {
    problems.push('progression/baseline.json ausente: sem ele não há stats de level 1');
  }
  const combats = parseAll('combat', raw.combat ?? [], combatSchema, problems);
  const combat = combats.get('baseline');
  // Mesma razão da base de progressão: sem coeficiente não há como resolver dano, e um
  // default em código faria o §12.1 deixar de valer no dia em que ninguém estivesse olhando.
  if (combat === undefined) {
    problems.push('combat/baseline.json ausente: sem ele não há como resolver dano');
  }
  const staminas = parseAll('stamina', raw.stamina ?? [], staminaSchema, problems);
  const stamina = staminas.get('baseline');
  const bestiary = parseAll('bestiary', raw.bestiary ?? [], bestiarySchema, problems).get('baseline');
  // Ausente é ERRO pela mesma razão dos outros dois: a stamina é o TETO DE SIMULAÇÃO do
  // projeto (ADR 0001), e um default em código faria o número que sustenta a projeção de
  // custo morar onde ninguém procura por ele.
  if (stamina === undefined) {
    problems.push('stamina/baseline.json ausente: sem ele não há teto de stamina');
  }
  const bots = parseAll('bot', raw.bot ?? [], botSchema, problems);
  const bot = bots.get('baseline');
  // Ausente é ERRO, como progressão, combate e stamina. O bot é o produto — o invariante 11
  // diz que a automação é funcionalidade central, não tolerância —, e um default em código
  // faria os slots que o designer ajusta morarem onde ele não alcança.
  if (bot === undefined) {
    problems.push('bot/baseline.json ausente: sem ele não há vocabulário de automação');
  } else if (bot.vocabularyVersion !== BOT_VOCABULARY_VERSION) {
    // Conteúdo declarando outra versão de vocabulário é conteúdo escrito para outro servidor.
    // Aceitar seria rodar regra que este binário não sabe compilar, e descobrir na execução.
    problems.push(
      `bot/baseline.json declara vocabularyVersion ${bot.vocabularyVersion}, e este servidor `
        + `entende ${BOT_VOCABULARY_VERSION}`,
    );
  }
  const spells = parseAll('spell', raw.spells ?? [], spellSchema, problems);
  const supplies = parseAll('supply', raw.supplies ?? [], supplySchema, problems);
  const skills = parseAll('skill', raw.skills ?? [], skillSchema, problems);
  const itemDefinitions = parseAll('item', raw.items ?? [], itemSchema, problems);
  const mapData = parseAll('map', raw.maps ?? [], tilemapSchema, problems);
  const routeData = parseAll('route', raw.routes ?? [], routeSchema, problems);

  // A aparência (FUN-94). Ausente é ERRO quando há o que mapear, pela mesma razão de
  // `progression` e `combat`: um default em código faria o arquivo que existe para tornar a
  // troca de pacote barata deixar de valer no dia em que ninguém estivesse olhando.
  //
  // Quando não há monstro nem item, a tabela é dispensável — é o conteúdo de teste que só fala
  // de mapa, e exigir dele um arquivo vazio seria burocracia sem nada do outro lado.
  const appearanceTables = parseAll('appearances', raw.appearances ?? [], appearancesSchema,
    problems);
  const appearances = appearanceTables.get('baseline');
  if (appearances === undefined && (monsterDefinitions.size > 0 || itemDefinitions.size > 0)) {
    problems.push(
      'appearances/baseline.json ausente: sem ele monstro e item não têm aparência, e trocar de '
        + 'pacote de assets voltaria a ser reescrever conteúdo (ADR 0008)',
    );
  }
  // Todo mapa precisa saber de que é feito (FUN-23), e a tabela não pode citar mapa que não
  // existe — a mesma checagem dos dois lados que monstro e item já têm. Sem a primeira, o
  // mundo desenha buraco preto; sem a segunda, a linha órfã sobrevive a três trocas de pacote.
  if (appearances !== undefined) {
    for (const [id, data] of mapData) {
      if (appearances.maps[id] !== undefined) continue;
      // Mapa IMPORTADO (ADR 0025) traz a pilha de aparências por tile em `things/`, não um
      // par chão/parede aqui — o `source` diz que ele é assim. Só o autorado à mão precisa
      // da linha na tabela.
      if (data.source !== undefined) continue;
      problems.push(`mapa "${id}" não tem chão nem parede: falta a linha "${id}" em appearances.maps`);
    }
    for (const id of Object.keys(appearances.maps)) {
      if (mapData.has(id)) continue;
      problems.push(`appearances.maps mapeia mapa "${id}", que não existe no conteúdo`);
    }
    // Magia e supply (FUN-109) são conferidos de UM lado só, ao contrário de monstro, item e
    // mapa: a linha órfã continua sendo recusada — é o defeito que a tabela introduz —, mas
    // magia sem efeito é magia MUDA, e muda é válida. Exigir o outro lado obrigaria cada
    // magia nova a nascer com arte antes de nascer com número, que é a ordem errada.
    for (const id of Object.keys(appearances.spells)) {
      if (spells.has(id)) continue;
      problems.push(`appearances.spells mapeia magia "${id}", que não existe no conteúdo`);
    }
    for (const id of Object.keys(appearances.supplies)) {
      if (supplies.has(id)) continue;
      problems.push(`appearances.supplies mapeia supply "${id}", que não existe no conteúdo`);
    }
  }

  // O inventário do pacote (FUN-21). É a única conferência de que os NÚMEROS da tabela existem:
  // tudo acima cruza a tabela com o conteúdo, e nada cruzava a tabela com o pacote — o outfit
  // 999 passava e virava quadrado invisível em produção. Sem inventário nenhum a conferência
  // não roda, e é assim que a fixture de combate continua sem falar de arte; com inventários
  // e nenhum do pacote citado, é erro — o campo `pack` deixou de ser só documentação.
  const packs = parseAll('pack', raw.packs ?? [], packSchema, problems);
  let pack: Pack | undefined;
  if (appearances !== undefined && packs.size > 0) {
    pack = packs.get(appearances.pack);
    if (pack === undefined) {
      problems.push(
        `appearances/baseline.json aponta o pacote "${appearances.pack}", e packs/ não tem o `
          + `inventário dele — rode pnpm assets:inventory com o pacote na máquina`,
      );
    } else {
      problems.push(...packProblems(appearances, pack));
    }
  }

  const monsters: ReadonlyMap<string, Monster> = resolveAppearance(
    'monstro', 'monsters', monsterDefinitions, appearances?.monsters, 'outfitId', problems);
  const items: ReadonlyMap<string, Item> = resolveAppearance(
    'item', 'items', itemDefinitions, appearances?.items, 'appearanceId', problems);

  const maps = new Map<string, Tilemap>();
  for (const data of mapData.values()) {
    let map: Tilemap;
    try {
      map = buildTilemap(data);
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    // Ponto de entrada em parede é conteúdo quebrado, e quebra AQUI, no boot — não no
    // primeiro personagem que tentar andar (FUN-60).
    const entry = map.entryPoint;
    if (entry !== undefined && isBlocked(map, entry.x, entry.y, entry.z)) {
      problems.push(
        `mapa "${map.id}": entryPoint (${entry.x},${entry.y},${entry.z}) está fora do mapa, ` +
          'em parede, ou num andar que o mapa não tem',
      );
    }
    // Escada para parede é o personagem preso no andar de cima; escada de tile bloqueado é
    // uma que ninguém alcança (FUN-119).
    for (const [, to] of map.floorChanges) {
      if (isBlocked(map, to.x, to.y, to.z)) {
        problems.push(
          `mapa "${map.id}": floorChange leva a (${to.x},${to.y},${to.z}), que está fora do ` +
            'mapa, em parede, ou num andar que o mapa não tem',
        );
      }
    }
    for (const change of data.floorChanges) {
      if (isBlocked(map, change.from.x, change.from.y, change.from.z)) {
        problems.push(
          `mapa "${map.id}": floorChange sai de (${change.from.x},${change.from.y},` +
            `${change.from.z}), que ninguém pisa`,
        );
      }
    }
    maps.set(data.id, map);
  }

  let city: Tilemap | undefined;
  let citySettings: CitySettings | undefined;
  if (raw.city !== undefined) {
    const parsed = citySchema.safeParse(raw.city);
    if (!parsed.success) {
      problems.push(`city: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    } else {
      city = maps.get(parsed.data.mapId);
      citySettings = { stepDurationMs: parsed.data.stepDurationMs };
      if (city === undefined) {
        problems.push(`city referencia mapa inexistente "${parsed.data.mapId}"`);
      } else if (city.entryPoint === undefined) {
        problems.push(`mapa da Cidade "${city.id}" não tem entryPoint — ninguém teria onde nascer`);
      }
    }
  }

  const routes = new Map<string, Route>();
  for (const data of routeData.values()) {
    const map = maps.get(data.mapId);
    if (!map) {
      problems.push(`rota "${data.id}" referencia mapa inexistente "${data.mapId}"`);
      continue;
    }
    try {
      routes.set(data.id, buildRoute(data, map));
    } catch (erro) {
      problems.push((erro as Error).message);
    }
  }

  // As referências cruzadas daqui para baixo conferem contra as DEFINIÇÕES, não contra os mapas
  // resolvidos. A diferença aparece quando a tabela de aparências falta: o mapa resolvido fica
  // vazio, e conferir contra ele faria uma tabela ausente reportar todo monstro do jogo como
  // inexistente — o boot escondendo a causa dentro de trinta sintomas.
  //
  // Loot de item agora tem catálogo (FUN-76), e a referência é conferida — o que continua sendo
  // recusado é o item FANTASMA. Aceitar a linha creditaria no primeiro abate um item que nunca
  // vai poder ser desenhado, equipado nem vendido, e o sintoma chegaria dias depois.
  for (const monster of monsterDefinitions.values()) {
    for (const line of monster.loot.items) {
      if (itemDefinitions.has(line.itemId)) continue;
      problems.push(
        `monstro "${monster.id}": loot.items referencia item "${line.itemId}", que não existe `
          + 'no catálogo',
      );
    }
  }

  // Referência cruzada: validar formato não basta. Uma hunt apontando monstro inexistente
  // passa em qualquer schema e só falha quando alguém entra nela.
  for (const hunt of hunts.values()) {
    for (const [difficultyName, difficulty] of Object.entries(hunt.difficulties)) {
      for (const entry of difficulty?.composition ?? []) {
        if (!monsterDefinitions.has(entry.monsterId)) {
          problems.push(
            `hunt "${hunt.id}" (${difficultyName}) referencia monstro inexistente ` +
              `"${entry.monsterId}"`,
          );
        }
      }
    }
  }

  for (const hunt of hunts.values()) {
    if (maps.size > 0 && !maps.has(hunt.mapId)) {
      problems.push(`hunt "${hunt.id}" referencia mapa inexistente "${hunt.mapId}"`);
    }
    // A rota é o caminho inteiro que o bot percorre. Uma hunt que aponta rota inexistente
    // passa em qualquer schema e só falha quando alguém entra nela — e aí o sintoma é "a
    // hunt não abre", longe da causa.
    if (routes.size > 0 && !routes.has(hunt.routeId)) {
      problems.push(`hunt "${hunt.id}" referencia rota inexistente "${hunt.routeId}"`);
      continue;
    }
    const route = routes.get(hunt.routeId);
    if (route !== undefined && route.mapId !== hunt.mapId) {
      problems.push(
        `hunt "${hunt.id}" está no mapa "${hunt.mapId}" mas a rota "${hunt.routeId}" é do ` +
          `mapa "${route.mapId}"`,
      );
    }
  }

  if (problems.length > 0) throw new ContentError(problems);

  // Todo `_open` do conteúdo, venha de onde vier. Marcar um valor como provisório no JSON e
  // o boot não repetir isso é a mesma coisa que não marcar — o aviso existe justamente para
  // alguém lembrar de voltar.
  const openValues = [
    ...[...vocations.values()]
      .filter((v) => v._open !== undefined)
      .map((v) => `vocation/${v.id}: ${v._open ?? ''}`),
    ...(progression?._open === undefined
      ? []
      : [`progression/${progression.id}: ${progression._open}`]),
    ...(combat?._open === undefined ? [] : [`combat/${combat.id}: ${combat._open}`]),
    ...(stamina?._open === undefined ? [] : [`stamina/${stamina.id}: ${stamina._open}`]),
    ...(bestiary?._open === undefined ? [] : [`bestiary/${bestiary.id}: ${bestiary._open}`]),
    ...openOf('spell', spells),
    ...openOf('supply', supplies),
    ...openOf('skill', skills),
    ...openOf('item', items),
  ];

  const content: Content = {
    version: computeVersion(raw),
    bot: bot as BotLimits,
    spells,
    supplies,
    skills,
    items,
    monsters,
    hunts,
    vocations,
    progression: progression as Progression,
    combat: combat as Combat,
    stamina: stamina as Stamina,
    ...(bestiary === undefined ? {} : { bestiary }),
    maps,
    routes,
    openValues,
    ...(city === undefined ? {} : { city }),
    ...(citySettings === undefined ? {} : { citySettings }),
    ...(appearances === undefined ? {} : { appearances }),
    ...(pack === undefined ? {} : { pack }),
  };

  // A configuração de bot com que o personagem NASCE (FUN-114) passa pelo MESMO juiz que a
  // do jogador — depois de o conteúdo estar montado, porque o juiz olha os catálogos de
  // magia e supply. Uma magia que não existe reprova o boot aqui, e não o primeiro
  // personagem criado: o conteúdo é quem errou.
  const defaultConfig = content.bot.defaultConfig;
  if (defaultConfig !== undefined) {
    // O gate de level é do jogador (§13.2); o padrão nasce no level 1, então é o nível 1 que
    // ele tem de passar — regra avançada no padrão seria personagem recusado ao entrar.
    const rejected = [
      ...validateBotConfig(defaultConfig, content),
      ...advancedFeaturesUsed(defaultConfig, content.bot)
        .map((feature) => `usa recurso do bot avançado (${feature}), e o personagem nasce no level 1`),
    ].map((problem) => `bot/baseline.json defaultConfig: ${problem}`);
    if (rejected.length > 0) throw new ContentError(rejected);
  }

  return content;
}

/**
 * Uma tabela de aparências DERIVADA do conteúdo, com ids sequenciais (FUN-94).
 *
 * Existe para fixture e para ferramenta de scaffolding, e o nome diz o que ela é: um teste de
 * combate não fala de arte, e obrigá-lo a escrever a tabela à mão faria toda fixture carregar
 * um dado que ela não usa — que é como fixture deixa de ser lida.
 *
 * **Não serve a conteúdo de verdade.** Os números são 1, 2, 3… e nenhum deles aponta uma
 * aparência que exista em pacote nenhum. `data/appearances/baseline.json` é escrito à mão, e é
 * essa a única tabela que o jogo carrega.
 */
export function placeholderAppearances(raw: Partial<RawContent>): Appearances {
  const sequential = (entries: readonly unknown[] | undefined): Record<string, number> =>
    Object.fromEntries((entries ?? []).map((entry, index) => [
      typeof entry === 'object' && entry !== null && 'id' in entry
        ? String((entry as { id: unknown }).id)
        : `#${index}`,
      index + 1,
    ]));
  return {
    id: 'baseline',
    pack: 'placeholder',
    monsters: sequential(raw.monsters),
    items: sequential(raw.items),
    maps: Object.fromEntries((raw.maps ?? []).map((entry, index) => [
      typeof entry === 'object' && entry !== null && 'id' in entry
        ? String((entry as { id: unknown }).id)
        : `#${index}`,
      { floor: index * 2 + 1, wall: index * 2 + 2 },
    ])),
    // Vazios de propósito (FUN-109): magia e supply são conferidos de um lado só, então a
    // fixture não precisa inventar efeito nenhum — e um teste de combate que precise de um
    // passa a tabela explícita, como o de aparência já faz.
    spells: {},
    supplies: {},
    hits: {},
  };
}

/**
 * Casa cada definição com a aparência da tabela (FUN-94), e reclama dos DOIS lados.
 *
 * Entidade sem aparência é o defeito óbvio: um monstro que o cliente não teria como desenhar.
 * A aparência órfã — a linha que aponta um id que não existe — é o defeito que a tabela
 * INTRODUZ, e é o preço que a issue já previa: com o id inline, apagar a entidade levava o id
 * junto; com a tabela, a linha fica para trás em silêncio. Depois de três trocas de pacote,
 * ninguém sabe mais quais linhas ainda valem.
 *
 * Recusar as duas coisas no boot é o que mantém a tabela confiável o bastante para alguém
 * remapeá-la sem ir conferir entidade por entidade.
 */
function resolveAppearance<D extends { id: string }, K extends 'appearanceId' | 'outfitId'>(
  kind: string,
  section: string,
  definitions: ReadonlyMap<string, D>,
  table: Readonly<Record<string, number>> | undefined,
  field: K,
  problems: string[],
): Map<string, D & Record<K, number>> {
  const resolved = new Map<string, D & Record<K, number>>();
  // Tabela ausente já foi reportada uma vez por quem chamou. Repetir aqui daria uma linha de
  // erro por entidade, e o boot escondendo a causa dentro do próprio sintoma.
  if (table === undefined) return resolved;

  for (const [id, definition] of definitions) {
    const appearance = table[id];
    if (appearance === undefined) {
      problems.push(
        `${kind} "${id}" não tem aparência: falta a linha "${id}" em appearances.${section}`,
      );
      continue;
    }
    // A chave é variável (`outfitId` no monstro, `appearanceId` no item), e o TypeScript
    // tipa chave computada como índice aberto — daí a asserção ficar no objeto de UM campo, e
    // não na entidade inteira, onde ela esconderia qualquer divergência de forma.
    resolved.set(id, { ...definition, ...({ [field]: appearance } as Record<K, number>) });
  }

  for (const id of Object.keys(table)) {
    if (definitions.has(id)) continue;
    problems.push(`appearances.${section} mapeia ${kind} "${id}", que não existe no conteúdo`);
  }
  return resolved;
}

/** Os `_open` de um catálogo inteiro, prefixados pelo tipo. Ver `openValues`. */
function openOf(
  kind: string, catalog: ReadonlyMap<string, { readonly _open?: string | undefined }>,
): string[] {
  const open: string[] = [];
  for (const [id, entry] of catalog) {
    if (entry._open !== undefined) open.push(`${kind}/${id}: ${entry._open}`);
  }
  return open;
}

function parseAll<S extends z.ZodType<{ id: string }>>(
  kind: string,
  entries: readonly unknown[],
  schema: S,
  problems: string[],
): Map<string, z.infer<S>> {
  const byId = new Map<string, z.infer<S>>();
  for (const [index, entry] of entries.entries()) {
    const parsed = schema.safeParse(entry);
    if (!parsed.success) {
      // O id vem do dado cru: sem ele, a mensagem diria só "item #3", e achar qual arquivo
      // está errado num diretório com dezenas vira caça ao tesouro.
      const id = typeof entry === 'object' && entry !== null && 'id' in entry
        ? String((entry as { id: unknown }).id)
        : `#${index}`;
      problems.push(`${kind} "${id}": ${describeIssues(parsed.error)}`);
      continue;
    }
    const value = parsed.data;
    if (byId.has(value.id)) {
      problems.push(`${kind} "${value.id}" duplicado`);
      continue;
    }
    byId.set(value.id, value);
  }
  return byId;
}

function describeIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '(raiz)'} ${i.message}`).join('; ');
}

/**
 * Hash determinístico do conjunto (FNV-1a sobre JSON canônico).
 *
 * Determinístico entre máquinas de propósito: todos os nós precisam calcular a MESMA versão,
 * senão uma sessão migrada acha que o conteúdo mudou. Não é criptográfico e não precisa ser —
 * o que se quer é detectar mudança, não resistir a adversário.
 */
export function computeVersion(raw: RawContent): string {
  // O inventário do pacote (FUN-21) fica FORA da versão. Ele não é lido por sessão nenhuma —
  // só confere a tabela no boot —, e regenerá-lo porque o pacote ganhou ids novos não muda o
  // que ninguém vê. Contá-lo faria um `pnpm assets:inventory` recusar todo snapshot de uma
  // queda sem drenagem (`createSessionRestorer`) sem que um único número de jogo tenha mudado.
  // O que muda a arte de uma sessão é o `pack` da tabela, e esse já conta.
  const { packs: _packs, ...versioned } = raw;
  const canonical = JSON.stringify(versioned, ordenarChaves);
  let hash = 0x811c_9dc5;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x0100_0193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Ordena chaves para o hash não depender da ordem em que o JSON foi escrito. */
function ordenarChaves(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
  );
}
