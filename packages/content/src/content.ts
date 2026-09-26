// Montagem e validação do conteúdo. PURO: nenhuma leitura de disco acontece aqui, para este
// módulo poder ser importado por `sim` sem arrastar `node:fs` junto (invariante 1).
// Quem lê arquivo é `@draconya/content/load`, e o lint impede `sim` de importar de lá.

import { z } from 'zod';
import { buildRoute, buildTilemap, isBlocked } from './map.js';
import type { Route, Tilemap } from './map.js';
import {
  BOT_VOCABULARY_VERSION,
  BASIC_ABILITY_ID,
  COMBAT_PROFILES,
  DAMAGE_TYPES,
  abilityPower,
  ammunitionSchema,
  appearancesSchema,
  attackRange,
  packSchema,
  botSchema, combatSchema, huntSchema, monsterSchema, progressionSchema, routeSchema,
  bestiarySchema, itemSchema, partySchema, skillSchema, spellSchema, staminaSchema,
  supplySchema, tilemapSchema, vocationSchema, weaponFamilySchema,
} from './schemas.js';
import type {
  Ammunition, AmmunitionDefinition, Appearances, Bestiary, BotLimits, Combat, CompiledMitigation,
  DamageType, Hunt, Item, ItemDefinition, MitigationProfile, Monster, MonsterAbility, MonsterDefense,
  MonsterDefinition, Pack, PartyConfig, Progression, ResolvedWeapon, Skill, Spell, Stamina, Supply,
  Vocation, VocationRequirement, Weapon, WeaponFamily, WeaponFamilyDefinition, WeaponKind,
  WeaponPowerFormula, WeaponProfile,
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
  /** A party de hunt (§15, ADR 0027): teto de membros e pool de XP por vocações únicas. */
  readonly party: PartyConfig;
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
  /**
   * O catálogo de suprimentos (§20.1): poção e runa são ABSTRATAS — usar debita gold direto,
   * sem item físico nem pilha. O `group` é o grupo de cooldown do motor v2.
   */
  readonly supplies: ReadonlyMap<string, Supply>;
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
  readonly party?: readonly unknown[];
  readonly bestiary?: readonly unknown[];
  readonly bot?: readonly unknown[];
  readonly spells?: readonly unknown[];
  readonly supplies?: readonly unknown[];
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
    physical: 0, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0, arcane: 0,
  };
  if (profile !== undefined) {
    for (const type of DAMAGE_TYPES) {
      const value = profile.resistances[type];
      if (value !== undefined) resistances[type] = value;
    }
  }
  return { resistances, immunities: new Set(profile?.immunities ?? []) };
}

/** O monstro resolvido (CMB-03), usado pelo boot e por fixture que monta `Monster` à mão. */
export function compileMonster(monster: MonsterDefinition): CompiledMonster {
  const { mitigation: _rawMitigation, abilities: _rawAbilities, defenses: _rawDefenses, ...rest } = monster;
  return {
    ...rest,
    abilities: normalizeMonsterAbilities(monster),
    defenses: normalizeMonsterDefenses(monster),
    mitigation: compileMitigation(monster.mitigation),
  };
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
  definitions: ReadonlyMap<string, MonsterDefinition>,
): Map<string, CompiledMonster> {
  const compiled = new Map<string, CompiledMonster>();
  for (const [id, monster] of definitions) compiled.set(id, compileMonster(monster));
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
      const power = powerOf(raw.kind === 'distance' ? 0 : item.attack, family);
      weapon = {
        kind: raw.kind,
        family: familyId,
        damageType,
        range,
        ...(power === undefined ? {} : { power }),
        ...(raw.kind === 'distance' && raw.ammoFamily !== undefined
          ? { ammoFamily: raw.ammoFamily }
          : {}),
        // O `hitChance` da arma (#524) é só dado — a chance de acerto à distância é a #522.
        ...(raw.hitChance === undefined ? {} : { hitChance: raw.hitChance }),
      };
    }
  }
  const { weapon: _rawWeapon, mitigation: _rawMitigation, ...rest } = item;
  return {
    ...rest,
    mitigation: compileMitigation(item.mitigation),
    ...(weapon === undefined ? {} : { weapon }),
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
  const monsterDefinitions = compileMonsters(rawMonsterDefinitions);
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
  const bestiary = parseAll('bestiary', raw.bestiary ?? [], bestiarySchema, problems).get('baseline');
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
      const selfOrigin = effect.area !== undefined
        && (effect.area.shape !== 'circle' || effect.area.centered === 'caster');
      if (selfOrigin && effect.range !== undefined) {
        problems.push(`${where}: forma que sai do lançador não tem alcance`);
      }
      if (!selfOrigin && effect.range === undefined) {
        problems.push(`${where}: dano no alvo precisa de range`);
      }
    }
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
      if (weapon.kind === 'distance' && weapon.ammoFamily === undefined) {
        problems.push(`item "${item.id}": arma de distância precisa de "ammoFamily"`);
      }
      if (weapon.kind === 'distance' && weapon.ammoFamily !== undefined
        && ![...ammunitionDefinitions.values()].some((ammo) => ammo.family === weapon.ammoFamily)) {
        problems.push(`item "${item.id}": a família "${weapon.ammoFamily}" não tem munição no catálogo`);
      }
      if (weapon.kind === 'wand' && (weapon.manaPerHit === undefined || weapon.damage === undefined)) {
        problems.push(`item "${item.id}": wand precisa de "manaPerHit" e "damage"`);
      }
      if (weapon.kind !== 'distance' && weapon.ammoFamily !== undefined) {
        problems.push(`item "${item.id}": só arma de distância tem "ammoFamily"`);
      }
      if (weapon.kind !== 'wand' && (weapon.manaPerHit !== undefined || weapon.damage !== undefined)) {
        problems.push(`item "${item.id}": só wand tem "manaPerHit" e "damage"`);
      }
      if (weapon.damage !== undefined && weapon.damage.min > weapon.damage.max) {
        problems.push(`item "${item.id}": damage.min maior que damage.max`);
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
    // Defesa (CMB-04) só nas combinações aprovadas: escudo, ou arma corpo a corpo de UMA mão.
    // Bow/twoHanded e wand/rod não têm defesa residual, e a arma de duas mãos não deixa escudo
    // de sobra — o `Inventory` já recusa as duas juntas, e aqui a recusa é sobre o dado.
    const meleeOneHanded = item.kind === 'weapon' && !item.twoHanded
      && (item.weapon?.kind ?? 'melee') === 'melee';
    if (item.defense > 0 && item.kind !== 'shield' && !meleeOneHanded) {
      problems.push(
        `item "${item.id}": defense só vale em escudo ou arma corpo a corpo de uma mão`,
      );
    }
    // extraDefense/spellbook/quiver (#549, M30-02): a mesma disciplina do `defense` acima —
    // um campo que só a conta do JOGADOR lê não pode aparecer num item que não é arma ou
    // escudo, porque o schema de campo opcional não sabe do `kind`.
    if (item.extraDefense > 0 && item.kind !== 'weapon') {
      problems.push(`item "${item.id}": extraDefense só faz sentido em arma`);
    }
    if ((item.spellbook || item.quiver) && item.kind !== 'shield') {
      problems.push(`item "${item.id}": spellbook/quiver só fazem sentido em escudo`);
    }
    if (item.spellbook && item.quiver) {
      problems.push(`item "${item.id}": spellbook e quiver são exclusivos — o escudo é um ou outro`);
    }
    if (item.ringEffect !== undefined && item.kind !== 'ring') {
      problems.push(`item "${item.id}": "ringEffect" só faz sentido em anel`);
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
    if (item.bonuses?.skill !== undefined && skills.size > 0
      && !skills.has(item.bonuses.skill.skillId)) {
      problems.push(
        `item "${item.id}": bonuses.skill.skillId "${item.bonuses.skill.skillId}" não existe`,
      );
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
  // desconhecida é zero.
  if (skills.size > 0) {
    for (const vocation of vocations.values()) {
      if (!skills.has(vocation.spellSkill)) {
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
  const appearances = appearanceTables.get('baseline');
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
  const items: ReadonlyMap<string, Item> = resolveAppearance(
    'item', 'items', itemDefinitions, appearances?.items, 'appearanceId', problems);
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
  for (const monster of monsterDefinitions.values()) {
    for (const line of monster.loot.items) {
      if (line.itemId !== undefined) {
        if (itemDefinitions.has(line.itemId)) continue;
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

  // As abilities DECLARADAS (CMB-06, área estendida em #518), conferidas no arquivo CRU — o
  // compilado já tem a básica sintetizada, e validá-lo reprovaria todo monstro legado pelo id
  // reservado. O `basic` é do BOOT; a duplicata tornaria a escolha por id ambígua. `wave` e
  // `beam` saem da DIREÇÃO do lançador para o alvo (`facingDirection`, recalculada a cada golpe
  // — o monstro não guarda direção entre golpes); `cross`/`cleave` continuam fora porque nenhum
  // monstro do recorte precisa deles ainda.
  const MONSTER_ABILITY_AREA_SHAPES = new Set(['circle', 'wave', 'beam']);
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
            'monstro só lança `circle`, `wave` ou `beam`',
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
    ...(party?._open === undefined ? [] : [`party/${party.id}: ${party._open}`]),
    ...(bestiary?._open === undefined ? [] : [`bestiary/${bestiary.id}: ${bestiary._open}`]),
    ...openOf('spell', spells),
    ...openOf('supply', supplies),
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
    party: party as PartyConfig,
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
    ammunition,
    weapons: {},
    // Sem cadáver: fixture não fala de arte, e monstro sem linha aqui é válido (FUN-123).
    corpses: {},
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
