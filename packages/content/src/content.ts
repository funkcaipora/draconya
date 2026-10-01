// Montagem e validação do conteúdo. PURO: nenhuma leitura de disco acontece aqui, para este
// módulo poder ser importado por `sim` sem arrastar `node:fs` junto (invariante 1).
// Quem lê arquivo é `@draconya/content/load`, e o lint impede `sim` de importar de lá.

import { z } from 'zod';
import { absoluteToLocal, buildRoute, buildTilemap, isBlocked } from './map.js';
import type { Route, Tilemap } from './map.js';
import {
  BOT_VOCABULARY_VERSION,
  BASIC_ABILITY_ID,
  COMBAT_PROFILES,
  DAMAGE_TYPES,
  NEUTRAL_RATES,
  SPELL_SKILL_WEAPON,
  abilityPower,
  ammunitionSchema,
  appearancesSchema,
  attackRange,
  packSchema,
  blessingSchema,
  botSchema, combatSchema, huntSchema, monsterSchema, progressionSchema, routeSchema,
  bestiarySchema, boostedSchema, bosstiarySchema, charmSchema, itemSchema, loyaltySchema, partySchema, skillSchema,
  skinningSchema, spellSchema,
  staminaSchema, supplySchema, tilemapSchema, trainingSchema, vocationSchema, weaponFamilySchema, worldSchema,
} from './schemas.js';
import type {
  Ammunition, AmmunitionDefinition, Appearances, Bestiary, Blessing, Boosted, BotLimits, Bosstiary, Charm,
  Combat, Loyalty, CompiledMitigation,
  CompiledReflect, DamageType, Hunt, Item, ItemDefinition, MitigationProfile, Monster, MonsterAbility, MonsterDefense,
  MonsterDefinition, Pack, PartyConfig, Progression, Rates, ResolvedWeapon, Skill, Skinning, Spell, Stamina, Supply,
  Training, Vocation, VocationRequirement, Weapon, WeaponFamily, WeaponFamilyDefinition, WeaponKind,
  WeaponPowerFormula, WeaponProfile, World,
} from './schemas.js';
import { packProblems } from './pack.js';
import { validateBotConfig, validateBotConfigV2 } from './bot.js';

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
   * O Treino do Tibia (#631, ADR 0059): o boneco, o que cada golpe rende e o offline training.
   * Opcional — o conteúdo de teste que não fala de treino não o tem, e o `sim`/o servidor tratam
   * ausência como "nenhuma sessão de Treino existe". O conteúdo REAL o tem, e `load.test.ts` prende.
   */
  readonly training?: Training;
  /** A party de hunt (§15, ADR 0027): teto de membros e pool de XP por vocações únicas. */
  readonly party: PartyConfig;
  /**
   * Os marcos do Bestiário e o bônus por marco (§18, FUN-113). Opcional: sem ele o abate
   * continua contado no personagem, só não há marco nem bônus — é o conteúdo de teste que
   * não fala de progressão permanente. O conteúdo REAL o tem, e `load.test.ts` prende.
   */
  readonly bestiary?: Bestiary;
  /**
   * Os níveis do Bosstiary por raridade (#629): quantos abates levam a cada um dos três níveis e
   * quantos pontos de boss cada nível rende (`IOBosstiary::levelInfos` do Canary). Opcional, como
   * `bestiary`: sem ele o abate de boss continua contado no personagem, só não há nível nem
   * ponto — é o conteúdo de teste que não fala de progressão permanente. O conteúdo REAL o tem,
   * e `load.test.ts` prende.
   */
  readonly bosstiary?: Bosstiary;
  /**
   * O catálogo dos 25 Charms do Canary (M39-02, #602; ADR 0053 d.3): `content/data/charms/
   * generated/charms.json`, chave `charmId` (o slug). Vazio no conteúdo de teste que não fala
   * de Charms — a economia (`@draconya/sim/charms.ts`) trata catálogo ausente como "nenhum
   * charm existe", igual a `bestiary` ausente.
   */
  readonly charms: ReadonlyMap<string, Charm>;
  /**
   * Como o cadáver de cada monstro esfolável é esfolado (#626, ADR 0048 d.5/d.6; ADR 0053 d.5):
   * `content/data/skinning/generated/skinning.json`, chave `monsterId`. Vazio no conteúdo de teste
   * que não fala de esfola — nenhuma ferramenta é reconhecida e o sorteio nunca corre.
   */
  readonly skinning: ReadonlyMap<string, Skinning>;
  /**
   * A Boosted Creature diária (M42, #615, ADR 0054 decisão 7): a hora de virada. Opcional —
   * sem ela o `jobs` não sorteia nada, e nenhuma hunt aplica o bônus. É o conteúdo de teste que
   * não fala de engajamento diário.
   */
  readonly boosted?: Boosted;
  /**
   * O Loyalty (M44, #628, ADR 0052 decisão 5): a tabela de degraus da idade da conta. Opcional —
   * sem ela nenhum ticket carrega bônus, e o conteúdo de teste que não fala de Loyalty continua
   * valendo o nível BASE de toda skill.
   */
  readonly loyalty?: Loyalty;
  /** Vocabulário e limites do bot (§13). Sem ele não há automação, que é o produto. */
  readonly bot: BotLimits;
  /** Catálogo de magias (§4.1). Custo, cooldown e efeito são conteúdo, nunca motor. */
  readonly spells: ReadonlyMap<string, Spell>;
  /**
   * O catálogo de suprimentos (§20.1): poção e runa são ABSTRATAS — usar debita gold direto,
   * sem item físico nem pilha. O `group` é o grupo de cooldown do motor v2.
   */
  readonly supplies: ReadonlyMap<string, Supply>;
  /**
   * As sete bênçãos PvE do Tibia (#570, ADR 0052): compradas na Cidade, consumidas na morte.
   * `order` (em cada `Blessing`) é o índice do bit que `CharacterRuntime.blessings` guarda —
   * ver `packages/sim/src/blessings.ts`.
   */
  readonly blessings: ReadonlyMap<string, Blessing>;
  /** Skills que sobe por uso (§9.4). Vazio é um jogo em que nada sobe por fazer. */
  readonly skills: ReadonlyMap<string, Skill>;
  /** Catálogo de itens (§21.2). Atributos base fixos: item melhor é item diferente. */
  readonly items: ReadonlyMap<string, Item>;
  /**
   * O catálogo de MUNIÇÃO (ADR 0026 d.3): flecha e virote são ABSTRATOS — cada tiro debita
   * gold, sem item físico nem pilha. A seleção é por família, no slot do escudo.
   */
  readonly ammunition: ReadonlyMap<string, Ammunition>;
  /**
   * As famílias de arma (CMB-05, #333): alcance, tipo, recurso, fórmula e a skill que as
   * escala. É o que o `sim` lê para saber como uma arma bate sem conhecer nome de item nem
   * vocação. Indexadas por id no boot.
   */
  readonly weaponFamilies: ReadonlyMap<WeaponFamily, CompiledWeaponFamily>;
  /**
   * O perfil do golpe DESARMADO (CMB-05): a família `fist` com o `attack`, o alcance e o tipo
   * de `combat.player`. É o fallback de quem não tem arma — o jogo tem hunt antes de ter item.
   */
  readonly unarmed: WeaponProfile;
  readonly maps: ReadonlyMap<string, Tilemap>;
  readonly routes: ReadonlyMap<string, Route>;
  /**
   * Os mundos (#829, OW-08, ADR 0060 d.1 e d.2), `data/worlds/<id>.json`: tipo, mapa, cidades com
   * templo e teto de gente. Vazio no conteúdo de teste que não fala de mundo aberto; o conteúdo
   * REAL tem o `main`, e `load.test.ts` prende. Cada `map` já foi conferido contra `maps` e cada
   * templo contra o recorte (em coordenada absoluta, traduzida por `absoluteToLocal`).
   */
  readonly worlds: ReadonlyMap<string, World>;
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
  readonly training?: readonly unknown[];
  readonly party?: readonly unknown[];
  readonly bestiary?: readonly unknown[];
  /** Os níveis do Bosstiary (#629), `bosstiary/baseline.json`. */
  readonly bosstiary?: readonly unknown[];
  readonly charms?: readonly unknown[];
  /** Como o cadáver de cada monstro esfolável é esfolado (#626), `skinning/generated/`. */
  readonly skinning?: readonly unknown[];
  readonly boosted?: readonly unknown[];
  readonly loyalty?: readonly unknown[];
  readonly bot?: readonly unknown[];
  readonly spells?: readonly unknown[];
  readonly supplies?: readonly unknown[];
  /** As sete bênçãos PvE (#570), `blessings/*.json`. */
  readonly blessings?: readonly unknown[];
  readonly skills?: readonly unknown[];
  readonly items?: readonly unknown[];
  /** As munições abstratas, `ammunition/*.json` (ADR 0026 d.3). */
  readonly ammunition?: readonly unknown[];
  /** As famílias de arma (CMB-05), `weapon-families/*.json`. */
  readonly weaponFamilies?: readonly unknown[];
  readonly appearances?: readonly unknown[];
  /** Inventários de pacote (FUN-21), `packs/<pack>.json`. Só o conteúdo real os tem. */
  readonly packs?: readonly unknown[];
  readonly maps?: readonly unknown[];
  readonly routes?: readonly unknown[];
  /** Os mundos (#829, ADR 0060), `worlds/*.json`. Entram em `computeVersion` como tudo aqui. */
  readonly worlds?: readonly unknown[];
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

/** O monstro já com a mitigação compilada (CMB-03) e as abilities normalizadas (CMB-06). */
export type CompiledMonster = Omit<Monster, 'outfitId' | 'corpseAppearanceId'>;

/** O item já com arma tipada e mitigação compilada (CMB-03), sem aparência. */
export type CompiledItem = Omit<Item, 'appearanceId'>;

/**
 * A família de arma COMPILADA (CMB-05): a definição do arquivo mais a contribuição por nível
 * da skill apontada. É o que o boot entrega ao `sim` — a fórmula de uma arma se monta a partir
 * dela, e rebalancear a skill rebalanceia todas as famílias que a usam.
 */
export interface CompiledWeaponFamily extends WeaponFamilyDefinition {
  /** `damagePerLevel` da skill apontada; zero sem skill (conteúdo de teste). */
  readonly skillFactor: number;
  /** Nível inicial da skill apontada — a contribuição conta a partir dele. */
  readonly skillStartingLevel: number;
}

/**
 * Compila um `MitigationProfile` para a forma do caminho quente (CMB-03): a tabela completa por
 * tipo — zero onde não há resistência, que é a identidade — e um `Set` de imunidades. O boot
 * paga a compilação uma vez; cada golpe faz só um lookup e um `has`.
 */
export function compileMitigation(profile: MitigationProfile | undefined): CompiledMitigation {
  const resistances: Record<DamageType, number> = {
    physical: 0, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0,
    drown: 0, lifedrain: 0, manadrain: 0, arcane: 0,
  };
  if (profile !== undefined) {
    for (const type of DAMAGE_TYPES) {
      const value = profile.resistances[type];
      if (value !== undefined) resistances[type] = value;
    }
  }
  return { resistances, immunities: new Set(profile?.immunities ?? []) };
}

/**
 * Compila o reflexo declarado por tipo (#552) nas duas tabelas completas que o `sim` lê
 * (`Defender.reflect`): zero onde nada reflete. `undefined` quando NADA reflete — o item comum,
 * que não paga objeto nenhum no caminho quente. O reflexo de monstro (#683) usa a mesma forma.
 */
export function compileReflect(
  reflect: Partial<Record<DamageType, { percent?: number | undefined; flat?: number | undefined }>> | undefined,
): CompiledReflect | undefined {
  if (reflect === undefined) return undefined;
  const percent: Record<DamageType, number> = {
    physical: 0, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0,
    drown: 0, lifedrain: 0, manadrain: 0, arcane: 0,
  };
  const flat: Record<DamageType, number> = { ...percent };
  let any = false;
  for (const type of DAMAGE_TYPES) {
    const entry = reflect[type];
    if (entry === undefined) continue;
    percent[type] = entry.percent ?? 0;
    flat[type] = entry.flat ?? 0;
    if (percent[type] > 0 || flat[type] > 0) any = true;
  }
  return any ? { percent, flat } : undefined;
}

/**
 * O monstro resolvido (CMB-03), usado pelo boot e por fixture que monta `Monster` à mão.
 *
 * Os rates de monstro/boss (#691) entram AQUI, na definição compilada — a §15 da referência
 * (MonsterDefinition vs MonsterRuntime) —, como o Canary faz na instanciação
 * (`monsters.cpp:332-342`, `isBoss() ? RATE_BOSS_* : RATE_MONSTER_*`): vida × `health` (piso 1:
 * vida 0 nasceria morto), defesa e armadura × `defense` truncadas, e a mitigação percentual ×
 * `defense` em ponto flutuante (`monster.cpp:1391`). O ATAQUE não entra aqui: o Canary
 * multiplica o dano sorteado, e escalar a faixa arredondaria diferente — é o `sim` quem o
 * aplica no golpe. Multiplicador 1 não toca o campo: o conteúdo de hoje sai bit a bit.
 */
export function compileMonster(monster: MonsterDefinition, rates: Rates = NEUTRAL_RATES): CompiledMonster {
  const {
    mitigation: _rawMitigation, abilities: _rawAbilities, defenses: _rawDefenses,
    elementHealing: _rawHealing, reflect: _rawReflect, ...rest
  } = monster;
  const scale = monster.boss ? rates.boss : rates.monster;
  const elementHealing = compileElementHealing(monster.elementHealing);
  // O reflexo do monstro é só percentual (#683): o `flat` fica zero na forma do item (#552).
  let reflect: CompiledReflect | undefined;
  if (monster.reflect !== undefined) {
    const declared: Partial<Record<DamageType, { percent: number }>> = {};
    for (const type of DAMAGE_TYPES) {
      const percent = monster.reflect[type];
      if (percent !== undefined) declared[type] = { percent };
    }
    reflect = compileReflect(declared);
  }
  return {
    ...rest,
    ...(scale.health === 1 ? {} : { health: Math.max(1, Math.trunc(monster.health * scale.health)) }),
    ...(scale.defense === 1 ? {} : {
      defense: Math.trunc(monster.defense * scale.defense),
      armor: Math.trunc(monster.armor * scale.defense),
      defenseMitigation: monster.defenseMitigation * scale.defense,
    }),
    abilities: normalizeMonsterAbilities(monster),
    defenses: normalizeMonsterDefenses(monster),
    mitigation: compileMitigation(monster.mitigation),
    ...(elementHealing === undefined ? {} : { elementHealing }),
    ...(reflect === undefined ? {} : { reflect }),
  };
}

/**
 * Compila a cura por elemento do monstro (#683) na tabela COMPLETA por tipo que o `sim` lê
 * (`Defender.elementHealing`): zero onde não cura, como `compileMitigation`. `undefined` quando
 * NADA cura — o monstro comum não paga objeto nenhum no caminho quente, como `compileReflect`.
 */
export function compileElementHealing(
  healing: Partial<Record<DamageType, number>> | undefined,
): Readonly<Record<DamageType, number>> | undefined {
  if (healing === undefined) return undefined;
  const table: Record<DamageType, number> = {
    physical: 0, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0,
    drown: 0, lifedrain: 0, manadrain: 0, arcane: 0,
  };
  let any = false;
  for (const type of DAMAGE_TYPES) {
    const value = healing[type];
    if (value === undefined || value <= 0) continue;
    table[type] = value;
    any = true;
  }
  return any ? table : undefined;
}

/**
 * Normaliza as abilities no BOOT (CMB-06, DT-02), e não a cada golpe.
 *
 * Ausência (ou lista vazia) vira UMA ability básica montada do `attack`/`attackIntervalMs`/
 * `attackRange`/`damageType` de sempre — a MESMA faixa, a MESMA cadência e o MESMO tipo que o
 * rato já usava, então o resultado entregue é bit a bit. Com abilities declaradas, elas são
 * copiadas com o poder já em faixa; a básica NÃO é sintetizada.
 *
 * O ramo por golpe seria o caminho fácil e errado: além de pagar a decisão no caminho quente,
 * duas formas de ler o ataque divergiriam na primeira mudança em uma delas.
 */
export function normalizeMonsterAbilities(monster: MonsterDefinition): readonly MonsterAbility[] {
  const declared = monster.abilities;
  if (declared !== undefined && declared.length > 0) {
    return declared.map((ability) => ({
      id: ability.id,
      cadenceMs: ability.cadenceMs,
      ...(ability.chance === undefined ? {} : { chance: ability.chance }),
      target: {
        range: ability.target.range,
        ...(ability.target.area === undefined ? {} : { area: ability.target.area }),
      },
      power: abilityPower(ability.power),
      damageType: ability.damageType,
      // O tipo de ataque (#682) passa direto; ausente continua ausente — a forma decide.
      ...(ability.kind === undefined ? {} : { kind: ability.kind }),
      ...(ability.presentation === undefined ? {} : {
        presentation: {
          ...(ability.presentation.missileKey === undefined
            ? {} : { missileKey: ability.presentation.missileKey }),
          ...(ability.presentation.impactKey === undefined
            ? {} : { impactKey: ability.presentation.impactKey }),
        },
      }),
      // A condição e o campo (CMB-07) passam direto: já vêm na forma que o `sim` lê, como o
      // poder já vem em faixa. Copiar aqui mantém a normalização do BOOT (DT-02) e o caminho
      // quente sem ramificar.
      ...(ability.condition === undefined ? {} : { condition: ability.condition }),
      ...(ability.field === undefined ? {} : { field: ability.field }),
      // A provocação (#599) passa direto, como a condição e o campo.
      ...(ability.challenge === undefined ? {} : { challenge: ability.challenge }),
    }));
  }
  return [{
    id: BASIC_ABILITY_ID,
    cadenceMs: monster.attackIntervalMs,
    target: { range: monster.attackRange },
    power: attackRange(monster.attack),
    damageType: monster.damageType,
  }];
}

/**
 * Normaliza as defesas no BOOT (#518), mesmo desenho de `normalizeMonsterAbilities`: ausente
 * vira lista vazia — nunca `undefined` —, para o `sim` iterar sem `?? []` em cada chamada.
 * Não há caso legado a preservar aqui: nenhum monstro existente declara `defenses`.
 */
export function normalizeMonsterDefenses(monster: MonsterDefinition): readonly MonsterDefense[] {
  return (monster.defenses ?? []).map((defense) => ({
    id: defense.id,
    cadenceMs: defense.cadenceMs,
    chance: defense.chance,
    ...(defense.heal === undefined ? {} : { heal: { min: defense.heal.min, max: defense.heal.max } }),
    // A condição (CMB-11, #556) passa direto, como `condition`/`field` de `normalizeMonsterAbilities`
    // abaixo: já vem na forma que o `sim` lê, e copiar aqui mantém a normalização do BOOT (DT-02).
    ...(defense.condition === undefined ? {} : { condition: defense.condition }),
    ...(defense.presentation === undefined ? {} : {
      presentation: {
        ...(defense.presentation.impactKey === undefined
          ? {} : { impactKey: defense.presentation.impactKey }),
      },
    }),
  }));
}

/** Compila a mitigação de cada monstro no boot (CMB-03). */
function compileMonsters(
  definitions: ReadonlyMap<string, MonsterDefinition>, rates: Rates,
): Map<string, CompiledMonster> {
  const compiled = new Map<string, CompiledMonster>();
  for (const [id, monster] of definitions) compiled.set(id, compileMonster(monster, rates));
  return compiled;
}

/**
 * A família default de um `kind` (CMB-05). É a MESMA normalização que o boot já fazia com
 * `{ kind: 'melee', range: 1 }`: conteúdo anterior ao CMB-05 (e fixture) continua montando e
 * produzindo os mesmos números. O conteúdo real declara a família — `load.test.ts` prende.
 *
 * `fist` nunca é default: ela é o fallback SEM item, e um item que a declare é recusado.
 */
export function defaultFamilyForKind(kind: WeaponKind): WeaponFamily {
  if (kind === 'distance') return 'distance';
  if (kind === 'wand') return 'wand';
  return 'sword';
}

/**
 * Compila as famílias (CMB-05): a definição do arquivo mais o `damagePerLevel` e o
 * `startingLevel` da skill apontada. Skill ausente é contribuição zero — o conteúdo de teste
 * que não fala de skill continua montando, e a arma bate o `attack` puro.
 */
export function compileWeaponFamilies(
  definitions: ReadonlyMap<string, WeaponFamilyDefinition>,
  skills: ReadonlyMap<string, Skill>,
): Map<WeaponFamily, CompiledWeaponFamily> {
  const compiled = new Map<WeaponFamily, CompiledWeaponFamily>();
  for (const definition of definitions.values()) {
    const skill = skills.get(definition.skillId);
    compiled.set(definition.id, {
      ...definition,
      skillFactor: skill?.damagePerLevel ?? 0,
      skillStartingLevel: skill?.startingLevel ?? 0,
    });
  }
  return compiled;
}

/**
 * A fórmula de uma arma escalada (CMB-05): `base` é o `attack` do item (zero na distância, que
 * usa o `attack` da munição resolvido no golpe) e os fatores vêm da família compilada.
 */
function powerOf(
  base: number, family: CompiledWeaponFamily | undefined,
): WeaponPowerFormula | undefined {
  const formula = family?.formula;
  if (formula === undefined) return undefined;
  return {
    base,
    levelFactor: formula.levelFactor,
    skillFactor: family?.skillFactor ?? 0,
    skillStartingLevel: family?.skillStartingLevel ?? 0,
    spread: formula.spread,
  };
}

/**
 * Resolve o tipo de dano, o alcance, a família e a fórmula de cada arma, e compila a mitigação
 * de cada item (CMB-03/CMB-05).
 *
 * O default de tipo preserva o v1: `physical` em corpo a corpo e distância, `arcane` (o antigo
 * `magic`) em wand e rod. Onde o conteúdo conhece o elemento — a wand de energia, o rod de
 * terra —, o arquivo declara e o default não entra.
 *
 * As famílias são opcionais só para o chamador que compila um item solto (fixture de
 * inventário, que não fala de dano): sem elas, a arma fica sem fórmula e bate o `attack` puro.
 */
export function compileItem(
  item: ItemDefinition,
  families: ReadonlyMap<WeaponFamily, CompiledWeaponFamily> = new Map(),
  skills: ReadonlyMap<string, Skill> = new Map(),
): CompiledItem {
  // O cast cobre item NÃO-arma com um `weapon` escrito por engano: a validação de forma em
  // `buildContent` reprova esse caso, então o valor nunca chega ao `sim`.
  let weapon: ResolvedWeapon | undefined;
  if (item.kind === 'weapon') {
    const raw = (item.weapon ?? { kind: 'melee' }) as Weapon;
    const familyId = raw.family ?? defaultFamilyForKind(raw.kind);
    const family = families.get(familyId);
    // `raw.range` da arma vence o da família; ausente nos dois é corpo a corpo.
    const range = raw.range ?? family?.range ?? 1;
    const damageType = raw.damageType ?? family?.damageType
      ?? (raw.kind === 'wand' ? 'arcane' : 'physical');
    if (raw.kind === 'wand') {
      weapon = {
        kind: raw.kind,
        family: familyId,
        damageType,
        range,
        ...(raw.manaPerHit === undefined ? {} : { manaPerHit: raw.manaPerHit }),
        ...(raw.damage === undefined ? {} : { fixedDamage: raw.damage }),
      };
    } else {
      // O arremessável (#575) NÃO tem lançador: o `attack` é do PRÓPRIO item, como o corpo a
      // corpo — só a arma COM `ammoFamily` (o bow/crossbow) zera a base e espera o `attack` da
      // munição no golpe (`#strike`).
      const isLauncher = raw.kind === 'distance' && raw.ammoFamily !== undefined;
      const power = powerOf(isLauncher ? 0 : item.attack, family);
      weapon = {
        kind: raw.kind,
        family: familyId,
        damageType,
        range,
        ...(power === undefined ? {} : { power }),
        ...(raw.kind === 'distance' && raw.ammoFamily !== undefined ? { ammoFamily: raw.ammoFamily } : {}),
        // O `hitChance` da arma (#524) é só dado — a chance de acerto à distância é a #522.
        ...(raw.hitChance === undefined ? {} : { hitChance: raw.hitChance }),
        // Elemento e `unproperly` (#687): só dado aqui; só o `combat-v3` os lê no `sim`.
        ...(raw.element === undefined ? {} : { element: raw.element }),
        ...(raw.wieldUnproperly === undefined ? {} : { wieldUnproperly: raw.wieldUnproperly }),
        // O arremessável (#575): `breakChance` só existe sem `ammoFamily` — ver `weaponSchema`.
        ...(raw.breakChance === undefined ? {} : { breakChance: raw.breakChance }),
      };
    }
  }
  const { weapon: _rawWeapon, mitigation: _rawMitigation, reflect: _rawReflect, ...rest } = item;
  const reflect = compileReflect(item.reflect);
  return {
    ...rest,
    mitigation: compileMitigation(item.mitigation),
    ...(weapon === undefined ? {} : { weapon }),
    ...(reflect === undefined ? {} : { reflect }),
  };
}

function compileItems(
  definitions: ReadonlyMap<string, ItemDefinition>,
  families: ReadonlyMap<WeaponFamily, CompiledWeaponFamily>,
  skills: ReadonlyMap<string, Skill>,
): Map<string, CompiledItem> {
  const compiled = new Map<string, CompiledItem>();
  for (const [id, item] of definitions) compiled.set(id, compileItem(item, families, skills));
  return compiled;
}

/**
 * O perfil do golpe desarmado (CMB-05): a família `fist` com o `attack`, o alcance e o tipo
 * que `combat.player` já declarava. Os números continuam vindo do conteúdo — a família dá a
 * skill e a fórmula, o bloco `player` dá o valor base —, e o v1 é preservado bit a bit.
 *
 * A fórmula é sempre montada, mesmo sem a família `fist` no catálogo (conteúdo de teste que
 * não fala de arma): sem ela o desarmado teria poder zero, e "sem arma" é como todo personagem
 * começa. A identidade (`levelFactor`/`spread` zero, skill zero) devolve o `attackPower` puro.
 */
export function compileUnarmed(
  combat: Combat, families: ReadonlyMap<WeaponFamily, CompiledWeaponFamily>,
): WeaponProfile {
  const family = families.get('fist');
  const formula = family?.formula ?? { levelFactor: 0, spread: 0 };
  return {
    family: 'fist',
    damageType: combat.player.damageType,
    range: combat.player.attackRange,
    power: {
      base: combat.player.attackPower,
      levelFactor: formula.levelFactor,
      skillFactor: family?.skillFactor ?? 0,
      skillStartingLevel: family?.skillStartingLevel ?? 0,
      spread: formula.spread,
    },
  };
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

  const rawMonsterDefinitions = parseAll('monster', raw.monsters, monsterSchema, problems);
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
  // Os rates de monstro/boss (#691) escalam a definição COMPILADA, então a compilação espera a
  // progressão. Sem ela o boot já vai recusar; o neutro só evita erro em cascata até lá.
  const monsterDefinitions = compileMonsters(rawMonsterDefinitions, progression?.rates ?? NEUTRAL_RATES);
  const combats = parseAll('combat', raw.combat ?? [], combatSchema, problems);
  const combat = combats.get('baseline');
  // Mesma razão da base de progressão: sem coeficiente não há como resolver dano, e um
  // default em código faria o §12.1 deixar de valer no dia em que ninguém estivesse olhando.
  if (combat === undefined) {
    problems.push('combat/baseline.json ausente: sem ele não há como resolver dano');
  }
  // Perfil de compatibilidade desconhecido derruba o boot, SEM fallback (ADR 0031, CMB-02): o
  // resolver canônico não reinterpreta uma fórmula que não conhece. Um perfil novo entra por
  // ADR e por `COMBAT_PROFILES`, nunca por um valor que passou em silêncio.
  if (combat !== undefined && !COMBAT_PROFILES.has(combat.compatibilityProfile)) {
    problems.push(
      `combat/${combat.id}: perfil de compatibilidade "${combat.compatibilityProfile}" ` +
        'desconhecido — o motor não escolhe fallback (ADR 0031)',
    );
  }
  const staminas = parseAll('stamina', raw.stamina ?? [], staminaSchema, problems);
  const stamina = staminas.get('baseline');
  // O Treino (#631): opcional, como `bestiary` — um conteúdo de teste sem `training/` simplesmente
  // não tem sessão de Treino. As referências cruzadas (skill do livro, tile do boneco) são
  // conferidas mais abaixo, quando skills e mapa da Cidade já existem.
  const training = parseAll('training', raw.training ?? [], trainingSchema, problems).get('baseline');
  const bestiary = parseAll('bestiary', raw.bestiary ?? [], bestiarySchema, problems).get('baseline');
  // Os níveis do Bosstiary (#629): um documento `baseline` único, como `bestiary` — a tabela de
  // 3 raridades × 3 níveis é uma coisa só, e o `id` fixo é o que impede duas versões dela.
  const bosstiary = parseAll('bosstiary', raw.bosstiary ?? [], bosstiarySchema, problems).get('baseline');
  // O catálogo de Charms (M39-02, #602): uma entidade por charm, como `spells`/`items` — não
  // um documento `baseline` único como `bestiary` (aqui não há "marco global", só 25 fichas
  // independentes, cada uma com o próprio id).
  const charms = parseAll('charm', raw.charms ?? [], charmSchema, problems);
  const boosted = parseAll('boosted', raw.boosted ?? [], boostedSchema, problems).get('baseline');
  const loyalty = parseAll('loyalty', raw.loyalty ?? [], loyaltySchema, problems).get('baseline');
  // Ausente é ERRO pela mesma razão dos outros dois: a stamina é o TETO DE SIMULAÇÃO do
  // projeto (ADR 0001), e um default em código faria o número que sustenta a projeção de
  // custo morar onde ninguém procura por ele.
  if (stamina === undefined) {
    problems.push('stamina/baseline.json ausente: sem ele não há teto de stamina');
  }
  const parties = parseAll('party', raw.party ?? [], partySchema, problems);
  const party = parties.get('baseline');
  // Ausente é ERRO, como bot: solo é uma party de um, e a tabela é o que diz quanto vale cada
  // vocação a mais — número que o designer ajusta, e que não pode morar em código.
  if (party === undefined) {
    problems.push('party/baseline.json ausente: sem ele não há pool de XP por vocação');
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
  // O catálogo de suprimentos (§20.1): poção e runa abstratas, gold no uso.
  const supplies = parseAll('supply', raw.supplies ?? [], supplySchema, problems);
  // As sete bênçãos PvE (#570): `order` é o índice do bit em `CharacterRuntime.blessings`, e
  // precisa ser ÚNICO — duas bênçãos no mesmo bit fariam comprar uma marcar a outra como dona.
  const blessings = parseAll('blessing', raw.blessings ?? [], blessingSchema, problems);
  const blessingOrders = new Map<number, string>();
  for (const blessing of blessings.values()) {
    const owner = blessingOrders.get(blessing.order);
    if (owner !== undefined) {
      problems.push(`blessing "${blessing.id}" usa o mesmo order (${blessing.order}) de "${owner}"`);
      continue;
    }
    blessingOrders.set(blessing.order, blessing.id);
  }
  const skills = parseAll('skill', raw.skills ?? [], skillSchema, problems);
  // As famílias de arma (CMB-05) são compiladas com as skills: o `damagePerLevel` da skill
  // apontada vira o `skillFactor` da família, e rebalanceá-la rebalanceia todas as famílias.
  const weaponFamilyDefinitions = parseAll(
    'weaponFamily', raw.weaponFamilies ?? [], weaponFamilySchema, problems,
  );
  const weaponFamilies = compileWeaponFamilies(weaponFamilyDefinitions, skills);
  // Os itens crus ficam à mão para a validação de FORMA da arma (o `damage`, o `manaPerHit` e
  // o `ammoFamily` do arquivo); o compilado é o que o `sim` lê.
  const rawItems = parseAll('item', raw.items ?? [], itemSchema, problems);
  const itemDefinitions = compileItems(rawItems, weaponFamilies, skills);
  // O catálogo de MUNIÇÃO (ADR 0026 d.3): flecha e virote abstratos, gold no tiro.
  const ammunitionDefinitions = parseAll('munição', raw.ammunition ?? [], ammunitionSchema,
    problems);
  // A esfola (#626): uma entrada por MONSTRO. Cada referência é conferida aqui, no boot — um
  // monstro, uma ferramenta ou um material que não existe deixaria a esfola muda (ou, pior,
  // sortearia sem entregar nada) no meio de uma hunt.
  const skinning = parseAll('skinning', raw.skinning ?? [], skinningSchema, problems);
  for (const entry of skinning.values()) {
    const where = `skinning/${entry.id}`;
    const monster = monsterDefinitions.get(entry.id);
    if (monster === undefined) problems.push(`${where}: o monstro não existe`);
    // A janela de esfola é um PREFIXO da vida do cadáver (os primeiros estágios da cadeia de
    // decaimento): passar do `corpseTtlMs` do monstro seria esfolar um cadáver que já sumiu.
    const window = entry.stages.reduce((sum, stage) => sum + stage.durationMs, 0);
    if (monster?.corpseTtlMs !== undefined && window > monster.corpseTtlMs) {
      problems.push(
        `${where}: a janela de esfola (${String(window)} ms) passa da vida do cadáver `
          + `(corpseTtlMs ${String(monster.corpseTtlMs)})`,
      );
    }
    if (!itemDefinitions.has(entry.toolId)) problems.push(`${where}: a ferramenta "${entry.toolId}" não existe`);
    if (!itemDefinitions.has(entry.materialId)) {
      problems.push(`${where}: o material "${entry.materialId}" não existe`);
    }
  }

  // A skill de defesa (CMB-04) precisa existir E subir por bloqueio. Uma referência a skill
  // inexistente deixaria o escudo sem treinar nada; uma que sobe por outra fonte escalaria a
  // defesa e nunca subiria com o bloqueio — as duas divergências que o boot recusa.
  const defenseSkillId = combat?.defense?.skillId;
  if (defenseSkillId !== undefined) {
    const skill = skills.get(defenseSkillId);
    if (skill === undefined) {
      problems.push(
        `combat/${combat?.id ?? 'baseline'}: defense.skillId "${defenseSkillId}" não existe `
          + 'no catálogo de skills',
      );
    } else if (skill.gain.on !== 'shield-block') {
      problems.push(
        `combat/${combat?.id ?? 'baseline'}: defense.skillId "${defenseSkillId}" não sobe por `
          + `bloqueio (gain.on "${skill.gain.on}")`,
      );
    }
  }

  // O catálogo de magias do Tibia (#155, ADR 0026 decisão 5): o schema fecha a forma de cada
  // campo; o que UM campo não sabe do OUTRO é conferido aqui. Cada regra é um defeito que, sem
  // ela, subiria mudo e apareceria no meio de uma hunt como magia que não bate.
  for (const spell of spells.values()) {
    const where = `spell/${spell.id}`;
    // A vocação que a magia exige precisa existir (#156–#159): uma magia órfã subiria muda e
    // nunca seria lançada por ninguém.
    if (spell.vocationId !== undefined && !vocations.has(spell.vocationId)) {
      problems.push(`${where}: vocationId "${spell.vocationId}" não existe`);
    }
    if (spell.groupCooldownMs !== undefined && spell.group === undefined) {
      problems.push(`${where}: groupCooldownMs sem group`);
    }
    if (spell.group !== undefined && spell.groupCooldownMs === undefined) {
      problems.push(`${where}: group sem groupCooldownMs`);
    }
    // Sem primário o secundário vira o único grupo da magia, com semântica diferente da
    // documentada em combat.md — o modelo da #155 é o secundário ser o SEGUNDO livro.
    if (spell.secondaryGroup !== undefined && spell.group === undefined) {
      problems.push(`${where}: secondaryGroup sem group`);
    }
    if (spell.secondaryGroup !== undefined && spell.groupCooldownMs !== undefined
      && spell.secondaryGroup.cooldownMs < spell.groupCooldownMs) {
      problems.push(`${where}: o grupo secundário tranca por menos tempo que o primário`);
    }
    const effect = spell.effect;
    if (effect.kind === 'heal') {
      // A cura sai de UM mecanismo, como o dano (#475): o número fixo (`amount`) OU a faixa
      // escalada (`basePower` provisório e/ou a `formula` canônica). Os dois juntos é a mesma
      // ambiguidade que o dano recusa — a precedência implícita faria a cura sair errada mudo.
      const fixed = effect.amount !== undefined;
      const scaled = effect.basePower !== undefined || effect.formula !== undefined;
      if (fixed === scaled) {
        problems.push(`${where}: cura precisa de amount OU basePower/formula, um dos dois`);
      }
      // Cura em área é de GRUPO centrada no lançador (Mass Healing): forma no alvo exigiria
      // mira e alcance que a cura não tem, e a magia não acharia ninguém.
      if (effect.area !== undefined
        && (effect.area.shape !== 'circle' || effect.area.centered === 'target')) {
        problems.push(`${where}: cura em área precisa ser centrada no lançador`);
      }
      if (effect.target === 'friend' && effect.range === undefined) {
        problems.push(`${where}: cura em outro personagem precisa de range`);
      }
      if (effect.target === 'self' && effect.range !== undefined) {
        problems.push(`${where}: cura em si mesmo não tem alcance`);
      }
    }
    if (effect.kind === 'damage') {
      // O dano sai de UM mecanismo: o número fixo (`power`) OU a faixa escalada (`basePower`
      // e/ou a `formula` canônica da #474). Fixo junto de escalado é ambiguidade — qual vence
      // ninguém sabe, e a magia sairia com o dano errado em silêncio.
      const fixed = effect.power !== undefined;
      const scaled = effect.basePower !== undefined || effect.formula !== undefined;
      if (fixed === scaled) {
        problems.push(`${where}: dano precisa de power OU basePower/formula, um dos dois`);
      }
      const formula = effect.formula;
      if (formula?.scaling === 'magic' && (
        formula.attackMin !== undefined || formula.attackMax !== undefined
        || formula.skillAttackMin !== undefined || formula.skillAttackMax !== undefined)) {
        // LEVELMAGIC não recebe `attack` no Canary (#677): os dois juntos são uma transcrição
        // que misturou o callback de magic level com o de skill da arma.
        problems.push(`${where}: fórmula de magic level não tem termo de ataque de arma`);
      }
      const selfOrigin = effect.area !== undefined
        && (effect.area.shape !== 'circle' || effect.area.centered === 'caster');
      if (selfOrigin && effect.range !== undefined) {
        problems.push(`${where}: forma que sai do lançador não tem alcance`);
      }
      if (!selfOrigin && effect.range === undefined) {
        problems.push(`${where}: dano no alvo precisa de range`);
      }
    }
    // Dispel em área (#592, Cancel Invisibility) é sempre centrado no LANÇADOR, como a cura em
    // grupo: forma no alvo exigiria mira e alcance que este efeito não declara.
    if (effect.kind === 'dispel' && effect.area !== undefined
      && (effect.area.shape !== 'circle' || effect.area.centered === 'target')) {
      problems.push(`${where}: dispel em área precisa ser centrado no lançador`);
    }
    if (effect.kind === 'challenge') {
      const selfOrigin = effect.area !== undefined
        && (effect.area.shape !== 'circle' || effect.area.centered === 'caster');
      if (selfOrigin && effect.range !== undefined) {
        problems.push(`${where}: forma que sai do lançador não tem alcance`);
      }
      if (!selfOrigin && effect.range === undefined) {
        problems.push(`${where}: challenge no alvo precisa de range`);
      }
    }
    // Alvo de party (#588: Heal/Protect/Enchant/Train Party) segue a MESMA regra de
    // `target`/`range` da cura em outro personagem: quem mira além do lançador precisa de
    // alcance, e quem mira só a si mesmo não declara nenhum — nos dois sentidos, para um
    // `range` esquecido (ou sobrando) não subir mudo.
    if (effect.kind === 'heal-over-time' || effect.kind === 'buff') {
      if (effect.target === 'party' && effect.range === undefined) {
        problems.push(`${where}: alvo de party precisa de range`);
      }
      if ((effect.target === undefined || effect.target === 'self') && effect.range !== undefined) {
        problems.push(`${where}: alvo em si mesmo não tem alcance`);
      }
    }
    // O custo por tamanho da party (#588) só faz sentido ao lado de um efeito que de fato mira
    // a party: sem isso, `party-scaled` cobraria por um `n` que a magia nunca resolve, e o
    // custo real nunca bateria com o anunciado (`manaCostDisplayOf`, o `base`).
    if (typeof spell.manaCost !== 'number') {
      const targetsParty = (effect.kind === 'heal-over-time' || effect.kind === 'buff')
        && effect.target === 'party';
      if (!targetsParty) {
        problems.push(`${where}: manaCost "party-scaled" precisa de um efeito com target "party"`);
      }
    }
    // O familiar (#599, ADR 0057 d.3): o monstro precisa existir e ser `familiar` — o flag é o que
    // liga o teleporte ao mestre e a XP inteira, e uma magia que invocasse um monstro comum
    // deixaria de ser o familiar do Canary sem ninguém perceber. A vocação é obrigatória: cada
    // uma tem o SEU familiar (`FAMILIAR_ID`), e o `sim` reencontra o monstro pela vocação do
    // personagem ao entrar na hunt (o Canary recria o familiar no login).
    if (effect.kind === 'familiar') {
      const familiar = monsterDefinitions.get(effect.monsterId);
      if (familiar === undefined) {
        problems.push(`${where}: familiar.monsterId "${effect.monsterId}" não existe no catálogo de monstros`);
      } else if (!familiar.familiar) {
        problems.push(`${where}: familiar.monsterId "${effect.monsterId}" não é um monstro "familiar"`);
      } else if (typeof spell.manaCost === 'number' && familiar.manaCost !== undefined
        && familiar.manaCost !== spell.manaCost) {
        problems.push(
          `${where}: manaCost ${String(spell.manaCost)} difere do manaCost ${String(familiar.manaCost)} `
            + `do monstro "${effect.monsterId}"`,
        );
      }
      if (spell.vocationId === undefined) {
        problems.push(`${where}: o familiar exige vocationId — cada vocação tem o seu`);
      }
      if (effect.cooldownMs < effect.durationMs) {
        problems.push(`${where}: familiar.cooldownMs é menor que a duração (o Canary usa 2 × a duração)`);
      }
    }
    // Conjuração (#594, ADR 0044): o id creditado precisa existir no catálogo correspondente —
    // sem isto, a magia subiria muda, creditando carga que `useSupply`/o tiro nunca reconhecem.
    if (effect.kind === 'conjure') {
      if (effect.supplyId !== undefined && !supplies.has(effect.supplyId)) {
        problems.push(`${where}: conjure.supplyId "${effect.supplyId}" não existe no catálogo de supplies`);
      }
      if (effect.ammunitionId !== undefined && !ammunitionDefinitions.has(effect.ammunitionId)) {
        problems.push(
          `${where}: conjure.ammunitionId "${effect.ammunitionId}" não existe no catálogo de munição`,
        );
      }
    }
    // Food (#623): cada id da lista precisa ser comida DE VERDADE — item consumível com efeito
    // `food` —, senão o Food criaria na mochila um item que `use-item` recusa como `not-usable`.
    if (effect.kind === 'food') {
      for (const itemId of effect.items) {
        const item = itemDefinitions.get(itemId);
        if (item === undefined) {
          problems.push(`${where}: food.items "${itemId}" não existe no catálogo de itens`);
        } else if (item.kind !== 'consumable' || item.effect?.kind !== 'food') {
          problems.push(`${where}: food.items "${itemId}" não é comida (consumível com efeito "food")`);
        }
      }
      if (new Set(effect.items).size !== effect.items.length) {
        problems.push(`${where}: food.items repete um item — o sorteio uniforme pesaria o repetido em dobro`);
      }
    }
  }
  // Cada vocação tem UM familiar (#599): duas magias `familiar` para a mesma vocação deixariam
  // ambíguo qual delas o `sim` recria quando o personagem entra na hunt com tempo sobrando.
  const familiarSpellByVocation = new Map<string, string>();
  for (const spell of spells.values()) {
    if (spell.effect.kind !== 'familiar' || spell.vocationId === undefined) continue;
    const owner = familiarSpellByVocation.get(spell.vocationId);
    if (owner !== undefined) {
      problems.push(`spell/${spell.id}: a vocação "${spell.vocationId}" já tem o familiar "${owner}"`);
      continue;
    }
    familiarSpellByVocation.set(spell.vocationId, spell.id);
  }
  // O supply de cura (#475): a runa UH/IH sai de UM mecanismo, como a magia — `amount` fixo
  // (poção) OU `basePower`/`formula` (runa). O `mana` não entra aqui: ele sempre foi fixo.
  // A runa de ATAQUE (#476) segue a mesma regra do dano da magia: `basePower` (BP provisório) ou
  // `formula` canônica, pelo menos um. Sem nenhum o dano sairia zero em silêncio.
  // O par `target`/`range` do supply (cura e mana) copia a MESMA regra do dano da magia: um
  // efeito que alcança outro personagem precisa de alcance, e um que cura quem usa não tem
  // nenhum. Sem isto, uma poção `target: 'friend'` sem `range` subiria muda.
  for (const supply of supplies.values()) {
    const where = `supply/${supply.id}`;
    const effect = supply.effect;
    if (effect.kind === 'heal') {
      // `amountRange` (#524, a poção do Tibia) conta como "fixo" ao lado de `amount`: as duas
      // são um número SEM escalar por level/ML, ao contrário de `basePower`/`formula`.
      const fixed = effect.amount !== undefined || effect.amountRange !== undefined;
      const scaled = effect.basePower !== undefined || effect.formula !== undefined;
      if (fixed === scaled) {
        problems.push(
          `${where}: cura precisa de amount/amountRange OU basePower/formula, um dos dois`,
        );
      }
    }
    if (effect.kind === 'damage'
      && effect.basePower === undefined && effect.formula === undefined) {
      problems.push(`${where}: dano precisa de basePower ou formula`);
    }
    if (effect.kind === 'heal' || effect.kind === 'mana') {
      if (effect.target === 'friend' && effect.range === undefined) {
        problems.push(`${where}: efeito em outro personagem precisa de range`);
      }
      if (effect.target === 'self' && effect.range !== undefined) {
        problems.push(`${where}: efeito em si mesmo não tem alcance`);
      }
    }
    // A vocação que o suprimento exige precisa existir (#524, como a magia em #156-159): a
    // grande poção de mana pede Sorcerer/Druid/Paladin, e um id errado subiria mudo — recusado
    // sempre, nunca lançável, sem nenhuma pista de por quê. Só quando HÁ vocações (a mesma
    // tolerância do item, acima, e do `spellSkill`).
    if (vocations.size > 0) {
      for (const vocationId of vocationIdsOf(supply.requires.vocationId)) {
        if (!vocations.has(vocationId)) {
          problems.push(`${where}: requires.vocationId "${vocationId}" não existe`);
        }
      }
    }
    // A Animate Dead (#600) nasce um monstro do catálogo: `monsterId` errado subiria mudo e a runa
    // consumiria o cadáver (e o gold) sem invocar nada. Só quando HÁ monstros (a mesma tolerância
    // das referências acima, para o conteúdo de teste sem catálogo).
    if (effect.kind === 'animate-dead' && monsterDefinitions.size > 0
      && !monsterDefinitions.has(effect.monsterId)) {
      problems.push(`${where}: animate-dead.monsterId "${effect.monsterId}" não existe no catálogo de monstros`);
    }
    // A poção de buff (#576) aponta skill pelo id do catálogo em `skillDeltas` — como o bônus de
    // equipamento (linha ~890) e a família de arma (abaixo), pela MESMA razão: um id errado
    // bonificaria uma skill que ninguém lê, e a poção pareceria funcionar sem fazer nada.
    if (effect.kind === 'condition' && effect.condition.effect.kind === 'buff' && skills.size > 0) {
      for (const skillId of Object.keys(effect.condition.effect.skillDeltas ?? {})) {
        if (!skills.has(skillId)) {
          problems.push(`${where}: condition.effect.skillDeltas "${skillId}" não existe`);
        }
      }
    }
  }
  // A família de arma que o schema sozinho não fecha (CMB-05): ela aponta uma skill que precisa
  // existir, e a combinatória de `kind`/`resource`/`formula` é regra de domínio, não de forma.
  // `fist` é o fallback sem item: sem ela, o desarmado perderia a escala de skill.
  for (const family of weaponFamilyDefinitions.values()) {
    const where = `weaponFamily/${family.id}`;
    // A skill precisa existir — quando há skills. O conteúdo de teste sem skill nenhuma não
    // tem como conferir, e a arma bate o `attack` puro (a mesma tolerância da `spellSkill`).
    if (skills.size > 0 && !skills.has(family.skillId)) {
      problems.push(`${where}: skillId "${family.skillId}" não existe`);
    }
    if (family.kind === 'wand') {
      if (family.formula !== undefined) {
        problems.push(`${where}: wand/rod usam a faixa fixa da arma, não fórmula`);
      }
      if (family.resource !== 'mana') {
        problems.push(`${where}: wand/rod gastam mana`);
      }
    } else {
      if (family.formula === undefined) {
        problems.push(`${where}: família "${family.kind}" precisa de fórmula`);
      }
      if (family.resource !== 'none') {
        problems.push(`${where}: família "${family.kind}" não gasta recurso`);
      }
    }
  }
  if (weaponFamilies.size > 0 && !weaponFamilies.has('fist')) {
    problems.push('weaponFamilies: falta a família "fist" — é o fallback do golpe desarmado');
  }
  // Arma sem `weapon` é corpo a corpo de alcance 1 (#152), e o tipo de dano default de cada
  // `kind` (CMB-03) é resolvido em `compileItems`: corpo a corpo e distância são `physical`,
  // wand e rod são `arcane` — o `kind: magic` do v1. O default NÃO mora no schema, porque o
  // schema de um campo opcional não sabe do `kind`.
  //
  // A munição é ABSTRATA (ADR 0026 d.3): o catálogo `ammunition/` existe de novo, e a arma de
  // distância confere a família contra ele — nunca contra um item de munição.
  //
  // A forma do item que o schema sozinho não fecha (ADR 0026): a mochila é o único item que
  // se veste nas costas, e o que se veste nas costas é a mochila; e só arma ocupa as duas
  // mãos. Um `back` numa espada equiparia a espada nas costas sem nada acusar.
  //
  // A validação olha o item CRU: `damage`, `manaPerHit` e `ammoFamily` só existem no arquivo —
  // o compilado já virou `fixedDamage`/perfil. A família resolvida (declarada ou default do
  // `kind`) é conferida contra o catálogo.
  for (const item of rawItems.values()) {
    // Como a arma bate é da arma, e só dela (#152): `weapon` sem `kind: 'weapon'` é um
    // capacete com alcance; arma sem `weapon` seria uma arma que o motor não sabe usar.
    if (item.kind !== 'weapon' && item.weapon !== undefined) {
      problems.push(`item "${item.id}": "weapon" só faz sentido em arma`);
    }
    const weapon = item.weapon;
    if (weapon !== undefined) {
      // A família é DADO (DT-01): ela precisa existir e ser coerente com o `kind` da arma. E
      // `fist` não é arma — é o fallback de quem está desarmado.
      const familyId = weapon.family ?? defaultFamilyForKind(weapon.kind);
      if (familyId === 'fist') {
        problems.push(`item "${item.id}": "fist" é o fallback desarmado e não existe como arma`);
      } else {
        const family = weaponFamilies.get(familyId);
        if (family === undefined) {
          problems.push(`item "${item.id}": a família "${familyId}" não existe em weapon-families/`);
        } else if (family.kind !== weapon.kind) {
          problems.push(
            `item "${item.id}": família "${familyId}" é "${family.kind}", e a arma é "${weapon.kind}"`,
          );
        }
      }
      // Toda arma `distance` é OU lançador (`ammoFamily`, munição por família) OU arremessável
      // (`breakChance`, #575 — o item É o próprio projétil): nunca os dois, nunca nenhum. Sem
      // isto, um item de distância sem nenhum campo bateria o `attack` de si mesmo (base do
      // arremessável) sem nunca quebrar, e um com os dois debitaria gold E consumiria estoque no
      // mesmo tiro.
      if (weapon.kind === 'distance') {
        if (weapon.ammoFamily !== undefined && weapon.breakChance !== undefined) {
          problems.push(`item "${item.id}": arma de distância não pode ter "ammoFamily" (lançador) E "breakChance" (arremessável) ao mesmo tempo`);
        } else if (weapon.ammoFamily === undefined && weapon.breakChance === undefined) {
          problems.push(`item "${item.id}": arma de distância precisa de "ammoFamily" (lançador) ou "breakChance" (arremessável)`);
        }
        if (weapon.ammoFamily !== undefined
          && ![...ammunitionDefinitions.values()].some((ammo) => ammo.family === weapon.ammoFamily)) {
          problems.push(`item "${item.id}": a família "${weapon.ammoFamily}" não tem munição no catálogo`);
        }
      }
      if (weapon.kind === 'wand' && (weapon.manaPerHit === undefined || weapon.damage === undefined)) {
        problems.push(`item "${item.id}": wand precisa de "manaPerHit" e "damage"`);
      }
      if (weapon.kind !== 'distance' && weapon.ammoFamily !== undefined) {
        problems.push(`item "${item.id}": só arma de distância tem "ammoFamily"`);
      }
      if (weapon.kind !== 'distance' && weapon.breakChance !== undefined) {
        problems.push(`item "${item.id}": só arma de distância tem "breakChance"`);
      }
      if (weapon.kind !== 'wand' && (weapon.manaPerHit !== undefined || weapon.damage !== undefined)) {
        problems.push(`item "${item.id}": só wand tem "manaPerHit" e "damage"`);
      }
      if (weapon.damage !== undefined && weapon.damage.min > weapon.damage.max) {
        problems.push(`item "${item.id}": damage.min maior que damage.max`);
      }
      // O elemento da arma (#687) só entra no golpe corpo a corpo; munição elemental é a #575.
      if (weapon.element !== undefined && weapon.kind !== 'melee') {
        problems.push(`item "${item.id}": element só vale em arma corpo a corpo`);
      }
    }
    if (item.kind === 'container' && item.slot !== 'back') {
      problems.push(`item "${item.id}": container tem de ter slot "back" — é a mochila`);
    }
    if (item.slot === 'back' && item.kind !== 'container') {
      problems.push(`item "${item.id}": só container se veste em "back"`);
    }
    if (item.twoHanded && item.kind !== 'weapon') {
      problems.push(`item "${item.id}": twoHanded só faz sentido em arma`);
    }
    // Defesa (CMB-04) só nas combinações aprovadas: escudo, ou arma corpo a corpo — de uma ou
    // de duas mãos (#687: o `Player::getDefense` do Canary conta a `defense` de qualquer arma que
    // não seja escudo, e a Broadsword tem 23). Bow e wand/rod não têm defesa residual. Só o
    // `combat-v3` lê a defesa da arma de duas mãos (`#playerDefenseV3`); o `defenseSource` do
    // v1/v2 continua ignorando-a, bit a bit (ADR 0031).
    const melee = item.kind === 'weapon' && (item.weapon?.kind ?? 'melee') === 'melee';
    if (item.defense > 0 && item.kind !== 'shield' && !melee) {
      problems.push(
        `item "${item.id}": defense só vale em escudo ou arma corpo a corpo`,
      );
    }
    // extraDefense/spellbook/quiver (#549, M30-02): a mesma disciplina do `defense` acima —
    // um campo que só a conta do JOGADOR lê não pode aparecer num item que não é arma ou
    // escudo, porque o schema de campo opcional não sabe do `kind`.
    if (item.extraDefense > 0 && item.kind !== 'weapon') {
      problems.push(`item "${item.id}": extraDefense só faz sentido em arma`);
    }
    // O bond elemental (#627) é o da ARMA na mão (`casterPlayer->getWeapon(true)`, `combat.cpp:163`)
    // — a mesma disciplina do `extraDefense`: fora de arma seria um número que nada lê.
    if (item.elementalBond !== undefined && item.kind !== 'weapon') {
      problems.push(`item "${item.id}": elementalBond só faz sentido em arma`);
    }
    // A capacidade de magic shield (#627) é `Abilities` do Canary: só vale em peça que se veste,
    // como o `imbuementSlots` — num item sem slot ela nunca seria somada.
    if (item.bonuses?.magicShieldCapacity !== undefined && item.slot === undefined) {
      problems.push(`item "${item.id}": bonuses.magicShieldCapacity só vale em item que se veste`);
    }
    if ((item.spellbook || item.quiver) && item.kind !== 'shield') {
      problems.push(`item "${item.id}": spellbook/quiver só fazem sentido em escudo`);
    }
    if (item.spellbook && item.quiver) {
      problems.push(`item "${item.id}": spellbook e quiver são exclusivos — o escudo é um ou outro`);
    }
    // O bônus de perfect shot (#575) só faz sentido na peça da mão secundária — a mesma
    // disciplina de `spellbook`/`quiver` acima, e independente dos dois (uma aljava comum tem
    // `quiver: true` sem `perfectShot`; a eldritch quiver tem os dois).
    if (item.perfectShot !== undefined && item.kind !== 'shield') {
      problems.push(`item "${item.id}": "perfectShot" só faz sentido em escudo`);
    }
    if (item.ringEffect !== undefined && item.kind !== 'ring') {
      problems.push(`item "${item.id}": "ringEffect" só faz sentido em anel`);
    }
    // A skill que a exercise weapon treina (#631) tem de existir — como o bônus de skill abaixo:
    // uma skill que ninguém lê deixaria o golpe rendendo tries para lugar nenhum.
    if (item.exercise !== undefined && skills.size > 0 && !skills.has(item.exercise.skillId)) {
      problems.push(`item "${item.id}": exercise.skillId "${item.exercise.skillId}" não existe`);
    }
    // A vocação que o item exige precisa existir (#524, como a magia em #156-159): a Magic
    // Plate Armor pede Knight/Paladin, e um id errado tornaria o item ETERNAMENTE inacessível
    // sem nenhuma pista de por quê — ninguém tem a vocação que não existe. Só quando HÁ
    // vocações — o conteúdo de teste sem nenhuma (fixture sem sistema de vocação) não tem como
    // conferir, a mesma tolerância do `spellSkill` (linha ~790).
    if (vocations.size > 0) {
      for (const vocationId of vocationIdsOf(item.requires.vocationId)) {
        if (!vocations.has(vocationId)) {
          problems.push(`item "${item.id}": requires.vocationId "${vocationId}" não existe`);
        }
      }
    }
    // O bônus de skill do item (#524) aponta uma skill que precisa existir — como a família de
    // arma aponta a dela (linha ~620). Sem a conferência, "hat of the mad" bonificaria uma skill
    // que ninguém lê, e o item pareceria funcionar sem fazer nada.
    // Skill repetida no mesmo item (#688) seria dois números para a mesma coisa: o importador
    // colapsa sword/axe/club em `melee` (#521) gravando uma entrada só, com o maior valor.
    const bonusSkills = new Set<string>();
    for (const bonus of item.bonuses?.skills ?? []) {
      if (bonusSkills.has(bonus.skillId)) {
        problems.push(`item "${item.id}": bonuses.skills repete "${bonus.skillId}"`);
      }
      bonusSkills.add(bonus.skillId);
      if (skills.size > 0 && !skills.has(bonus.skillId)) {
        problems.push(`item "${item.id}": bonuses.skills.skillId "${bonus.skillId}" não existe`);
      }
    }
  }
  // A munição é abstrata (ADR 0026 d.3): NÃO existe munição grátis por família — cada tiro
  // debita `price` do gold, e o schema exige `price > 0`. Não há o que exigir aqui.
  // O kit de nascimento (#153): item que existe, no slot dele, sem exigir nada — o personagem
  // nasce level 1 e sem vocação —, e um por slot, que é o que o índice único de
  // `item_instance` vai impor de qualquer jeito; melhor reprovar no boot do que na criação.
  const kitSlots = new Set<string>();
  let kitTwoHanded = false;
  // Container tem lugares, e só ele (#160): `initialSlots` fora de `kind: 'container'` é um
  // número que ninguém lê; container sem ele é uma mochila em que nada cabe.
  for (const item of itemDefinitions.values()) {
    if (item.kind === 'container' && item.initialSlots === undefined) {
      problems.push(`item "${item.id}": container precisa de initialSlots`);
    }
    if (item.kind !== 'container' && item.initialSlots !== undefined) {
      problems.push(`item "${item.id}": initialSlots só vale em kind "container"`);
    }
    // Slot de imbuement (#604, ADR 0046) só em peça que se VESTE e não empilha: o imbuement é
    // estado da instância, e instância com overlay não empilha (d.3) — num item empilhável o
    // slot seria um número que nenhuma pilha poderia usar.
    if (item.imbuementSlots !== undefined && (item.slot === undefined || item.stackable)) {
      problems.push(`item "${item.id}": imbuementSlots só vale em item que se veste e não empilha`);
    }
    // A proteção contra a perda de item (#571) é a do colar: `Blessings.PlayerDeath` só olha o
    // slot do pescoço (`CONST_SLOT_NECKLACE`), então a flag em qualquer outro slot seria um
    // número que a morte nunca lê — e pareceria proteção sem proteger.
    if (item.protectsOnDeath && item.slot !== 'neck') {
      problems.push(`item "${item.id}": protectsOnDeath só vale em item de slot "neck"`);
    }
  }
  // A perda de item na morte (#571): a mochila de reposição tem de ser uma mochila de verdade —
  // `kind: 'container'` que veste nas costas —, senão a morte entregaria um item que nem cabe no
  // slot dela, ou que não abre lugar nenhum para o loot.
  const itemLoss = progression?.deathPenalty.itemLoss;
  if (itemLoss !== undefined) {
    const replacement = itemDefinitions.get(itemLoss.replacementContainerId);
    if (replacement === undefined) {
      problems.push(
        `progression: deathPenalty.itemLoss.replacementContainerId "${itemLoss.replacementContainerId}" não existe`,
      );
    } else if (replacement.kind !== 'container' || replacement.slot !== 'back') {
      problems.push(
        `progression: "${replacement.id}" (replacementContainerId) precisa ser um container de slot "back"`,
      );
    }
  }
  for (const piece of progression?.startingKit ?? []) {
    const item = itemDefinitions.get(piece.itemId);
    if (item === undefined) {
      problems.push(`progression: o kit de nascimento aponta item "${piece.itemId}", que não existe`);
      continue;
    }
    if (item.slot !== piece.slot) {
      problems.push(`progression: "${piece.itemId}" do kit se veste em "${item.slot ?? 'nenhum'}", não em "${piece.slot}"`);
    }
    if (item.requires.level !== undefined || item.requires.vocationId !== undefined) {
      problems.push(`progression: "${piece.itemId}" do kit exige level ou vocação, e o personagem nasce sem`);
    }
    if (kitSlots.has(piece.slot)) {
      problems.push(`progression: o kit de nascimento tem duas peças em "${piece.slot}"`);
    }
    kitSlots.add(piece.slot);
    if (item.twoHanded) kitTwoHanded = true;
  }
  // As duas mãos (#152): o kit é gravado direto no banco, sem passar por `Inventory.equip`, então
  // a regra `hands-full` precisa valer AQUI — senão todo personagem nasceria num estado que
  // nenhum caminho de equipar alcança.
  if (kitTwoHanded && kitSlots.has('shield')) {
    problems.push('progression: o kit de nascimento não pode ter arma de duas mãos e escudo ao mesmo tempo');
  }
  // A skill que escala a magia de cada vocação (#155) precisa existir — quando há skills. O
  // conteúdo de teste sem skills não tem como conferir, e não precisa: `levelOf` de skill
  // desconhecida é zero. `SPELL_SKILL_WEAPON` (#567) é a única exceção: é a sentinela "skill da
  // arma equipada", nunca o id de uma skill do catálogo — não há `skills/weapon.json` para
  // conferir contra.
  if (skills.size > 0) {
    for (const vocation of vocations.values()) {
      if (vocation.spellSkill !== SPELL_SKILL_WEAPON && !skills.has(vocation.spellSkill)) {
        problems.push(`vocation/${vocation.id}: spellSkill "${vocation.spellSkill}" não existe`);
      }
    }
  }
  // A arma de cada vocação (#154, ADR 0026 decisão 3): existe, é arma, e exige a própria
  // vocação. Sem a última, "a arma da vocação" seria uma arma que qualquer um veste.
  for (const vocation of vocations.values()) {
    if (vocation.startingWeaponItemId === undefined) continue;
    const weapon = itemDefinitions.get(vocation.startingWeaponItemId);
    if (weapon === undefined) {
      problems.push(`vocation/${vocation.id}: a arma inicial "${vocation.startingWeaponItemId}" não existe`);
      continue;
    }
    if (weapon.kind !== 'weapon') {
      problems.push(`vocation/${vocation.id}: "${weapon.id}" não é arma`);
    }
    if (weapon.requires.vocationId !== vocation.id) {
      problems.push(`vocation/${vocation.id}: "${weapon.id}" precisa exigir a própria vocação`);
    }
  }
  // O kit inicial de cada vocação (#496): item que existe, no slot declarado (quando o é),
  // exigindo no máximo a própria vocação — o escudo do kit veste em qualquer um —, e um por
  // slot, porque a segunda peça do mesmo slot é declaração morta: ela nasce na mochila e o
  // slot declarado mente. Arma de duas mãos com escudo NÃO é recusada: o kit do Paladin é
  // exatamente isso, e o `Inventory.equip` dá o estado certo (escudo na mochila).
  for (const vocation of vocations.values()) {
    const kitSlots = new Set<string>();
    for (const piece of vocation.startingKit) {
      const item = itemDefinitions.get(piece.itemId);
      if (item === undefined) {
        problems.push(`vocation/${vocation.id}: o kit inicial aponta item "${piece.itemId}", que não existe`);
        continue;
      }
      if (piece.slot !== undefined && item.slot !== piece.slot) {
        problems.push(
          `vocation/${vocation.id}: "${piece.itemId}" do kit se veste em "${item.slot ?? 'nenhum'}", não em "${piece.slot}"`,
        );
      }
      if (
        item.requires.vocationId !== undefined
        && item.requires.vocationId !== vocation.id
      ) {
        problems.push(`vocation/${vocation.id}: "${piece.itemId}" do kit exige a vocação "${item.requires.vocationId}"`);
      }
      const slot = piece.slot ?? item.slot;
      if (slot !== undefined && kitSlots.has(slot)) {
        problems.push(`vocation/${vocation.id}: o kit tem duas peças em "${slot}"`);
      }
      if (slot !== undefined) kitSlots.add(slot);
    }
    // Arma legada e kit juntos (#496): a arma já é peça do kit, e os dois declarados em
    // desacordo são duas verdades para o mesmo grant — o host prefere o kit, e o campo ficaria
    // só a mentira de exibição. O boot exige que a arma declarada seja uma das peças.
    if (vocation.startingWeaponItemId !== undefined && vocation.startingKit.length > 0
      && !vocation.startingKit.some((piece) => piece.itemId === vocation.startingWeaponItemId)) {
      problems.push(
        `vocation/${vocation.id}: a arma inicial "${vocation.startingWeaponItemId}" não é peça do startingKit — declare um ou o outro`,
      );
    }
  }
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
  let appearances = appearanceTables.get('baseline');
  // `appearances/generated/scenery.json` (#727, ADR 0050 d.1) é uma tabela SEPARADA — `pnpm
  // map:import` a escreve por mapa, e nunca toca `baseline.json`. O que o `sim`/`server` leem é
  // um `appearances` só, então toda tabela que NÃO é `baseline` contribui sua seção `scenery`
  // por cima dela — mesma chave em duas tabelas é o último arquivo (ordem alfabética) vencendo,
  // como o resto do conteúdo.
  if (appearances !== undefined) {
    let scenery = appearances.scenery;
    for (const [id, table] of appearanceTables) {
      if (id === 'baseline' || Object.keys(table.scenery).length === 0) continue;
      scenery = { ...scenery, ...table.scenery };
    }
    if (scenery !== appearances.scenery) appearances = { ...appearances, scenery };
  }
  if (appearances === undefined
    && (monsterDefinitions.size > 0 || itemDefinitions.size > 0
      || ammunitionDefinitions.size > 0)) {
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
    // O projétil da wand e do rod (#152): de um lado só, como `spells` — arma sem linha bate
    // sem desenhar; linha para item que não é arma, ou que não existe, é órfã.
    for (const id of Object.keys(appearances.weapons)) {
      const item = itemDefinitions.get(id);
      if (item?.kind === 'weapon') continue;
      problems.push(`appearances.weapons mapeia "${id}", que não é arma do conteúdo`);
    }
    // A forma ativa do item vestido (#689): de um lado só — item sem linha veste com a aparência
    // de sempre —, mas a linha órfã, e a de item que não se veste, é recusada.
    for (const id of Object.keys(appearances.equippedItems)) {
      const item = itemDefinitions.get(id);
      if (item?.slot !== undefined) continue;
      problems.push(`appearances.equippedItems mapeia "${id}", que não é item vestível do conteúdo`);
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

  const monsters: ReadonlyMap<string, Monster> = withCorpses(resolveAppearance(
    'monstro', 'monsters', monsterDefinitions, appearances?.monsters, 'outfitId', problems),
  appearances?.corpses, problems);
  const items: ReadonlyMap<string, Item> = withEquippedAppearance(resolveAppearance(
    'item', 'items', itemDefinitions, appearances?.items, 'appearanceId', problems),
  appearances?.equippedItems);
  // A tabela `appearances.ammunition` guarda o ÍCONE e o PROJÉTIL de cada munição (#152, ADR
  // 0026 d.3); `resolveAmmunition` confere os dois lados — a munição sem linha e a linha órfã.
  const ammunition: ReadonlyMap<string, Ammunition> = resolveAmmunition(
    ammunitionDefinitions, appearances?.ammunition, problems);

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

  // Os mundos (#829, OW-08, ADR 0060): o schema fecha a forma do arquivo; o que ele não vê — o
  // mapa existir e ser importado, e o templo cair num tile andável do recorte — é conferido aqui,
  // no boot. O templo é coordenada ABSOLUTA do Tibia, e o chão é local: traduzir pelo
  // `source.region` é o que `absoluteToLocal` faz. Templo em parede é o personagem que nasce, ou
  // volta ao morrer, preso — e quebra AQUI, como o `entryPoint` da Cidade, e não no jogador.
  const worldData = parseAll('world', raw.worlds ?? [], worldSchema, problems);
  const worlds = new Map<string, World>();
  for (const world of worldData.values()) {
    const where = `world "${world.id}"`;
    // A existência se confere contra a DEFINIÇÃO, como as referências abaixo: um mapa que não
    // montou já gerou o próprio problema, e repeti-lo aqui como "inexistente" seria ruído.
    if (!mapData.has(world.map)) {
      problems.push(`${where}: map "${world.map}" não existe no conteúdo`);
      continue;
    }
    const map = maps.get(world.map);
    if (map === undefined) continue;
    if (map.source === undefined) {
      problems.push(
        `${where}: o mapa "${map.id}" não tem source.region — só um mapa importado do OTBM tem a ` +
          'origem que traduz a coordenada absoluta do templo para um tile',
      );
      continue;
    }
    const townIds = new Set<string>();
    for (const town of world.towns) {
      const at = `${where}, cidade "${town.id}"`;
      if (townIds.has(town.id)) problems.push(`${at}: id de cidade duplicado`);
      townIds.add(town.id);
      const { x, y, z } = town.temple;
      const local = absoluteToLocal(map, town.temple);
      if (local === undefined) {
        const region = map.source.region;
        problems.push(
          `${at}: templo (${x},${y},${z}) cai fora do recorte do mapa "${map.id}" ` +
            `(x ${region.x[0]}..${region.x[1]}, y ${region.y[0]}..${region.y[1]}, ` +
            `z ${region.z[0]}..${region.z[1]})`,
        );
      } else if (isBlocked(map, local.x, local.y, local.z)) {
        problems.push(
          `${at}: templo (${x},${y},${z}), no tile (${local.x},${local.y},${local.z}) do mapa ` +
            `"${map.id}", está em parede ou num andar sem chão — ninguém andaria dali`,
        );
      }
    }
    worlds.set(world.id, world);
  }

  // O Treino (#631, ADR 0059): as skills do livro existem, e o tile em que o personagem fica é
  // andável no mapa da Cidade — a mesma disciplina do `entryPoint`, reprovando no boot e não na
  // primeira sessão de Treino. Só com Cidade e skills carregadas: o conteúdo de teste sem elas não
  // tem contra o que conferir (a mesma tolerância de `spellSkill`).
  if (training !== undefined) {
    const offlineSkills = new Set<string>();
    for (const entry of training.offline.skills) {
      if (offlineSkills.has(entry.skillId)) {
        problems.push(`training: offline.skills repete "${entry.skillId}"`);
      }
      offlineSkills.add(entry.skillId);
      if (skills.size > 0 && !skills.has(entry.skillId)) {
        problems.push(`training: offline.skills "${entry.skillId}" não existe em skills/`);
      }
    }
    if (training.offline.spendCapMs.free > training.offline.bankCapMs
      || training.offline.spendCapMs.premium > training.offline.bankCapMs) {
      problems.push('training: offline.spendCapMs não pode passar do teto do banco (bankCapMs)');
    }
    if (city !== undefined) {
      const { stand, dummy } = training.place;
      if (isBlocked(city, stand.x, stand.y, stand.z)) {
        problems.push(
          `training: place.stand (${stand.x},${stand.y},${stand.z}) está fora do mapa da Cidade ` +
            `"${city.id}", ou em parede — ninguém teria onde treinar`,
        );
      }
      if (Math.max(Math.abs(stand.x - dummy.x), Math.abs(stand.y - dummy.y)) > 1 || stand.z !== dummy.z) {
        problems.push('training: place.stand tem de ser adjacente ao boneco (place.dummy), no mesmo andar');
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
  //
  // Loot de SUPPLY e de MUNIÇÃO (#520) é a mesma conferência do outro lado: a linha declara
  // exatamente um de `itemId`/`supplyId`/`ammunitionId` (o schema já garante isso), e cada um
  // confere contra o catálogo dele.
  //
  // Numa tabela `canary` (#685), a linha de ITEM com `max > 1` precisa de item empilhável: o
  // `generateLootRoll` do Canary só tira a quantidade da rolagem quando o item é `stackable`, e
  // dá 1 no resto — aceitar a linha faria o Draconya criar uma pilha que o Canary nunca cria.
  // Supply, munição e gold são sempre pilha e não passam por isso.
  for (const monster of monsterDefinitions.values()) {
    const canary = monster.loot.rollModel === 'canary';
    for (const line of monster.loot.items) {
      if (line.itemId !== undefined) {
        const item = itemDefinitions.get(line.itemId);
        if (item !== undefined) {
          if (canary && line.max > 1 && !item.stackable) {
            problems.push(
              `monstro "${monster.id}": loot.items "${line.itemId}" tem max > 1 mas não empilha `
                + '(o Canary daria 1)',
            );
          }
          continue;
        }
        problems.push(
          `monstro "${monster.id}": loot.items referencia item "${line.itemId}", que não existe `
            + 'no catálogo',
        );
      } else if (line.supplyId !== undefined) {
        if (supplies.has(line.supplyId)) continue;
        problems.push(
          `monstro "${monster.id}": loot.items referencia supply "${line.supplyId}", que não `
            + 'existe no catálogo',
        );
      } else if (line.ammunitionId !== undefined) {
        if (ammunitionDefinitions.has(line.ammunitionId)) continue;
        problems.push(
          `monstro "${monster.id}": loot.items referencia munição "${line.ammunitionId}", que não `
            + 'existe no catálogo',
        );
      }
    }
  }

  // As janelas de Animate Dead do cadáver (#600) vivem DENTRO da vida dele: sem `corpseTtlMs` não
  // há cadáver, e uma janela que passa do prazo (ou que se sobrepõe à anterior) é uma transcrição
  // errada da cadeia `decayTo` — o `sim` a leria como um cadáver animável depois de sumir.
  for (const monster of monsterDefinitions.values()) {
    const windows = monster.corpseAnimatable;
    if (windows === undefined) continue;
    if (monster.corpseTtlMs === undefined) {
      problems.push(`monstro "${monster.id}": corpseAnimatable sem corpseTtlMs`);
      continue;
    }
    let previousEnd = 0;
    for (const window of windows) {
      if (window.fromMs < previousEnd || window.untilMs > monster.corpseTtlMs) {
        problems.push(
          `monstro "${monster.id}": corpseAnimatable ${window.fromMs}-${window.untilMs} fora de ordem `
            + `ou além de corpseTtlMs (${monster.corpseTtlMs})`,
        );
      }
      previousEnd = window.untilMs;
    }
  }

  // A invocação (#546): cada entrada aponta um monstro que precisa existir no catálogo — a
  // mesma referência cruzada de `loot.items` acima, agora contra `monsterDefinitions` (o
  // Slime pode invocar a si mesmo; o boot não recusa self-reference, o TFS também não). E o
  // `monsterId` precisa ser único dentro da lista: duas entradas do mesmo nome dividiriam o
  // MESMO `(kind, subject)` na fila do `sim` — uma sobrescreveria o vencimento da outra, e o
  // erro certo é recusar no boot, não descobrir num monstro que para de invocar pela metade.
  for (const monster of monsterDefinitions.values()) {
    const seenSummons = new Set<string>();
    for (const entry of monster.summons?.entries ?? []) {
      if (seenSummons.has(entry.monsterId)) {
        problems.push(
          `monstro "${monster.id}": summons.entries "${entry.monsterId}" duplicada`,
        );
      }
      seenSummons.add(entry.monsterId);
      if (monsterDefinitions.has(entry.monsterId)) continue;
      problems.push(
        `monstro "${monster.id}": summons.entries referencia monstro "${entry.monsterId}", que `
          + 'não existe no catálogo',
      );
    }
  }

  // A ficha de Bestiário por monstro (#520): a chave precisa ser um monstro que existe — a
  // mesma referência cruzada de `loot.items` acima —, e o `class` da ficha precisa bater com o
  // `class` do PRÓPRIO monstro quando ele o declara: duas fontes da mesma categoria divergiriam
  // na primeira mudança em uma delas, e ninguém perceberia (a categoria do Cyclopedia é a do
  // monstro, §"A classe do monstro" acima).
  if (bestiary !== undefined) {
    for (const [monsterId, entry] of Object.entries(bestiary.entries)) {
      const monster = monsterDefinitions.get(monsterId);
      if (monster === undefined) {
        problems.push(
          `bestiary/baseline.json: entries referencia monstro "${monsterId}", que não existe `
            + 'no catálogo',
        );
        continue;
      }
      if (monster.class !== undefined && monster.class !== entry.class) {
        problems.push(
          `bestiary/baseline.json: entries."${monsterId}".class é "${entry.class}", e o monstro `
            + `declara "${monster.class}"`,
        );
      }
    }
  }

  // O boss (#629): `bosstiary` sem `boss` seria um monstro que conta no Bosstiary e, ao mesmo
  // tempo, no Bestiário e nos rates de monstro comum — o `isBoss` do Canary é "tem bloco
  // bosstiary", e a flag existe para o resto do motor não precisar olhar o bloco.
  // O contador é do `raceId`, e variantes de um boss o compartilham (`monsterSchema.bosstiary`):
  // o NÍVEL de um contador compartilhado sai de UMA raridade, então duas raridades para o mesmo
  // `raceId` fariam o nível depender de qual variante foi abatida por último.
  const rarityByRaceId = new Map<number, string>();
  for (const monster of monsterDefinitions.values()) {
    if (monster.bosstiary === undefined) continue;
    if (!monster.boss) {
      problems.push(`monstro "${monster.id}": declara bosstiary e não declara boss: true`);
    }
    const seen = rarityByRaceId.get(monster.bosstiary.raceId);
    if (seen === undefined) rarityByRaceId.set(monster.bosstiary.raceId, monster.bosstiary.rarity);
    else if (seen !== monster.bosstiary.rarity) {
      problems.push(
        `monstro "${monster.id}": bosstiary.raceId ${String(monster.bosstiary.raceId)} é compartilhado `
          + `com um boss de raridade "${seen}", e este declara "${monster.bosstiary.rarity}"`,
      );
    }
  }

  // As abilities DECLARADAS (CMB-06, área estendida em #518), conferidas no arquivo CRU — o
  // compilado já tem a básica sintetizada, e validá-lo reprovaria todo monstro legado pelo id
  // reservado. O `basic` é do BOOT; a duplicata tornaria a escolha por id ambígua. `wave`, `rows`
  // (#679) e `beam` saem da DIREÇÃO do lançador para o alvo (`facingDirection`, recalculada a cada golpe
  // — o monstro não guarda direção entre golpes); `cross`/`cleave` continuam fora porque nenhum
  // monstro do recorte precisa deles ainda.
  const MONSTER_ABILITY_AREA_SHAPES = new Set(['circle', 'wave', 'rows', 'beam']);
  for (const monster of rawMonsterDefinitions.values()) {
    const seenAbilities = new Set<string>();
    for (const ability of monster.abilities ?? []) {
      if (ability.id === BASIC_ABILITY_ID) {
        problems.push(`monstro "${monster.id}": o id de ability "${BASIC_ABILITY_ID}" é reservado ao boot`);
      }
      if (seenAbilities.has(ability.id)) {
        problems.push(`monstro "${monster.id}": ability "${ability.id}" duplicada`);
      }
      seenAbilities.add(ability.id);
      const area = ability.target.area;
      if (area !== undefined && !MONSTER_ABILITY_AREA_SHAPES.has(area.shape)) {
        problems.push(
          `monstro "${monster.id}": ability "${ability.id}" usa área "${area.shape}", e o ` +
            'monstro só lança `circle`, `wave`, `rows` ou `beam`',
        );
      }
      // O campo (CMB-07) segue a regra ANTERIOR da área: só `circle`. `wave`/`beam` são da
      // ability em si (#518, o ataque que sai do monstro); o campo que ela deixa no chão
      // continua centrado no alvo, como sempre — estender o campo fica para quem precisar.
      if (ability.field !== undefined && ability.field.shape.shape !== 'circle') {
        problems.push(
          `monstro "${monster.id}": o campo da ability "${ability.id}" usa forma ` +
            `"${ability.field.shape.shape}", e o monstro só deixa círculo`,
        );
      }
    }
  }

  // Referência cruzada: validar formato não basta. Um ponto de spawn apontando monstro
  // inexistente passa em qualquer schema e só falha quando alguém entra na hunt (#583, ADR
  // 0039 — toda hunt nasce dos pontos de spawn da rota, não de uma composição por dificuldade).
  for (const hunt of hunts.values()) {
    const route = routes.get(hunt.routeId);
    if (route === undefined) continue;
    for (const [index, point] of route.spawnPoints.entries()) {
      const monsterIds = point.monsterId !== undefined
        ? [point.monsterId]
        : (point.monsters ?? []).map((entry) => entry.monsterId);
      for (const monsterId of monsterIds) {
        if (!monsterDefinitions.has(monsterId)) {
          problems.push(
            `hunt "${hunt.id}": rota "${hunt.routeId}" ponto ${String(index)} referencia ` +
              `monstro inexistente "${monsterId}"`,
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
    ...(training?._open === undefined ? [] : [`training/${training.id}: ${training._open}`]),
    ...(party?._open === undefined ? [] : [`party/${party.id}: ${party._open}`]),
    ...(bestiary?._open === undefined ? [] : [`bestiary/${bestiary.id}: ${bestiary._open}`]),
    ...(bosstiary?._open === undefined ? [] : [`bosstiary/${bosstiary.id}: ${bosstiary._open}`]),
    // `boosted` não tem `_open`: a hora de virada não é um número disputado do PRD, é
    // configuração de operação — não pede uma seção de `docs/product` para justificar.
    ...(loyalty?._open === undefined ? [] : [`loyalty/${loyalty.id}: ${loyalty._open}`]),
    ...openOf('spell', spells),
    ...openOf('charm', charms),
    ...openOf('supply', supplies),
    ...openOf('blessing', blessings),
    ...openOf('skill', skills),
    ...openOf('item', items),
    ...openOf('munição', ammunition),
    ...openOf('weaponFamily', weaponFamilyDefinitions),
  ];

  // O perfil desarmado (CMB-05) sai da família `fist` com o bloco `player`. Se o combate
  // faltar, os problemas acima já derrubam o boot antes de alguém ler este valor — o objeto
  // neutro só evita um `undefined` no meio da montagem.
  const unarmed: WeaponProfile = combat === undefined
    ? { family: 'fist', damageType: 'physical', range: 1 }
    : compileUnarmed(combat, weaponFamilies);

  const content: Content = {
    version: computeVersion(raw),
    bot: bot as BotLimits,
    spells,
    supplies,
    blessings,
    skills,
    items,
    ammunition,
    weaponFamilies,
    unarmed,
    monsters,
    hunts,
    vocations,
    progression: progression as Progression,
    combat: combat as Combat,
    stamina: stamina as Stamina,
    ...(training === undefined ? {} : { training }),
    party: party as PartyConfig,
    ...(bestiary === undefined ? {} : { bestiary }),
    ...(bosstiary === undefined ? {} : { bosstiary }),
    charms,
    skinning,
    ...(boosted === undefined ? {} : { boosted }),
    ...(loyalty === undefined ? {} : { loyalty }),
    maps,
    routes,
    worlds,
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
    const rejected = validateBotConfig(defaultConfig, content)
      .map((problem) => `bot/baseline.json defaultConfig: ${problem}`);
    if (rejected.length > 0) throw new ContentError(rejected);
  }

  // As baselines v2 por vocação (ADR 0032 d.4) passam pelo juiz v2, que cruza item e magia
  // contra o catálogo. É dado de onboarding: id que não existe reprova o boot, não o primeiro
  // personagem criado.
  const defaultConfigByVocation = content.bot.defaultConfigByVocation;
  if (defaultConfigByVocation !== undefined) {
    const rejected = Object.entries(defaultConfigByVocation).flatMap(([vocationId, config]) =>
      validateBotConfigV2(config, content)
        .map((problem) => `bot/baseline.json defaultConfigByVocation.${vocationId}: ${problem}`));
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
  const items = sequential(raw.items);
  // A munição é abstrata (ADR 0026 d.3): a fixture deriva ícone e projétil com ids sequenciais
  // da própria lista de munição, e o teste que fala de arte passa a tabela explícita.
  const ammunition: Record<string, { icon: number; missile: number }> = {};
  for (const [index, entry] of (raw.ammunition ?? []).entries()) {
    if (typeof entry !== 'object' || entry === null || !('id' in entry)) continue;
    ammunition[String((entry as { id: unknown }).id)] = { icon: index + 1, missile: index + 1 };
  }
  return {
    id: 'baseline',
    pack: 'placeholder',
    monsters: sequential(raw.monsters),
    items,
    // Sem forma ativa (#689): item sem linha veste com a aparência de sempre.
    equippedItems: {},
    ammunition,
    weapons: {},
    // Sem cadáver: fixture não fala de arte, e monstro sem linha aqui é válido (FUN-123).
    corpses: {},
    // Sem campo: fixture não fala de arte, e campo sem linha aqui é válido (#561, M31-06).
    fields: {},
    // Sem estágio de campo: idem, campo sem cadeia de arte é válido (#560).
    fieldStages: {},
    // Sem cenário: fixture não importa mapa nenhum, e chave sem uso é vocabulário à espera.
    scenery: {},
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
    abilities: {},
  };
}

/**
 * Acrescenta a forma ativa (`appearances.equippedItems`, #689) ao item que tem linha. A linha
 * órfã já foi recusada por quem chamou; aqui só se lê.
 */
function withEquippedAppearance<D extends { id: string }>(
  items: Map<string, D>,
  table: Readonly<Record<string, number>> | undefined,
): Map<string, D & { equippedAppearanceId?: number }> {
  if (table === undefined) return items;
  for (const [id, item] of items) {
    const equippedAppearanceId = table[id];
    if (equippedAppearanceId !== undefined) items.set(id, { ...item, equippedAppearanceId });
  }
  return items;
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

/**
 * Resolve a tabela `appearances.ammunition` contra o catálogo de munição (#152, ADR 0026 d.3).
 *
 * A linha tem DOIS números — `icon` (o ícone do seletor) e `missile` (o projétil) —, por isso
 * não cabe em `resolveAppearance`. Munição sem linha não tem como ser escolhida na tela, e a
 * linha órfã é o defeito que a tabela introduz: as duas derrubam o boot, porque tiro sem
 * projétil é vida sumindo do nada.
 */
function resolveAmmunition(
  definitions: ReadonlyMap<string, AmmunitionDefinition>,
  table: Appearances['ammunition'] | undefined,
  problems: string[],
): Map<string, Ammunition> {
  const resolved = new Map<string, Ammunition>();
  if (table === undefined) return resolved;
  for (const [id, definition] of definitions) {
    const look = table[id];
    if (look === undefined) {
      problems.push(`munição "${id}" não tem aparência: falta a linha "${id}" em appearances.ammunition`);
      continue;
    }
    resolved.set(id, { ...definition, appearanceId: look.icon, missileId: look.missile });
  }
  for (const id of Object.keys(table)) {
    if (definitions.has(id)) continue;
    problems.push(`appearances.ammunition mapeia munição "${id}", que não existe no conteúdo`);
  }
  return resolved;
}

/**
 * O cadáver de cada monstro (FUN-123), pela tabela: `corpses.<monstro> → appearanceId`. Linha
 * sem monstro é erro, como em toda seção da tabela; monstro sem linha é válido — não deixa
 * cadáver, e o `sim` nem fica sabendo (invariante 6: ele só diz que alguém morreu).
 */
function withCorpses(
  monsters: ReadonlyMap<string, Monster>,
  corpses: Readonly<Record<string, number>> | undefined,
  problems: string[],
): ReadonlyMap<string, Monster> {
  if (corpses === undefined) return monsters;
  const resolved = new Map<string, Monster>(monsters);
  for (const [id, appearance] of Object.entries(corpses)) {
    const monster = resolved.get(id);
    if (monster === undefined) {
      problems.push(`appearances.corpses mapeia monstro "${id}", que não existe no conteúdo`);
      continue;
    }
    resolved.set(id, { ...monster, corpseAppearanceId: appearance });
  }
  return resolved;
}

/** Normaliza um `VocationRequirement` (#524) para a lista de ids que ele carrega. Ausente: nenhum. */
function vocationIdsOf(requirement: VocationRequirement | undefined): readonly string[] {
  if (requirement === undefined) return [];
  return typeof requirement === 'string' ? [requirement] : requirement;
}

/** Os `_open` de um catálogo inteiro, prefixados pelo tipo. Ver `openValues`. */
function openOf<K extends string>(
  kind: string, catalog: ReadonlyMap<K, { readonly _open?: string | undefined }>,
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
