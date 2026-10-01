// Schemas de todo dado de jogo. São a definição normativa: o que não passa aqui não entra
// na simulação, e conteúdo inválido derruba o boot em vez de virar bug de balanceamento
// três semanas depois.

import { z } from 'zod';

/**
 * A taxonomia CANÔNICA de tipos de dano (CMB-03, emenda do ADR 0031; drown/lifedrain/manadrain
 * pelo #547, M29-07). É a fonte ÚNICA: o `sim` importa `DamageType` daqui e não redeclara o enum.
 *
 * Os dez primeiros são os `CombatType` do Tibia 13.32 (TFS/Canary — só os NOMES, que são fato de
 * domínio; nenhum código GPL é copiado, ADR 0019): físico, energia, terra, fogo, gelo, sagrado,
 * morte, afogamento (`drown`), dreno de vida (`lifedrain`) e dreno de mana (`manadrain`).
 * `lifedrain` e `manadrain` são dano — o Canary NUNCA os usa para curar quem ataca
 * (`Creature::mitigateDamage`, `creature.cpp:911-921`, os pula da mitigação percentual; nenhum
 * dos dois soma vida ou mana em quem golpeia). `manadrain` resolve contra a MANA do alvo, não a
 * vida (`sim/combat/outcome.ts`); `drown` e `lifedrain` são dano de vida comum. `arcane` é o
 * OITAVO/último tipo, NÃO-ELEMENTAL, da magia cujo elemento o conteúdo ainda não declarou — é o
 * vocabulário do `combat-v1` (`melee`/`magic`) preservado para que a ausência de tipo continue
 * rendendo bit a bit o mesmo dano (DT-03); seu destino no catálogo (ADR 0040) é uma issue à parte.
 *
 * Tipo é separado de ORIGEM (`DamageSource`) e de EFEITO VISUAL (`CreatureHit.source`), pela
 * DT-01: o mesmo elemento pode vir de fontes diferentes, e o mesmo efeito pode desenhar sem
 * dizer qual fórmula resolveu.
 */
export const DAMAGE_TYPES = [
  'physical', 'energy', 'earth', 'fire', 'ice', 'holy', 'death',
  'drown', 'lifedrain', 'manadrain', 'arcane',
] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];

/**
 * As raças de monstro do Canary (`RaceType_t`, `creatures_definitions.hpp`; `monster.race` no
 * Lua, lido por `MonsterType:race`, `monster_type_functions.cpp`). A raça decide de que COR e com
 * que EFEITO o golpe físico que atinge o monstro se desenha (`Game::combatGetTypeInfo`,
 * `game.cpp`): sangue vermelho, veneno verde, morto-vivo cinza, fogo laranja, energia roxa, tinta,
 * chocolate e doce. **Só apresentação** (#620) — nenhum sistema de combate a lê. O protocolo
 * repete a lista (`MonsterRace`, `protocol/types.ts`): é a base da pilha e não importa `content`,
 * e `schemas.test.ts` confere que as duas são o mesmo conjunto.
 */
export const MONSTER_RACES = [
  'venom', 'blood', 'undead', 'fire', 'energy', 'ink', 'chocolate', 'candy',
] as const;
export type MonsterRace = (typeof MONSTER_RACES)[number];

/** A raça do monstro que o Canary não declara: `MonsterType::info.race = RACE_BLOOD` (`monsters.hpp`). */
export const DEFAULT_MONSTER_RACE: MonsterRace = 'blood';

/**
 * Os elementos que têm MAGIC LEVEL ESPECIALIZADO no Canary (#680): as oito chaves
 * `<elemento>magiclevelpoints` de `item_parse.cpp:915-941`. `healing` é o da cura; `drown`,
 * `lifedrain`, `manadrain` e `arcane` não têm chave lá, e por isso não têm aqui.
 */
export const SPECIALIZED_MAGIC_ELEMENTS = [
  'physical', 'energy', 'earth', 'fire', 'ice', 'holy', 'death', 'healing',
] as const;
export type SpecializedMagicElement = (typeof SPECIALIZED_MAGIC_ELEMENTS)[number];

/**
 * Os três valores que o `elementalbond` de `items.xml` aceita: `ItemParse::parseElementalBond`
 * (`item_parse.cpp:764-778`, Canary 47dfd51) só reconhece `energy`, `earth` e `physical` — qualquer
 * outro texto deixa o bond em `COMBAT_NONE`. O `fire`/`ice` que `Combat::monkEffectByElementalBond`
 * (`combat.cpp:1105-1141`) também trata nunca sai do parser: são variantes de efeito de um bond que
 * o XML não consegue declarar, e não entram aqui.
 */
export const ELEMENTAL_BOND_TYPES = ['physical', 'earth', 'energy'] as const;
export type ElementalBondType = (typeof ELEMENTAL_BOND_TYPES)[number];

/**
 * Proveniência de uma entidade GERADA pelo importador de catálogo (ADR 0038 decisão 2): de qual
 * engine, commit e arquivo do Canary/TFS o número saiu — o mesmo `CatalogSource` que
 * `scripts/catalog/generated-writer.ts` grava por entidade em `<tipo>/generated/*.json`, e o
 * mesmo espírito do `source` que `tilemapSchema` já declara para o mapa importado (ADR 0025
 * decisão 3). Opcional: só entidade GERADA carrega isto — uma autoral não tem `source` porque
 * nasceu aqui, não foi importada.
 *
 * Precisa ser um campo EXPLÍCITO em cada schema que hospeda entidade gerada, e não um `_open`
 * qualquer: todo schema de entidade (`itemSchema`, `monsterSchema`, `ammunitionSchema`, …) é
 * `z.strictObject`, e chave não declarada derruba o boot na primeira entidade gerada de
 * verdade — exatamente o motivo de `tilemapSchema` já declarar o dela.
 */
export const catalogSourceSchema = z.object({
  engine: z.enum(['canary', 'forgottenserver']),
  commit: z.string().min(1),
  path: z.string().min(1),
});

/**
 * O perfil de mitigação de uma entidade (CMB-03): o que ela RESISTE e ao que é IMUNE.
 *
 * `resistances` é uma fração por tipo, no intervalo `[-1, 1)` aprovado na emenda do ADR 0031:
 * positivo reduz (`dano × (1 − r)`), negativo é VULNERABILIDADE e amplifica (`dano × (1 + |r|)`).
 * `1` é recusado por ser indistinguível de imunidade — a DT-02 exige que imunidade seja
 * EXPLÍCITA, nunca comunicada por resistência de 100 %.
 *
 * Imutável e compilado no boot: o caminho quente faz `resistances[tipo]` (lookup) e
 * `immunities.has(tipo)` (Set), nunca uma varredura por golpe.
 */
function refineMitigation(
  mitigation: {
    readonly resistances: Partial<Record<DamageType, number>>;
    readonly immunities: readonly DamageType[];
  },
  context: z.RefinementCtx,
): void {
  const seen = new Set<DamageType>();
  for (const type of mitigation.immunities) {
    // Duplicata é dado ambíguo: não se sabe se é engano ou ênfase, e o boot é o lugar de
    // perguntar.
    if (seen.has(type)) {
      context.addIssue({ code: 'custom', message: `imunidade duplicada para "${type}"` });
    }
    seen.add(type);
    // Resistência E imunidade para o mesmo tipo é a ambiguidade que a DT-02 descarta: escolha
    // uma. Aceitar deixaria a regra depender da ordem em que o resolver lê os dois.
    if (mitigation.resistances[type] !== undefined) {
      context.addIssue({
        code: 'custom',
        message: `"${type}" declara resistência e imunidade ao mesmo tempo — escolha uma`,
      });
    }
  }
}

/** O mesmo perfil com o piso de resistência parametrizado: item e monstro diferem só nele (#683). */
function mitigationSchemaWith(minResistance: number) {
  return z.object({
    resistances: z.partialRecord(z.enum(DAMAGE_TYPES), z.number().gte(minResistance).lt(1)).default({}),
    immunities: z.array(z.enum(DAMAGE_TYPES)).default([]),
  }).superRefine(refineMitigation);
}

export const mitigationSchema = mitigationSchemaWith(-1);

/**
 * O perfil de mitigação do MONSTRO (#683, M30-G6): o mesmo de `mitigationSchema`, mas a
 * vulnerabilidade vai até `-2` (-200 %, o `minElementalResistance` do Canary,
 * `config.lua.dist`) — `-2` triplica o dano, o `(100 − (−200)) / 100` de `Monster::blockHit`.
 * O teto continua `< 1`: `elements ≥ 100` do Canary é IMUNIDADE explícita (DT-02 do ADR 0031),
 * nunca resistência de 100 %. O item continua em `[-1, 1)` — o Canary não dá esse recorte ao
 * item, e alargar o schema compartilhado mudaria o item sem pedido (DT-03 do #683).
 */
export const monsterMitigationSchema = mitigationSchemaWith(-2);

export type MitigationProfile = z.infer<typeof mitigationSchema>;

/**
 * A forma COMPILADA de `MitigationProfile` (CMB-03): a tabela completa por tipo (zero onde não
 * há resistência) e um `Set` de imunidades. É o que o resolver lê no caminho quente, para o
 * custo por golpe ser O(1) e não uma varredura.
 */
export interface CompiledMitigation {
  readonly resistances: Readonly<Record<DamageType, number>>;
  readonly immunities: ReadonlySet<DamageType>;
}

/**
 * A tabela de efetividade de armadura que reproduz o `combat-v1` bit a bit (CMB-03): `physical`
 * vale o antigo `melee` (1), e todo tipo não-físico vale o antigo `magic` (0), inclusive
 * drown/lifedrain/manadrain (#547, M29-07: nenhum conteúdo v1/v2 os declara, e o `combat-v3`
 * nem lê este campo — `blockhit.ts` usa a armadura em faixa, sem efetividade por tipo). É a
 * REFERÊNCIA da migração e o valor que uma fixture pode reusar; o conteúdo real declara a sua,
 * porque o schema exige os onze tipos e um default em código faria o balanceamento morar onde
 * ninguém procura.
 */
export const V1_ARMOR_EFFECTIVENESS: Readonly<Record<DamageType, number>> = {
  physical: 1, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0,
  drown: 0, lifedrain: 0, manadrain: 0, arcane: 0,
};

/** Referência a uma aparência no pacote de assets. NUNCA um caminho de arquivo (invariante 6). */
const appearanceId = z.number().int().positive();

/**
 * As quatro peças de uma parede (FUN-105), como o Tibia monta muro: o tile bloqueado NÃO tem
 * uma arte só — a peça é escolhida pela VIZINHANÇA. `vertical` corre de norte a sul,
 * `horizontal` de leste a oeste, `corner` é onde as duas se encontram e `pole` é a ponta
 * solta, sem parede em nenhum dos quatro lados. A regra que escolhe é do cliente
 * (`world/walls.ts`); aqui moram só os quatro ids — nunca um caminho de arquivo (invariante 6).
 *
 * `strictObject`, como item e monstro: uma quinta chave (`"diagonal"`, `"end"`) seria uma peça
 * que ninguém desenha, e Zod a descartaria em silêncio no arquivo que existe para ninguém
 * conferir arte à mão.
 */
export const wallSetSchema = z.strictObject({
  vertical: appearanceId,
  horizontal: appearanceId,
  corner: appearanceId,
  pole: appearanceId,
});

export type WallSet = z.infer<typeof wallSetSchema>;

/**
 * As quatro peças da parede de um mapa (FUN-105), venha `wall` como vier.
 *
 * O schema aceita UM id ou os quatro, e não normaliza — o arquivo diz o que o humano escreveu.
 * Quem desenha precisa sempre das quatro, e é aqui que um número vira as quatro IGUAIS: a
 * regra de vizinhança continua rodando, escolhe uma peça por tile, e todas apontam a mesma
 * arte. É o que faz um mapa com `wall: 1298` desenhar hoje exatamente o que desenhava antes
 * de existir peça por vizinhança.
 */
export function wallSetOf(wall: number | WallSet): WallSet {
  if (typeof wall === 'number') {
    return { vertical: wall, horizontal: wall, corner: wall, pole: wall };
  }
  return wall;
}

/**
 * A TABELA de aparências (FUN-94), o mapa único que o ADR 0008 já previa: *"trocar o pacote de
 * assets no futuro é remapear `appearanceId`/`outfitId` numa tabela, não reescrever
 * `content/`"*.
 *
 * Antes da FUN-94 os ids viviam inline em cada entidade, e o ADR valia na letra — nenhum
 * caminho de arte em `content/` — mas não no efeito: trocar de pacote era editar todo arquivo
 * de conteúdo. Aqui é um arquivo, e o diff da troca é o remapeamento inteiro numa tela.
 *
 * **Separada por tipo, e não um mapa achatado.** Id é único DENTRO de um tipo, não entre eles:
 * um dia existe o item "rat" e o monstro "rat", e num mapa achatado um sobrescreveria o outro
 * em silêncio — no arquivo que existe justamente para ninguém precisar conferir arte à mão.
 *
 * `pack` não é lido por código nenhum, e é o campo mais importante do arquivo para quem for
 * trocar: sem ele, os números são ids sem origem, e a primeira pergunta de quem abre o arquivo
 * ("de qual pacote são estes?") não teria resposta em lugar nenhum.
 */
export const appearancesSchema = z.object({
  id: z.string().min(1),
  /** De qual pacote de assets estes ids vieram. Documentação, para o humano que remapear. */
  pack: z.string().min(1),
  /** `id de monstro → outfitId`. */
  monsters: z.record(z.string().min(1), appearanceId).default({}),
  /** `id de item → appearanceId`. */
  items: z.record(z.string().min(1), appearanceId).default({}),
  /**
   * `id de item → appearanceId` da forma ATIVA, enquanto vestido (#689): o Energy Ring ligado
   * no dedo. No Tibia é outro id de item (3051 → 3088, `transformequipto`); aqui é só outra
   * aparência do MESMO item (invariante 6) — o id de conteúdo, o inventário e o ledger não
   * mudam. De um lado só, como `weapons`: item sem linha veste com a aparência de sempre, e a
   * linha órfã é recusada.
   */
  equippedItems: z.record(z.string().min(1), appearanceId).default({}),
  /**
   * `id de munição → { icon, missile }` (#152, ADR 0026 decisão 3). A munição é ABSTRATA, não
   * item: o seletor do slot do escudo lista a família do bow, e o tiro é o projétil. O ícone é
   * `icon` (não há mais `appearances.items[id]` para a munição) e `missile` é o projétil — a
   * linha tem dois números, e `resolveAmmunition` confere os dois lados.
   */
  ammunition: z.record(z.string().min(1), z.object({
    icon: appearanceId,
    missile: appearanceId,
  })).default({}),
  /**
   * `id de item → { missile }` para a arma que dispara sem munição — wand e rod (#152). De
   * um lado só, como `spells`: arma sem linha é arma MUDA (bate, não desenha), e a linha
   * órfã é recusada.
   */
  weapons: z.record(z.string().min(1), z.object({ missile: appearanceId })).default({}),
  /**
   * `id de monstro → aparência do cadáver` (FUN-123). O `sim` diz que um monstro morreu; é
   * aqui que o rato morto vira o objeto 5964 no chão — arte, logo tabela (invariante 6).
   * Monstro sem linha não deixa cadáver: válido, só não desenha.
   */
  corpses: z.record(z.string().min(1), appearanceId).default({}),
  /**
   * `id de campo de tile → appearanceId` (#561, M31-06): fogo, veneno, energia — o `sim` diz
   * QUE campo está ativo e ONDE (`FieldSpec.id`, declarado inline em spell/ability); a arte é
   * daqui (invariante 6). Campo sem linha não aparece — MUDO, não erro, como `spells`: um campo
   * novo não precisa nascer com arte antes de nascer com mecânica.
   */
  fields: z.record(z.string().min(1), appearanceId).default({}),
  /**
   * `id de campo → [appearanceId dos estágios 1, 2, …]` (#560): o segundo estágio do fire
   * field, mais fraco, é OUTRA arte — a mesma indireção de `fields` acima, só que por índice em
   * vez de um número só. `fields[id]` continua sendo a arte do NASCIMENTO (estágio 0); este
   * array começa no estágio 1 — `fieldStages[id][stageIndex - 1]` é o id de quem recebe
   * `field-stage-change` com aquele `stageIndex`. Campo cuja cadeia não tem entrada aqui troca
   * de estágio MUDO — o cliente não redesenha, mas a mecânica (dano, bloqueio) já rodou no `sim`.
   */
  fieldStages: z.record(z.string().min(1), z.array(appearanceId)).default({}),
  /**
   * `appearanceKey → { estado → id }` do cenário usável (#727, ADR 0050 d.1): a mesma
   * indireção de `corpses` para porta, capim, stone pile, rope spot, ladder, alavanca. GERADO
   * por `pnpm map:import` em `appearances/generated/scenery.json` — nunca escrito à mão —,
   * porque quem sabe quais ids formam um par fechado/aberto é a tabela do Canary transcrita
   * como dado, não um humano copiando do OTBM. Chave sem uso é vocabulário à espera (mesma
   * regra de `abilities`); `tilemapSchema.interactables[].appearanceKey` aponta para cá.
   */
  scenery: z.record(z.string().min(1), z.record(z.string().min(1), appearanceId)).default({}),
  /**
   * Outfits de PERSONAGEM (FUN-103). `default` é o que todo jogador veste enquanto ninguém
   * escolhe o seu (§7.4 pendente): `CharacterRuntime` não tem outfit e o ticket não carrega
   * um. Mora aqui, e não numa constante no servidor, porque é arte (invariante 6).
   */
  characters: z.object({ default: appearanceId }).optional(),
  /**
   * `id de mapa → aparência do chão e da parede` (FUN-23).
   *
   * O tilemap é grade de caracteres (`#` bloqueia, o resto é livre) e não guarda id de arte
   * nenhum — nem deveria, pelo invariante 6. Aqui é onde o `#` vira uma laje de pedra e o `.`
   * vira terra batida.
   *
   * **Por MAPA, e não um par global.** Uma adega e uma praça não têm o mesmo chão, e um par
   * único faria a Cidade parecer o porão do rato — que é o tipo de coisa que ninguém escreve
   * de propósito e todo mundo vê na primeira tela.
   *
   * `wall` é UM id — a mesma peça em todo tile bloqueado — ou as quatro de `wallSetSchema`
   * (FUN-105). A união fica no schema de propósito, sem normalizar aqui: o arquivo diz o que
   * o humano escreveu, e quem precisa das quatro chama `wallSetOf`.
   */
  maps: z.record(z.string().min(1), z.object({
    floor: appearanceId,
    wall: z.union([appearanceId, wallSetSchema]),
  })).default({}),
  /**
   * `id de magia → o que ela desenha` (FUN-109). `effect` é a animação no tile do alvo;
   * `missile` é o projétil do conjurador até ele. Os dois são opcionais e independentes: uma
   * cura tem efeito e não tem projétil, e uma magia sem entrada nenhuma aqui é magia MUDA —
   * válida, só não desenha. É por isso que `buildContent` confere UM lado só: toda chave
   * daqui precisa existir no catálogo, mas o catálogo não precisa estar todo aqui.
   *
   * A semântica dos ids é do pacote (`pack`), e é ele quem diz que 13 é "magic blue". Este
   * arquivo não sabe disso, e não deve: no dia em que o pacote mudar, o 13 vira outro número
   * e nada aqui precisa entender o que ele desenhava.
   */
  spells: z.record(z.string().min(1), z.object({
    effect: appearanceId.optional(),
    missile: appearanceId.optional(),
  })).default({}),
  /**
   * `id de supply → { effect, missile }` (FUN-109). `effect` é a animação no tile do alvo (ou
   * no de quem usou, na poção); `missile` é o projétil do conjurador até o primeiro alvo, que a
   * runa de ataque lança ANTES de a área estourar (#478). Os dois são opcionais e independentes:
   * a poção tem efeito e não tem projétil, a runa tem os dois, e um supply sem entrada é MUDA.
   * Mesma regra de `spells`.
   */
  supplies: z.record(z.string().min(1), z.object({
    effect: appearanceId.optional(),
    missile: appearanceId.optional(),
  })).default({}),
  /**
   * Efeito do golpe sem magia (FUN-109). `melee` é o sangue do corpo a corpo. Objeto, e não
   * um número solto, porque o golpe à distância (§21.3, munição) vai ter o seu e não cabe em
   * `spells` nem em `supplies`.
   */
  hits: z.object({
    melee: appearanceId.optional(),
    /**
     * O efeito do golpe FÍSICO por RAÇA do alvo (#620, `Game::combatGetTypeInfo` do Canary):
     * sangue para `blood`, gota de veneno para `venom`, o "hit area" cinza para `undead`/`ink`…
     * O host o escolhe pela `race` do monstro atingido no lugar do `melee`, que continua sendo o
     * efeito quando a raça não tem linha (e o do jogador atingido, que é `blood`). Raça sem linha
     * nem `melee` é golpe sem efeito — o `CONST_ME_NONE` do Canary.
     */
    byRace: z.partialRecord(z.enum(MONSTER_RACES), appearanceId).optional(),
  }).default({}),
  /**
   * `chave semântica → { missile, effect }` para as abilities de monstro (CMB-06). A ability
   * declara `presentation.missileKey`/`impactKey` — nunca um id de arte (invariante 6) —, e o
   * host resolve a chave aqui. As chaves são um VOCABULÁRIO COMPARTILHADO (duas abilities podem
   * apontar a mesma), então, ao contrário de `spells`/`supplies`, não há id de conteúdo de um
   * lado só: chave sem linha é MUDA, e linha sem uso é vocabulário à espera — as duas válidas.
   */
  abilities: z.record(z.string().min(1), z.object({
    missile: appearanceId.optional(),
    effect: appearanceId.optional(),
  })).default({}),
});

export type Appearances = z.infer<typeof appearancesSchema>;

/**
 * Uma faixa INCLUSIVA de ids, `[primeiro, último]`. Um id só é `[n, n]`.
 *
 * Faixas, e não a lista: o pacote 13.32 tem 36 mil objetos em 760 faixas, e é a diferença
 * entre um arquivo que cabe num diff e um que ninguém abre.
 */
const idRange = z.tuple([appearanceId, appearanceId]).refine(
  ([first, last]) => first <= last,
  { message: 'faixa invertida: o primeiro id passa do último' },
);

/** Faixas em ordem crescente e sem sobreposição — é o que a busca binária de `packHas` exige. */
const idRanges = z.array(idRange).superRefine((ranges, context) => {
  for (let index = 1; index < ranges.length; index += 1) {
    const previous = ranges[index - 1];
    const current = ranges[index];
    if (previous === undefined || current === undefined || current[0] > previous[1]) continue;
    context.addIssue({
      code: 'custom',
      message: `faixas fora de ordem ou sobrepostas em ${index}: `
        + `[${previous}] antes de [${current}]`,
    });
    return;
  }
});

/**
 * O INVENTÁRIO de um pacote de assets (FUN-21): quais ids existem nele, por tipo.
 *
 * É a sombra do pacote dentro de `content/`. O pacote em si mora em `things/`, fora do Git, e
 * o servidor nem o carrega — mas a tabela de aparências aponta para ele, e sem isto nada
 * conferia que o outfit 21 EXISTE: um id errado passava pelo schema e pelo boot, e virava um
 * quadrado invisível em produção, longe da causa. `buildContent` cruza a tabela com este
 * inventário e recusa o id que não está em faixa nenhuma.
 *
 * Gerado por `pnpm assets:inventory` a partir do `appearances-<hash>.dat`, nunca à mão; a mesma
 * ferramenta confere o arquivo versionado contra o pacote local (`--check`, dentro do `pnpm
 * check`). `id` é o que `appearances.pack` cita; `version` é a pasta em `things/`.
 *
 * `strictObject` pela razão de sempre: uma quinta categoria seria descartada em silêncio.
 * Não é arte (invariante 6): são números, e os mesmos que a tabela já carrega.
 */
export const packSchema = z.strictObject({
  id: z.string().min(1),
  /** A pasta do pacote em `things/` — é por ela que `--check` o encontra na máquina. */
  version: z.string().min(1),
  /** SHA-256 do `.dat` de que este inventário saiu. Proveniência, para quem for regenerar. */
  appearancesSha256: z.string().regex(/^[0-9a-f]{64}$/),
  object: idRanges,
  outfit: idRanges,
  effect: idRanges,
  missile: idRanges,
});

export type Pack = z.infer<typeof packSchema>;

/** Uma linha de loot: cai com `chance`, e quando cai vem entre `min` e `max`. */
const lootRollSchema = z.object({
  chance: z.number().min(0).max(1),
  min: z.number().int().positive().default(1),
  max: z.number().int().positive().default(1),
}).refine((roll) => roll.min <= roll.max, { message: 'loot: min não pode passar de max' });

/**
 * A tabela de loot (FUN-63). Moeda e item são coisas DIFERENTES, e o schema diz qual é qual:
 * gold é campo no personagem (`character.gold`), não item — por isso tem lugar próprio, em vez
 * de um `itemId: "gold-coin"` que o código teria que reconhecer por nome.
 *
 * `items` aceita `itemId` OU `supplyId` OU `ammunitionId` (#520): poção e munição física são
 * ABSTRATAS (`supplies/*.json`/`ammunition/*.json`, AB-01/ADR 0026 d.7) e não existiam no
 * catálogo de item — sem isso, um Burst Arrow ou uma Strong Health Potion no loot de monstro
 * não tinham como ser declarados. `supplyId`/`ammunitionId` creditam o ESTOQUE
 * (`CharacterRuntime.supplyStock`/`ammunitionStock`, `character.ts`) de quem recebe o drop, e
 * NÃO passam pela mochila: sem peso, sem instância — o mesmo motivo de gold não ser item. O `.refine` recusa a linha ambígua (duas ou mais chaves) ou vazia
 * (nenhuma) — o mesmo formato do `itemId` sozinho, então um arquivo existente que só declara
 * `itemId` continua válido sem mudar uma vírgula.
 */
/**
 * Os modelos de rolagem de loot (#685). Só um além do padrão: `canary`, o `generateLootRoll` do
 * Canary (`monstertype.lua`) — fator 95–105 % por linha, rolagem inteira em `[0, 100000]` e a
 * quantidade da MESMA rolagem. O padrão (campo ausente) não tem nome aqui de propósito: é o
 * FUN-63, e toda semente já gravada depende de ele continuar sendo o que o ausente significa.
 */
export const LOOT_ROLL_MODELS = ['canary'] as const;
export type LootRollModel = (typeof LOOT_ROLL_MODELS)[number];

export const lootTableSchema = z.object({
  /**
   * Como a tabela é sorteada (#685). AUSENTE é o modelo FUN-63 (preserva toda semente gravada);
   * `canary` é o `generateLootRoll` do Canary. O leitor de monstros (#578) grava `canary` em toda
   * tabela gerada; os monstros autorais não o declaram e rendem bit a bit o de antes
   * (invariante 7). Numa tabela `canary`, linha `itemId` com `max > 1` exige item `stackable` —
   * o Canary daria 1 —, e `buildContent` recusa a que não empilha.
   */
  rollModel: z.enum(LOOT_ROLL_MODELS).optional(),
  gold: lootRollSchema.optional(),
  /**
   * Itens de verdade, supply OU munição. `buildContent` confere cada `itemId`/`supplyId`/
   * `ammunitionId` contra o catálogo correspondente (FUN-76 / AB-01 / ADR 0026 d.7).
   */
  items: z.array(lootRollSchema.safeExtend({
    itemId: z.string().min(1).optional(),
    supplyId: z.string().min(1).optional(),
    ammunitionId: z.string().min(1).optional(),
  }).refine(
    (line) => [line.itemId, line.supplyId, line.ammunitionId].filter((id) => id !== undefined).length === 1,
    { message: 'loot: declare exatamente um de itemId, supplyId ou ammunitionId' },
  )).default([]),
});

/**
 * Onde um item se equipa. Ausente no item = ele não se equipa (§21.3).
 *
 * Lista fechada porque o personagem tem um slot de cada: um item que declara um slot que o
 * personagem não tem é conteúdo quebrado, e o boot é o lugar de descobrir isso.
 */
export const ITEM_SLOTS = [
  'head', 'neck', 'chest', 'legs', 'feet', 'hand', 'shield', 'finger', 'ammo', 'back',
] as const;
export type ItemSlot = (typeof ITEM_SLOTS)[number];

/** As famílias de munição do Tibia: flecha para bow, virote para crossbow. */
export const AMMO_FAMILIES = ['arrow', 'bolt'] as const;
export type AmmoFamily = (typeof AMMO_FAMILIES)[number];

/**
 * Como uma arma bate (#152, ADR 0026 decisões 3 e 4). `melee` usa o `attack` do item pela skill
 * corpo a corpo; `distance` usa o `attack` da MUNIÇÃO selecionada pela skill de distância, e
 * exige `ammoFamily`; `wand` (wand e rod) gasta `manaPerHit` por golpe, causa dano mágico por
 * faixa fixa (`damage`) e treina magia pela mana gasta — o `attack` do item fica 0.
 */
export const WEAPON_KINDS = ['melee', 'distance', 'wand'] as const;
export type WeaponKind = (typeof WEAPON_KINDS)[number];

/**
 * As FAMÍLIAS de arma (CMB-05, #333), a taxonomia decidida: `fist` (desarmado), as três
 * corpo a corpo (sword/axe/club), `distance` e as duas de conjuração (wand/rod).
 *
 * A família é DADO (DT-01): o motor não infere a família pelo NOME do item, e o ruleset não
 * tem `if` por id, nome ou vocação. `fist` é o fallback sem item — nunca aparece como arma
 * do catálogo, e `buildContent` recusa o item que a declare.
 */
export const WEAPON_FAMILIES = ['fist', 'sword', 'axe', 'club', 'distance', 'wand', 'rod'] as const;
export type WeaponFamily = (typeof WEAPON_FAMILIES)[number];

/**
 * O que uma família declara em `content` (CMB-05): alcance, tipo, recurso, fórmula e a SKILL
 * que a escala e cujo `gain` é a prática. A fórmula traz os fatores que são da FAMÍLIA
 * (`levelFactor`, `spread`); a contribuição por nível de skill vem do `damagePerLevel` da
 * skill apontada, para rebalanceá-la num lugar só.
 */
export const weaponFamilySchema = z.strictObject({
  id: z.enum(WEAPON_FAMILIES),
  name: z.string().min(1),
  /** O despacho que a família segue: corpo a corpo, distância ou wand/rod. */
  kind: z.enum(WEAPON_KINDS),
  /** A skill que escala a família e cujo `gain` define a prática. */
  skillId: z.string().min(1),
  /** Alcance default em tiles; a arma pode declarar o seu. */
  range: z.number().int().positive(),
  /** Tipo de dano default; a arma (ou a munição) pode declarar o seu. */
  damageType: z.enum(DAMAGE_TYPES),
  /** O recurso gasto por golpe. `mana` é de wand/rod; corpo a corpo e distância não gastam. */
  resource: z.enum(['none', 'mana']),
  /**
   * A fórmula da família, ausente em wand/rod (que usam a faixa fixa da arma). Os fatores são
   * provisórios e marcados em `_open`; `spread: 0` não consome sorteio, preservando o v1.
   */
  formula: z.object({
    levelFactor: z.number().nonnegative(),
    spread: z.number().min(0).max(1),
  }).optional(),
  _open: z.string().optional(),
});

export type WeaponFamilyDefinition = z.infer<typeof weaponFamilySchema>;

/**
 * A fórmula de poder de arma COMPILADA (CMB-05). `base` é o `attack` da arma (ou da munição,
 * resolvido no golpe); `skillFactor`/`skillStartingLevel` vêm da skill da família, e
 * `levelFactor`/`spread` da família. `spread: 0` devolve o valor sem consumir RNG.
 */
export interface WeaponPowerFormula {
  readonly base: number;
  readonly levelFactor: number;
  readonly skillFactor: number;
  readonly skillStartingLevel: number;
  readonly spread: number;
}

/**
 * O perfil de arma que o `sim` consome (CMB-05). É o contrato do `resolveWeaponPower`: família,
 * tipo, alcance, e OU uma fórmula escalada (`power`) OU a faixa fixa de wand/rod
 * (`fixedDamage`), com o recurso por golpe quando há (`manaPerHit`).
 */
export interface WeaponProfile {
  readonly family: WeaponFamily;
  readonly damageType: DamageType;
  readonly range: number;
  readonly power?: WeaponPowerFormula;
  readonly manaPerHit?: number;
  readonly fixedDamage?: { readonly min: number; readonly max: number };
  /** O `hitChance` da arma (#524), só dado — ver o comentário em `weaponSchema`. */
  readonly hitChance?: number;
  /** O componente elemental do golpe (#687), só corpo a corpo e só no `combat-v3`. */
  readonly element?: { readonly type: DamageType; readonly attack: number };
  /** Abaixo do level exigido bate metade em vez de não bater (#687, `combat-v3`). */
  readonly wieldUnproperly?: boolean;
}

export const weaponSchema = z.strictObject({
  kind: z.enum(WEAPON_KINDS),
  /**
   * A família (CMB-05). Ausente é normalizada pelo `kind` — corpo a corpo vira `sword`,
   * distância `distance`, wand `wand` —, o mesmo default que `buildContent` já aplicava ao
   * `kind` para preservar o conteúdo anterior. O conteúdo real declara a sua.
   */
  family: z.enum(WEAPON_FAMILIES).optional(),
  /** Alcance em tiles. Ausente vale o da família; `1` é corpo a corpo. */
  range: z.number().int().positive().optional(),
  /**
   * O TIPO de dano da arma (CMB-03, emenda do ADR 0031). Ausente é o default que preserva o
   * v1: `physical` em corpo a corpo e distância, `arcane` em wand e rod — o `kind: magic` de
   * antes. A wand declara o seu elemento (energia, terra) quando o conteúdo o conhece.
   */
  damageType: z.enum(DAMAGE_TYPES).optional(),
  ammoFamily: z.enum(AMMO_FAMILIES).optional(),
  manaPerHit: z.number().int().positive().optional(),
  damage: z.object({
    min: z.number().int().nonnegative(),
    max: z.number().int().nonnegative(),
  }).optional(),
  /**
   * O bônus/malus de acerto à distância da ARMA (#524, `hitchance` do Canary — o royal
   * crossbow tem `+3`). Só dado: a chance de acerto por skill/distância é da issue #522
   * (`chance de acerto à distância`); este campo carrega o número para quando ela existir.
   */
  hitChance: z.number().int().min(-100).max(100).optional(),
  /**
   * O componente elemental da arma (#687) — o `element<tipo>` do Canary (`elementfire 11` da
   * Fire Sword). `attack` do item continua só o FÍSICO; este é o ataque elemental somado a ele
   * no sorteio do golpe e dividido de volta por truncamento. Só o `combat-v3` lê; v1/v2 ignoram
   * (ADR 0031). Só em arma corpo a corpo — munição elemental é a #575.
   */
  element: z.strictObject({
    type: z.enum(DAMAGE_TYPES).refine((t) => t !== 'physical', 'elemento não pode ser physical'),
    attack: z.number().int().positive(),
  }).optional(),
  /**
   * O `unproperly` do Canary (#687): vestida abaixo do level exigido — o level caiu com a arma
   * na mão —, a arma bate METADE em vez de não bater. Só o `combat-v3` lê.
   */
  wieldUnproperly: z.boolean().optional(),
  /**
   * O `breakChance` do Canary (#575, `Weapon::executeUseWeapon`, `weapons.cpp:363-367`): só em
   * arma `distance` SEM `ammoFamily` — o arremessável (spear, throwing star), que É a própria
   * munição, sem lançador nem seleção por família (ADR 0026 d.3 não se aplica a ele). Cada tiro
   * rola `breakChance`% de consumir uma unidade do `ammunitionStock` do personagem (por ID do
   * ITEM, não por família); sem quebrar, "volta ao estoque" — não é decrementado. `buildContent`
   * exige exatamente um de `ammoFamily`/`breakChance` em toda arma `distance`.
   */
  breakChance: z.number().int().min(0).max(100).optional(),
});
export type Weapon = z.infer<typeof weaponSchema>;

/**
 * A arma pronta para uso (CMB-03/CMB-05): o `WeaponProfile` do `sim` mais o que o despacho e o
 * catálogo do servidor ainda leem (`kind`, `ammoFamily`). `damageType`, `range`, família e
 * fórmula já estão resolvidos no boot — o schema deixa os campos opcionais porque a forma do
 * arquivo não sabe do `kind`.
 */
export type ResolvedWeapon = WeaponProfile & {
  readonly kind: WeaponKind;
  readonly ammoFamily?: AmmoFamily;
  /** O arremessável (#575) — ver o comentário em `weaponSchema.breakChance`. */
  readonly breakChance?: number;
};

/**
 * Efeito passivo de anel (§13.9, SV-16) — ativo enquanto o item está EQUIPADO no dedo, ao
 * contrário de `charges`/`durationMs` (adiante neste schema), que são consumo por uso/tempo e
 * ainda não têm mecanismo nenhum (§21.3). Fechado por `kind`, como `botExitRuleSchema` e o
 * `effect` de magia: o `sim` só executa o que conhece, e um `kind` novo sem branch aqui é
 * recusado no boot em vez de virar um anel mudo que ninguém explica.
 *
 * - `energy-shield`: o Energy Ring. O dano sofrido debita da MANA antes da vida — a MESMA leitura
 *   que a condição `mana-shield` do utamo vita já faz em `applyDamageOutcome`
 *   (`sim/combat/outcome.ts`, CMB-08); as duas convergem no mesmo estágio e não se somam.
 *
 * O Life Ring NÃO é `ringEffect`: a regeneração dele é `bonuses.regeneration`, a do Canary
 * (`healthgain`/`manaticks`…), somada à da vocação (#688). O antigo `ringEffect` que
 * multiplicava o pulso da vocação (+300%) não tinha fonte no Tibia e saiu.
 */
export const RING_EFFECT_KINDS = ['energy-shield'] as const;
export type RingEffectKind = (typeof RING_EFFECT_KINDS)[number];

export const ringEffectSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('energy-shield') }),
]);
export type RingEffect = z.infer<typeof ringEffectSchema>;

/**
 * Condições que um item suprime enquanto vestido (`suppress*` do Canary, `MoveEvent::EquipItem`
 * → `addConditionSuppressions`). Só `drunk` por ora: o Draconya não tem afogamento
 * (`suppressdrown`), e o enum cresce junto com a condição que ele suprime.
 */
export const SUPPRESSIBLE_CONDITIONS = ['drunk'] as const;
export type SuppressibleCondition = (typeof SUPPRESSIBLE_CONDITIONS)[number];

/** De onde uma instância veio. É a proveniência do §25.3, e ela existe desde o dia um. */
/**
 * De onde uma instância veio (§25.3). `starting-kit` e `vocation-choice` são as duas únicas
 * origens em que o item é DADO, não dropado (ADR 0026, decisões 2 e 3; #153 e #154).
 */
export const ITEM_ORIGINS = [
  'loot', 'boss', 'quest', 'market', 'admin', 'starting-kit', 'vocation-choice',
  // A mochila que a morte devolve a quem ficou sem nenhuma (#571, ADR 0042 decisão 4): dada pelo
  // sistema, não dropada nem comprada — `Blessings.PlayerDeath` do Canary faz `addItem(ITEM_BAG)`.
  'death-replacement',
  // Comprado do NPC por gold (#631, ADR 0059 d.2): a exercise weapon do `buy-item` — `market` é o
  // comércio entre jogadores, e o NPC do Canary é outra proveniência.
  'purchase',
] as const;
export type ItemOrigin = (typeof ITEM_ORIGINS)[number];

/**
 * Um requisito de vocação (FUN-92, #524): UMA vocação, ou VÁRIAS — a peça/poção do Tibia que
 * duas vocações usam igual (Magic Plate Armor em Knight+Paladin, Focus Cape em Sorcerer+Druid).
 * Magia continua com um arquivo por vocação (`haste-knight.json` etc., #155): lá o formato pode
 * mudar por vocação (mana, alcance); aqui o item/suprimento é IDÊNTICO nas duas, e duplicar o
 * arquivo só para variar `vocationId` divergiria peso/preço/atributo no primeiro balanceamento.
 * `min(2)` porque uma vocação só é o `z.string()` de sempre — a lista existe para dizer "mais de
 * uma", nunca para repetir o caso simples.
 */
export const vocationRequirementSchema = z.union([
  z.string().min(1),
  z.array(z.string().min(1)).min(2),
]);
export type VocationRequirement = z.infer<typeof vocationRequirementSchema>;

/**
 * Casa a vocação do portador com o requisito (FUN-92, #524). Ausente é "qualquer um", como
 * sempre; string é a comparação de sempre; lista aceita qualquer uma das declaradas. Mora aqui
 * (e não em `sim`) porque é pura leitura do formato do schema — `Inventory#meets` e `useSupply`
 * chamam a mesma função em vez de reimplementar a união cada um do seu jeito.
 */
export function matchesVocationRequirement(
  required: VocationRequirement | undefined, actual: string | null,
): boolean {
  if (required === undefined) return true;
  if (actual === null) return false;
  return typeof required === 'string' ? actual === required : required.includes(actual);
}

/**
 * Os grupos de cooldown do consumível (ADR 0032 d.2/d.6). O motor v2 os lê: o uso do supply
 * tranca o livro do grupo, como a magia tranca o dela.
 */
export const CONSUMABLE_GROUPS = ['potion', 'attack', 'healing', 'support'] as const;
export type ConsumableGroup = (typeof CONSUMABLE_GROUPS)[number];

/**
 * O efeito do consumível. `blessing` EXISTIU aqui (M22/#726) como andaime — a carga de
 * `blessing-charge` que a TP-03 nunca chegou a executar de verdade — e foi REMOVIDO pelo #570:
 * bênção passou a ser serviço de Cidade (compra por intenção, ADR 0052), nunca item de mochila.
 * Sem consumível `blessing` hoje, o catálogo real fica sem `kind: 'consumable'` nenhum — o que
 * a ADR 0026 d.3 chamava de "o único que sobrevive" deixou de existir, e é o esperado: nada do
 * recorte atual usa item físico consumível.
 */
export const consumableEffectSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('heal'), amount: z.number().int().positive() }),
  z.object({ kind: z.literal('mana'), amount: z.number().int().positive() }),
  z.object({
    kind: z.literal('damage'),
    basePower: z.number().int().positive(),
    range: z.number().int().positive(),
    area: z.object({
      shape: z.literal('circle'),
      radius: z.number().int().positive(),
      centered: z.literal('target').default('target'),
    }),
    damageType: z.enum(DAMAGE_TYPES).default('arcane'),
  }),
  /**
   * Comida (#726, ADR 0049 decisão 5, emenda ao ADR 0043): `durationMs` é `value × 12` segundos
   * em milissegundos, o mecanismo do Canary (`foods.lua`: `itemFood[1] * 12`, teto de 1200 s —
   * "You are full") — soma a `CharacterRuntime.fedMs`, capado em `FOOD_CAP_MS`
   * (`packages/sim/src/food.ts`). O efeito em si (regeneração) só é lido quando
   * `progression.regeneration.requiresFood` está ligado; comer sempre soma o contador, ligado
   * ou não, porque é assim que o Tibia também funciona (a flag decide quem LÊ, não quem ESCREVE).
   */
  z.object({ kind: z.literal('food'), durationMs: z.number().int().positive() }),
]);
export type ConsumableEffect = z.infer<typeof consumableEffectSchema>;

/**
 * Os modificadores de crítico e leech que o ATACANTE ganha por VESTIR o item (M30-04, #551).
 *
 * Pontos-base (×10000) — a MESMA escala do `criticalhitchance`/`criticalhitdamage`/
 * `lifeleechamount`/`manaleechamount` do Canary (`data/items/items.xml`, conferido em
 * 2026-09-26 contra `47dfd51`): `1000` é 10 %, `3500` é +35 % de dano. `Inventory.combatModifiers`
 * (`sim`) SOMA os equipados, como já faz `armor`/`skillBonus`/`speedBonus` — um item só nunca é
 * o total do personagem.
 *
 * `lifeleechchance`/`manaleechchance` do Canary (também em `items.xml`, 19/17 itens) **não**
 * têm campo aqui de propósito: `Game::calculateLeechAmount` (`src/game/game.cpp:9058`) só lê a
 * skill AMOUNT (`SKILL_LIFE_LEECH_AMOUNT`/`SKILL_MANA_LEECH_AMOUNT`) — a CHANCE não entra na
 * fórmula —, e o próprio Canary pula as duas ao montar a descrição do item (`item.cpp:91`,
 * `if (i == SKILL_MANA_LEECH_CHANCE || i == SKILL_LIFE_LEECH_CHANCE) continue;`): são
 * atributos vestigiais nesta versão, sem consumidor na resolução de dano — conferido, não
 * suposto (a pergunta do `_open` de `#548` "conferir se a chance ainda é lida" fica respondida
 * aqui: não é).
 *
 * Ausente é o item comum de sempre, sem bônus nenhum — o total ZERO de todo conteúdo hoje, que
 * preserva bit a bit o v1/v2/v3 (ver `combat/modifiers.ts` do `sim`).
 */
export const itemCombatModifiersSchema = z.strictObject({
  criticalChance: z.number().int().min(0).max(10_000).optional(),
  criticalDamage: z.number().int().min(0).optional(),
  lifeLeech: z.number().int().min(0).optional(),
  manaLeech: z.number().int().min(0).optional(),
});
export type ItemCombatModifiers = z.infer<typeof itemCombatModifiersSchema>;

/**
 * A absorção por tipo do item (M30-05, #552). **Percentual INTEIRO**, a escala do Canary
 * (`absorbpercent*` em `data/items/items.xml`: `8` é 8 %) — não a fração de
 * `mitigation.resistances`, porque o `combat-v3` aplica cada item em SEQUÊNCIA com arredondamento
 * (`damage -= round(damage × p / 100)`, `Player::blockHit`, `player.cpp:3938-3962`), e a conta
 * inteira é a que o Canary faz.
 *
 * `percent` é o `absorbpercent*`; negativo é o item que AUMENTA o dano recebido daquele tipo. É o
 * MESMO atributo que `mitigation.resistances` já carregava nos itens do kit (o `_open` de cada um
 * cita o `absorbpercent*` de origem): o `combat-v3` lê os dois como absorção do item, e por isso
 * o item recusa declarar os dois no mesmo tipo (`itemSchema`). `flat` é o `absorbFlat` do
 * `Creature` do Canary: subtraído ANTES da imunidade e da defesa, sem piso abaixo de zero.
 */
export const itemAbsorbSchema = z.strictObject({
  percent: z.number().int().gte(-100).lt(100).optional(),
  flat: z.number().int().positive().optional(),
});

/**
 * O reflexo por tipo (M30-05, #552): `percent` INTEIRO do dano bloqueado e `flat` em pontos,
 * devolvidos ao ATACANTE com o teto `ceil(1 % da vida máxima dele)` (`game.cpp:7957-7981`). O
 * `reflectdamage` do Canary (5 itens) é `flat` de `physical` (`item_parse.cpp:971`).
 */
export const reflectSchema = z.strictObject({
  percent: z.number().int().positive().max(200).optional(),
  flat: z.number().int().positive().optional(),
});

/**
 * O reflexo COMPILADO (#552): as duas tabelas completas por tipo, zero onde nada reflete. É a
 * forma que o `Defender.reflect` do `sim` lê, e a que o reflexo de MONSTRO (#683) reusa — a fonte
 * muda, o mecanismo não.
 */
export interface CompiledReflect {
  readonly percent: Readonly<Record<DamageType, number>>;
  readonly flat: Readonly<Record<DamageType, number>>;
}

/**
 * A DEFINIÇÃO de um item (§21.2, FUN-76).
 *
 * **Estrito, ao contrário dos outros schemas** (FUN-94). Zod DESCARTA chave desconhecida em
 * silêncio, e é justamente o que aconteceria com um `appearanceId` escrito aqui por hábito
 * depois de a aparência ter mudado de lugar: o arquivo pareceria certo, o campo não iria a
 * lugar nenhum, e o item apareceria com a arte errada sem nada acusar. O mesmo vale para o
 * monstro e o `outfitId`.
 *
 *
 * **Atributos base são FIXOS.** Não há rolagem aleatória: duas espadas do mesmo id são
 * idênticas, e item melhor é item DIFERENTE. É a decisão do §21.2, e ela apaga toda a
 * matemática de variação por instância — junto com a pergunta "por que a minha é pior".
 *
 * O que distingue uma instância da outra é identidade e proveniência, não número.
 */
export const itemSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  /**
   * O rótulo curto da barra/Mochila (AB-13, #424). Opcional: só o item que precisa de uma
   * forma abreviada o declara, e a tela cai no `name` quando ele falta. É APRESENTAÇÃO de
   * texto, não arte (invariante 6).
   */
  shortLabel: z.string().min(1).optional(),
  /**
   * `container` é a mochila (ADR 0026, decisão 6): o item que se veste nas costas e dentro do
   * qual o loot cai — os lugares dele entram com o container no `sim` (issue #160). `consumable`
   * é o tipo que sobrevive ao modelo abstrato: poção, runa e munição NÃO são itens — são
   * `supply`/`ammunition`, uma seleção que debita gold no uso/tiro. A comida é `consumable` real
   * (#726); a carga de bênção que também era (`blessing-charge`, M22) foi removida pelo #570 —
   * bênção virou serviço de Cidade, nunca item de mochila.
   */
  kind: z.enum([
    'weapon', 'armor', 'shield', 'ring', 'amulet', 'container', 'other', 'consumable',
  ]),
  slot: z.enum(ITEM_SLOTS).optional(),
  /**
   * Ocupa as duas mãos (o bow): equipar recusa escudo, e vice-versa — a regra é do `sim`
   * (issue #152); aqui só a forma. Fora de arma é conteúdo quebrado, e o boot recusa.
   */
  twoHanded: z.boolean().default(false),
  /**
   * Como a arma bate (#152). Obrigatório em `kind: 'weapon'` e proibido fora dela —
   * `buildContent` confere, porque o schema de um campo opcional não sabe do `kind`.
   */
  weapon: weaponSchema.optional(),
  /**
   * Lugares iniciais de um container (#160, ADR 0026 decisão 6). Obrigatório em
   * `kind: 'container'` e proibido fora dela — `buildContent` confere, como faz com `weapon`.
   */
  initialSlots: z.number().int().positive().optional(),
  /** Em unidades de capacidade. Capacidade é do personagem (§21.4). */
  weight: z.number().nonnegative(),
  /**
   * Preço de venda ao NPC, em gold (#188, ADR 0027 decisão 6). OBRIGATÓRIO e sem default: um
   * item sem preço é decisão de conteúdo, e o schema recusar é o que faz a decisão ser tomada.
   * Zero é "não se vende" — a bolsa da party o devolve ao líder em vez de vendê-lo. É o mesmo
   * campo que a autovenda (§22.1, E5) vai ler.
   */
  value: z.number().int().nonnegative(),
  /**
   * Empilha na mesma linha de inventário? Queijo empilha; espada não. O schema não impõe
   * `stackable: true` a consumível — a `blessing-charge` (removida no #570) era o exemplo de
   * carga única não-empilhável, e um consumível futuro pode voltar a precisar disso.
   */
  stackable: z.boolean().default(false),
  /**
   * É um creature product (#603, o `primarytype="creature products"` do Canary `items.xml`)? É o
   * que o charm Gut lê: no `generateLootRoll` (`monstertype.lua`) a chance de drop de um item
   * desta classe sobe `ceil(chance × charm / 100)` quando o dono do cadáver tem o charm para o
   * monstro. Só o importador o escreve (fatia `creature-products`); ausente é "não é".
   */
  creatureProduct: z.literal(true).optional(),
  attack: z.number().int().nonnegative().default(0),
  armor: z.number().int().nonnegative().default(0),
  /**
   * A DEFESA da peça (CMB-04, emenda do ADR 0031): o que ela bloqueia, e não o que ela aguenta.
   * Diferente da armadura, a defesa vale só contra os tipos aprovados no perfil (`physical` no
   * v1) e só na combinação aprovada — escudo, ou arma corpo a corpo de uma mão. Bow/twoHanded e
   * wand/rod não têm defesa residual, e `buildContent` recusa `defense` fora dessas combinações.
   * `0` é item sem defesa, o default que preserva o v1: nenhum golpe muda por causa dele.
   */
  defense: z.number().int().nonnegative().default(0),
  /**
   * O `extradef` da ARMA (#549, M30-02; `Player::getDefense`, Canary `player.cpp:776-813`) — a
   * defesa ADICIONAL que só conta na fórmula de defesa/mitigação do JOGADOR (`playerDefense`/
   * `playerMitigation`, `sim/combat/player-defense.ts`), somada ao `defense` do escudo (ou da
   * própria arma, se ela for de duas mãos). Diferente de `defense` (CMB-04: o que a peça BLOQUEIA
   * no `combat-v1`/`v2`, e a magnitude do estágio novo do `combat-v3`), `extraDefense` só existe
   * dentro da conta do jogador — nunca aparece isolado. `0` é o default que preserva toda arma
   * sem o atributo (a maioria: só a Mystic Blade do kit level 200 o declara, Canary `items.xml`
   * id 7384, `extradef value="2"`). Só em `kind: 'weapon'` — `buildContent` recusa o resto,
   * como já faz com `defense`.
   */
  extraDefense: z.number().int().nonnegative().default(0),
  /**
   * O escudo é um SPELLBOOK (#549, M30-02; `Item::isSpellBook`, Canary `item.hpp:553-555`) — o
   * "escudo" de Sorcerer/Druid, vestido com wand/rod na outra mão. Só muda `playerMitigation`:
   * em vez do `primaryShield` da vocação, ele usa o `secondaryShield` como `distanceFactor`
   * (a mesma leitura que o `quiver` do Paladin usa, por um mecanismo diferente — arco/besta).
   * Só em `kind: 'shield'`, e nunca junto de `quiver` — `buildContent` recusa as duas.
   */
  spellbook: z.boolean().default(false),
  /**
   * O escudo é um QUIVER (#549, M30-02; `Item::isQuiver`, Canary `item.hpp:544-546`) — o
   * carcás que segura munição na mão secundária. Mesma leitura do `spellbook` em
   * `playerMitigation` (`secondaryShield` como `distanceFactor`); nenhum item do catálogo atual
   * o declara (a Royal Crossbow do Paladin é de duas mãos, sem escudo — o `ammoFamily` da ARMA
   * já cobre o `distanceFactor` dela). Só em `kind: 'shield'`, e nunca junto de `spellbook`.
   */
  quiver: z.boolean().default(false),
  /**
   * O bônus de PERFECT SHOT da aljava (#575; `Player::getPerfectShotDamage`, Canary
   * `weapons.cpp:706-718`/`game.cpp:8500-8509`, `perfectshotrange`/`perfectshotdamage` do
   * `items.xml` — ex. eldritch quiver, id 36666). Soma `damage` ao tiro (munição OU arremessável)
   * quando a distância de Chebyshev até o alvo é EXATAMENTE `range` — nem mais perto, nem mais
   * longe. Só em `kind: 'shield'` (a peça que ocupa a mão secundária, como `quiver`/`spellbook`
   * acima); a maioria dos quivers do Canary não o declara — ausente é a aljava comum, sem bônus.
   * Não exige `quiver: true`: as duas leituras são independentes (uma é `secondaryShield` na
   * mitigação, a outra é dano extra no tiro).
   */
  perfectShot: z.strictObject({
    range: z.number().int().positive(),
    damage: z.number().int().positive(),
  }).optional(),
  /**
   * O que o personagem precisa para equipar. Vazio é item que qualquer um veste.
   *
   * Vocação aqui é o mesmo campo que a magia usa (FUN-92): o personagem nasce sem uma e
   * escolhe no level 8, então item de vocação é inacessível até lá por construção.
   */
  requires: z.object({
    level: z.number().int().positive().optional(),
    /** Uma vocação, ou várias (#524) — ver `vocationRequirementSchema`. */
    vocationId: vocationRequirementSchema.optional(),
    /** O `magicLevel` da runa (#165). Hoje só o supply de dano o usa. */
    magicLevel: z.number().int().nonnegative().optional(),
  }).default(() => ({})),
  /**
   * Cargas e duração (§21.3, ADR 0032 d.8). Equipamento comum não tem durabilidade; anel gasta
   * por TEMPO e colar por CARGA — os dois consumidos pela hunt (`EQUIP_EXPIRE`, cargas por golpe).
   *
   * `durationMs` é tempo VESTIDO (#689): fora do corpo o prazo pausa, e vestir de novo retoma o
   * restante guardado na instância (`overlay.durationRemainingMs`, ADR 0046) — o `stopduration`
   * do Canary. Na Cidade, que não simula, o anel no dedo também fica pausado.
   */
  charges: z.number().int().positive().optional(),
  durationMs: z.number().int().positive().optional(),
  /**
   * Bônus PASSIVO enquanto o item está equipado (#524, kit level 200; #688): skills (inclusive
   * magic level — que aqui é a skill `magic`, FUN-92), velocidade, regeneração própria e
   * supressão de condição — o que o Canary aplica em `MoveEvent::EquipItem`. Ausente é o item
   * comum de sempre, sem bônus nenhum. Mora num objeto só, como `ringEffect`, porque os dois são
   * "efeito de estar vestido" — ao contrário de `charges`/`durationMs`, que são consumo.
   *
   * Um item pode declarar VÁRIAS skills: o Canary soma todas (`setVarSkill` num laço por skill),
   * e 54 itens base do `items.xml` têm mais de uma (collar of red plasma, id 23528: sword, axe e
   * club +4). Os `skillboost` dentro de `imbuementslot` não contam — aquilo é a lista de
   * imbuements permitidos, não bônus.
   */
  bonuses: z.object({
    /**
     * As skills do item (`skill*`/`magiclevelpoints` do Canary). Uma entrada por skill: o boot
     * recusa skillId repetido no mesmo item (`buildContent`).
     */
    skills: z.array(z.strictObject({
      skillId: z.string().min(1),
      amount: z.number().int().positive(),
    })).min(1).optional(),
    /** Velocidade somada direto a `character.speed` enquanto vestido (boots of haste). */
    speed: z.number().int().positive().optional(),
    /**
     * MAGIC LEVEL ESPECIALIZADO por elemento enquanto vestido (#680): as chaves
     * `<elemento>magiclevelpoints` do Canary (`firemagiclevelpoints` → `fire`). Soma no ML só da
     * fórmula de magia/runa do MESMO elemento (`combat.cpp:1979`), nunca no requisito de ML.
     */
    specializedMagicLevel: z.partialRecord(
      z.enum(SPECIALIZED_MAGIC_ELEMENTS), z.number().int().positive(),
    ).optional(),
    /**
     * Regeneração PRÓPRIA do item (`healthgain`/`healthticks`/`managain`/`manaticks`), somada à
     * da vocação. O primeiro ganho sai `*TicksMs` depois de vestir, como na
     * `ConditionRegeneration` do Canary, que acumula o intervalo antes de curar.
     */
    regeneration: z.strictObject({
      healthGain: z.number().int().nonnegative(),
      healthTicksMs: z.number().int().positive(),
      manaGain: z.number().int().nonnegative(),
      manaTicksMs: z.number().int().positive(),
    }).refine((r) => r.healthGain > 0 || r.manaGain > 0, 'regeneração sem ganho').optional(),
    /** Condições que o item suprime enquanto vestido (`suppress*` do Canary). */
    suppress: z.array(z.enum(SUPPRESSIBLE_CONDITIONS)).min(1).optional(),
    /**
     * A CAPACIDADE DE MAGIC SHIELD do item (#627, M44-09): o `magicshieldCapacityflat` e o
     * `magicshieldCapacitypercent` do `items.xml` (4 itens — eldritch folio/tome, cocoa e creamy
     * grimoire), os dois inteiros de `Abilities` (`items.hpp:50-51`), somados pelos equipados
     * (`Player::getMagicShieldCapacityFlat`/`Percent`, `player.cpp:7633-7681`). É o número
     * DECLARADO pelo Canary e nada mais: no checkout 47dfd51 ele só é LIDO pela descrição do item
     * (`item.cpp:134-141`, `:2727-2735`) e pelo pacote de defesa da Cyclopedia
     * (`protocolgame.cpp:5661-5663`) — `magic_shield.lua` e `ConditionManaShield` montam o
     * escudo SEM consultá-lo, e nenhum script de `data/` chama o getter. Por isso o `sim` não o lê
     * (ver `docs/product/items.md`, "Atributos raros"): aplicá-lo ao escudo seria
     * comportamento que o Canary não tem.
     */
    magicShieldCapacity: z.strictObject({
      flat: z.number().int(),
      percent: z.number().int(),
    }).refine((c) => c.flat !== 0 || c.percent !== 0, 'capacidade de magic shield sem valor').optional(),
  }).optional(),
  /**
   * Quantos imbuements a peça aceita (ADR 0046, #604) — o `imbuementslot` do Canary
   * (`ItemAttribute_t::IMBUEMENT_SLOT`, `src/enums/item_attribute.hpp:36`), de 1 a 3 no
   * `items.xml`. É o TETO da definição; os imbuements aplicados são estado da INSTÂNCIA e
   * moram no overlay da entrada de inventário (`sim`, `item-overlay.ts`), nunca aqui — o item
   * de catálogo continua fixo pelo id. Ausente é a peça que não aceita imbuement. Quem o
   * preenche no catálogo importado é o importador (M34-02).
   */
  imbuementSlots: z.number().int().min(1).max(3).optional(),
  /** Crítico e leech do item, enquanto vestido (M30-04, #551) — ver `itemCombatModifiersSchema`. */
  combatModifiers: itemCombatModifiersSchema.optional(),
  /**
   * O que o EQUIPAMENTO resiste e ao que é imune (CMB-03). Ausente é o item neutro — o default
   * preserva o v1, em que nenhum item tinha mitigação. Soma com os outros equipados no boot do
   * defensor (ver `Inventory.mitigation`).
   */
  mitigation: mitigationSchema.default(() => ({ resistances: {}, immunities: [] })),
  /**
   * Absorção por tipo (M30-05, #552) — ver `itemAbsorbSchema`. Só o `combat-v3` lê; ausente é o
   * item de sempre.
   */
  absorb: z.partialRecord(z.enum(DAMAGE_TYPES), itemAbsorbSchema).optional(),
  /**
   * Aumento do dano CAUSADO por tipo, em percentual INTEIRO (M30-05, #552): o `increasePercent`
   * do atacante em `applyAbsorbDamageModifications` (`creature.cpp:935-940`), somado entre os
   * equipados. Só o `combat-v3` lê.
   */
  increase: z.partialRecord(z.enum(DAMAGE_TYPES), z.number().int().gt(-100).lte(100)).optional(),
  /** Reflexo por tipo (M30-05, #552) — ver `reflectSchema`. Só o `combat-v3` lê. */
  reflect: z.partialRecord(z.enum(DAMAGE_TYPES), reflectSchema).optional(),
  /**
   * O `cleavepercent` do Canary (M30-05, #552; 6 itens em `items.xml`): o golpe CORPO A CORPO com
   * arma também acerta os dois tiles que flanqueiam o alvo, com esta fração INTEIRA de uma rolagem
   * própria de dano (`WeaponMelee::useWeapon`, `weapons.cpp:531-589`). Soma entre os equipados.
   */
  cleavePercent: z.number().int().positive().max(100).optional(),
  /**
   * O `elementalbond` do Canary (#627, M44-09; `ItemType::elementalBond`, `items.hpp:296`) — 32
   * itens em `items.xml`, e TODOS são arma `weapontype="fist"` (sais, katars, bôs e nunchakus).
   * 30 pedem Monk; `traditional sai` pede Knight (e para o Knight o bond é mudo); e
   * `transcendent bo` (`items.xml:84976-84998`) não tem script nem vocação, então um Monk o
   * equipa e o bond dele dispara. É o tipo de dano que TROCA o da magia do Monk quando a arma
   * está na mão, e são DOIS pontos de leitura com portões diferentes: `Combat::getCombatDamage`
   * (`combat.cpp:159-174`) só troca o tipo para `VOCATION_MONK_CIP`, magia INSTANTÂNEA e que não
   * cure; `Combat::sendCombatEffect` (`combat.cpp:1143-1159`) recolore o efeito visual só com o
   * Monk e uma arma de bond na mão — sem o portão de instantânea/cura. Para qualquer outra
   * vocação o bond é um atributo mudo. O Monk está fora do corte (ADR 0038 d.5) e a família
   * `fist` não é declarável (DT-01), então nenhum item do catálogo o carrega hoje e nenhuma
   * vocação o lê: o campo existe para o importador não perder o dado e para o dia em que o corte
   * mudar. Só em `kind: 'weapon'` (`buildContent`).
   */
  elementalBond: z.enum(ELEMENTAL_BOND_TYPES).optional(),
  /**
   * O item PROTEGE quem o veste da perda de item na morte (#571, ADR 0042 decisão 4) — o
   * Amulet of Loss (`ITEM_AMULETOFLOSS`, id 3057, `src/utils/utils_definitions.hpp:638` do
   * Canary): `Blessings.PlayerDeath` (`data/libs/systems/blessing.lua:82-99`) confere só o slot do
   * colar, então a flag só vale em item de `slot: 'neck'`. Protegido, NENHUM item é sorteado; e a
   * morte consome UM colar assim (`Player::death`, `player.cpp:4215-4219`). Ausente é o item comum
   * de sempre. É a MESMA leitura da regra do Canary, mas por dado em vez de por id fixo em código.
   */
  protectsOnDeath: z.boolean().default(false),
  /** Efeito passivo de anel, ativo enquanto vestido (§13.9, SV-16). Só em `kind: 'ring'`. */
  ringEffect: ringEffectSchema.optional(),
  /** O efeito do consumível. Só em `kind: 'consumable'` — hoje só a comida (#726). */
  effect: consumableEffectSchema.optional(),
  /** De onde um item IMPORTADO veio (ADR 0038 decisão 2). Ausente em item autorado à mão. */
  source: catalogSourceSchema.optional(),
  /**
   * O item É uma ferramenta de cenário (#727, ADR 0050 d.1): `use.tool` diz qual interativo do
   * mapa (`tilemapSchema.interactables[].requires.tool`) ele destrava — machete corta capim,
   * rope sobe de um rope spot, shovel cava a pile, pick abre rachadura, key abre porta de chave.
   * NÃO é consumida: `#useOnMap` só confere que a ferramenta compatível está na mochila ou na
   * mão, como o Tibia faz (a machete do kit de nascimento nunca acaba). Ausente é o item comum
   * de sempre — a maioria não destrava nada.
   */
  use: z.object({
    tool: z.enum(['machete', 'rope', 'shovel', 'pick', 'key']),
    /**
     * Só quando `tool === 'key'` (#732, ADR 0050 d.6 T2): o id que precisa bater com o
     * `requires.keyId` da porta de chave (`tilemapSchema.interactables[]`) — o mesmo
     * `item.actionid` que o Canary compara entre a chave e a porta (`key_door.lua`:
     * `item.actionid == target.actionid`, "The key does not match." quando diverge). Uma
     * ferramenta que NÃO é chave nunca precisa de um id específico — machete corta qualquer
     * capim —, e é por isso que só `key` declara este campo.
     */
    keyId: z.number().int().positive().optional(),
  }).optional(),
  /**
   * O item É uma exercise weapon (#631, ADR 0059 d.1): usada num boneco, gasta UMA carga por golpe
   * (`charges` é o total da definição — 500/1 800/14 400; as restantes são estado da INSTÂNCIA no
   * overlay, `ItemInstanceOverlay.charges`) e credita a skill `skillId` (`SKILL_*` da tabela
   * `exerciseWeaponsTable` de `exercise_training_weapons.lua`; `magic` para rod/wand). Só em
   * `kind: 'other'` com `charges` — `buildContent` confere.
   */
  exercise: z.strictObject({ skillId: z.string().min(1) }).optional(),
  /**
   * Compra mínima por gold (#631, ADR 0059 d.2): enquanto não há loja geral (E5), `buy-item
   * { itemId }` só aceita item com `purchasable: true`, ao `buyPrice` — o MENOR `buy` de NPC do
   * Canary (`npc-prices.ts`, ADR 0038 d.6). A loja geral substitui o mecanismo sem mudar o dado.
   * Os dois andam juntos (`superRefine` abaixo).
   */
  purchasable: z.literal(true).optional(),
  buyPrice: z.number().int().positive().optional(),
  _open: z.string().optional(),
}).superRefine((item, ctx) => {
  // `purchasable` e `buyPrice` são um par: preço sem `purchasable` seria um número que ninguém lê,
  // e `purchasable` sem preço, um item que se leva de graça.
  if ((item.purchasable === true) !== (item.buyPrice !== undefined)) {
    ctx.addIssue({ code: 'custom', message: '`purchasable` e `buyPrice` vão juntos' });
  }
  // Uma exercise weapon é um item de mochila com cargas: sem `charges` não haveria o que gastar, e
  // com `slot`/`weapon` ela viraria uma arma que o combate leria.
  if (item.exercise !== undefined) {
    if (item.kind !== 'other') ctx.addIssue({ code: 'custom', message: '`exercise` só vale em `kind: "other"`' });
    if (item.charges === undefined) ctx.addIssue({ code: 'custom', message: '`exercise` exige `charges`' });
    if (item.slot !== undefined || item.weapon !== undefined) {
      ctx.addIssue({ code: 'custom', message: '`exercise` não se veste nem é arma' });
    }
  }
  // O schema de campo opcional não sabe do `kind`; é aqui que a forma de um tipo não invade o
  // outro. Um `effect` num anel seria descartado em silêncio se o schema fosse aberto.
  if (item.kind === 'consumable') {
    if (item.effect === undefined) ctx.addIssue({ code: 'custom', message: 'consumível sem `effect`' });
  } else if (item.effect !== undefined) {
    ctx.addIssue({ code: 'custom', message: 'só `kind: consumable` tem `effect`' });
  }
  // `mitigation.resistances` e `absorb.percent` são o MESMO `absorbpercent*` do Canary (#552): os
  // dois no mesmo tipo seria somar o atributo duas vezes, ou deixar a regra depender da ordem de
  // leitura. Escolha um.
  for (const type of DAMAGE_TYPES) {
    if (item.absorb?.[type]?.percent !== undefined && item.mitigation.resistances[type] !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: `"${type}" declara \`mitigation.resistances\` e \`absorb.percent\` ao mesmo tempo — escolha um`,
      });
    }
  }
  // `keyId` só faz sentido para a ferramenta `key` (#732) — declará-lo em `machete`/`rope`/
  // `shovel`/`pick` seria um número que nada lê, e pareceria decisão de conteúdo sem ser.
  if (item.use?.keyId !== undefined && item.use.tool !== 'key') {
    ctx.addIssue({ code: 'custom', message: '`use.keyId` só em `use.tool: "key"`' });
  }
});

/** O item como o ARQUIVO o descreve — sem aparência, que vive na tabela (FUN-94). */
export type ItemDefinition = z.infer<typeof itemSchema>;

/**
 * A forma da área (#155, ADR 0026 decisão 5; referência §19). `rows`, `wave`, `cleave` e `beam`
 * saem do LANÇADOR na direção dele; `circle` é centrado no alvo — ou no lançador, e aí a magia não
 * exige alvo nem alcance; `cross` (Explosion) é centrado no alvo, sem direção.
 *
 * Mora aqui, antes de supply, porque o efeito de CURA do supply a referencia (#475) e porque a
 * ability de monstro (CMB-06) reusa a MESMA geometria: a forma é conteúdo, e a matriz não se
 * copia de engine nenhuma (ADR 0019).
 */
export const spellAreaSchema = z.discriminatedUnion('shape', [
  z.object({
    shape: z.literal('circle'),
    /**
     * Raio 1 é o 3x3 completo (9 tiles); do raio 2 em diante os cantos caem pela distância de
     * Manhattan (`|dx| + |dy| <= radius + ⌊radius/2⌋`) — o raio 3 rende os 37 tiles da
     * `AREA_CIRCLE3X3` do Canary (#472, ADR 0019).
     */
    radius: z.number().int().positive(),
    /** `target` exige alvo e alcance; `caster` não exige nenhum dos dois. */
    centered: z.enum(['target', 'caster']).default('target'),
  }),
  /** Cruz de `radius` tiles nos quatro eixos cardeais mais o centro (Explosion) — 1 → 5 tiles. */
  z.object({ shape: z.literal('cross'), radius: z.number().int().positive() }),
  /**
   * LEGADO DE FIXTURE (#679): cone à frente com a fileira k (1..length) de largura 2·⌊k/2⌋+1 →
   * 1, 3, 3, 5, 5. É a aproximação do #523, que contou as `AREA_WAVEn` sem a fileira do `3` e
   * errou uma fileira em toda onda — e `AREA_SQUAREWAVE5` e a onda de monstro nem cabem nesta
   * fórmula. O catálogo usa `rows`, e `load.test.ts` proíbe `wave` em `data/`; fica no schema só
   * porque fixtures de teste o usam, bit a bit iguais.
   */
  z.object({ shape: z.literal('wave'), length: z.number().int().positive() }),
  /**
   * Fileiras à frente, uma largura cada (#679). A fileira i está a i + 1 tiles: a 0 é o `3`
   * do Canary, ancorado um passo à frente (`getCasterPosition`). Transcreve a CONTAGEM por
   * fileira da `AREA_*`, nunca a matriz (ADR 0019).
   */
  z.object({
    shape: z.literal('rows'),
    widths: z.array(z.number().int().positive().refine((w) => w % 2 === 1, {
      message: 'largura de fileira é ímpar (centrada na linha da frente)',
    })).min(1),
  }),
  /**
   * Os três tiles imediatamente à frente (Front Sweep, Lesser Front Sweep). O Canary
   * (`AREA_WAVE6`, `data/scripts/lib/register_spells.lua`: `{0,0,0,0,0} {0,1,3,1,0}
   * {0,0,0,0,0}`) ancora essa fileira em `getNextPosition(dir, casterPos)` — um passo à frente
   * do lançador, não na posição dele —, então em coordenadas do mundo os três tiles (os dois
   * `1` e o `3`, que TAMBÉM conta como atingido) caem juntos, um passo adiante: exatamente
   * `distance` 1, largura 3. #523 chegou a "corrigir" isto para os dois tiles ao LADO do
   * lançador lendo só a matriz local, sem a âncora do motor — revertido numa revisão.
   */
  z.object({ shape: z.literal('cleave') }),
  /**
   * Linha reta de `length` tiles à frente, largura 1: `beam n` é exatamente a `AREA_BEAMn` do
   * Canary, contando o `3` — ancorado um passo à frente (`spells.cpp` `getCasterPosition`) e
   * atingido como qualquer valor não-zero (`AreaCombat::getList`, #679).
   */
  z.object({ shape: z.literal('beam'), length: z.number().int().positive() }),
  /**
   * UM tile só, no ALVO mirado (#591): a runa de campo simples (Fire/Poison/Energy Field) e a
   * Destroy Field mesma miram um único tile vazio — diferente do círculo no alvo, que sempre
   * cobre mais de um. Sem parâmetro: a geometria inteira é "o tile que o jogador apontou".
   */
  z.object({ shape: z.literal('point') }),
  /**
   * A parede (#591, Magic Wall/Wild Growth NÃO usam esta forma — as duas nascem num tile só,
   * `point`, `magic_wall.lua`/`wild_growth.lua` do Canary criam o item só na posição mirada, sem
   * `setArea`; é Fire/Poison/Energy WALL que usam `AREA_WALLFIELD`/`AREA_WALLFIELD_ENERGY` —
   * "a forma da parede é perpendicular à direção" no corpo da issue): `width` (ímpar) tiles
   * numa linha CENTRADA no alvo, perpendicular à direção lançador→alvo — a mesma fileira que
   * `row()` já calcula para `cleave`/`beam`/`rows`, só que ancorada no ALVO (distância 0) em vez
   * do lançador. Não há matriz do Canary aqui (ADR 0019): só a CONTAGEM (3 tiles), como toda
   * outra forma deste arquivo.
   */
  z.object({
    shape: z.literal('wall'),
    width: z.number().int().positive().refine((w) => w % 2 === 1, {
      message: 'largura de parede é ímpar (centrada no alvo)',
    }),
  }),
]);

export type SpellArea = z.infer<typeof spellAreaSchema>;

/**
 * A fórmula canônica de uma magia de dano (#474) OU de cura (#475, ADR 0019 e ADR 0026 d.5).
 *
 * O mecanismo é do motor; os coeficientes são do conteúdo. A fórmula é a mesma que o Canary
 * registra por `onGetFormulaValues`:
 *
 * ```text
 * min = level × levelFactor + skill × skillMin + baseMin
 * max = level × levelFactor + skill × skillMax + baseMax
 * ```
 *
 * `levelFactor` é `1 / 5` por padrão (o `level / 5` da referência). Na magia de DANO o `skill` é
 * o que `scaling` declara (#677): o MAGIC LEVEL em `magic` (o `CALLBACK_PARAM_LEVELMAGICVALUE` do
 * Canary) ou, ausente, a skill que a vocação usa (`vocation.spellSkill` — `magic`, `distance` no
 * Paladin, e a skill da ARMA equipada no Knight desde o #567 — `SPELL_SKILL_WEAPON`, o que a
 * `SKILLVALUE` lê); na magia e na runa de CURA é sempre o MAGIC LEVEL. Sem `formula`, o efeito
 * continua no caminho provisório de `basePower` × `combat.spellPower`, bit a bit (ADR 0031,
 * migração aditiva).
 */
export const spellFormulaSchema = z.object({
  /** Quanto o level pesa. Default `0.2` — o `level / 5` da referência. */
  levelFactor: z.number().default(0.2),
  /** Coeficiente do skill no piso da faixa. */
  skillMin: z.number(),
  /** Coeficiente do skill no teto da faixa. */
  skillMax: z.number(),
  /** Constante somada ao piso. Default `0`. */
  baseMin: z.number().default(0),
  /** Constante somada ao teto. Default `0`. */
  baseMax: z.number().default(0),
  /**
   * O termo de ATAQUE DA ARMA (#523). O Canary usa `CALLBACK_PARAM_SKILLVALUE` — em vez de
   * `(player, level, maglevel)` o callback recebe `(player, skill, attack, factor)` — para
   * Groundshaker, Berserk, Fierce Berserk, Front Sweep e Whirlwind Throw: a magia soma o
   * `attack` da arma equipada ao skill antes de escalar, então skill sozinho (`skillMin`/
   * `skillMax`) não basta. `attackMin`/`attackMax` são o coeficiente LINEAR do `attack`;
   * `skillAttackMin`/`skillAttackMax` são o coeficiente do PRODUTO `skill × attack` (Brutal
   * Strike, Front Sweep, Lesser Front Sweep somam `skill * attack`, não `skill + attack`).
   * Ausentes — o caso de toda magia que não é baseada em arma —, o `attack` que `sim` passa
   * nunca entra na conta: é o que preserva bit a bit toda fórmula que já existia antes do #523.
   */
  attackMin: z.number().optional(),
  attackMax: z.number().optional(),
  skillAttackMin: z.number().optional(),
  skillAttackMax: z.number().optional(),
  /**
   * QUAL skill entra no termo `skill` (#677). `magic` = `CALLBACK_PARAM_LEVELMAGICVALUE` do
   * Canary (magic level em qualquer vocação); `vocation` = `spellSkill`, o que a SKILLVALUE lê.
   * AUSENTE = `vocation`, bit a bit (ADR 0031). Sem efeito em cura e runa (sempre ML).
   * `optional()` e não `default()`: as fixtures de `sim` montam `SpellFormula` (tipo de SAÍDA)
   * à mão (`casting.test.ts`), e um default tornaria o campo obrigatório nelas.
   */
  scaling: z.enum(['vocation', 'magic']).optional(),
  /**
   * Se o termo de ML soma o MAGIC LEVEL ESPECIALIZADO do elemento (#680). AUSENTE = `true`: é o
   * `getMagicLevelSkill` do Canary (`combat.cpp:1979`). `false` = o script lê `getMagicLevel()`
   * cru (Mass Healing, `mass_healing.lua`, TARGETCREATURE). Só vale onde o termo é o ML.
   */
  includeSpecializedMagicLevel: z.boolean().optional(),
});

export type SpellFormula = z.infer<typeof spellFormulaSchema>;

/**
 * A forma de uma runa de ATAQUE (#476): círculo de raio `radius` OU cruz no ALVO. Runa é
 * lançada num alvo, então — ao contrário da magia — não existe forma que saia do lançador:
 * `centered` é sempre `target`, e a cruz também centra no alvo (`area.ts`). É também por isso
 * que a cruz não tem `centered`: não há o que escolher.
 */
const runeAreaSchema = z.union([
  z.object({
    shape: z.literal('circle'),
    radius: z.number().int().positive(),
    centered: z.literal('target').default('target'),
  }),
  /**
   * Cruz de `radius` tiles nos quatro eixos cardeais mais o centro (Explosion) — 1 → 5 tiles.
   */
  z.object({ shape: z.literal('cross'), radius: z.number().int().positive() }),
]);

/**
 * Uma faixa `[min, max]` sorteada por uso (#524) — a poção do Tibia, que cura/repõe um valor
 * ALEATÓRIO fixo, sem escalar por level ou skill (ao contrário de `basePower`/`formula`).
 */
const rangeSchema = z.object({
  min: z.number().int().positive(),
  max: z.number().int().positive(),
}).refine((range) => range.min <= range.max, { message: 'faixa invertida: min maior que max' });

/**
 * Uma das sete bênçãos PvE do Tibia (#570, `data/libs/systems/blessing.lua` do Canary —
 * `Blessings.All` tem 8 ids; o 1º, Twist of Fate, é PvP e fica fora deste catálogo). `order` é
 * o índice do BIT que `CharacterRuntime.blessings` usa (`packages/sim/src/blessings.ts`): a
 * identidade importa porque comprar de novo a mesma bênção é recusado, e a redução da morte
 * olha só a CONTAGEM de bits — o Tibia dá o mesmo 8% por bênção, regular ou `enhanced`.
 * `enhanced` (Heart/Blood of the Mountain, ids 7-8) custa mais caro pela mesma tabela
 * (`blessingPricing`), nunca reduz mais que uma regular.
 */
export const blessingSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Índice do bit em `CharacterRuntime.blessings` (0-6, um por bênção). Único no catálogo. */
  order: z.number().int().min(0).max(6),
  /** Heart/Blood of the Mountain (#570): custam mais caro pela `blessingPricing`. */
  enhanced: z.boolean().default(false),
  _open: z.string().optional(),
});

/**
 * O preço por level de UMA bênção (#570, `getBlessingCost` do Canary,
 * `data/libs/systems/blessing.lua:148-166`, e o Adventurer's Blessing grátis de
 * `config.lua.dist:496`). Piecewise em três faixas de level, com multiplicador maior para
 * `enhanced`; `blessingCost` (`packages/sim/src/blessings.ts`) é a função pura que soma o
 * mecanismo — os números abaixo são os do Tibia, e são dado, não código.
 */
export const blessingPricingSchema = z.object({
  /** Abaixo deste level a bênção é GRÁTIS (o Adventurer's Blessing). Tibia: 21. */
  freeBelowLevel: z.number().int().nonnegative(),
  /** Até este level (inclusive) o preço é fixo, `flatPrice`. Tibia: 30. */
  flatUntilLevel: z.number().int().positive(),
  /** Preço fixo da faixa acima (level ≤ `flatUntilLevel`, e ≥ `freeBelowLevel`). Tibia: 2000. */
  flatPrice: z.number().int().nonnegative(),
  /** A partir de qual level a faixa alta (`highBase` + `highMultiplier`) substitui a faixa média. Tibia: 120. */
  highFromLevel: z.number().int().positive(),
  /** Deduzido do level antes de multiplicar, na faixa MÉDIA (`flatUntilLevel < level < highFromLevel`). Tibia: 20. */
  midOffset: z.number().int().nonnegative(),
  /** Multiplicador da faixa média, bênção regular. Tibia: 200. */
  midMultiplier: z.number().int().positive(),
  /** Multiplicador da faixa média, bênção `enhanced`. Tibia: 260. */
  midEnhancedMultiplier: z.number().int().positive(),
  /** Base fixa da faixa alta, bênção regular. Tibia: 20000. */
  highBase: z.number().int().nonnegative(),
  /** Base fixa da faixa alta, bênção `enhanced`. Tibia: 26000. */
  highEnhancedBase: z.number().int().nonnegative(),
  /** Multiplicador da faixa alta (sobre `level - highFromLevel`), bênção regular. Tibia: 75. */
  highMultiplier: z.number().int().positive(),
  /** Multiplicador da faixa alta, bênção `enhanced`. Tibia: 100. */
  highEnhancedMultiplier: z.number().int().positive(),
});

export type Blessing = z.infer<typeof blessingSchema>;
export type BlessingPricing = z.infer<typeof blessingPricingSchema>;

/**
 * A perda de item na morte (#571, ADR 0042 decisão 4): `Blessings.PlayerDeath`/`DropLoot` do
 * Canary (`data/libs/systems/blessing.lua:36-46,82-118`). O mecanismo mora em
 * `packages/sim/src/item-loss.ts` — os números abaixo são os do Tibia, e são dado, não código.
 *
 * **`enabled` é a chave da decisão em aberto do dono** (ADR 0042, "Questões em aberto" e emenda de
 * 2026-09-25): o Tibia larga o item perdido no cadáver do jogador, e o Draconya não tem item no
 * chão — então "perder" aqui é DESTRUIR, e isso é irreversível para o jogador. Enquanto o dono
 * não decidir entre destruir-e-registrar e manter "nunca perde item" (`docs/product/death.md`
 * §3.8), o mecanismo inteiro existe e é testado mas o conteúdo real o entrega DESLIGADO
 * (`enabled: false` → morte não toca em item nenhum). Ligar é trocar este `true` — sem código.
 *
 * Quem liga também decide a BOLSA (`satchel`): ela não tem equivalente no Tibia, o mecanismo a
 * deixa de fora da perda, e o que o jogador guarda nela sobrevive a toda morte (`death.md`, "Em
 * aberto"). Sem vocação, ou abaixo do level do Adventurer's Blessing com vocação, a morte também
 * não perde item — as proteções do Canary/TFS, derivadas no `sim` (`item-loss.ts`).
 */
export const itemLossSchema = z.strictObject({
  /** Liga a perda de item na morte. `false` é o "nunca perde item" provisório (ver acima). */
  enabled: z.boolean(),
  /**
   * A chance, em PERCENTUAL, de perder cada item equipado por CONTAGEM de bênçãos — o índice é o
   * número de bênçãos (`Blessings.LossPercent[n].item`). Contagem além do fim da lista usa a
   * última entrada. Tibia: 100/70/45/25/10/0… (`blessing.lua:36-46`).
   */
  lossPercentByBlessings: z.array(z.number().min(0).max(100)).min(1),
  /**
   * Item que NÃO é container perde a chance dividida por isto (`chance / 10` em `DropLoot`,
   * `blessing.lua:109`): a mochila (e a aljava, que no cliente é container) leva o percentual
   * cheio, o resto um décimo dele. Tibia: 10.
   */
  nonContainerDivisor: z.number().positive(),
  /**
   * A mochila que a morte devolve a quem ficou sem nenhuma nas costas
   * (`player:addItem(ITEM_BAG, 1, false, CONST_SLOT_BACKPACK)`, `blessing.lua:94-96`, `ITEM_BAG` =
   * 2853). Precisa ser um `kind: 'container'` de `slot: 'back'` — `buildContent` confere.
   */
  replacementContainerId: z.string().min(1),
});
export type ItemLoss = z.infer<typeof itemLossSchema>;

/**
 * Um SUPRIMENTO (FUN-77, §20.1). Poção e runa **não são itens físicos**: usar debita gold
 * direto, no ato. Por isso supply tem preço e `group` de cooldown, e não tem peso, slot nem
 * instância. O `effect` é a união discriminada por `kind`, fechada como o vocabulário do bot:
 * o `sim` só executa o que conhece. `group` é o grupo de cooldown do motor v2 (poção → `potion`,
 * runa de ataque → `attack`).
 */
export const supplySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /**
   * O texto de apresentação do suprimento (#436, ADR 0033), em português — o que o
   * `ActionConfigModal` mostra abaixo dos números. Opcional: a sub-issue das descrições
   * preenche os arquivos reais; sem o campo, o cliente cai no fallback fixo por Tipo.
   */
  description: z.string().min(1).optional(),
  /** Gold debitado por uso. Sem gold, o uso é RECUSADO — o saldo nunca fica negativo. */
  price: z.number().int().nonnegative(),
  /** Grupo de cooldown do motor v2 (ADR 0032 d.2). O mesmo vocabulário de `spell.group`. */
  group: z.enum(CONSUMABLE_GROUPS),
  /**
   * Por quanto tempo o uso tranca o livro do grupo (ADR 0032 d.2/d.6), como
   * `spell.groupCooldownMs`. Default 1000: o passo do Tibia para poção e a cadência que o pool
   * `potion` já respeitava; a runa de `attack` declara o dela para se alinhar às magias de
   * ataque. Até o #592, o supply não tinha cooldown individual separado: o grupo era o único
   * livro dele — ver `cooldownMs` logo abaixo para a exceção.
   */
  groupCooldownMs: z.number().int().positive().default(1_000),
  /**
   * O cooldown PRÓPRIO do supply (#592, Canary `paralyze_rune.lua`: `rune:cooldown(6*1000)` AO
   * LADO de `rune:groupCooldown(2*1000)`) — os dois livros trancam ao mesmo tempo, e os dois
   * precisam vencer para o próximo uso. Ausente é o comportamento de sempre (só o grupo);
   * `startSupplyCooldown`/`useSupply` (`sim/casting.ts`) iniciam e conferem os dois quando
   * declarado. Diferente de `supplyCooldownKey` — que já existia para o supply SEM `group`
   * (nenhum caso real usa isso hoje) —, aqui o livro próprio SOMA ao de grupo, nunca o substitui.
   */
  cooldownMs: z.number().int().positive().optional(),
  /**
   * A exaustão de AÇÃO compartilhada (`nextPotionAction` do Canary, `timeBetweenExActions`,
   * #690): todo supply que a declara trava o MESMO livro, poção ou runa — uma poção logo depois
   * de uma runa de ataque espera, apesar de os grupos serem livros separados. Ausente não trava
   * (fixture e a Magic Shield Potion, #576, que o Canary tira da exaustão).
   */
  actionExhaustMs: z.number().int().positive().optional(),
  effect: z.discriminatedUnion('kind', [
    /**
     * Cura o usuário (poção) ou o alvo selecionado (runa de cura, #475). QUATRO mecanismos —
     * `amount` fixo, `amountRange` (faixa fixa sorteada por uso, #524: a poção do Tibia cura
     * entre um mínimo e um máximo, SEM escalar por level/ML — a strong health potion cura
     * 250-350 tanto no level 50 quanto no 200), `basePower` provisório ou `formula` canônica —
     * e a runa escala pelo MAGIC LEVEL. `range` é o alcance da runa (catalogado; no motor v1 a
     * runa de cura cura o próprio usuário, como a poção).
     * `self` cura quem usa; `friend` cura um membro da party (§26, ADR 0035 d.10).
     */
    z.object({
      kind: z.literal('heal'),
      amount: z.number().int().positive().optional(),
      amountRange: rangeSchema.optional(),
      basePower: z.number().int().positive().optional(),
      formula: spellFormulaSchema.optional(),
      /**
       * Mana reposta NO MESMO uso (#524: great/ultimate spirit potion do Tibia curam vida E
       * mana de um só gole). Ausente é a poção/runa de cura de sempre, sem mana junto. Ao lado
       * de `heal`, e não um `kind` novo, para não duplicar todo `switch`/`if` por `effect.kind`
       * que já trata `'heal'` como "isto cura" (auto-target do bot, `#emitHealed`) — a poção de
       * espírito CURA, com um bônus, não é um quinto tipo de efeito.
       */
      alsoMana: z.object({
        amount: z.number().int().positive().optional(),
        amountRange: rangeSchema.optional(),
      }).refine(
        (mana) => mana.amount !== undefined || mana.amountRange !== undefined,
        { message: 'alsoMana precisa de "amount" ou "amountRange"' },
      ).optional(),
      /** `self` cura quem usa; `friend` cura um membro da party (§26, ADR 0035 d.10). */
      target: z.enum(['self', 'friend']).optional(),
      range: z.number().int().positive().optional(),
      area: spellAreaSchema.optional(),
      /** A cura COMPOSTA (#590), como na magia — ver `spellEffectSchema`. */
      dispel: z.object({
        types: z.array(z.string().min(1)).min(1),
      }).optional(),
    }).refine(
      (effect) => effect.amount !== undefined || effect.amountRange !== undefined
        || effect.basePower !== undefined || effect.formula !== undefined,
      { message: 'heal precisa de "amount", "amountRange", "basePower" ou "formula"' },
    ),
    z.object({
      kind: z.literal('mana'),
      amount: z.number().int().positive().optional(),
      /** Faixa fixa sorteada por uso (#524), como `heal.amountRange` — a mesma poção do Tibia. */
      amountRange: rangeSchema.optional(),
      target: z.enum(['self', 'friend']).optional(),
      range: z.number().int().positive().optional(),
    }).refine(
      (effect) => effect.amount !== undefined || effect.amountRange !== undefined,
      { message: 'mana precisa de "amount" ou "amountRange"' },
    ),
    /**
     * Runa de ataque (#165, ADR 0026 d.8; #476): o dano sai de UM mecanismo — o Base Power do
     * TibiaWiki convertido pela mesma fórmula das magias (`combat.spellPower`, #155) ou a
     * `formula` canônica do Canary (#476), que VENCE o `basePower` (o BP continua sendo o número
     * de exibição, ADR 0033). Escala SEMPRE pelo magic level, em toda vocação. `area` é
     * OPCIONAL: o círculo no alvo (Avalanche, Great Fireball, Thunderstorm, Stone Shower), a
     * cruz no alvo (Explosion) ou NADA, que é a runa de ALVO ÚNICO (Sudden Death, Heavy Magic
     * Missile). `range` é o alcance até o alvo principal, obrigatório como na magia de dano.
     */
    z.object({
      kind: z.literal('damage'),
      basePower: z.number().int().positive().optional(),
      formula: spellFormulaSchema.optional(),
      range: z.number().int().positive(),
      area: runeAreaSchema.optional(),
      /**
       * O TIPO de dano da runa (CMB-03). Ausente é `arcane`, o default que preserva o v1; a
       * Avalanche é gelo, e o arquivo declara.
       */
      damageType: z.enum(DAMAGE_TYPES).default('arcane'),
    }),
    /**
     * Poção de BUFF (#576: Berserk, Mastermind, Bullseye, Magic Shield) — bebe e aplica uma
     * `ConditionSpec` no próprio usuário, SEMPRE — nunca no `recipient` de `useSupply`: as quatro
     * poções do Tibia são auto-alvo (`CONDITION_ATTRIBUTES` do Canary não tem alcance nem alvo),
     * ao contrário da runa de cura (`heal`/`target: 'friend'`). Reaproveita `conditionSpecSchema`
     * inteiro, a MESMA forma que `fieldSpecSchema`/`monsterAbilitySchema.condition` já usam
     * (CMB-07): a poção não inventa um segundo jeito de declarar prazo e efeito. `z.lazy` porque
     * `conditionSpecSchema` só é definido MAIS ABAIXO neste arquivo (a mesma técnica de
     * `botConfigSchema.defaultConfig`) — mover ~300 linhas de `conditionEffectSchema`/`speed`/
     * `drunk`/dano-ao-longo-do-tempo para antes de `supplySchema` só para içar a `const` custaria
     * um diff bem maior sem mudar nenhum comportamento.
     */
    z.object({
      kind: z.literal('condition'),
      condition: z.lazy(() => conditionSpecSchema),
      /**
       * O alvo à distância (#592, Paralyze Rune: `rune:needTarget(true)`/`allowFarUse(true)`).
       * Ausente é o auto-alvo de sempre, das quatro poções acima; `'enemy'` mira o monstro
       * selecionado como a runa de ataque (`kind: 'damage'`) — mesma ordem de recusas, mesmo
       * `#aimFor`, e a condição só entra depois do gold sair (`useSupply`, `sim/casting.ts`).
       * Exige `range` (`buildContent` confere as duas implicações).
       */
      target: z.enum(['enemy']).optional(),
      range: z.number().int().positive().optional(),
    }),
    /**
     * Runa de dispel puro (#590, Canary `antidote_rune.lua`: só `COMBAT_PARAM_DISPEL`, sem cura
     * nenhuma). Sem `target`/`range` declarados o uso é SEMPRE no próprio usuário — o mesmo
     * caminho de `recipient` default de `useSupply` —, e a runa não ganha a mira à distância que
     * o Canary tem (`allowFarUse`/`needTarget`): mirar outro personagem por esta runa fica fora
     * do recorte desta issue (§12).
     */
    z.object({
      kind: z.literal('dispel'),
      types: z.array(z.string().min(1)).min(1),
    }),
    /**
     * Runa de CAMPO (#591): Fire/Poison/Energy Field/Wall, Magic Wall, Wild Growth — planta o
     * `FieldSpec` inteiro (`z.lazy`, o mesmo truque de `condition` acima — `fieldSpecSchema` só é
     * definida bem mais abaixo neste arquivo) no tile mirado. `range` é o alcance até o tile —
     * `#725`/`#726` já miram `target.position`; o `sim` resolve o tile, nunca o cliente
     * (invariante 4). O `FieldSpec.shape` decide a geometria: `point` (Fire/Poison/Energy
     * Field, Magic Wall, Wild Growth — um tile só) ou `wall` (Fire/Poison/Energy Wall — a
     * fileira perpendicular). Cada cast em tile DIFERENTE é uma instância própria — o `sim`
     * deriva o id de campo por instância a partir de `field.id` + tile, nunca reaproveita o id
     * do conteúdo cru (que reiniciaria o campo antigo em vez de abrir um novo).
     */
    z.object({
      kind: z.literal('field'),
      field: z.lazy(() => fieldSpecSchema),
      range: z.number().int().positive(),
    }),
    /**
     * Destroy Field (#591, `destroy_field_rune.lua`): remove um campo NÃO-bloqueante no tile
     * mirado — o Canary lista só variantes de fogo/veneno/energia (`fields = {105, 2118..2126,
     * 2132..2135, 21465}`); Magic Wall (2128) e Wild Growth (2130) NUNCA entram nessa lista, e a
     * regra equivalente aqui é `blocksMovement`: o `sim` recusa remover campo bloqueante. Sem
     * campo destrutível no tile, `no-target` — a carga NUNCA é gasta à toa (o Lua devolve
     * `false` sem `field:remove()`).
     */
    z.object({
      kind: z.literal('destroy-field'),
      range: z.number().int().positive(),
    }),
    /**
     * Convince Creature (#600, ADR 0057 d.5, `convince_creature.lua`): transfere a posse de UM
     * monstro `convinceable` da hunt ao usuário. Alvo único, como a runa de dano sem `area`
     * (`needTarget(true)`/`allowFarUse(true)`): mira o monstro selecionado, com `range` até ele —
     * a convenção de alcance 8 deste catálogo, porque o script não declara `rune:range`. O CUSTO
     * não é do arquivo: é a MANA do monstro (`monster.manaCost`), debitada pelo ruleset depois que
     * o alvo, o teto de 2 invocações e a mana confirmam — `casting.ts` não conhece monstro
     * (invariante 1). O gold da runa (`price`) só sai com o sucesso, como toda runa.
     */
    z.object({
      kind: z.literal('convince'),
      range: z.number().int().positive(),
    }),
    /**
     * Animate Dead (#600, ADR 0057 d.6, `animate_dead_rune.lua`): consome o CADÁVER do tile mirado
     * e nasce o monstro `monsterId` como invocação do usuário. `monsterId` é o `"Skeleton"` que o
     * script do Canary escreve no código — aqui é conteúdo, e `buildContent` confere que existe.
     * Mira um TILE, não uma criatura (`Tile(position):getTopDownItem()`): `range` é o alcance até
     * ele. Não custa mana (o script nunca chama `addMana`) — só o gold da runa.
     */
    z.object({
      kind: z.literal('animate-dead'),
      monsterId: z.string().min(1),
      range: z.number().int().positive(),
    }),
  ]).refine(
    (effect) => effect.kind !== 'condition' || (effect.target === 'enemy') === (effect.range !== undefined),
    { message: 'o efeito condition com target "enemy" exige range, e só ele (#592)' },
  ),
  /** O que o personagem precisa para usar (§20.1). `magicLevel` é o level da skill `magic`. */
  requires: z.object({
    level: z.number().int().positive().optional(),
    magicLevel: z.number().int().nonnegative().optional(),
    /** Uma vocação, ou várias (#524, o suprimento do Tibia restrito por vocação — a poção de
     * espírito é só do Paladin, a grande poção de mana é Sorcerer/Druid/Paladin). */
    vocationId: vocationRequirementSchema.optional(),
  }).default(() => ({})),
  /** De onde um suprimento IMPORTADO veio (ADR 0038 decisão 2). Ausente em supply autorado à mão. */
  source: catalogSourceSchema.optional(),
  _open: z.string().optional(),
});

export type Supply = z.infer<typeof supplySchema>;

/**
 * Munição (ADR 0026, decisão 3 — o modelo do Huntera). NÃO é item: não tem peso, pilha nem
 * instância. É uma SELEÇÃO por família, mostrada no slot do escudo com o bow na mão; cada tiro
 * debita `price` do gold do personagem. O `attack` do tiro é este `attack` pela skill de
 * distância — o bow não tem attack próprio. Estrito, como o item, e pela mesma razão:
 * `appearanceId` escrito aqui por hábito iria para lugar nenhum em silêncio.
 */
export const ammunitionSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  family: z.enum(AMMO_FAMILIES),
  /** O dano do tiro é este `attack` pela skill de distância — o bow não tem attack próprio. */
  attack: z.number().int().nonnegative(),
  /** O tipo de dano do tiro (CMB-03). Ausente é `physical`, o default que preserva o v1. */
  damageType: z.enum(DAMAGE_TYPES).default('physical'),
  /** Gold debitado por tiro. Sem munição grátis: o preço é > 0, e o gold no tiro é o custo. */
  price: z.number().int().positive(),
  /**
   * O `maxhitchance` da munição (#524, o power bolt tem `91`) — o BALDE (`combat.
   * distanceHitChance`, #522) que a tabela por skill/distância usa. `91` não bate nenhum dos
   * três baldes que o Canary modela (75/90/100), então a munição especial cai na chance FIXA
   * (`else { chance = maxHitChance; }` do Canary) — nem skill nem distância importam.
   */
  maxHitChance: z.number().int().min(0).max(100).optional(),
  /**
   * O `hitchance` DIRETO do Canary (`it.hitChance`, #522): quando declarado e diferente de
   * zero, IGNORA `maxHitChance` e a tabela inteira — chance FIXA, sem skill nem distância. É o
   * caminho da munição/arma de arremesso avulsa (viper star `hitchance=80`, leaf star `90`) —
   * `it.hitChance != 0` é conferido ANTES de `it.maxHitChance` em `WeaponDistance::useWeapon`.
   * Distinto de `weapon.hitChance` (#524): aquele é o bônus/malus ADITIVO do arco, somado ao
   * que a munição calcular por qualquer um dos dois caminhos — os dois vêm do MESMO atributo
   * `hitchance` do Canary, lido em papéis diferentes conforme o item é o arco ou o disparado.
   */
  hitChance: z.number().int().min(0).max(100).optional(),
  requires: z.object({
    level: z.number().int().positive().optional(),
  }).default(() => ({})),
  /** De onde uma munição IMPORTADA veio (ADR 0038 decisão 2). Ausente em munição autorada à mão. */
  source: catalogSourceSchema.optional(),
  _open: z.string().optional(),
});

export type AmmunitionDefinition = z.infer<typeof ammunitionSchema>;
/** A munição pronta para uso: `appearanceId` é o ícone, `missileId` o projétil, ambos do boot. */
export type Ammunition = AmmunitionDefinition & {
  readonly appearanceId: number;
  readonly missileId: number;
};

/**
 * O item pronto para uso, com a aparência já resolvida por `buildContent`.
 *
 * A resolução acontece no boot e não no ponto de uso: quem desenha um item nunca precisa
 * saber que existe uma tabela, e a entidade sem aparência morre na montagem do conteúdo — não
 * no primeiro jogador que abrir a mochila.
 */
export type Item = Omit<ItemDefinition, 'weapon' | 'mitigation' | 'reflect'> & {
  readonly appearanceId: number;
  /** A forma ativa enquanto vestido (`appearances.equippedItems`, #689). Ausente: `appearanceId`. */
  readonly equippedAppearanceId?: number;
  /** A arma com o tipo de dano já resolvido (CMB-03). Ausente em item que não é arma. */
  readonly weapon?: ResolvedWeapon;
  /** A mitigação compilada (CMB-03): lookup por tipo e Set de imunidade. */
  readonly mitigation: CompiledMitigation;
  /** O reflexo compilado (#552). Ausente em item que não reflete nada — o caso comum. */
  readonly reflect?: CompiledReflect;
};

// `spellAreaSchema`/`SpellArea` foram movidos para antes de `supplySchema`: o efeito de cura do
// supply o referencia (#475), e uma `const` não é içada — usá-la antes da inicialização quebra.

/** Um percentual por FONTE de dano: a postura do Knight sobe o corpo a corpo, a do Paladin o tiro. */
export const damagePercentBySource = z.object({
  melee: z.number().int().optional(),
  distance: z.number().int().optional(),
  spell: z.number().int().optional(),
});

/**
 * A POLÍTICA de fusão de uma condição (CMB-07, DT-02): declarada no conteúdo, nunca um campo
 * por efeito. Evita timers paralelos quando a mesma condição é relançada.
 *
 * `longest` (M44-04, #622) é a regra de `Condition::updateCondition` do Canary para as condições
 * GENÉRICAS (`ConditionGeneric` — rooted e pacified — e `ConditionFeared`): relançar só vale se o
 * prazo novo NÃO termina antes do que já está correndo (`getEndTime() > now + novoTicks` mantém o
 * antigo). É diferente de `refresh` (o novo sempre vence, mesmo mais curto) e de `strongest`
 * (compara MAGNITUDE, e estas condições não têm magnitude) — um pacified de 10 s do Swift Foot não
 * pode ser encurtado por uma troca de andar que só trava por 2 s.
 */
export const conditionMergeSchema = z.enum(['replace', 'refresh', 'strongest', 'longest']);
export type ConditionMerge = z.infer<typeof conditionMergeSchema>;

/**
 * A fórmula de `ConditionSpeed::setFormula` (CMB-11, #556) — o método existe tanto no Canary
 * quanto no TFS (`condition.cpp`), mas o `−40` abaixo é só do CANARY: o TFS usa `baseSpeed`
 * direto, sem esse deslocamento (`monsters.cpp`: `minSpeedChange / 1000.0` como `mina`/`maxa`,
 * `minb = maxb = 0`). O formato é o da RUNA/MAGIA, declarado direto no Lua (`paralyze_rune.lua`:
 * `setFormula(-1, 0, -1, 0)`; `haste.lua`: `setFormula(1.3, 40, 1.3, 40)`). O `sim` lê como o
 * CANARY lê — `min/max = a × (baseSpeed − 40) + b`, truncado para inteiro — nunca reescalada
 * aqui; a precedência é a do ADR 0037 decisão 4 (Canary `main` para fórmula).
 */
export const conditionSpeedFormulaSchema = z.object({
  mina: z.number(),
  minb: z.number(),
  maxa: z.number(),
  maxb: z.number(),
});
export type ConditionSpeedFormula = z.infer<typeof conditionSpeedFormulaSchema>;

/**
 * A chave RESERVADA de uma condição `speed` (CMB-11, #556). Haste e paralyze do Tibia são dois
 * `ConditionType_t` que se REMOVEM um ao outro (`Creature::onAddCondition` do Canary/TFS); aqui
 * os dois vivem na MESMA chave, e a política de fusão do `Conditions.apply` (que sempre
 * substitui, exceto `strongest`) já os torna mutuamente exclusivos sem lógica extra — é por
 * isso que `conditionSpecSchema` exige esta chave exata para o efeito `speed`.
 */
export const SPEED_CONDITION_KEY = 'speed' as const;

/**
 * A chave RESERVADA de uma condição `drunk` (M31-03, #558). O efeito não carrega campo nenhum
 * além do `durationMs` que `conditionSpecSchema` já dá a QUALQUER condição — nada no estado de
 * runtime (`ConditionState`) o distingue de um `buff`/`mana-shield` vazio, então o `sim`
 * (`Conditions.hasDrunk`) reconhece a condição pela CHAVE, como já faz para `mana-shield`. A
 * chave reservada é o que garante que essa chave seja SEMPRE a mesma, qualquer que seja a
 * ability/defesa/campo que a declare.
 */
export const DRUNK_CONDITION_KEY = 'drunk' as const;

/**
 * A chave RESERVADA de uma condição `invisible` (#592, `CONDITION_INVISIBLE`). Sem campo
 * próprio, como `drunk`/`mana-shield`: `Conditions.hasInvisible` (`sim/conditions.ts`)
 * reconhece a condição pela CHAVE — nenhum estado de runtime a distingue de um `buff` vazio.
 */
export const INVISIBLE_CONDITION_KEY = 'invisible' as const;

/**
 * As chaves RESERVADAS das três condições de CONTROLE (M44-04, #622): `CONDITION_ROOTED`,
 * `CONDITION_FEARED` e `CONDITION_PACIFIED` do Canary (`creatures_definitions.hpp:140-144`). Sem
 * campo próprio no estado — a semântica inteira mora no `sim` (`Conditions.isActive`, que lê o prazo
 * da chave reservada, como `hasDrunk` lê a do drunk) —, e por isso a chave é
 * reservada: um `buff` copiado com `key: 'rooted'` por engano prenderia quem o carrega. `rooted`
 * proíbe QUALQUER passo (`Game::internalMoveCreature`), `feared` força a fuga (`ConditionFeared`) e
 * `pacified` proíbe o golpe e a magia agressiva (`Player::doAttacking`/`Spell::playerSpellCheck`).
 */
export const ROOTED_CONDITION_KEY = 'rooted' as const;
export const FEARED_CONDITION_KEY = 'feared' as const;
export const PACIFIED_CONDITION_KEY = 'pacified' as const;

/**
 * As condições a que um monstro pode declarar imunidade (`monster.immunities[].condition` do
 * Canary, ADR 0041 decisão 2): `paralyze` (o sinal NEGATIVO da condição de velocidade), `drunk`,
 * `invisible` (que o Canary reaproveita como "enxerga invisível", ver `monsterSchema`) e as oito
 * DOTs de `DAMAGE_OVER_TIME_CONDITION_IMMUNITY`. `outfit` — 119 monstros o declaram imune, mas o
 * Draconya ainda não tem a condição — entra com o M44-03.
 *
 * `rooted`, `feared` e `pacified` (M44-04, #622) entram como vocabulário AUTORAL: o
 * `Monster::isImmune(ConditionType_t)` do Canary é um `bitset` sobre TODO `ConditionType_t`, mas a
 * ponte do Lua (`luaMonsterTypeConditionImmunities`) só nomeia os que estão acima — nenhum monstro
 * do bestiário declara imunidade a estes três, então o importador nunca os escreve. Existem para o
 * conteúdo que o Draconya autora (boss da Roda, Avatar): "imunidade por monstro" da issue.
 */
export const CONDITION_IMMUNITIES = [
  'paralyze', 'drunk', 'invisible',
  'bleeding', 'poison', 'burning', 'electrified', 'cursed', 'drowning', 'freezing', 'dazzled',
  'rooted', 'feared', 'pacified',
] as const;
export type ConditionImmunity = (typeof CONDITION_IMMUNITIES)[number];

/**
 * O tipo de condição de DANO AO LONGO DO TEMPO que cada tipo de dano gera no Tibia
 * (`Combat::DamageToConditionType`, Canary `src/creatures/combat/combat.cpp:278-307`; o TFS tem o
 * mesmo par): fogo queima, energia eletrifica, terra envenena, gelo congela, sagrado ofusca, morte
 * amaldiçoa, afogamento afoga, físico sangra. `lifedrain`/`manadrain`/`arcane` não geram condição
 * nenhuma (`CONDITION_NONE`) e por isso não têm entrada.
 *
 * É o nome com que o ADR 0041 decisão 1 batiza as oito condições de DOT — e o nome que
 * `monster.conditionImmunities` usa para a imunidade a cada uma (`Monster::isImmune(ConditionType_t)`,
 * `monster.cpp:3535`). Uma DOT no `sim` (`ConditionState.tick.damageType`) casa com a imunidade
 * por esta tabela: a condição não é ADICIONADA a quem é imune, e o dano que ela carregaria nunca
 * nasce.
 */
export const DAMAGE_OVER_TIME_CONDITION_IMMUNITY: Readonly<Partial<Record<DamageType, ConditionImmunity>>> = {
  physical: 'bleeding',
  earth: 'poison',
  fire: 'burning',
  energy: 'electrified',
  death: 'cursed',
  drown: 'drowning',
  ice: 'freezing',
  holy: 'dazzled',
};

/**
 * Uma RODADA do dano ao longo do tempo do Tibia (M31-02): `count` tiques do MESMO `damage`, a
 * cada `intervalMs` — o `addDamage(rounds, interval, value)` que os scripts de magia do Canary
 * usam (Ignite: `addDamage(25, 3000, -45)`) e que o campo de fogo do Dragon Lord também usa
 * (`items.xml` id 2118: `ticks 10000 count 7 damage 20`). O `form: 'rounds'` de
 * `conditionEffectSchema` aceita mais de uma rodada, para concatenar grupos com cadência
 * diferente — o caso comum (Dragon Lord) é uma rodada só.
 */
const damageOverTimeRoundSchema = z.object({
  count: z.number().int().positive(),
  intervalMs: z.number().int().positive(),
  damage: z.number().int().positive(),
});

/**
 * O efeito declarativo de uma condição (CMB-07). É o `ConditionEffect` do contrato da issue: um
 * estado com prazo que muda uma leitura (velocidade, postura, magic shield) ou dispara um tique (cura
 * ou DANO ao longo do tempo). O dano contínuo NÃO traz origem — quem aplica decide (`spell`,
 * `monster-attack`), e é a mesma divisão do `DamageSource` canônico (CMB-02).
 *
 * O dano ao longo do tempo tem DUAS formas do Tibia (M31-02, ADR 0037), a mesma divisão que
 * `ConditionDamage::init`/`ItemParse::parseFieldCombatDamage` do Canary fazem por `startDamage`
 * presente ou ausente — nunca as DUAS ao mesmo tempo:
 * - `generated`: a lista DECRESCENTE que `ConditionDamage::generateDamageList`
 *   (`src/creatures/combat/condition.cpp:2143-2160`) soma até `totalDamage`, começando em
 *   `startDamage` e descendo até 1 (poison field do Canary: `start=5 damage=100`). Ausente,
 *   `startDamage` é `max(1, ceil(totalDamage / 20))`, o default do próprio Canary.
 * - `rounds`: a lista de RODADAS explícitas de cima. `generateDamageList`/`damageOverTimeTicks`,
 *   abaixo, expandem as duas para a MESMA fila de tiques (`sim/conditions.ts` importa as duas em
 *   vez de reimplementá-las) — o conteúdo só escolhe a forma mais perto da fonte.
 *
 * `damageType` é o ELEMENTO do Tibia (poison→earth, fire→fire, energy→energy, bleeding→physical,
 * cursed→death, freezing→ice, dazzled→holy, drowning→drown — tabela em `docs/product/combat.md`;
 * `drown` chegou ao enum pelo #547/M29-07, e um conteúdo de afogamento já pode declará-lo).
 * Ausente é `physical`, o default que preserva o v1.
 */
export const conditionEffectSchema = z.discriminatedUnion('kind', [
  /**
   * Velocidade com SINAL (CMB-11, #556, `ConditionSpeed` — a classe existe no Canary e no TFS,
   * mas o PISO abaixo é mecanismo do CANARY, o TFS não tem: `type` é o nome do Tibia (`haste`
   * acelera, `paralyze` desacelera) — não é derivado do sinal calculado, porque só ele decide o
   * PISO (paralyze nunca desce a velocidade abaixo de 40; "40" está na escala do TFS que o nosso
   * `speed` já usa — ADR 0037 decisão 4 — mas o próprio piso é do Canary). O `type` também
   * precisa CONCORDAR com o sinal de `delta`/`formula` — ver os `.refine` abaixo: um `type`
   * que contradiz a magnitude escapa do piso (a defesa que o protege só olha `type ===
   * 'paralyze'`) e pode produzir `speedScale` negativo. Duas formas mutuamente exclusivas:
   * `delta`, o `speedChange` do ATAQUE/DEFESA de monstro copiado em MILÉSIMOS, sem conversão
   * (`Monsters::deserializeSpell` deriva a fórmula sozinho a partir dele); `formula`, a fórmula
   * da RUNA/MAGIA copiada direto do Lua. Nunca os dois, nunca nenhum.
   */
  z.object({
    kind: z.literal('speed'),
    type: z.enum(['haste', 'paralyze']),
    delta: z.number().int().optional(),
    formula: conditionSpeedFormulaSchema.optional(),
    damageDealtPercent: damagePercentBySource.optional(),
  }),
  z.object({
    kind: z.literal('buff'),
    damageDealtPercent: damagePercentBySource.optional(),
    damageTakenPercent: z.number().int().optional(),
    /**
     * Bônus/malus FLAT numa skill pelo id do catálogo (#576: Berserk soma 5 em `melee` e tira 10
     * de `shielding`; Bullseye soma 5 em `distance` e tira 10 de `shielding`; Mastermind soma 3
     * em `magic`, que É o magic level, FUN-92). Ao lado de `damageDealtPercent`/
     * `damageTakenPercent`, e não um `kind` novo: as três poções do Tibia usam o MESMO
     * `CONDITION_ATTRIBUTES` do Canary, só com parâmetros diferentes — um `kind` por poção
     * duplicaria o `switch` de `conditions.ts` sem nenhum comportamento novo. Chave livre (não
     * fechada a `melee`/`distance`/`magic`/`shielding`): o vocabulário de skill já é aberto no
     * catálogo (`skills/*.json`), e fechar aqui duplicaria essa lista em outro lugar.
     */
    skillDeltas: z.record(z.string(), z.number().int()).optional(),
  }),
  z.object({ kind: z.literal('mana-shield') }),
  /**
   * O desvio de passo do bêbado (M31-03, #558, `CONDITION_DRUNK` — `Creature::onWalk` do
   * Canary/TFS, `creatures/creature.cpp:291-301`). Sem campo próprio: o `sim`
   * (`rollDrunkDeviation`, `conditions.ts`) sorteia a direção A CADA PASSO com o `Rng` da
   * sessão — só `durationMs` (comum a toda condição) importa aqui. A área do ATAQUE que aplica
   * a condição (`radius`/`length`+`spread` do Canary) já é o `target.area` de
   * `monsterAbilitySchema`, o mesmo mecanismo de toda ability em área — nada de novo aqui.
   */
  z.object({ kind: z.literal('drunk') }),
  /**
   * Invisibilidade do personagem (#592, Canary `invisible.lua`: `Condition(CONDITION_INVISIBLE)`,
   * sem parâmetro além do prazo). Sem campo próprio, como `drunk` — `Conditions.hasInvisible`
   * reconhece pela chave reservada (`INVISIBLE_CONDITION_KEY`). Um monstro que não "vê invisível"
   * (`Monster.seesInvisible`) não seleciona nem retém quem carrega esta condição como alvo
   * (`chooseTarget`, `sim/monster/monster.ts`).
   */
  z.object({ kind: z.literal('invisible') }),
  /**
   * As três condições de CONTROLE (M44-04, #622 — `CONDITION_ROOTED`/`CONDITION_FEARED`/
   * `CONDITION_PACIFIED`). Sem campo próprio, como `drunk`: só `durationMs` (comum a toda
   * condição) importa, e o `sim` reconhece cada uma pela chave reservada.
   *
   * - `rooted`: nenhum passo sai (`Game::internalMoveCreature` recusa, `game.cpp:1965`);
   * - `feared`: o personagem foge do LANÇADOR — o `sim` guarda de onde no estado da condição
   *   (`ConditionState.flee`) e conduz a caminhada forçada (`ConditionFeared`,
   *   `condition.cpp:2163-2455`); não pode lançar magia nem usar runa (`spells.cpp:104,503`);
   * - `pacified`: sem golpe e sem magia AGRESSIVA (`Player::doAttacking`, `player.cpp:3982`;
   *   `Spell::playerSpellCheck`, `spells.cpp:517`).
   */
  z.object({ kind: z.literal('rooted') }),
  z.object({ kind: z.literal('feared') }),
  z.object({ kind: z.literal('pacified') }),
  z.object({
    kind: z.literal('heal-over-time'),
    amount: z.number().int().positive(),
    intervalMs: z.number().int().positive(),
  }),
  z.discriminatedUnion('form', [
    z.object({
      kind: z.literal('damage-over-time'),
      form: z.literal('generated'),
      totalDamage: z.number().int().positive(),
      startDamage: z.number().int().positive().optional(),
      intervalMs: z.number().int().positive(),
      damageType: z.enum(DAMAGE_TYPES).default('physical'),
    }).refine(
      (effect) => effect.startDamage === undefined || effect.startDamage <= effect.totalDamage,
      { message: 'startDamage não pode passar de totalDamage', path: ['startDamage'] },
    ),
    z.object({
      kind: z.literal('damage-over-time'),
      form: z.literal('rounds'),
      rounds: z.array(damageOverTimeRoundSchema).min(1),
      damageType: z.enum(DAMAGE_TYPES).default('physical'),
    }),
  ]),
]).refine(
  (effect) => effect.kind !== 'speed' || (effect.delta !== undefined) !== (effect.formula !== undefined),
  { message: 'o efeito speed exige delta OU formula, nunca os dois nem nenhum' },
).refine(
  (effect) => {
    if (effect.kind !== 'speed' || effect.delta === undefined) return true;
    // `Monsters::deserializeSpell` do Canary: `speedChange > 0 ? CONDITION_HASTE :
    // CONDITION_PARALYZE` — delta zero cai no `else` (paralyze), nunca haste.
    return effect.type === 'haste' ? effect.delta > 0 : effect.delta <= 0;
  },
  {
    message: 'o type do efeito speed precisa concordar com o sinal de delta (haste > 0, '
      + 'paralyze <= 0, como Monsters::deserializeSpell do Canary) — um type que contradiz o '
      + 'delta escapa do piso do paralyze e pode gerar speedScale negativo',
  },
).refine(
  (effect) => {
    if (effect.kind !== 'speed' || effect.formula === undefined) return true;
    const { mina, minb, maxa, maxb } = effect.formula;
    // Sinal ESTATICAMENTE decidível: se todos os coeficientes têm o mesmo sinal (ou são zero),
    // o resultado pré-piso só pode ir numa direção para qualquer baseSpeed >= 40 — o mínimo que
    // o conteúdo usa hoje. Uma fórmula que só pode SUBIR velocidade não pode ser `paralyze`, e
    // uma que só pode DESCER não pode ser `haste`: é o caso real da runa de paralyze (`-1, 0,
    // -1, 0`) rotulada por engano como `haste`, que produziria um `speedScale` negativo (#556).
    const onlyNonPositive = mina <= 0 && minb <= 0 && maxa <= 0 && maxb <= 0;
    const onlyNonNegative = mina >= 0 && minb >= 0 && maxa >= 0 && maxb >= 0;
    if (effect.type === 'haste' && onlyNonPositive && !onlyNonNegative) return false;
    if (effect.type === 'paralyze' && onlyNonNegative && !onlyNonPositive) return false;
    return true;
  },
  {
    message: 'o type do efeito speed precisa concordar com o sinal da formula — coeficientes '
      + 'que só podem reduzir velocidade não podem ser type "haste", e coeficientes que só '
      + 'podem aumentar não podem ser type "paralyze"',
  },
);
export type ConditionEffect = z.infer<typeof conditionEffectSchema>;

/** Os `kind`s de controle (M44-04, #622) — o que `conditionSpecSchema` exige `merge: 'longest'`. */
const CONTROL_CONDITION_KINDS: ReadonlySet<ConditionEffect['kind']> = new Set([
  'rooted', 'feared', 'pacified',
]);
export type DamageOverTimeEffect = Extract<ConditionEffect, { kind: 'damage-over-time' }>;

/**
 * A lista DECRESCENTE do Tibia (M31-02): o mecanismo de `ConditionDamage::generateDamageList` do
 * Canary (`src/creatures/combat/condition.cpp:2143-2160`), reescrito em TypeScript a partir do
 * comportamento descrito — nunca copiado (ADR 0019). Mora AQUI, e não em `sim`, porque
 * `conditionSpecSchema` (abaixo) também precisa saber quantos tiques uma lista `generated`
 * produz, para recusar um `durationMs` curto demais para a própria fila que ele declara — achado
 * da revisão do #557: nada cruzava os dois, e um `durationMs` "razoável" mas curto truncava o DOT
 * em silêncio, sem erro nem teste que acusasse. `sim/conditions.ts` importa esta função em vez de
 * reimplementá-la: duas contas para o mesmo número é o defeito que a DT-03 já nomeia noutro lugar
 * deste pacote.
 *
 * Soma até `totalDamage`, começando em `startDamage` e descendo até 1: para cada "banda" `n` (de
 * 1 até `startDamage`), a média-alvo é `n × totalDamage / startDamage`, e o valor da banda
 * (`startDamage + 1 − n`) é repetido enquanto isso aproxima a soma acumulada dessa média — pelo
 * menos uma vez. `startDamage` maior que `totalDamage` divide por um número maior que o total (o
 * Canary clampa antes de chamar); o schema já recusa essa combinação, então aqui é só a
 * matemática.
 *
 * Exemplo (poison field do Canary, `items.xml` id 2121, `start=5 damage=100`):
 * `[5,5,5,5,4,4,4,4,4,3,3,3,3,3,3,3,2,2,2,2,2,2,2,2,2,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]`
 * — soma exata 100; `conditions.test.ts` (sim) e `content.test.ts` prendem esse vetor.
 */
export function generateDamageList(totalDamage: number, startDamage: number): readonly number[] {
  const amount = Math.abs(totalDamage);
  const start = Math.abs(startDamage);
  const list: number[] = [];
  let sum = 0;
  for (let i = start; i > 0; i -= 1) {
    const band = start + 1 - i;
    const target = Math.trunc((band * amount) / start);
    let closerWithOneMore: boolean;
    do {
      sum += i;
      list.push(i);
      const ifOneMore = Math.abs(1 - (sum + i) / target);
      const asIs = Math.abs(1 - sum / target);
      closerWithOneMore = ifOneMore < asIs;
    } while (closerWithOneMore);
  }
  return list;
}

/** O `startDamage` default do Canary quando o conteúdo o omite: `max(1, ceil(totalDamage/20))`. */
function defaultStartDamage(totalDamage: number): number {
  return Math.max(1, Math.ceil(totalDamage / 20));
}

/** Um tique da fila do Tibia já expandido — a MESMA forma que `sim` consome (`QueuedTick`, sem
 * `kind`/`damageType`/`source`, que não variam dentro da fila de uma condição). */
export interface DamageOverTimeTick {
  readonly amount: number;
  readonly intervalMs: number;
}

/**
 * Expande um `DamageOverTimeEffect` (as duas formas do Tibia) para a fila ORDENADA de tiques —
 * puro, sem I/O, a mesma lista para a mesma entrada (invariante 1). A forma `generated` vira UMA
 * lista decrescente, cada elemento com o `intervalMs` declarado; `rounds` concatena os grupos na
 * ordem em que aparecem. Sempre pelo menos um elemento — o schema exige `totalDamage`/`count`
 * positivos. `sim/conditions.ts` importa esta função para compilar o `ConditionState` de runtime
 * a partir do MESMO cálculo que `conditionSpecSchema`, abaixo, usa para conferir `durationMs`.
 */
export function damageOverTimeTicks(effect: DamageOverTimeEffect): readonly DamageOverTimeTick[] {
  if (effect.form === 'generated') {
    const start = Math.min(effect.startDamage ?? defaultStartDamage(effect.totalDamage), effect.totalDamage);
    return generateDamageList(effect.totalDamage, start)
      .map((amount) => ({ amount, intervalMs: effect.intervalMs }));
  }
  return effect.rounds.flatMap((round) => Array.from(
    { length: round.count }, () => ({ amount: round.damage, intervalMs: round.intervalMs }),
  ));
}

/**
 * O tempo TOTAL (ms) que a fila de `damageOverTimeTicks` precisa para esgotar — a soma do
 * `intervalMs` de cada tique, na ordem em que disparam. É contra este número que
 * `conditionSpecSchema`, abaixo, confere `durationMs` (achado da revisão do #557): no Canary os
 * dois nunca podem divergir porque `ConditionDamage::addDamage` ESTENDE `ticks` a cada rodada
 * somada — não existe campo de duração independente da fila. Aqui `durationMs` é um campo solto
 * (histórico, e mantido por compatibilidade de conteúdo já autorado), então a mesma garantia
 * precisa vir de CONFERÊNCIA em vez de vir de estrutura.
 */
export function damageOverTimeTotalMs(effect: DamageOverTimeEffect): number {
  return damageOverTimeTicks(effect).reduce((sum, tick) => sum + tick.intervalMs, 0);
}

/**
 * A condição declarativa do conteúdo (CMB-07): chave, política de fusão, prazo e efeito. O
 * `sim` a compila para o estado de runtime com prazo LÓGICO absoluto. Nunca carrega arte
 * (invariante 6) — a apresentação, quando existir, é resolvida por id na tabela de aparências.
 *
 * Para `damage-over-time`, `durationMs` não pode ser menor que `damageOverTimeTotalMs(effect)`
 * (achado da revisão do #557): sem esta conferência, um `durationMs` autorado à mão que fica
 * curto demais para a própria fila de tiques trunca o DOT em silêncio — `#onConditionTick`
 * (`sim/rulesets/hunt.ts`) para de agendar o próximo tique assim que ele cairia depois do prazo,
 * mesmo com tiques ainda por entregar na fila. `durationMs` MAIOR que o total é aceito: a
 * condição só fica com a fila zerada (`retiredTick`) até vencer, sem efeito observável.
 *
 * O efeito `speed` (CMB-11) exige `key: 'speed'` — a chave RESERVADA que faz haste e paralyze
 * de QUALQUER fonte se substituírem (ver `SPEED_CONDITION_KEY`), como no Tibia. O efeito `drunk`
 * (M31-03) exige `key: 'drunk'` pelo mesmo motivo: sem campo próprio no estado, é a chave que o
 * `sim` reconhece (ver `DRUNK_CONDITION_KEY`). O mesmo vale para `invisible` e para as três de
 * controle (`rooted`/`feared`/`pacified`, M44-04), que além da chave exigem `merge: 'longest'`.
 *
 * As duas checagens abaixo são as DUAS IMPLICAÇÕES, não só uma (achado da revisão do #651): sem
 * a volta, `key: 'speed'`/`key: 'drunk'` com um `effect.kind` DIFERENTE passa batido — e
 * `Conditions.hasDrunk`/o efeito de velocidade (`sim/conditions.ts`) reconhecem a condição só
 * pela CHAVE, nunca pelo `effect.kind` dela. Um `buff` de dano copiado/colado com `key: 'drunk'`
 * por engano ligaria o desvio de passo do bêbado em quem o carrega, sem NENHUMA relação com o
 * autor pretendido.
 */
export const conditionSpecSchema = z.object({
  key: z.string().min(1),
  merge: conditionMergeSchema.default('refresh'),
  durationMs: z.number().int().positive(),
  effect: conditionEffectSchema,
}).superRefine((spec, context) => {
  if (spec.effect.kind !== 'damage-over-time') return;
  const totalMs = damageOverTimeTotalMs(spec.effect);
  if (spec.durationMs < totalMs) {
    context.addIssue({
      code: 'custom',
      path: ['durationMs'],
      message: `durationMs (${spec.durationMs} ms) é menor que o total de ${totalMs} ms que a `
        + `própria fila de tiques do efeito precisa para esgotar — faltariam `
        + `${totalMs - spec.durationMs} ms de dano no fim da condição`,
    });
  }
}).refine(
  (spec) => (spec.effect.kind === 'speed') === (spec.key === SPEED_CONDITION_KEY),
  { message: `a condição speed precisa da chave reservada "${SPEED_CONDITION_KEY}", e só ela` },
).refine(
  (spec) => (spec.effect.kind === 'drunk') === (spec.key === DRUNK_CONDITION_KEY),
  { message: `a condição drunk precisa da chave reservada "${DRUNK_CONDITION_KEY}", e só ela` },
).refine(
  (spec) => (spec.effect.kind === 'invisible') === (spec.key === INVISIBLE_CONDITION_KEY),
  {
    message: `a condição invisible precisa da chave reservada "${INVISIBLE_CONDITION_KEY}", `
      + 'e só ela',
  },
).refine(
  (spec) => (spec.effect.kind === 'rooted') === (spec.key === ROOTED_CONDITION_KEY),
  { message: `a condição rooted precisa da chave reservada "${ROOTED_CONDITION_KEY}", e só ela` },
).refine(
  (spec) => (spec.effect.kind === 'feared') === (spec.key === FEARED_CONDITION_KEY),
  { message: `a condição feared precisa da chave reservada "${FEARED_CONDITION_KEY}", e só ela` },
).refine(
  (spec) => (spec.effect.kind === 'pacified') === (spec.key === PACIFIED_CONDITION_KEY),
  { message: `a condição pacified precisa da chave reservada "${PACIFIED_CONDITION_KEY}", e só ela` },
).refine(
  // A fusão das três é a de `Condition::updateCondition` do Canary (ver `conditionMergeSchema`):
  // não é uma escolha do conteúdo, e um `refresh` autorado à mão encurtaria o prazo que já corre.
  (spec) => !CONTROL_CONDITION_KINDS.has(spec.effect.kind) || spec.merge === 'longest',
  { message: 'as condições rooted, feared e pacified exigem merge "longest" (Condition::updateCondition)' },
);
export type ConditionSpec = z.infer<typeof conditionSpecSchema>;

/**
 * UM estágio da cadeia de decaimento de um campo (#560, `decayTo` do Canary —
 * `items.xml:4212-4246`: o fire field 2118 (dano 20, 200s) decai para 2119 (dano 10, 148s) e
 * depois para 2120 (sem dano, 98s) antes de sumir). `condition` AUSENTE é estágio sem efeito —
 * o campo continua ocupando o tile (e bloqueando, se `fieldSpecSchema.blocksMovement`), mas
 * ninguém que pisa nele sofre nada; é o caso do 2120 e de todo campo puramente bloqueante
 * (Magic Wall, Wild Growth) — nenhum dos dois tem `field value="fire"` correspondente no
 * Canary, então nunca houve condição para preservar bit a bit.
 */
export const fieldStageSchema = z.object({
  durationMs: z.number().int().positive(),
  condition: conditionSpecSchema.optional(),
});
export type FieldStage = z.infer<typeof fieldStageSchema>;

/**
 * Um CAMPO de tile declarativo (CMB-07): uma condição que vive no chão por um prazo, numa forma
 * (`spellAreaSchema`, a MESMA geometria da magia e da ability). O `sim` resolve os tiles no
 * momento da aplicação e indexa por chave NUMÉRICA de tile — nunca varre todos os campos por
 * passo. O campo pertence ao ruleset, nunca ao `Tilemap` (DT-01: conteúdo é imutável).
 *
 * **`condition` é OPCIONAL desde o #560** — era obrigatória até então, e a mudança é o que
 * permite um campo puramente bloqueante (Magic Wall, Wild Growth: nenhum dano, só parede
 * temporária). `durationMs`/`condition` no NÍVEL DO SPEC continuam sendo o estágio ÚNICO de
 * sempre — todo campo declarado antes desta issue não tem `stages`, e por isso preserva bit a
 * bit o sorteio e a cadência: `fieldStagesOf` (abaixo) devolve exatamente
 * `[{ durationMs, condition }]` quando `stages` está ausente, o mesmo par que `applyField` já
 * lia direto do spec.
 *
 * **`stages`, quando presente, é a cadeia inteira** (o `decayTo` do Canary) — o primeiro
 * elemento é o estado de nascimento do campo, e `durationMs`/`condition` do próprio spec ficam
 * como documentação do primeiro estágio (não lidos por quem usa `fieldStagesOf`).
 */
export const fieldSpecSchema = z.object({
  id: z.string().min(1),
  durationMs: z.number().int().positive(),
  shape: spellAreaSchema,
  condition: conditionSpecSchema.optional(),
  /** A cadeia de decaimento (#560). Ausente: um estágio só, do próprio spec. */
  stages: z.array(fieldStageSchema).min(1).optional(),
  /**
   * Bloqueia movimento, como parede (#560, Magic Wall/Wild Growth: `blocking="1"` no
   * `items.xml`)? Vale para QUALQUER criatura — jogador e monstro — ao contrário do desvio de
   * dano (`canMonsterEnterField`, M29-05), que só o monstro respeita e só quando o campo tem
   * `damageType`. **`optional`, não `default`** (ao contrário do padrão do resto do schema): um
   * default preenchido tornaria o campo OBRIGATÓRIO no tipo `FieldSpec` — toda fixture de teste
   * que já constrói um `FieldSpec` literal (e são muitas) passaria a exigir as duas flags à toa.
   * Ausente é `false` em todo consumidor (`spec.blocksMovement ?? false`), o que preserva bit a
   * bit todo campo de hoje (fogo, veneno, energia — nenhum bloqueia passagem no Canary).
   */
  blocksMovement: z.boolean().optional(),
  /**
   * Bloqueia projétil e linha de visão (#560, `CONST_PROP_BLOCKPROJECTILE`)? Consultado por
   * `isSightClear` (`packages/sim/src/line-of-sight.ts`) quando o M30-06 estiver completo — a
   * TASK atual só declara o campo; o consumo em LOS já está fiado a `fieldBlocksProjectileAt`.
   * `optional`, pelo mesmo motivo de `blocksMovement` acima. Ausente é `false`.
   */
  blocksProjectile: z.boolean().optional(),
});
export type FieldSpec = z.infer<typeof fieldSpecSchema>;

/**
 * A cadeia de estágios de um `FieldSpec`, NORMALIZADA — sempre pelo menos um elemento, nunca
 * lida por `spec.stages` diretamente (que pode estar ausente). É o `sim` quem consome isto, não
 * o schema: mora aqui porque é função pura sobre o tipo de conteúdo, sem estado de sessão.
 */
export function fieldStagesOf(spec: FieldSpec): readonly FieldStage[] {
  if (spec.stages !== undefined) return spec.stages;
  return spec.condition === undefined
    ? [{ durationMs: spec.durationMs }]
    : [{ durationMs: spec.durationMs, condition: spec.condition }];
}


/**
 * O id RESERVADO da ability que o boot sintetiza para o monstro legado (CMB-06, DT-02).
 *
 * Ausência de `abilities` vira UMA ability básica com o `attack`/`attackIntervalMs`/
 * `attackRange`/`damageType` de sempre, e é isso que preserva o rato bit a bit — mesmo sorteio,
 * mesmos eventos. O conteúdo NÃO pode declarar uma ability com este id: ela é do boot.
 */
export const BASIC_ABILITY_ID = 'basic';

/**
 * O poder de uma ability, JÁ normalizado para faixa (CMB-06). O arquivo aceita um número — a
 * faixa de um valor só —, e o boot o transforma aqui, como o `attack` do monstro sempre fez.
 */
export interface MonsterAbilityPower {
  readonly min: number;
  readonly max: number;
}

/**
 * O alvo de uma ability de monstro (CMB-06, estendido em #518): o alcance até o alvo principal
 * e, opcionalmente, a forma de área. `circle` é o caso de sempre (centrado no alvo ou no
 * lançador); `wave` e `beam` saem do lançador NA DIREÇÃO dele — o monstro vira para o alvo antes
 * de atacar (`facingDirection`, `area.ts`), o mesmo cálculo do TFS `updateLookDirection` (eixo
 * dominante de dx/dy, empate decide horizontal; referência §15-19). `cross`/`cleave` continuam
 * fora: `buildContent` recusa as formas que o monstro ainda não lança.
 */
export const monsterAbilityTargetSchema = z.object({
  range: z.number().int().positive().default(1),
  area: spellAreaSchema.optional(),
});

/**
 * Uma ability declarada de monstro (CMB-06, DT-01): alvo/alcance, forma, poder, tipo de dano e
 * referências SEMÂNTICAS de apresentação. Não carrega caminho, bitmap nem id de asset — a arte
 * é do host, pela tabela (invariante 6).
 */
export const monsterAbilitySchema = z.strictObject({
  id: z.string().min(1),
  /** Milissegundos entre usos. Tempo decorrido, nunca contagem de tick (invariante 2). */
  cadenceMs: z.number().int().positive(),
  /**
   * A chance de a ability sair quando o `cadenceMs` vence (#518, TFS `Monster::doAttacking`/
   * `onThinkDefense`, referência §15-19): cada entrada da lista rola a PRÓPRIA chance, uma
   * rolagem independente — corpo a corpo, onda e bola podem sair no mesmo vencimento.
   *
   * **Ausente é sempre passa, e NÃO consome sorteio** — o mesmo argumento do `blockChance`
   * (CMB-04) e do `modifiers.critical` (CMB-08): é o que preserva o rato e o rotworm bit a bit,
   * porque a ability básica do boot nunca declara este campo. Declarada, a ability consome UMA
   * rolagem a cada vencimento, mesmo com o valor 1 — a sequência não pode depender do número.
   */
  chance: z.number().min(0).max(1).optional(),
  target: monsterAbilityTargetSchema.default(() => ({ range: 1 })),
  power: z.union([
    z.number().int().nonnegative(),
    z.object({ min: z.number().int().nonnegative(), max: z.number().int().nonnegative() })
      .refine((range) => range.min <= range.max, 'power.min não pode passar de power.max'),
  ]),
  /** O tipo de dano da ability (CMB-03). Ausente é `physical`, o default que preserva o v1. */
  damageType: z.enum(DAMAGE_TYPES).default('physical'),
  /**
   * Se a ability é o ataque `melee` ou um `combat` do Canary (#682) — é o que decide o
   * bloqueio no `combat-v3` (`Monsters::deserializeSpell`, `monsters.cpp:105-120`): `melee`
   * bloqueia defesa e armadura; `combat` FÍSICO só armadura, em qualquer alcance ou área;
   * `combat` de outro tipo, nada. Ausente: decide a forma (`isMeleeAbility`), o comportamento
   * de antes — o conteúdo escrito à mão e a ability básica do boot não mudam.
   */
  kind: z.enum(['melee', 'combat']).optional(),
  /**
   * As chaves SEMÂNTICAS de apresentação (CMB-06): o host as resolve em ids de aparência na
   * tabela versionada (`appearances.abilities`). Chave sem linha é MUDA, nunca erro.
   */
  presentation: z.object({
    missileKey: z.string().min(1).optional(),
    impactKey: z.string().min(1).optional(),
  }).optional(),
  /**
   * A condição que a ability aplica a QUEM ela acerta (CMB-07). Ausente é ability que só bate —
   * o caso legado. O tique de dano entra no MESMO resolver canônico do golpe.
   */
  condition: conditionSpecSchema.optional(),
  /**
   * O CAMPO que a ability deixa no chão (CMB-07), centrado no alvo principal. Só `circle`: o
   * monstro não carrega direção, como na área da própria ability. O `sim` resolve os tiles e os
   * indexa por tile; o campo vive no ruleset, nunca no `Tilemap`.
   */
  field: fieldSpecSchema.optional(),
  /**
   * A PROVOCAÇÃO que a ability lança (#599, M38-02; `doChallengeCreature(creature, target, ms)`
   * do script `monster/summonchallenge.lua`, o "summon challenge" dos familiares Druid e
   * Sorcerer): cada monstro atingido passa a mirar QUEM lançou por `durationMs`, e a fuga dele
   * fica suspensa — o mesmo efeito da magia Challenge do Knight, na mão de uma invocação. Só
   * faz sentido para uma invocação de personagem (o `sim` a aplica em monstros hostis; contra
   * um jogador ela não faz nada) e não causa dano: `power` é 0. Ausente é a ability de sempre.
   */
  challenge: z.object({ durationMs: z.number().int().positive() }).optional(),
  _open: z.string().optional(),
}).refine(
  // O Canary fixa `COMBAT_PHYSICALDAMAGE` no `melee` (#682): um `melee` de fogo é conteúdo
  // que o motor de referência não tem como produzir.
  (ability) => ability.kind !== 'melee' || ability.damageType === 'physical',
  { message: "kind 'melee' exige damageType 'physical'", path: ['kind'] },
);

export type MonsterAbilityDefinition = z.infer<typeof monsterAbilitySchema>;

/**
 * A ability como o `sim` a consome (CMB-06): poder já em faixa e sem os defaults do schema. É o
 * contrato que o ruleset lê — o mesmo papel do `WeaponProfile` para a arma.
 */
export interface MonsterAbility {
  readonly id: string;
  readonly cadenceMs: number;
  /** A chance de sair a cada vencimento (#518). Ausente: sempre sai, sem consumir sorteio. */
  readonly chance?: number;
  readonly target: { readonly range: number; readonly area?: SpellArea };
  readonly power: MonsterAbilityPower;
  readonly damageType: DamageType;
  /**
   * `melee` ou `combat` do Canary (#682): decide as flags de bloqueio no `combat-v3`
   * (`abilityBlockFlags`, `sim`). Ausente: a forma decide o corpo a corpo.
   */
  readonly kind?: 'melee' | 'combat';
  readonly presentation?: { readonly missileKey?: string; readonly impactKey?: string };
  /** A condição que a ability aplica a quem acerta (CMB-07). Ausente: só o golpe. */
  readonly condition?: ConditionSpec;
  /** O campo que a ability deixa no chão, centrado no alvo (CMB-07). Ausente: nenhum. */
  readonly field?: FieldSpec;
  /** A provocação que a ability lança (#599): quem for atingido passa a mirar o lançador. */
  readonly challenge?: { readonly durationMs: number };
}

/**
 * As classes de monstro que a Cyclopedia usa para agrupar o Bestiário (SV-20, ADR 0030,
 * `Modals.jsx:187-195` do kit renderizado — a SideList de categorias). Vocabulário FECHADO: as
 * 20 classes do `monster.Bestiary.class` do Canary (M35-01, #578), no slug em inglês — o leitor
 * de monstros (`scripts/catalog/monsters.ts`, `BESTIARY_CLASS_MAP`) converte `"Extra
 * Dimensional"` em `extra-dimensional` e o resto em minúsculas. Antes do catálogo importado o
 * vocabulário crescia por monstro real (`mammal`, `vermin`, `dragon`, nessa ordem); as três
 * continuam na frente para a ordem de quem já as lia não mudar, e as outras dezessete seguem em
 * ordem alfabética. A contagem por classe no Canary (47dfd51) vai de Humanoid (90) a Amphibic (11).
 *
 * Identificador em inglês, valor de exibição em português fica para quem desenhar a `SideList`
 * (RC-08/#321) — o mesmo desenho de `HUNT_DIFFICULTY_NAMES`/`cautious` (traduzido para
 * "Cauteloso" só no cliente, `packages/client/src/shell/HuntsModal.tsx:25`) e de
 * `BOT_CATEGORIES`/`heal` (traduzido para "Cura" em `packages/client/src/shell/BotPanel.tsx:39`).
 * Ver Decisão técnica DT-02.
 */
export const MONSTER_CLASSES = [
  'mammal', 'vermin', 'dragon',
  'amphibic', 'aquatic', 'bird', 'construct', 'demon', 'elemental', 'extra-dimensional', 'fey',
  'giant', 'human', 'humanoid', 'lycanthrope', 'magical', 'plant', 'reptile', 'slime', 'undead',
] as const;
export type MonsterClass = (typeof MONSTER_CLASSES)[number];

/**
 * As facções do Canary (`Faction_t`, `src/game/game_definitions.hpp:44-53`, conferido em
 * 47dfd51), na ORDEM do enum: o índice de cada nome É o valor numérico da facção, e o valor
 * importa — o Canary soma `faction × 100` à distância e `faction × 100 000` à vida/dano ao
 * ranquear alvos (`Monster::searchTargetImmediate`, `monster_targeting.cpp`), então quem tem a
 * facção de número MENOR ganha o desempate de "mais perto". `factionValue` devolve o número.
 *
 * `default` (0) é o monstro sem facção — o bestiário quase inteiro — e `player` (1) é a do
 * jogador e de tudo que ele invoca; nenhum monstro DECLARA `faction: 'player'`, mas as listas
 * `enemyFactions` de quase todos o citam (é o que faz o monstro de facção atacar o jogador).
 * Identificador em inglês; nomes com hífen no lugar do `FACTION_LIONUSURPERS` colado do Canary.
 */
export const MONSTER_FACTIONS = [
  'default', 'player', 'lion', 'lion-usurpers', 'marid', 'efreet', 'deepling', 'deathling',
  'anuma', 'fafnar',
] as const;
export type MonsterFaction = (typeof MONSTER_FACTIONS)[number];

/** O valor numérico de uma facção no enum do Canary — o índice em `MONSTER_FACTIONS`. */
export function factionValue(faction: MonsterFaction): number {
  return MONSTER_FACTIONS.indexOf(faction);
}

/**
 * As três raridades do Bosstiary do Canary (`BosstiaryRarity_t`, `src/io/io_bosstiary.hpp`, #629):
 * `RARITY_BANE` (0), `RARITY_ARCHFOE` (1) e `RARITY_NEMESIS` (2) — em ordem crescente de raridade,
 * a mesma que o `monster.bosstiary.bossRace` de cada boss declara. O vocabulário é FECHADO: o
 * Canary tem um quarto valor (`BOSS_INVALID`, 10) que é só marcador de leitura do servidor, nunca
 * enviado ao cliente nem declarado por monstro.
 */
export const BOSSTIARY_RARITIES = ['bane', 'archfoe', 'nemesis'] as const;
export type BosstiaryRarity = (typeof BOSSTIARY_RARITIES)[number];
export const bosstiaryRaritySchema = z.enum(BOSSTIARY_RARITIES);

/**
 * Os `ConditionEffect.kind` que uma DEFESA de monstro pode aplicar a SI MESMA (#651): todo
 * self-buff que o bestiário do Canary/TFS usa em defesa própria, nunca um efeito que só faz
 * sentido vindo de um ATACANTE contra outra criatura — `drunk` (desvio de passo) e
 * `damage-over-time` ficam de fora por isso. `invisible` entrou no #559/#592 (Killer Rabbit e
 * afins, `{ name = "invisible", ... }` em `monster.defenses` — o monstro fica invisível sozinho,
 * o mesmo self-buff que `speed`/`buff` já são).
 */
const DEFENSE_SELF_CONDITION_KINDS = new Set<ConditionEffect['kind']>([
  'speed', 'buff', 'mana-shield', 'heal-over-time', 'invisible',
]);

/**
 * Uma DEFESA de monstro (#518, TFS `Monster::onThinkDefense`, referência §15-19): cura própria,
 * como o Dragon (`interval 2000, chance 15%, +40..+70`), OU self-haste (CMB-11, #556), como o
 * Doom Deer (`{ name = "speed", interval 3000, chance 30%, speedChange 400, duration 8000 }`,
 * `data-otservbr-global/monster/mammals/doom_deer.lua`). É uma lista independente da de ataque —
 * cada defesa tem a própria cadência e a própria chance, um evento na fila por defesa (o mesmo
 * desenho de `monsterAbilitySchema`), nunca um cálculo por tick.
 *
 * Campo NOVO e opcional no monstro: nenhum conteúdo existente declara `defenses`, então `chance`
 * aqui é OBRIGATÓRIA — declarar a lista já é conteúdo novo, sem concessão de compatibilidade a
 * preservar. `heal` e `condition` são cada um opcional, mas `buildContent` exige pelo menos um —
 * uma defesa que não cura nem muda velocidade não tem o que fazer.
 */
export const monsterDefenseSchema = z.strictObject({
  id: z.string().min(1),
  /** Milissegundos entre tentativas. Tempo decorrido, nunca contagem de tick (invariante 2). */
  cadenceMs: z.number().int().positive(),
  /** A chance de agir quando o `cadenceMs` vence — uma rolagem por vencimento. */
  chance: z.number().min(0).max(1),
  /** Quanto repõe, sorteado com o `Rng` da sessão a cada cura — nunca passa do HP máximo. */
  heal: z.object({
    min: z.number().int().nonnegative(),
    max: z.number().int().nonnegative(),
  }).refine((range) => range.min <= range.max, 'heal.min não pode passar de heal.max').optional(),
  /**
   * A condição que a defesa aplica a SI MESMO (CMB-11, #556) — o self-haste do Doom Deer.
   * `effect.type` precisa ser `haste` aqui: uma defesa que se paralisa sozinha não é o
   * mecanismo que o Canary usa (`speedChange` positivo nas defesas do bestiário observado).
   */
  condition: conditionSpecSchema.optional(),
  /**
   * A chave SEMÂNTICA de apresentação (CMB-06): o mesmo `impactKey` da ability, resolvido pelo
   * host em `appearances.abilities` — o `blueshimmer` do Dragon, por exemplo. Chave sem linha é
   * MUDA; a cura acontece igual (invariante 6).
   */
  presentation: z.object({
    impactKey: z.string().min(1).optional(),
  }).optional(),
  _open: z.string().optional(),
}).refine(
  (defense) => defense.heal !== undefined || defense.condition !== undefined,
  { message: 'a defesa precisa de heal ou condition' },
).refine(
  (defense) => defense.condition === undefined || defense.condition.effect.kind !== 'speed'
    || defense.condition.effect.type === 'haste',
  { message: 'a condition de uma defesa só usa speed do tipo haste (self-buff)' },
).refine(
  // O `effect.kind` de uma defesa é sempre um SELF-BUFF (achado da revisão do #651): sem esta
  // lista, nada impedia `condition.effect.kind: 'drunk'` numa defesa — o Canary nunca aplica
  // drunk como self-buff (é sempre um ataque do MONSTRO contra o jogador, `Monsters::
  // deserializeSpell`), e um monstro que se embebedasse sozinho a cada `cadenceMs` desviaria o
  // PRÓPRIO passo dele pelo mesmo `#drunkTarget` do jogador — um mecanismo que o Canary/TFS não
  // tem. `damage-over-time` fica de fora pelo mesmo motivo: uma defesa nunca teria por que
  // aplicar dano contínuo a si mesma.
  (defense) => defense.condition === undefined
    || DEFENSE_SELF_CONDITION_KINDS.has(defense.condition.effect.kind),
  {
    message: `a condition de uma defesa só aceita um efeito de self-buff `
      + `(${[...DEFENSE_SELF_CONDITION_KINDS].join(', ')})`,
  },
);
export type MonsterDefenseDefinition = z.infer<typeof monsterDefenseSchema>;

/** A defesa como o `sim` a consome — mesma forma do arquivo, sem defaults a resolver. */
export interface MonsterDefense {
  readonly id: string;
  readonly cadenceMs: number;
  readonly chance: number;
  readonly heal?: { readonly min: number; readonly max: number };
  /** A condição que a defesa aplica a SI MESMO (CMB-11). Ausente: defesa só de cura. */
  readonly condition?: ConditionSpec;
  readonly presentation?: { readonly impactKey?: string };
}

/**
 * A troca de alvo por tempo (#518, TFS `Monster::onThinkTarget`, `changeTargetSpeed`/
 * `changeTargetChance`, referência §15-19): a cada `intervalMs` rola `chance`; se passa, o
 * monstro troca para outro alvo válido ao acaso dentro do `aggroRadius` — o ramo
 * `TARGETSEARCH_RANDOM` do TFS, que é o que o Dragon usa (`targetDistance <= 1`). O ramo
 * `TARGETSEARCH_NEAREST` para monstro de alcance maior fica de fora (§ "Fora do escopo" do
 * #518): nenhum monstro do recorte precisa dele, e o Dragon/Dragon Lord usam o aleatório.
 */
export const monsterTargetChangeSchema = z.object({
  intervalMs: z.number().int().positive(),
  chance: z.number().min(0).max(1),
});
export type MonsterTargetChange = z.infer<typeof monsterTargetChangeSchema>;

/**
 * A seleção PONDERADA de alvo (#541, Canary `Monster::searchTargetImmediate`,
 * `monster.cpp:906-931`, e `MonsterTargetRanker::rank`, `monster_targeting.cpp:17-83`): o
 * CRITÉRIO usado por `chooseTarget` e pelo vencimento de `targetChange` é sorteado pelos pesos
 * declarados — mais perto, menos vida, mais dano causado NO monstro, ou aleatório — em vez de
 * fixo. Ausente preserva o comportamento de sempre: `chooseTarget` só pelo mais perto, e a troca
 * por tempo só pelo `TARGETSEARCH_RANDOM` do #518.
 *
 * Inteiros não-negativos, soma > 0. O Canary sorteia com `uniform_random(1, 100)` contra os
 * QUATRO campos de `monsters.hpp:127-130`, mas `strategiesTargetRandom` nunca entra na soma do
 * `.cpp` — "aleatório" é implicitamente "o que sobra até 100". Aqui `random` é um peso
 * EXPLÍCITO como os outros três: a soma não precisa ser 100, e `rankTarget`
 * (`packages/sim/src/monster/target-strategy.ts`) sorteia proporcionalmente à soma real.
 */
export const monsterTargetStrategySchema = z.object({
  nearest: z.number().int().nonnegative(),
  health: z.number().int().nonnegative(),
  damage: z.number().int().nonnegative(),
  random: z.number().int().nonnegative(),
}).refine(
  (strategy) => strategy.nearest + strategy.health + strategy.damage + strategy.random > 0,
  { message: 'targetStrategy precisa de ao menos um peso maior que zero' },
);
export type MonsterTargetStrategy = z.infer<typeof monsterTargetStrategySchema>;

/**
 * Uma entrada de invocação de monstro por monstro (#546, TFS/Canary `Monster::onThinkDefense`,
 * `monster.summon`/`summons`, referência §15-19): o MESMO laço que avalia `defenses`, um
 * `monsterId` por entrada — o `summonBlock.name`/`summonName` da fonte. Cada entrada tem a
 * PRÓPRIA cadência e a PRÓPRIA chance, um evento na fila por entrada (o desenho de
 * `monsterDefenseSchema`), nunca um cálculo por tick.
 */
export const monsterSummonEntrySchema = z.strictObject({
  monsterId: z.string().min(1),
  /** Milissegundos entre tentativas. Tempo decorrido, nunca contagem de tick (invariante 2). */
  intervalMs: z.number().int().positive(),
  /**
   * A chance de nascer quando o `intervalMs` vence — uma rolagem por vencimento, em FRAÇÃO 0–1
   * como o resto do conteúdo (`monsterDefenseSchema.chance`, `monsterAbilitySchema.chance`). A
   * fonte guarda 1–100 (`summonChance`/`chance`, TFS `summonChance < uniform_random(1, 100)`) —
   * o Slime declara `chance = 10`, e aqui vira `0.10`.
   */
  chance: z.number().min(0).max(1),
  /**
   * Teto de invocações VIVAS deste NOME (`summonBlock.max`/`summonCount`), não do monstro
   * inteiro — esse é `monsterSummonsSchema.max` (`maxSummons`).
   */
  count: z.number().int().positive(),
  _open: z.string().optional(),
});
export type MonsterSummonEntry = z.infer<typeof monsterSummonEntrySchema>;

/**
 * A invocação de um monstro (#546, `monster.summon`/`maxSummons`): quantas invocações vivas ele
 * tolera NO TOTAL, entre todos os nomes, e a lista do que pode nascer. Campo NOVO e opcional —
 * nenhum monstro do recorte atual (rat, rotworm, dragon, dragon-lord) declara `monster.summon`
 * na fonte (conferido em 2026-09-25); ausente é nenhuma invocação, o comportamento de sempre.
 */
export const monsterSummonsSchema = z.strictObject({
  max: z.number().int().positive(),
  entries: z.array(monsterSummonEntrySchema).min(1),
});
export type MonsterSummons = z.infer<typeof monsterSummonsSchema>;

/** Um índice na paleta de 133 cores do outfit (a mesma faixa de `OutfitColors` do protocolo). */
const outfitPaletteIndex = z.number().int().min(0).max(132);

/**
 * O que veste o monstro além do desenho (#620, `monster.outfit` do Canary: `lookHead`, `lookBody`,
 * `lookLegs`, `lookFeet`, `lookAddons`): as quatro cores do template e os addons. **São índices e
 * máscaras, nunca arte** (invariante 6) — o id do desenho (`lookType`) é `outfitId`, e vive na
 * tabela de aparências. Cor `0` é o branco da paleta, o neutro: um outfit de duas camadas com o
 * template todo em 0 se desenha como a base crua, e é o que a maioria dos monstros declara.
 * `addons` é a máscara de bits do Tibia: 1 = primeiro addon, 2 = segundo, 3 = os dois (o
 * bestiário inteiro do Canary usa só 0–3, conferido em 2026-09-30).
 */
export const monsterOutfitSchema = z.strictObject({
  head: outfitPaletteIndex,
  body: outfitPaletteIndex,
  legs: outfitPaletteIndex,
  feet: outfitPaletteIndex,
  addons: z.number().int().min(0).max(3).default(0),
});
export type MonsterOutfit = z.infer<typeof monsterOutfitSchema>;

/** Sem `outfit` declarado o monstro veste cor 0 em tudo e nenhum addon — o `Outfit_t` zerado do Canary. */
export const NEUTRAL_MONSTER_OUTFIT: MonsterOutfit = { head: 0, body: 0, legs: 0, feet: 0, addons: 0 };

/** Uma fala de monstro: o texto e se é grito (`TALKTYPE_MONSTER_YELL`) em vez de fala. */
export const monsterVoiceLineSchema = z.strictObject({
  text: z.string().min(1),
  yell: z.boolean().default(false),
});

/**
 * As falas periódicas de um monstro (#620; `monster.voices` do Canary, `registerMonsterType.voices`
 * em `register_monster_type.lua`, `Monster::onThinkYell`, `monster.cpp`). A cada `intervalMs` o
 * monstro rola `chance` (percentual INTEIRO 0–100, a mesma escala do Lua — o Canary compara
 * `chance >= uniform_random(1, 100)`) e, se passar, diz UMA das `lines` sorteada. **O sorteio é da
 * APRESENTAÇÃO**: o cliente o faz, nunca o `Rng` da sessão — a fala não muda resultado nenhum
 * (invariante 3) e o `sim` nem a conhece. O Canary calcula um intervalo e uma chance só por
 * monstro (o `addVoice` de cada linha sobrescreve os dois), e por isso o bloco os tem uma vez.
 */
export const monsterVoicesSchema = z.strictObject({
  intervalMs: z.number().int().positive(),
  chance: z.number().int().min(1).max(100),
  lines: z.array(monsterVoiceLineSchema).min(1),
});
export type MonsterVoices = z.infer<typeof monsterVoicesSchema>;

/**
 * A luz que o monstro carrega (#620; `monster.light` do Canary → `MonsterType::light(color, level)`,
 * `LightInfo`). `level` é o alcance em tiles e `color` o índice na paleta de 216 cores do Tibia
 * (`c = r·36 + g·6 + b`, a mesma do automapa) — dado do cliente de referência, não arte. Só os 102
 * monstros do Canary com nível maior que 0 declaram; ausente é sem luz.
 */
export const monsterLightSchema = z.strictObject({
  level: z.number().int().min(1).max(255),
  color: z.number().int().min(0).max(215),
});
export type MonsterLight = z.infer<typeof monsterLightSchema>;

export const monsterSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  /**
   * A classe do monstro, para a Cyclopedia agrupar por categoria (SV-20). Vocabulário fechado
   * em `MONSTER_CLASSES` — ver o comentário dela. Ausente: o monstro só aparece em "Todas as
   * entradas" na tela (nenhuma categoria própria ainda).
   */
  class: z.enum(MONSTER_CLASSES).optional(),
  /**
   * Level sugerido, só informativo — nenhum sistema lê o do MONSTRO (a hunt tem o próprio). O
   * Canary não tem esse campo, e o leitor de monstros (#578) não inventa um número: ausente no
   * monstro importado, declarado nos quatro autorais de sempre.
   */
  recommendedLevel: z.number().int().positive().optional(),
  health: z.number().int().positive(),
  experience: z.number().int().nonnegative(),
  /**
   * Dano por ataque, antes de defesa: um número, ou uma FAIXA `{ min, max }` sorteada a cada
   * golpe com o `Rng` da sessão (FUN-123) — o rato do Tibia bate de 0 a 8. Mesma semente,
   * mesmo dano: o contrato do loot vale aqui.
   */
  attack: z.union([
    z.number().int().nonnegative(),
    z.object({ min: z.number().int().nonnegative(), max: z.number().int().nonnegative() })
      .refine((range) => range.min <= range.max, 'attack.min não pode passar de attack.max'),
  ]),
  armor: z.number().int().nonnegative(),
  /**
   * A defesa do monstro no `combat-v3` (#548, `Monster::getDefense`/`monster.defenses.defense`
   * do Canary) — a peça que o `blockHit` subtrai em faixa (`uniform_random(defense/2,
   * defense)`) enquanto o `blockCount` tiver carga, ANTES da armadura. Ausente é `0`: sem
   * defesa, o estágio nunca reduz nada (a mesma identidade que preserva rato/rotworm). Dragon
   * (30) e Dragon Lord (34), `dragon.lua`/`dragon_lord.lua`, conferidos em 2026-09-25.
   */
  defense: z.number().int().nonnegative().default(0),
  /**
   * O TIPO de dano do ataque do monstro (CMB-03). Ausente é `physical`, o default que preserva
   * o v1 — o rato morde, e mordida era dano físico. As abilities por tipo são do CMB-06.
   */
  damageType: z.enum(DAMAGE_TYPES).default('physical'),
  /**
   * O que o monstro RESISTE e ao que é IMUNE (CMB-03). Ausente é o monstro neutro, e o default
   * preserva o v1. É o lado do DEFENSOR: entra no resolver junto da armadura e do Dodge.
   */
  mitigation: monsterMitigationSchema.default(() => ({ resistances: {}, immunities: [] })),
  /**
   * As condições a que o monstro é IMUNE (#559/#592, ADR 0041 decisão 2 — `Monster::isImmune`
   * do Canary/TFS, `monster.immunities[].condition`). `paralyze`/`drunk` e as oito DOTs
   * (`DAMAGE_OVER_TIME_CONDITION_IMMUNITY`: `bleeding`, `poison`, `burning`…): a condição não é
   * ADICIONADA — `#applyConditionTo` (`sim/rulesets/hunt.ts`) recusa antes de entrar, a mesma
   * forma que a supressão de `drunk` por anel já usa, e só quando o chamador é um COMBATE (magia,
   * runa, ability — `fromCombat`) contra outro alvo — `Combat::CombatConditionFunc` do Canary;
   * campo de tile, auto-aplicação e o que entra por `addCondition` direto (os charms
   * Cripple/Numb) não consultam a imunidade. `invisible` é o CASO especial que o Canary também
   * trata à parte: `Monster::canSeeInvisibility() { return isImmune(CONDITION_INVISIBLE); }` — a
   * MESMA imunidade vira "enxerga quem está invisível", nunca "não pode ficar invisível".
   * `chooseTarget` (`sim/monster/monster.ts`) lê esta chave para decidir se o monstro seleciona
   * ou retém um alvo invisível. Ausente é `[]`, o monstro de sempre, sem imunidade nenhuma —
   * preserva bit a bit todo monstro já importado. `outfit` (119 monstros) fica de fora até o
   * M44-03 trazer a condição; o importador o reporta em vez de descartar em silêncio
   * (`scripts/catalog/monsters.ts`).
   */
  conditionImmunities: z.array(z.enum(CONDITION_IMMUNITIES)).default([]),
  /**
   * A cura por elemento (#683, M30-G6; `monster.heals` do Canary): por tipo, o PERCENTUAL
   * INTEIRO do dano que o atinge — já crítico, ANTES de qualquer bloqueio, resistência ou
   * imunidade — que CURA o monstro (`ceil(dano × p / 100)`, `Game::combatBlockHit`). Sai mesmo
   * com o monstro imune ao tipo. Só com atacante (golpe, magia, runa, tique com dono) e só no
   * `combat-v3`. Inteiro, e não fração, pela mesma razão do reflexo abaixo: a escala do Canary e
   * uma conta sem erro de ponto flutuante dentro do `ceil`. Teto 500 (Maxxenius, o maior do
   * Canary local).
   */
  elementHealing: z.partialRecord(z.enum(DAMAGE_TYPES), z.number().int().positive().max(500)).optional(),
  /**
   * O reflexo do monstro (#683, M30-G6; `monster.reflects` do Canary): por tipo, o PERCENTUAL
   * INTEIRO do dano bloqueado devolvido ao atacante, com o TIPO original e o teto
   * `ceil(1 % da vida máxima do atacante)` — o mecanismo do #552 (`combat/reflect.ts`, refletor
   * `monster`), na mesma escala do `reflectSchema` do item. Teto 200 (`MAX_DAMAGE_REFLECTION`).
   * Sem reflexo `flat`: o monstro do Canary não declara. Só o `combat-v3` lê.
   */
  reflect: z.partialRecord(z.enum(DAMAGE_TYPES), z.number().int().positive().max(200)).optional(),
  /**
   * A mitigação PERCENTUAL do `combat-v3` (#548, `Monster::getMitigation`/`monster.defenses.
   * mitigation` do Canary — nome DISTINTO de `mitigation` acima de propósito: aquele é
   * resistência/imunidade POR TIPO, `Creature::mitigateDamage` é um percentual ÚNICO aplicado
   * por ÚLTIMO, depois da armadura, sobre QUALQUER tipo de dano — exceto lifedrain e manadrain
   * (`agony` não existe no Draconya). A exceção chegou com o #547 (M29-07): `resolveBlockHit`
   * (`sim/combat/blockhit.ts`) recebe `mitigationExempt` calculado do `damageType`, nunca mais
   * fixo em `false`. O valor É o percentual direto — `0.99` tira 0,99 % do dano, não 99 % — e o
   * Canary o CAPA em 30. Ausente é `0`, a identidade de rato/rotworm e de todo monstro que o
   * Canary não declara (a maioria: 1394/1655 no bestiário real DECLARAM, mas o Draconya só tem
   * quatro monstros hoje).
   */
  defenseMitigation: z.number().min(0).max(30).default(0),
  /**
   * O crítico do MONSTRO (M30-04, #551, `Monster::getCriticalChance`/`monsters.hpp:126`
   * `critChance`, conferido em 2026-09-26 contra `47dfd51`). PERCENTUAL inteiro 0-100 — a
   * MESMA escala do campo Lua (`critChance = 10` no `antenna.lua`) — porque é
   * `getCriticalChance() * 100` (`combat.cpp:2766`) quem converte para pontos-base na rolagem;
   * `sim/combat/modifiers.ts` faz a MESMA conversão. Ausente é `0`, a identidade de rato,
   * rotworm, dragon e dragon lord: nenhum dos quatro declara `critChance` no Canary — só 6
   * bosses o fazem (`antenna`, `mitmah_scout`, `mitmah_seer`, `the_monster`,
   * `alchemist_container`, `doctor_marrow`), fora do bestiário do Draconya hoje. O Canary NÃO
   * declara bônus de DANO crítico para monstro em conteúdo algum — `Monster::getCriticalDamage`
   * é campo só de runtime (`criticalDamage`, `monster.cpp:307`, default `0`, sem script que o
   * altere) — então um crítico de monstro ativa a FLAG sem multiplicar dano nenhum, fiel ao que
   * o Canary de fato faz; por isso não há `criticalDamage` aqui.
   */
  critChance: z.number().int().min(0).max(100).default(0),
  /**
   * Pode pisar em campo de FOGO mesmo sem ser imune a `fire` (M29-05, TFS `Monster::
   * canWalkOnFieldType`/`Tile::queryAdd`, Canary `monsters.hpp:150`, `canWalkOnFire`)? Ausente é
   * `true` — o default do próprio Canary, e o que preserva rato/rotworm/Dragon/Dragon Lord (os
   * quatro monstros de hoje declaram `true`, ou não declaram nada — `dragon.lua`/`dragon_lord.
   * lua`, conferidos em 2026-09-25). `false` é a EXCEÇÃO real (632/1601 no bestiário do Canary):
   * o passo guloso e a fuga (`monster/step.ts`) tratam um tile com campo de fogo como bloqueado
   * para quem declara `false` e não é imune a `fire` — a base de um Fire Field/GFB controlar
   * posição de monstro.
   */
  canWalkOnFire: z.boolean().default(true),
  /**
   * O mesmo, para campo de VENENO — TFS/Canary `canWalkOnPoison`. O elemento do Tibia aqui é
   * `earth` (CMB-03: `terra→canWalkOnPoison`), não um tipo `poison` à parte.
   */
  canWalkOnPoison: z.boolean().default(true),
  /** O mesmo, para campo de ENERGIA — TFS/Canary `canWalkOnEnergy`. */
  canWalkOnEnergy: z.boolean().default(true),
  /** Milissegundos entre ataques. Tempo decorrido, nunca contagem de tick (invariante 2). */
  attackIntervalMs: z.number().int().positive(),
  /**
   * Velocidade, na escala do Tibia (FUN-119, ADR 0025): o passo dura
   * `ceil50(chão × 1000 / speed)` ms, diagonal × 3. O rato do mapa real tem 172.
   */
  speed: z.number().int().positive(),
  /**
   * Raio de agressão, em tiles — a distância em que `chooseTarget` (`monster/monster.ts`) aceita
   * um candidato novo E em que MANTÉM o alvo retido: o alvo que sai dele é largado (#655, o
   * Canary o tira da `targetList`), e é o mesmo quadrado que decide se o monstro está ocioso,
   * volta ao spawn ou anda ao acaso (`decideUnengagedMove`) — a "lista de alvos" do Canary é quem
   * o monstro enxerga (Chebyshev, como `distance`). É o mesmo raio de `Monster::canSee` do
   * TFS/Canary, que faz `updateTargetList`/`onCreatureFound` aceitar um jogador na lista de
   * alvos (#527): TFS restringe a `Monster::canSee` própria — quadrado de
   * `Map::maxClientViewportX + 1` = 9 (`src/monster.cpp`, `src/map.h`); o Canary NÃO sobrescreve
   * `canSee` para monstro, então herda o quadrado de `Creature::canSee`,
   * `MAP_MAX_VIEW_PORT_X`/`_Y` = 11 (`src/map/map_const.hpp`, `src/creatures/creature.cpp`) — os
   * dois valores conferidos contra o código em 2026-09-25. Pela precedência do ADR 0037 d.4
   * (Canary primeiro quando ele define algo, TFS só onde a escala é a clássica), o raio de
   * agressão do Dragon e do Dragon Lord é 11, não o 9 do TFS nem o 8 que o conteúdo tinha antes
   * desta issue.
   */
  aggroRadius: z.number().int().nonnegative(),
  /**
   * Até onde o monstro alcança para atacar, em tiles. `1` é corpo a corpo.
   *
   * Separado do raio de agressão de propósito: um monstro que persegue de longe e só bate
   * colado é comportamento diferente de um que atira à distância, e a diferença é conteúdo.
   */
  attackRange: z.number().int().positive().default(1),
  /**
   * A distância que o monstro tenta MANTER do alvo, em tiles (#542, TFS/Canary `targetDistance`,
   * `Monster::getDistanceStep`/`getPathSearchParams`). Um atirador com `targetDistance > 1` recua
   * um passo quando o alvo chega mais perto que isto — independente da fuga por vida baixa
   * (`runOnHealth`), que já afasta por outro motivo — e também governa até onde a APROXIMAÇÃO
   * avança (revisão do #649): o monstro para de se aproximar ao alcançar `targetDistance`, e não
   * no maior alcance de ability. Ausente é `1`: o corpo a corpo de sempre, que nunca recua por
   * este campo nem muda onde a aproximação para — rato, rotworm, Dragon e Dragon Lord
   * (`dragon.lua`/`dragon_lord.lua`, que declaram o campo IGUAL ao default `1`) continuam
   * idênticos.
   *
   * Separado de `attackRange` de propósito: `attackRange` é até onde o monstro ALCANÇA para
   * bater; `targetDistance` é a distância que ele PREFERE manter enquanto persegue — e no
   * bestiário real do Canary os dois raramente coincidem: um atirador tipicamente declara
   * `targetDistance` bem MENOR que o alcance da ability mais longa (Necromancer `targetDistance`
   * 4 com abilities de alcance 1/1/7; Priestess `targetDistance` 4 com abilities de alcance 7).
   * Um monstro de `attackRange`/ability 7 e `targetDistance` 4 continua fechando a distância até
   * 4 tiles mesmo já podendo atirar de mais longe — só o oposto (`targetDistance` ausente ou `1`)
   * usa o maior alcance de ability como ponto de parada da aproximação.
   */
  targetDistance: z.number().int().positive().default(1),
  /** Raio a partir do qual ele desiste do alvo e volta ao posto. Zero = nunca desiste. */
  leashRadius: z.number().int().nonnegative().default(0),
  /**
   * Espera o jogador sair da vista do ponto para respawnar (#519, `isBlockable` no TFS/Canary)?
   * Ausente é `false` — o DEFAULT do Canary, e o que 1.640 dos 1.656 monstros do bestiário dele
   * declaram (inclusive Dragon e Dragon Lord): a maioria respawna na hora, ignorando quem está
   * perto. `true` é a EXCEÇÃO (só ~7 monstros, tipicamente NPCs/eventos de quest) — é ela que
   * `spawnClearRadius` (#236) passa a valer só para. Draconya invertia isso por padrão (`0`
   * desligava a checagem inteira, mas quando ligada valia para todo monstro); a partir daqui o
   * padrão passa a ser o do Tibia, monstro por monstro.
   */
  blockable: z.boolean().default(false),
  /**
   * O monstro pode ser EMPURRADO por outro que declare `canPushCreatures` (M29-08, TFS/Canary
   * `Monster::isPushable`, `monster.cpp:276`: `pushable && baseSpeed != 0`). A segunda metade
   * não precisa de campo aqui: `speed` é `positive()` neste schema (nunca zero), então
   * `pushable` sozinho decide. Ausente é `true` — o default do Canary e de 1.598/1.655 do
   * bestiário real; rato e rotworm não declaram (preservam `true`). **Dragon e Dragon Lord
   * declaram `false`** (`dragon.lua`/`dragon_lord.lua`, conferidos em 2026-09-27) — mas o
   * conteúdo autoral de hoje (`data/monsters/generated/dragons.json`, regenerado pelo #581)
   * ainda não carrega o campo, então os dois caem no default `true` até alguém trazer o valor
   * real (fora do escopo desta issue — ver `canPushCreatures` abaixo para o porquê disso ser
   * seguro por ora).
   */
  pushable: z.boolean().default(true),
  /**
   * Empurra CRIATURAS empurráveis que bloqueiam o próprio passo, em vez de tratá-las como
   * parede (M29-08, TFS/Canary `Monster::canPushCreatures`, `monsters.hpp:138`). Ausente é
   * `false` — o default do Canary; rato e rotworm não declaram. **Dragon e Dragon Lord
   * declaram `true`** (`dragon.lua`/`dragon_lord.lua`, conferidos em 2026-09-27) — o conteúdo
   * autoral de hoje ainda não carrega o campo (mesma nota de `pushable`), então os dois caem no
   * default `false` e continuam vendo tile ocupado como parede, exatamente como antes desta
   * issue: nenhum monstro do catálogo empurra nada ainda, e trazer o valor real do Dragon é
   * trabalho À PARTE (#578, o leitor de bestiário). Isso é seguro mesmo assim porque `sim`
   * (`HuntRuleset#clearPushableOccupant`/`#pushablePathThrough`) só executa o empurrão sob
   * `combat-v3` — sob `combat-v1`/`v2` o campo é lido, mas NUNCA move nada nem consome
   * `session.rng`, para uma hunt já congelada (ADR 0031/0040) nunca divergir por causa de um
   * valor de conteúdo que mudou depois dela ter começado.
   */
  canPushCreatures: z.boolean().default(false),
  /**
   * Empurra ITENS móveis do tile de destino (TFS/Canary `Monster::canPushItems`,
   * `monsters.hpp:137`). Aceito e validado, mas SEM EFEITO no Draconya: não existe item móvel
   * no chão — o cadáver é só visual (ADR 0048) — então não há o que empurrar. Ausente é
   * `false`, o default do Canary; Dragon e Dragon Lord declaram `true` no Canary
   * (`dragon.lua`/`dragon_lord.lua`), mas sem efeito nenhum aqui de qualquer forma.
   */
  canPushItems: z.boolean().default(false),
  /**
   * É boss (#691)? O `MonsterType::isBoss` do Canary (`!bosstiaryClass.empty()`), que decide
   * se os rates de `progression.rates.boss` valem no lugar dos de `monster` — e, desde o #629,
   * também quem NÃO conta no Bestiário (`Player::addBestiaryKill` devolve cedo para boss) e conta
   * no Bosstiary. O importador escreve `boss: true` junto com `bosstiary` (o `isBoss` do Canary É
   * "tem bloco bosstiary"), e `buildContent` recusa `bosstiary` sem `boss`. Ausente é `false`.
   */
  boss: z.boolean().default(false),
  /**
   * O boss no Bosstiary (#629; `monster.bosstiary` do Canary): a raridade — Bane, Archfoe ou
   * Nemesis, que escolhe a linha de `content.bosstiary.levels` (quantos abates levam a cada
   * nível, e quantos pontos cada nível rende) — e o `raceId` (`bossRaceId` do Canary), a CHAVE do
   * contador de abates. É a chave do Canary (`STORAGEVALUE_BESTIARYKILLCOUNT + raceid`), e não o
   * id de conteúdo, porque quatro `raceId` são compartilhados por variantes do mesmo boss (as
   * cinco formas de Urmahlullu, as duas Goshnar's Megalomania, os dois Voidborn, Rupture e
   * Eradicator2): abater qualquer uma soma no MESMO contador. Só o boss declara; monstro comum
   * fica sem o campo e conta no Bestiário.
   */
  bosstiary: z.strictObject({
    rarity: bosstiaryRaritySchema,
    raceId: z.number().int().positive(),
  }).optional(),
  loot: lootTableSchema.default({ items: [] }),
  /**
   * Quanto tempo o cadáver deste monstro fica no chão, em milissegundos (#585; ADR 0037 d.6):
   * a soma, em ms, da cadeia `duration`/`decayTo` do Canary `items.xml` a partir do item que
   * `monster.corpse` aponta — `duration` é lido em SEGUNDOS e multiplicado por 1000
   * (`item.cpp`, `newDuration = it.decayTime * 1000`), somado estágio a estágio até o último
   * `decayTo="0"`. Era um valor por HUNT (`huntSchema.corpseTtlMs`, calculado à mão); moveu para
   * cá porque o prazo é do MONSTRO no Canary, não de onde ele aparece — o rato tem o mesmo
   * cadáver em Rat Cellars ou em qualquer outra hunt. Ausente é monstro sem cadáver: a coleta de
   * loot roda igual (ADR 0048 decisão 1), só o que sobra do filtro de Quick Loot não tem onde
   * esperar e desaparece — o mesmo "hunt sem o campo" de antes desta issue, só que por monstro.
   */
  corpseTtlMs: z.number().int().positive().optional(),
  /**
   * As cores e os addons com que o outfit dele é pintado (#620, `monster.outfit.look*` do Canary).
   * Ausente é o neutro (`NEUTRAL_MONSTER_OUTFIT`, tudo 0) — o que o Canary faz sem declarar, e o
   * importador só escreve o campo quando algo difere. É APRESENTAÇÃO: o `sim` nunca lê, e o `id`
   * do desenho continua na tabela de aparências. Ver `monsterOutfitSchema`. **Sem `.default()` de
   * propósito:** o default no schema tornaria o campo obrigatório no tipo `Monster`, e cada
   * literal de monstro de teste, de bench e de fixture teria de repeti-lo — quem lê aplica o
   * neutro (`monster.outfit ?? NEUTRAL_MONSTER_OUTFIT`).
   */
  outfit: monsterOutfitSchema.optional(),
  /**
   * As falas periódicas (#620, `monster.voices`). Ausente é mudo. O sorteio é do cliente — ver
   * `monsterVoicesSchema`.
   */
  voices: monsterVoicesSchema.optional(),
  /** A luz que ele carrega (#620, `monster.light`). Ausente é sem luz. Ver `monsterLightSchema`. */
  light: monsterLightSchema.optional(),
  /**
   * A raça — cor e efeito do golpe físico que o atinge (#620, `monster.race`). Ausente é
   * `blood`, o `RACE_BLOOD` que o Canary assume (`DEFAULT_MONSTER_RACE`; quem lê aplica, pela
   * mesma razão de `outfit`). Só apresentação.
   */
  race: z.enum(MONSTER_RACES).optional(),
  /**
   * As JANELAS do cadáver em que a Animate Dead Rune o aceita (#600, ADR 0057 d.6): `fromMs`
   * inclusive, `untilMs` exclusivo, em milissegundos desde a morte — o mesmo relógio de
   * `corpseTtlMs`. O Canary (`animate_dead_rune.lua`) exige que o item do TOPO do tile seja
   * `itemType:isCorpse() and itemType:isMovable()`, e isso é propriedade de CADA ESTÁGIO da cadeia
   * `decayTo` (`appearances.dat`: flag `corpse`, e `unmove` ausente): o primeiro estágio de quase
   * todo monstro é `unmove` — o cadáver recém-abatido NÃO pode ser animado — e vira movível ao
   * decair (10 s depois, no caso comum: 5972 → 4024 do esqueleto). Por isso são janelas, e não um
   * booleano. Ausente é "nunca" — monstro sem cadáver (`corpseTtlMs` ausente) ou cuja cadeia
   * nunca tem um estágio movível. Gerado pelo importador a partir de `data/items/appearances.dat`
   * e do `items.xml` do Canary; nunca escrito à mão.
   */
  corpseAnimatable: z.array(z.strictObject({
    fromMs: z.number().int().nonnegative(),
    untilMs: z.number().int().positive(),
  }).refine((window) => window.untilMs > window.fromMs, { message: 'untilMs precisa passar de fromMs' }))
    .optional(),
  /**
   * O monstro pode ser CONVENCIDO pela Convince Creature Rune (#600, ADR 0057 d.5; Canary
   * `monster.flags.convinceable`, lido por `MonsterType::isConvinceable` em `convince_creature.lua`).
   * Ausente é `false` — o default do Canary: 139 dos monstros do bestiário o declaram. O custo da
   * convicção é o `manaCost` abaixo (ausente conta como zero: `MonsterType::info.manaCost`, o que o
   * binding `monsterType:manaCost()` devolve, fica zerado, e o script debita esse valor — ver a nota
   * de `manaCost` sobre o `getManaCost` que o script chama).
   */
  convinceable: z.boolean().default(false),
  /**
   * As abilities declaradas (CMB-06, DT-01). AUSENTE (ou vazia) normaliza no boot para UMA
   * ability básica montada do `attack`/`attackIntervalMs`/`attackRange`/`damageType` — é o que
   * preserva o monstro legado bit a bit, e é o caminho do rato. Quando declaradas, o
   * `attack`/`attackIntervalMs`/`attackRange` acima continuam no arquivo, mas quem manda são
   * elas (o boot NÃO sintetiza a básica). O id `basic` é reservado ao boot.
   */
  abilities: z.array(monsterAbilitySchema).optional(),
  /**
   * As defesas declaradas (#518): cura própria, hoje. AUSENTE é nenhuma — o rato e o rotworm não
   * declaram, e não curam sozinhos, como sempre.
   */
  defenses: z.array(monsterDefenseSchema).optional(),
  /** A troca de alvo por tempo (#518). Ausente é o comportamento de sempre: só troca quando o
   * alvo atual morre, sai do `leashRadius` ou sai da área de visão — o `aggroRadius`, #655
   * (`chooseTarget`). O timer não rola enquanto o monstro está ocioso (#655). */
  targetChange: monsterTargetChangeSchema.optional(),
  /**
   * O critério de seleção ponderada (#541) que `chooseTarget` e o vencimento de `targetChange`
   * sorteiam. Ausente é o comportamento de sempre — ver `monsterTargetStrategySchema`.
   */
  targetStrategy: monsterTargetStrategySchema.optional(),
  /**
   * A facção do monstro (#619, Canary `monster.faction`, `MonsterType::info.faction`,
   * `monsters.hpp:134`) — ver `MONSTER_FACTIONS`. Ausente é `default`, o monstro sem facção: só
   * ataca jogador e invocação de jogador, e nenhum outro monstro o ataca, como sempre. Com
   * facção, quem ele considera alvo passa a ser decidido por `enemyFactions` (abaixo), e uma
   * invocação sua herda a facção do mestre (`Monster::getFaction`).
   */
  faction: z.enum(MONSTER_FACTIONS).optional(),
  /**
   * As facções INIMIGAS deste monstro (#619, Canary `monster.enemyFactions`,
   * `MonsterType::info.enemyFactions`, `monsters.hpp:135`): só quem é de uma dessas facções é
   * alvo dele (`Monster::isTarget`) e só a esses o golpe dele acerta (`Combat::canDoCombat`).
   * `player` na lista é o que faz o monstro de facção caçar jogador — quase todo monstro de
   * facção do Canary o declara; as três da Lion (`lion-knight`/`-archer`/`-warlock`) só nomeiam
   * `lion-usurpers` e portanto ignoram o jogador. Ausente é nenhuma inimiga (o que, para um
   * monstro COM facção, é não atacar ninguém).
   */
  enemyFactions: z.array(z.enum(MONSTER_FACTIONS)).optional(),
  /**
   * O HP em que o monstro passa a fugir (#518, TFS `runonhealth`, referência §15-19): abaixo ou
   * igual a este valor, ele se afasta do alvo em vez de aproximar, não dá golpe corpo a corpo,
   * mas continua usando as abilities à distância que alcançam. Ausente é nunca foge — o
   * comportamento de sempre.
   */
  runOnHealth: z.number().int().nonnegative().optional(),
  /**
   * A fração de vencimentos em que o monstro, podendo atacar, fica parado em vez de dar um
   * passo aleatório colado no alvo (#518, TFS `staticattack`, referência §15-19: `randomStepping`
   * quando o sorteio passa do valor). **Aceito e validado, mas ainda NÃO wired no `sim`** — o
   * motor de passo daqui não tem um "pensamento" periódico independente do passo em si, e
   * simular o shuffle exigiria um evento novo só para isso. Registrado como divergência em
   * `docs/product/combat.md`, por decisão explícita do #518 ("implementar só se couber sem mexer
   * no determinismo; senão registrar como divergência").
   */
  staticAttack: z.number().min(0).max(1).optional(),
  /** De onde um monstro IMPORTADO veio (ADR 0038 decisão 2). Ausente em monstro autorado à mão. */
  source: catalogSourceSchema.optional(),
  /**
   * A invocação de monstro por monstro (#546, TFS/Canary `monster.summon`/`maxSummons`,
   * referência §15-19). Ausente é nenhuma — o comportamento de sempre.
   */
  summons: monsterSummonsSchema.optional(),
  /**
   * O monstro pode ser invocado por um PERSONAGEM (#598, M38-01, ADR 0057; TFS/Canary
   * `MonsterType::isSummonable()`, `data/scripts/spells/support/summon_creature.lua`: só monstro
   * com o campo marcado entra no parâmetro de `summon`). Distinto de `summons` acima — aquele é
   * o monstro CONVOCANDO outro; este é o monstro sendo convocado pelo JOGADOR. Ausente é `false`:
   * a maioria do bestiário do Canary não é invocável, e nenhum dos quatro monstros do recorte
   * atual (rat, rotworm, dragon, dragon-lord) declara.
   */
  summonable: z.boolean().default(false),
  /**
   * `manaCost` da invocação (#598, `MonsterType::info.manaCost`, o custo de mana que
   * `summon_creature.lua` debita do mestre por invocação) — 184 monstros do Canary o declaram.
   * Obrigatório quando `summonable` é `true` (`.refine` abaixo). Também é o custo da Convince
   * Creature Rune (#600, `convince_creature.lua`: `manaCost = target:getType():getManaCost()`) — por
   * isso o importador o traz para todo monstro que o declara, `summonable` ou não. Ausente é zero.
   *
   * **Nota de fonte:** nenhum dos dois motores registra um `MonsterType:getManaCost()` — o binding Lua
   * é `monsterType:manaCost()` (Canary `monster_type_functions.cpp`, "manaCost"; TFS `luascript.cpp`,
   * "manaCost"), e só o C++ `Monster::getManaCost()` existe, lendo `info.manaCost`. Os scripts
   * `convince_creature.lua` e `summon_creature.lua` chamam o nome que não existe e, como escritos,
   * falhariam com "attempt to call method". O catálogo segue a INTENÇÃO evidente deles (o custo é o
   * `info.manaCost` do monstro), registrada no ADR 0057 (emenda de 2026-09-30).
   */
  manaCost: z.number().int().positive().optional(),
  /**
   * O monstro é um FAMILIAR de vocação (#599, M38-02, ADR 0057 d.3; Canary `monster.flags.
   * familiar`, `Monster::isFamiliar()`): a invocação level 200 que o personagem mantém por 15
   * min. **Não é `summonable`** — o Canary declara `summonable = false` nos quatro, e é isso que
   * impede a Summon Creature de invocá-los; a única porta é a magia `familiar`
   * (`spellEffectSchema`). O flag muda o que a invocação FAZ: o mestre recebe a XP inteira (uma
   * invocação comum rende a metade, `Creature::onGainExperience`), ela é teleportada ao mestre
   * quando se afasta (`Creature::checkSummonMove`) e nasce com a velocidade dele, se maior. Ausente
   * é `false`.
   */
  familiar: z.boolean().default(false),
  /** Nota de proveniência do arquivo inteiro — número medido, fonte TFS/Canary, decisão tomada. */
  _open: z.string().optional(),
}).refine(
  (monster) => !monster.summonable || monster.manaCost !== undefined,
  { message: 'monster.summonable exige manaCost', path: ['manaCost'] },
);

/**
 * O nome de dificuldade que ainda chega no protocolo (`enter-hunt.difficulty`, #584). O modelo de
 * pull por tamanho do Huntera (Cauteloso/Ousado/Agressivo, FUN-123) foi REMOVIDO do conteúdo e do
 * `sim` pelo #583 (ADR 0039): toda hunt nasce dos pontos de spawn reais do Canary, nunca de uma
 * composição sorteada por tamanho de pull. O campo continua existindo no protocolo/servidor só
 * por compatibilidade — é aceito e IGNORADO (no-op) pelo `sim` — até o #584 tirar de vez a UI e
 * a mensagem que ainda o mandam. Sem enum: era `(typeof HUNT_DIFFICULTY_NAMES)[number]` antes
 * desta issue, e vira `string` porque não há mais uma lista fixa de nomes válidos por hunt.
 */
export type HuntDifficultyName = string;

export const huntSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  recommendedLevel: z.number().int().positive(),
  mapId: z.string().min(1),
  /**
   * O ambiente que o cliente desenha (FUN-121, cópia do Huntera): `cavern` escurece o mundo —
   * o bueiro —, `surface` é a luz do dia. Só apresentação; a simulação não lê isto.
   */
  ambience: z.enum(['surface', 'cavern']).optional(),
  /**
   * A rota que o bot percorre. **Apontada, não inferida.**
   *
   * Deduzir a rota pelo `mapId` funcionaria hoje, com uma rota por mapa, e falharia em
   * silêncio no dia em que um mapa tivesse duas — a hunt passaria a andar por um caminho que
   * ninguém escolheu, e nada no arquivo diria por quê. O §14.4 dá UMA rota a cada hunt; o
   * campo diz qual.
   */
  routeId: z.string().min(1),
  /**
   * Contagem regressiva de saída da hunt em milissegundos (#360).
   * Ausente é saída imediata.
   */
  exitDelayMs: z.number().int().positive().optional(),
  /**
   * O texto de apresentação da hunt (R8-13), mostrado no modal de detalhes do kit quando
   * #349/RC-12 o construir. Opcional: hunt sem o campo é hunt cujo parágrafo ainda não foi
   * escrito. Só apresentação; a simulação não lê isto.
   */
  description: z.string().min(1).optional(),
});

/**
 * Uma peça do kit inicial (#496): o item e, opcionalmente, o slot em que se declara. O slot é
 * opcional porque o item já diz onde veste — declará-lo é documentar a intenção, e
 * `buildContent` recusa a declaração que não bate com o item.
 */
export const startingKitPieceSchema = z.object({
  itemId: z.string().min(1),
  slot: z.enum(ITEM_SLOTS).optional(),
});

export type StartingKitPiece = z.infer<typeof startingKitPieceSchema>;

/**
 * Um pulso de regeneração (#678): `amount` pontos a cada `ticksMs` — o `gainhpticks`/
 * `gainhpamount` (e `gainmanaticks`/`gainmanaamount`) do Canary `vocations.xml`, guardado como
 * pulso e sem virar taxa. Cada pulso é UM evento da fila da sessão (invariante 2, ADR 0020), que
 * vence no instante exato: `ticksMs` inteiro, nada de `1000 / taxa` em ponto flutuante — é o que
 * faz a hunt desanexada a 1 Hz regenerar exatamente o mesmo que a anexada a 10 Hz.
 *
 * `amount: 0` é "não regenera" (nenhum evento agendado); `ticksMs` é positivo porque zero seria
 * um pulso que reagenda a si mesmo no mesmo instante, para sempre.
 */
export const regenPulseSchema = z.strictObject({
  ticksMs: z.number().int().positive(),
  amount: z.number().int().nonnegative(),
});

/** A regeneração passiva (#678): um pulso de vida e um de mana, independentes. */
export const regenSchema = z.strictObject({ health: regenPulseSchema, mana: regenPulseSchema });

export type RegenPulse = z.infer<typeof regenPulseSchema>;
export type Regen = z.infer<typeof regenSchema>;

/**
 * Sentinela de `vocation.spellSkill` (#567): "a skill da ARMA equipada agora", nunca uma skill
 * de verdade — não existe `skills/weapon.json`, e `buildContent` sabe disso e pula a
 * conferência de existência para este valor (ver `content.ts`). É o que o Knight usa desde a
 * separação de `melee` em `fist`/`club`/`sword`/`axe`: a magia dele (Berserk, Groundshaker…)
 * escala pela skill que a família da arma na mão aponta — `fist` desarmado —, e não por um
 * nome fixo que deixaria de existir a cada troca de arma.
 */
export const SPELL_SKILL_WEAPON = 'weapon' as const;

export const vocationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  healthPerLevel: z.number().int().nonnegative(),
  manaPerLevel: z.number().int().nonnegative(),
  capacityPerLevel: z.number().int().nonnegative(),
  /**
   * A skill que escala as magias de ATAQUE desta vocação (#155, ADR 0026 d.5): `magic`,
   * `distance` no Paladin, e `SPELL_SKILL_WEAPON` ("weapon") no Knight (#567) — a skill da
   * FAMÍLIA da arma equipada, resolvida em tempo de execução porque o Knight troca de arma e,
   * desde a separação de `melee`, não há mais uma skill fixa só dele.
   */
  spellSkill: z.string().min(1).default('magic'),
  /**
   * Regeneração passiva DESTA vocação (#521, ADR 0037), na mesma forma de `progression.regen`:
   * um pulso por recurso (#678, `regenPulseSchema`). Vem do Canary `vocations.xml`
   * (`gainhpticks`/`gainhpamount`, `gainmanaticks`/`gainmanaamount`, sem conversão), verificado
   * contra o arquivo em 47dfd51. Ausente: quem monta a sessão cai no `regen` da tabela base (sem
   * vocação) — o conteúdo de teste que não fala de vocação por vocação.
   */
  regen: regenSchema.optional(),
  /**
   * A mitigação percentual do JOGADOR desta vocação (#549, M30-02; `PlayerWheel::
   * calculateMitigation`, Canary `player_wheel.cpp:4072-4124`) — o `<mitigation multiplier
   * primaryShield secondaryShield>` de `vocations.xml`. SEM RELAÇÃO com `mitigationSchema`
   * (resistência/imunidade por tipo, CMB-03) nem com `Monster.defenseMitigation` (ADR 0040): os
   * três se chamam "mitigação" porque o Canary também repete o nome para conceitos diferentes.
   * `multiplier` escala a skill de escudo; `primaryShield`/`secondaryShield` escalam a defesa da
   * peça — o segundo é o que spellbook, quiver e arma de duas mãos usam em vez do primeiro.
   * Ausente: quem monta a sessão cai em `progression.mitigation` (a vocação `None`), a mesma
   * regra de `regen` acima. `playerMitigation` (`sim/combat/player-defense.ts`) consome os três.
   */
  mitigation: z.object({
    multiplier: z.number().nonnegative(),
    primaryShield: z.number().nonnegative(),
    secondaryShield: z.number().nonnegative(),
  }).optional(),
  /**
   * Quanto esta vocação demora para subir cada skill (#521, ADR 0037): o `factor` de
   * `pointsForLevel` (`skills.ts`) por `skillId`, substituindo o da tabela do conteúdo da
   * skill. É o `<skill id multiplier="…">` do Canary `vocations.xml` — a mesma chave cobre
   * magic level, porque ML é só mais uma entrada da tabela (`manamultiplier` no Canary).
   * Ausente para um `skillId`: cai no `factor` do PRÓPRIO conteúdo da skill (o padrão de quem
   * não distingue vocação nenhuma — o conteúdo de teste antigo).
   */
  skillMultipliers: z.record(z.string(), z.number().min(1)).default({}),
  /**
   * A arma que a vocação recebe ao ser escolhida (#154, ADR 0026 decisão 3). `buildContent`
   * confere que o item existe, é `kind: 'weapon'` e exige ESTA vocação — uma arma que qualquer
   * um veste não é "a arma da vocação". Opcional no SCHEMA, e não no conteúdo real: as quatro
   * vocações têm a sua, e o conteúdo de teste que não fala de item precisa de vocação sem arma.
   *
   * Legada desde o kit completo por vocação (#496): quando `startingKit` é declarado, é ele
   * quem diz o que a vocação concede — a arma já é a primeira peça dele, e o campo só sobrevive
   * para o conteúdo de teste e o fallback do host. Os dois juntos são conferidos no boot.
   */
  startingWeaponItemId: z.string().min(1).optional(),
  /**
   * O kit que a vocação concede ao ser escolhida, no level da escolha (#496): peça e slot
   * declarado. O slot é a declaração de intenção — `equip` veste pelo slot DO ITEM, e
   * `buildContent` recusa a peça declarada num slot que não é o dele. Opcional, porque o item
   * já diz onde veste.
   *
   * Arma de duas mãos com escudo É válida aqui — é o kit do Paladin: o `Inventory.equip` veste
   * a arma e o escudo fica na mochila, um estado alcançável, diferente do kit de nascimento
   * (gravado direto no banco, sem passar por `equip`), que recusa a combinação.
   */
  startingKit: z.array(startingKitPieceSchema).default([]),
  /**
   * O `meleeDamage`/`distDamage` de `vocations.xml` (Canary, #522): multiplicador do dano MÁXIMO
   * de arma desta vocação, corpo a corpo e distância — aplicado em `resolveWeaponPower` sob o
   * `combat-v2` (ADR 0037 decisão 5). `1` em toda vocação no Canary hoje: não há vocação que
   * bata mais forte de arma por decreto, só por skill/level/equipamento. Fica em conteúdo, não
   * constante mágica (§12.1), para o dia em que balancear precisar de outro valor.
   */
  meleeDamageMultiplier: z.number().positive().default(1),
  distDamageMultiplier: z.number().positive().default(1),
  /**
   * Pontos de alma (#593): teto e cadência de ganho, de `vocations.xml` (Canary) —
   * `soulmax`/`gainsoulticks`, verificados em `opentibiabr/canary` `data/XML/vocations.xml`,
   * `main` 2026-09-27. `soulGainTicksMs` é o `gainsoulticks` já em milissegundos (o Canary
   * também mede em ms); um ponto de alma a cada intervalo, nunca por tick (invariante 2).
   *
   * O Canary distingue vocação base (100/120000) de PROMOVIDA (200/15000) — Draconya não tem
   * promoção ainda, então cada vocação carrega só o número da base; o dia em que a promoção
   * existir, ela reescreve estes dois campos como já reescreve stats por level.
   *
   * Sem vocação (personagem antes do level 8, §7.4) não há alma: o Canary sempre tem vocação
   * (mesmo `VOCATION_NONE` declara os dois), mas aqui o personagem nasce sem uma, e a alma só
   * passa a existir quando ele escolhe — `chooseVocation` é quem a enche pela primeira vez.
   *
   * `default` é o número BASE (as quatro vocações reais o repetem explicitamente, como
   * `meleeDamageMultiplier: 1` — documentação, não silêncio): sem promoção implementada ainda,
   * é o único número que existe, e um default poupa cada conteúdo de TESTE — dezenas, entre
   * `content.test.ts`, `hunt.test.ts` e `catalogue.test.ts` — de declarar um par que não muda
   * o resultado de nenhum deles.
   */
  soulMax: z.number().int().positive().default(100),
  soulGainTicksMs: z.number().int().positive().default(120_000),
  /**
   * O bloco da vocação PROMOVIDA (#566, ADR 0042 decisão 1): `vocations.xml` ids 5–8 do Canary,
   * comparados às bases 1–4, verificado contra o checkout local em 2026-09-28. `name` é o nome
   * de exibição ("Elite Knight"); `regen` reescreve as taxas de vida/mana desta vocação quando
   * `CharacterRuntime.promoted` é `true` — ausente cai no `regen` da base, normal. `soulMax`/
   * `soulGainTicksMs` são os mesmos números do soul (#593): têm efeito só quando o consumidor do
   * soul existir (ainda não mesclado) — até lá ficam prontos e ignorados, sem quebrar nada.
   * `minLevel`/`price` são `data-otservbr-global/npc/king_tibianus.lua:194-204` (`level = 20`,
   * `cost = 20000`) — o NPC-padrão de promoção, não o `emperor_kruzak.lua` (Monk-only).
   * Opcional: vocação de conteúdo de teste não promove.
   */
  promotion: z.object({
    name: z.string().min(1),
    regen: regenSchema.optional(),
    soulMax: z.number().int().positive().optional(),
    soulGainTicksMs: z.number().int().positive().optional(),
    minLevel: z.number().int().nonnegative(),
    price: z.number().int().nonnegative(),
  }).optional(),
  /**
   * Marcador de valor ainda não decidido no PRD. Palpite disfarçado de decisão é o que faz
   * ninguém lembrar de voltar — o carregador avisa no boot, e o `docs-check` conta.
   */
  _open: z.string().optional(),
});

/**
 * Uma faixa de rate por level (#691), o `{ minlevel, maxlevel, multiplier }` de `data/stages.lua`
 * do Canary. `maxLevel` é INCLUSIVO; ausente é infinito, e só a ÚLTIMA faixa pode omiti-lo.
 */
const rateStageSchema = z.strictObject({
  minLevel: z.number().int().nonnegative(),
  maxLevel: z.number().int().positive().optional(),
  multiplier: z.number().positive(),
}).refine(
  (stage) => stage.maxLevel === undefined || stage.minLevel <= stage.maxLevel,
  'faixa de rate com minLevel acima de maxLevel',
);

/**
 * Recusa faixa aberta que não seja a última e faixas sobrepostas (#691), a mesma forma da
 * checagem do `experienceBonusByLevel` (#563). Sobreposição não seria erro no Canary — a
 * primeira faixa vence (`getRateFromTable`) —, mas aqui a segunda faixa seria letra morta, e
 * número que não vale nada é erro de digitação à espera de virar bug de balanceamento.
 */
const rateStagesSchema = z.array(rateStageSchema).superRefine((stages, context) => {
  for (let index = 0; index < stages.length; index += 1) {
    const stage = stages[index];
    if (stage === undefined) continue;
    if (stage.maxLevel === undefined && index !== stages.length - 1) {
      context.addIssue({ code: 'custom', message: `faixa de rate sem maxLevel em ${index} não é a última` });
      return;
    }
    for (let other = 0; other < index; other += 1) {
      const previous = stages[other];
      if (previous === undefined) continue;
      const previousMax = previous.maxLevel ?? Number.POSITIVE_INFINITY;
      const stageMax = stage.maxLevel ?? Number.POSITIVE_INFINITY;
      if (stage.minLevel <= previousMax && previous.minLevel <= stageMax) {
        context.addIssue({ code: 'custom', message: `faixas de rate sobrepostas em ${other} e ${index}` });
        return;
      }
    }
  }
});

/**
 * O escalonamento de monstro ou de boss (#691): `rateMonsterHealth/Attack/Defense` e
 * `rateBossHealth/Attack/Defense` do `config.lua` do Canary.
 */
const creatureRatesSchema = z.strictObject({
  health: z.number().positive().default(1),
  attack: z.number().positive().default(1),
  defense: z.number().positive().default(1),
});

/**
 * Os rates do servidor (#691, M44-G15): o `rateExp`/`rateSkill`/`rateMagic`/`rateLoot`, os
 * stages de `data/stages.lua` e os multiplicadores de monstro e boss do Canary. Moram no
 * conteúdo versionado, e não em variável de ambiente, pelo invariante 7: um rate fora do
 * conteúdo mudaria o resultado no meio de uma sessão. Mudar o rate é deploy de conteúdo.
 *
 * O default é NEUTRO (tudo 1, stages desligados), o Tibia com rate 1 — e com ele nenhum
 * número muda: o `sim` curto-circuita cada aplicação em 1. O `lowLevelBonusExp` do Canary NÃO
 * mora aqui (ADR 0043, emenda): é o `experienceBonusByLevel` do #563, e o rate de XP multiplica
 * DEPOIS da soma de bônus, na ordem do Canary.
 */
export const ratesSchema = z.strictObject({
  experience: z.number().positive().default(1),
  skill: z.number().positive().default(1),
  magic: z.number().positive().default(1),
  /**
   * Inteiro, como o `rateLoot` do Canary. `0` desliga o loot (sem sorteio nenhum); a chance de
   * cada linha é multiplicada por `max(1, loot)`, com teto 1.
   */
  loot: z.number().int().nonnegative().default(1),
  /** O `rateUseStages` do Canary: desligado, as tabelas abaixo são ignoradas. */
  useStages: z.boolean().default(false),
  experienceStages: rateStagesSchema.default([]),
  skillStages: rateStagesSchema.default([]),
  magicLevelStages: rateStagesSchema.default([]),
  /** Para monstro sem `boss`. Vida e defesa na compilação; ataque no golpe (`sim`). */
  monster: creatureRatesSchema.default(() => ({ health: 1, attack: 1, defense: 1 })),
  /** Para monstro com `boss: true` (`MonsterType::isBoss` do Canary). */
  boss: creatureRatesSchema.default(() => ({ health: 1, attack: 1, defense: 1 })),
});

export type Rates = z.infer<typeof ratesSchema>;
export type RateStage = Rates['experienceStages'][number];
export type CreatureRates = Rates['monster'];

/** Os rates neutros (#691): o que o conteúdo sem `progression.rates` recebe. */
export const NEUTRAL_RATES: Rates = ratesSchema.parse({});

/**
 * A tabela base de progressão: onde o personagem começa, e como cresce ENQUANTO NÃO TEM
 * vocação (§7.4 — ela é escolhida no level 8).
 *
 * O PRD (§9.3) define só o incremento POR VOCAÇÃO. Base e níveis 1–7 não estão decididos, e
 * é por isso que este arquivo carrega `_open`: o jogo não sobe sem esses números, mas eles
 * não podem parecer decisão de balanceamento quando são provisório.
 */
export const progressionSchema = z.object({
  id: z.literal('baseline'),
  startingHealth: z.number().int().positive(),
  startingMana: z.number().int().nonnegative(),
  startingCapacity: z.number().int().positive(),
  /** Incremento por level ATÉ a escolha de vocação. */
  healthPerLevel: z.number().int().nonnegative(),
  manaPerLevel: z.number().int().nonnegative(),
  capacityPerLevel: z.number().int().nonnegative(),
  /** Level em que a vocação é escolhida, e a partir do qual ela passa a reger o crescimento. */
  vocationLevel: z.number().int().positive(),
  /**
   * Velocidade inicial e ganho por level, na escala do Tibia (FUN-119, ADR 0025). A duração
   * do passo na hunt é `ceil50(chão × 1000 / speed)` ms, diagonal × 3; a Cidade não usa isto
   * (`city.stepDurationMs`). Fica aqui, e não em `combat`, porque velocidade é atributo do
   * personagem: quando haste e botas existirem, elas modificam ESTE número.
   */
  startingSpeed: z.number().int().positive(),
  speedPerLevel: z.number().int().nonnegative(),
  /**
   * Regeneração passiva BASE (FUN-36, FUN-68; pulsos desde #678) — a vocação `None` do Canary,
   * para quem ainda não tem vocação e para o conteúdo de teste que não declara uma.
   *
   * Um pulso por recurso (`regenPulseSchema`): `amount` a cada `ticksMs`, cada pulso um evento da
   * fila que vence no instante exato. Até #678 era uma taxa em pontos por segundo, que virava 1
   * ponto a cada `1000 / taxa` ms — mesma média, outro ritmo, e divisão em ponto flutuante.
   */
  regen: regenSchema,
  /**
   * A regeneração exige comida? (#726, ADR 0049 decisão 5, emenda ao ADR 0043). O ADR 0043
   * (emenda de 2026-09-25, Huntera) tinha decidido regeneração ligada só a "estar em hunt", sem
   * comida — e ESTA é a decisão que continua valendo por padrão: `requiresFood: false`. A flag
   * existe para o dono poder ligar a regra do Tibia (regenerar só com `fedMs > 0`) editando
   * CONTEÚDO, sem deploy de lógica — o motor (`#onRegen`, `packages/sim`) já sabe consultar os
   * dois casos; só o número aqui decide qual vale.
   */
  regeneration: z.object({
    requiresFood: z.boolean().default(false),
  }).default(() => ({ requiresFood: false })),
  /**
   * A mitigação percentual BASE (#549, M30-02) — a vocação `None` do Canary `vocations.xml`
   * (`<mitigation multiplier="1.3" primaryShield="2.05" secondaryShield="1.25">`), para quem
   * ainda não tem vocação (níveis 1–7, §7.4) e para o conteúdo de teste que não declara uma.
   *
   * Ausente aqui é o default ABAIXO — os mesmos três números —, e não a lacuna que `regen`
   * (sem default, acima) marca de propósito: `regen` ficou sem default porque o Canary não tem
   * "regeneração de quem não tem vocação" nenhuma para copiar (§9.3 é number provisório, por
   * decisão). Aqui o número É o do Canary, verificado, e não uma lacuna de balanceamento — o
   * default existe só para não reabrir a dúzia de fixtures de teste que já constroem
   * `progressionSchema` sem falar de combate. `content/data/progression/baseline.json` (o
   * conteúdo REAL) declara os três de qualquer forma, como o `weaponSchema.family` já declara o
   * que teria default.
   */
  mitigation: z.object({
    multiplier: z.number().nonnegative(),
    primaryShield: z.number().nonnegative(),
    secondaryShield: z.number().nonnegative(),
  }).default(() => ({ multiplier: 1.3, primaryShield: 2.05, secondaryShield: 1.25 })),
  /**
   * Com o que todo personagem nasce, já VESTIDO (ADR 0026, decisão 2; #153): o item e o slot
   * em que ele entra. É número de conteúdo, como o bot padrão — trocar a machete por outra
   * arma é editar JSON. `buildContent` confere que cada item existe, que o slot é o dele, que
   * ele não exige level nem vocação (o personagem nasce level 1 sem ela) e que há um por slot.
   */
  startingKit: z.array(z.object({
    itemId: z.string().min(1),
    slot: z.enum(ITEM_SLOTS),
  })).default([]),
  /**
   * A bolsa fixa do personagem (#160, ADR 0026 decisão 6): não é item, nasce com ele. E
   * quantos lugares uma linha acrescenta quando mochila ou bolsa enchem — o único teto é o
   * peso. Defaults para o conteúdo de teste; o real declara.
   */
  satchelInitialSlots: z.number().int().positive().default(10),
  containerRow: z.number().int().positive().default(5),
  /**
   * A curva de XP (#521, ADR 0037).
   *
   * `kind: 'tibia'` é a curva REAL do Tibia (`Player::getExpForLevel` do Canary/TFS): total
   * acumulado para estar no level `L` é `(L³ − 6L² + 17L − 12) / 6 × 100` — sempre inteiro,
   * porque `L³ − L` é produto de três inteiros consecutivos e por isso múltiplo de 6. É a curva
   * do conteúdo REAL (`baseline.json`); não é mais uma escolha de balanceamento do Draconya
   * (ADR 0037 revoga esse limite do ADR 0019 para mecânica de jogo).
   *
   * `kind: 'power'` é a fórmula antiga (`base * level^exponent`), mantida só para o conteúdo de
   * TESTE que quer uma curva pequena e arbitrária sem carregar os números do Tibia — nunca para
   * conteúdo de jogo real.
   */
  xp: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('tibia') }),
    z.object({
      kind: z.literal('power'),
      base: z.number().positive(),
      exponent: z.number().positive(),
    }),
  ]),
  /**
   * Penalidade de morte (#521/#569, ADR 0037): a fórmula do Tibia (`Player::getLostPercent`,
   * `Player::death` do Canary), não mais uma fração fixa de um level.
   *
   * Abaixo de `cubicFromLevel` o Tibia cobra uma fração FIXA da XP acumulada (`flatFraction`,
   * 10% dos levels 8–23); a partir dali a perda é a fórmula cúbica clássica —
   * `((L+50) / 100) × 50 × (L² − 5L + 8)`, com `L` incluindo a fração de progresso dentro do
   * level, para a perda não saltar na fronteira — sobre a XP acumulada, não mais uma fração de
   * `xpToCompleteLevel`. `blessingReduction` (#570) é a redução POR BÊNÇÃO — 8% no Tibia —, e a
   * penalidade multiplica pelo NÚMERO de bênçãos que o morto tinha (`CharacterRuntime.blessings`,
   * `packages/sim/src/blessings.ts`), nunca mais um binário `premium`. Sete bênçãos × 8% = 56%. O
   * MESMO percentual (menos a redução) tira também os tries de skill e a mana gasta (#569) —
   * não só a XP.
   */
  deathPenalty: z.object({
    /** Fração fixa da XP acumulada perdida abaixo de `cubicFromLevel`. Tibia: 10%. */
    flatFraction: z.number().min(0).max(1),
    /** A partir de qual level a fórmula cúbica substitui a fração fixa. Tibia: 24. */
    cubicFromLevel: z.number().int().positive(),
    /**
     * Redução ADITIVA de UMA bênção (#570, `getSkullClient`/`Player::getLostPercent`: cada
     * bênção soma 1/7 dos 56% cheios). Tibia: 8%. Multiplicada por
     * `blessingCount(character.blessings)` — nunca mais um binário `premium` — antes de aplicar
     * o teto de 50% do ramo `level < cubicFromLevel` (ver `applyDeathPenalty`).
     */
    blessingReduction: z.number().min(0).max(1),
    /**
     * Redução ADITIVA de quem já se promoveu (`Player::getLostPercent`: `percentReduction +=
     * 0.30`), somada à redução de bênção — nunca tetada pelo teto de 50% do ramo
     * `level < cubicFromLevel`, que só se aplica à parcela de bênção (#569). Tibia: 30%.
     *
     * `promoted` ainda não existe como estado do personagem (`applyDeathPenalty` o recebe como
     * parâmetro, opcional, default `false`) — a promoção em si é a #566/ADR 0042, ainda aberta;
     * este campo é o ponto de extensão que ela vai acionar.
     */
    promotionReduction: z.number().min(0).max(1),
    /**
     * A perda de ITEM na morte (#571, ADR 0042 decisão 4) — ver `itemLossSchema`. Opcional:
     * conteúdo de teste sem o bloco não perde item nenhum, e o conteúdo real o declara com
     * `enabled: false` até o dono decidir (a mesma disciplina de `blessingPricing`: número é
     * dado, nunca um default de código).
     */
    itemLoss: itemLossSchema.optional(),
  }),
  /**
   * O preço por level de bênção (#570). Opcional: conteúdo de teste sem Cidade/bênção não
   * precisa dele — a compra recusa sem ele (`blessing-service-unavailable`), nunca inventa um
   * default de código (a regra de sempre: número é dado, não código).
   */
  blessingPricing: blessingPricingSchema.optional(),
  /**
   * O bônus de XP por FAIXA de level (#563), em faixas ORDENADAS: `maxLevel` é o teto INCLUSIVO
   * e a primeira faixa que contém o level vence; a última pode OMITIR `maxLevel` para ser o
   * catch-all. Sem faixa nenhuma o bônus é zero (é o conteúdo de teste).
   *
   * Aditivo com o Bestiário e os demais bônus (VIP, evento): a soma dos percentuais vira UMA
   * multiplicação em inteiro (`applyExperienceBonus`, `sim`). Os percentuais são INTEIROS pela
   * mesma razão do Bestiário — meio ponto voltaria a pôr resíduo de ponto flutuante na frente do
   * arredondamento.
   *
   * O VALOR (200% até o level 300, 100% acima) é decisão de PRODUTO do Draconya, não do Tibia —
   * o `lowLevelBonus` do Canary é 50% até o level 50.
   */
  experienceBonusByLevel: z.array(z.object({
    maxLevel: z.number().int().positive().optional(),
    bonusPercent: z.number().int().nonnegative(),
  })).superRefine((brackets, context) => {
    for (let index = 0; index < brackets.length; index += 1) {
      const bracket = brackets[index];
      if (bracket === undefined) continue;
      if (bracket.maxLevel === undefined && index !== brackets.length - 1) {
        context.addIssue({ code: 'custom', message: `faixa de bônus sem maxLevel em ${index} não é a última` });
        return;
      }
      const previous = brackets[index - 1];
      if (index > 0 && previous?.maxLevel !== undefined && bracket.maxLevel !== undefined
        && bracket.maxLevel <= previous.maxLevel) {
        context.addIssue({
          code: 'custom',
          message: `faixas de bônus fora de ordem em ${index}: ${previous.maxLevel} antes de ${bracket.maxLevel}`,
        });
        return;
      }
    }
  }).default([]),
  /**
   * Quanto demora para subir cada skill SEM vocação escolhida (levels 1–7, §7.4): o `factor`
   * por `skillId`, na mesma forma do `skillMultipliers` da vocação. Vem da vocação `None` do
   * Canary `vocations.xml` (#521, ADR 0037). Ausente para um `skillId`: cai no `factor` do
   * próprio conteúdo da skill.
   */
  skillMultipliers: z.record(z.string(), z.number().min(1)).default({}),
  /**
   * Os rates do servidor (#691): ver `ratesSchema`. Ausente é o neutro — o conteúdo real
   * (`baseline.json`) não declara, porque o default É o Tibia com rate 1.
   */
  rates: ratesSchema.default(() => ratesSchema.parse({})),
  _open: z.string().optional(),
});

export type Progression = z.infer<typeof progressionSchema>;

/**
 * O perfil semântico de combate (ADR 0031, CMB-02). É o CONTRATO de compatibilidade, não
 * balanceamento: `id` é o que o resolver canônico despacha, e os outros campos documentam a
 * release de referência e como uma mudança de fórmula atravessa conteúdo, sessão e snapshot.
 */
export interface CombatCompatibilityProfile {
  readonly id: string;
  readonly referenceRelease: string;
  readonly productExceptions: readonly string[];
  readonly migrationPolicy: 'additive' | 'breaking';
}

/**
 * O perfil inicial, `combat-v1`: ADITIVO — preserva bit a bit o resultado já entregue e só
 * acrescenta estágios que hoje são identidade (ADR 0031). Mudança de dano resolvido,
 * quantidade/ordem de sorteio, arredondamento ou snapshot exige perfil novo.
 */
export const COMBAT_V1: CombatCompatibilityProfile = {
  id: 'combat-v1',
  referenceRelease: 'tibia-13.32',
  productExceptions: ['player-always-hit', 'dodge-halves-damage', 'pve-only-bestiary-bonus'],
  migrationPolicy: 'additive',
};

/**
 * O perfil `combat-v2` (ADR 0037, decisão 5): o próximo id livre depois do `combat-v1` — o
 * `combat-v2` que o ADR 0032 tinha reservado para a postura nunca chegou a existir em código, e
 * é por isso que esta é a primeira vez que o id é usado. **Rompimento**: o dano de arma passa a
 * ser o do Canary (fórmula, variância pela normal truncada e o fator de ataque da postura), com chance de
 * acerto à distância por skill e por tile. Uma sessão fixada no `combat-v1` continua nele
 * (invariante 7); retomar sob um perfil `breaking` diferente do que a criou é recusado, nunca
 * reinterpretado (ADR 0031).
 *
 * As exceções de produto do `combat-v1` mudam de forma: `player-always-hit` do v1 cobria
 * corpo a corpo E distância; o Canary não rola acerto ofensivo em corpo a corpo no PvE (o piso
 * da fórmula é quem faz um golpe "fraco", nunca um "miss"), então a exceção fica só
 * `player-always-hit-melee` — a DISTÂNCIA passa a rolar a chance de acerto do Tibia por skill e
 * tile (§ do Canary `WeaponDistance::useWeapon`), deixando de ser exceção. O Dodge **fica**: a
 * #522 confirma que ele corresponde ao charm de esquiva do Tibia (metade do dano, não zera), e
 * `dodge-halves-damage` continua listada. `pve-only-bestiary-bonus` é estrutural e não muda.
 */
export const COMBAT_V2: CombatCompatibilityProfile = {
  id: 'combat-v2',
  referenceRelease: 'tibia-13.32',
  productExceptions: ['player-always-hit-melee', 'dodge-halves-damage', 'pve-only-bestiary-bonus'],
  migrationPolicy: 'breaking',
};

/**
 * O perfil `combat-v3` (#548, M30-01; ADR 0040): o próximo id livre depois do `combat-v2`.
 * **Rompimento**: o bloqueio binário do defensor (`combat.defense.blockChance` do CMB-04) é
 * substituído pela ORDEM e pela MATEMÁTICA do `Creature::blockHit` do Canary —
 * imunidade explícita → defesa/escudo com `blockCount` (uma carga por golpe elegível, até duas,
 * recarregando com o tempo) → armadura numa FAIXA aleatória (não mais flat) → mitigação
 * percentual (`defenseMitigation`, campo novo do monstro, distinto de `mitigation`). O que o
 * `combat-v2` mudou (fórmula de arma, chance de acerto à distância) continua valendo — `combat-
 * v3` exige os MESMOS blocos `weaponDamage`/`distanceHitChance` do v2, porque não os substitui.
 *
 * As exceções de produto continuam as do `combat-v2`: Dodge fica (é o Draconya, não o Tibia, e
 * o Tibia nega o golpe inteiro ANTES do `blockHit` — a mesma posição que o Draconya já usa), e
 * `player-always-hit-melee` não muda (a chance de acerto ofensivo é FORA do escopo do #548).
 *
 * Absorção/aumento por tipo (`applyAbsorbDamageModifications` e o `absorbpercent*` de item),
 * reflexo e cleave entraram como emenda no M30-05 (#552, ADR 0040). Defesa e mitigação do JOGADOR continuam os números atuais (o que muda é só
 * o MECANISMO que os consome): a fórmula própria do 13.x é o M30-02.
 */
export const COMBAT_V3: CombatCompatibilityProfile = {
  id: 'combat-v3',
  referenceRelease: 'tibia-13.32',
  productExceptions: ['player-always-hit-melee', 'dodge-halves-damage', 'pve-only-bestiary-bonus'],
  migrationPolicy: 'breaking',
};

/**
 * O perfil `combat-v4` (ADR 0052 decisão 7): o veículo ÚNICO do endgame inteiro (M38–M44,
 * #598–#632/#643). Enquanto `tibia-parity` for a branch de integração, toda issue do endgame
 * que muda resultado ou ordem de sorteio emenda este MESMO perfil — um estágio declarado por
 * issue, documentado em `docs/product/combat-conformance.md` — em vez de ganhar um `combat-v5`
 * próprio; ele só congela (vira imutável) no merge na `main` (ADR 0040 decisão 3). Ele SOMA em
 * cima do `combat-v3`, nunca revoga: `HuntRuleset#isV3()` trata os dois ids como o mesmo
 * mecanismo de bloqueio/defesa/mitigação do jogador, e cada campo do `combat-v3` que este
 * perfil não menciona continua valendo sem mudança.
 *
 * **Estágio #598** (M38-01, invocação do jogador — ADR 0057): a invocação vira alvo válido do
 * `chooseTarget` de monstro e credita dano ao MESTRE via `Contribution`/mapa de dano — não
 * existe hoje nenhum cenário sem invocação onde isso mude ordem de sorteio ou resultado
 * resolvido (o teste de conformance §11 prende que a hunt sem ninguém invocando consome
 * `session.rng` exatamente como antes). Sozinho esse estágio seria `additive`, como o
 * `combat-v1`: o mecanismo é novo, mas nenhum abate ou golpe que já existia muda de número.
 *
 * **Estágio #603** (M39-03, Charms em combate — ADR 0053 d.5): os 24 Charms do Canary que agem
 * em combate (todos menos o Scavenge, que é a esfola do #626) rolam na ordem do `Game::
 * combatChangeHealth` — defensivos no golpe RECEBIDO de monstro (minor antes de major, antes do
 * mana shield, o Dodge encerra o golpe), ofensivos no golpe DADO (`percent` da vida do monstro),
 * passivos nos termos que já existem (crítico, leech, penalidade de morte, loot). Junto com ele
 * entram três mudanças de resultado declaradas em `docs/product/combat-conformance.md`: **(a)** o
 * Dodge do PRD (`dodgeChance` do jogador, `dodgeMultiplier`) SAI deste perfil — o único Dodge é o
 * charm (ADR 0053 d.5), e por isso a exceção `dodge-halves-damage` também sai; **(b)** o crítico
 * BASE de todo jogador (`playerBaseCriticalChance`/`Damage` do Canary, `combat.modifiers`), sem
 * o qual Low Blow e Savage Blow — que somam a ele — não têm o que somar; **(c)** o estágio de
 * Charms só roda neste perfil (`hasCharmStage`): a sessão ainda fixada em `combat-v3` não rola
 * charm nenhum, mesmo com o registro do personagem cheio (invariante 7). Muda resultado e ordem
 * de sorteio: a política passa a ser `breaking`.
 *
 * **Estágio #626** (M44-08, esfola de cadáver e Scavenge — ADR 0048 d.5/d.6, ADR 0053 d.5): o
 * abate rola UM sorteio a mais, depois de todo o de loot, quando quem coleta tem a ferramenta do
 * monstro (`hasSkinningStage`) — e o `use-item-on` da ferramenta no cadáver rola o mesmo. Sem
 * ferramenta, ou num monstro sem entrada em `content.skinning`, o `session.rng` não é tocado. O
 * Scavenge (o 25º charm, que o estágio #603 deixou de fora) muda o `chanceRange`, não a quantidade
 * de sorteios. Os detalhes e a tabela do estágio estão em `docs/product/combat-conformance.md`.
 */
export const COMBAT_V4: CombatCompatibilityProfile = {
  id: 'combat-v4',
  referenceRelease: 'tibia-13.32',
  productExceptions: ['player-always-hit-melee', 'pve-only-bestiary-bonus'],
  migrationPolicy: 'breaking',
};

/**
 * Os perfis que o motor sabe executar. Perfil fora daqui derruba o boot, sem fallback: o
 * resolver não reinterpreta uma fórmula que não conhece (ADR 0031).
 */
export const COMBAT_PROFILES: ReadonlyMap<string, CombatCompatibilityProfile> =
  new Map([
    [COMBAT_V1.id, COMBAT_V1], [COMBAT_V2.id, COMBAT_V2], [COMBAT_V3.id, COMBAT_V3],
    [COMBAT_V4.id, COMBAT_V4],
  ]);

/**
 * Os modificadores avançados de um golpe (CMB-08): crítico, life leech e mana leech.
 *
 * É o lado do ATACANTE, o irmão de `mitigation` (defensor) e de `defense` (peça). A ausência de
 * um campo é o default NEUTRO e não consome sorteio nenhum — é o que preserva o `combat-v1` bit
 * a bit para todo conteúdo que não declara modificador. Declarar `critical` consome a rolagem
 * do crítico mesmo com `chance: 0`, pela mesma regra aditiva da defesa do CMB-04 (ADR 0031).
 *
 * `lifeLeech`/`manaLeech` são a fração do HP EFETIVAMENTE removido que volta como vida/mana; não
 * consomem RNG, e o quanto de fato repõe é limitado pelo teto do atacante (`applyDamageOutcome`).
 */
export interface DamageModifiers {
  readonly critical?: { readonly chance: number; readonly multiplier: number } | undefined;
  readonly lifeLeech?: number | undefined;
  readonly manaLeech?: number | undefined;
  /**
   * O aumento do dano causado por tipo (M30-05, #552) — o `increasePercent` do atacante, em
   * percentual INTEIRO como no Canary (diferente dos campos acima, que são fração): aplicado no
   * estágio de absorção do `combat-v3` (`damage += round(damage × p / 100)`), para o primário E o
   * secundário, sem sorteio. `combat-v1`/`v2` o ignoram.
   */
  readonly increase?: Readonly<Partial<Record<DamageType, number>>> | undefined;
}

/**
 * Coeficientes de combate. O §12.1 é explícito: fórmula e parâmetro são CONTEÚDO, não código.
 *
 * O que o PRD decide (§12.2) e o que ele não decide estão separados de propósito — o que não
 * está decidido carrega `_open`, para não passar por escolha de balanceamento.
 */
export const combatSchema = z.object({
  id: z.literal('baseline'),
  /**
   * O perfil semântico de combate (ADR 0031, CMB-02). `Content.version` o inclui e a sessão o
   * congela na criação (invariante 7); ele NÃO entra no snapshot. Ausente é o default
   * compatível — conteúdo legado e fixture. Valor fora de `COMBAT_PROFILES` falha no boot.
   */
  compatibilityProfile: z.string().min(1).default(COMBAT_V1.id),
  /** §12.2 DECIDIDO: dodge não zera o dano, reduz à metade. */
  dodgeMultiplier: z.number().min(0).max(1),
  /**
   * Quanto da armadura do alvo é subtraído, POR TIPO DE DANO (CMB-03, emenda do ADR 0031).
   *
   * Antes eram duas colunas (`melee`/`magic`). A migração que preserva o v1 é:
   * `physical` fica com o antigo `melee`; TODO tipo não-físico fica com o antigo `magic` —
   * inclusive drown/lifedrain/manadrain (#547, M29-07). O `z.record` de chave enum é EXAUSTIVO
   * no zod 4: o conteúdo declara os ONZE tipos, sem default em código — mudar a efetividade de
   * um elemento é editar JSON, nunca lógica.
   */
  armorEffectiveness: z.record(z.enum(DAMAGE_TYPES), z.number().min(0).max(1)),
  /** Piso de dano, como fração do ataque: nem a armadura mais alta zera um golpe. */
  minimumDamageFraction: z.number().min(0).max(1),
  /**
   * O personagem **desarmado**: o que ele bate e o quanto aguenta sem equipamento nenhum.
   *
   * Existe porque o jogo tem hunt antes de ter item. Quando o equipamento chegar, estes
   * números continuam sendo o piso — o personagem sem nada nas mãos — e o item passa a somar
   * em cima. É o oposto de deixar o valor em código e "trocar depois": ali ele nunca é
   * trocado, porque ninguém encontra.
   */
  player: z.object({
    attackPower: z.number().int().nonnegative(),
    attackIntervalMs: z.number().int().positive(),
    /**
     * Alcance em tiles do personagem DESARMADO — `1`, corpo a corpo. Arma na mão vale o
     * `weapon.range` dela (#152); este só entra quando não há arma.
     */
    attackRange: z.number().int().positive().default(1),
    armor: z.number().int().nonnegative(),
    dodgeChance: z.number().min(0).max(1),
    /**
     * O tipo de dano do golpe DESARMADO (CMB-03). Ausente é `physical`, o default que preserva
     * o v1 — o punho sempre bateu dano físico.
     */
    damageType: z.enum(DAMAGE_TYPES).default('physical'),
  }),
  /**
   * Defesa e escudo (CMB-04, emenda do ADR 0031). É o estágio entre a rolagem de Dodge e a
   * armadura: o escudo ou a arma de uma mão bloqueia parte do golpe físico.
   *
   * **Ausente é o estágio IDENTIDADE**, e é o que preserva o v1: sem `defense` nenhum golpe
   * consome sorteio de bloqueio, e o resultado é bit a bit o entregue. O conteúdo real declara.
   *
   * `blockChance` é a chance do bloqueio acontecer, uma rolagem por golpe ELEGÍVEL — logo
   * depois do Dodge, que continua o primeiro sorteio. `blockTypes` são os tipos aprovados
   * (`physical` no v1): ataque elemental passa intacto e NÃO treina shielding por acidente.
   * `skillId` é a skill que escala a defesa e sobe por bloqueio; `buildContent` recusa uma que
   * não exista ou que não suba por `shield-block`.
   */
  defense: z.object({
    skillId: z.string().min(1).optional(),
    blockChance: z.number().min(0).max(1),
    blockTypes: z.array(z.enum(DAMAGE_TYPES)).min(1).default(['physical']),
  }).superRefine((defense, context) => {
    const seen = new Set<DamageType>();
    for (const type of defense.blockTypes) {
      if (seen.has(type)) {
        context.addIssue({ code: 'custom', message: `blockTypes tem "${type}" duplicado` });
      }
      seen.add(type);
    }
  }).optional(),
  /**
   * Os modificadores avançados do ATACANTE (CMB-08, emenda do ADR 0031): crítico, life leech e
   * mana leech. **Ausente é o default NEUTRO**, e é o que preserva o v1: sem `modifiers` nenhum
   * sorteio novo é consumido, e o resultado é bit a bit o do CMB-02/03/04.
   *
   * `critical` declarado consome UMA rolagem a mais, DEPOIS do Dodge e da defesa — mesmo com
   * `chance: 0`, para a sequência não depender do valor. `lifeLeech`/`manaLeech` não consomem
   * RNG: são fração do HP aplicado, e o `applyDamageOutcome` limita o que repõe ao teto do
   * atacante. Os números são provisórios (`_open`).
   */
  modifiers: z.object({
    critical: z.object({
      chance: z.number().min(0).max(1),
      multiplier: z.number().min(1),
    }).optional(),
    lifeLeech: z.number().min(0).max(1).optional(),
    manaLeech: z.number().min(0).max(1).optional(),
  }).optional(),
  /**
   * A conversão do Base Power (#155, ADR 0026 decisão 5) — UMA para todas as magias, e nossa:
   * o TibiaWiki não publica a fórmula, e a do TFS é GPL (ADR 0019). `mid = basePower × (1 +
   * level × levelFactor + skillLevel × skillFactor)`; `min = ⌊mid × (1 − spread)⌋`,
   * `max = ⌈mid × (1 + spread)⌉`. O default cobre o conteúdo de teste; o real declara.
   */
  spellPower: z.object({
    levelFactor: z.number().nonnegative(),
    skillFactor: z.number().nonnegative(),
    spread: z.number().min(0).max(1),
  }).default({ levelFactor: 0.06, skillFactor: 0.15, spread: 0.15 }),
  /**
   * O dano de arma do `combat-v2` (#522, ADR 0037 decisão 5) — `Weapons::getMaxWeaponDamage` do
   * Canary, com a variância pela normal truncada (`normal_random`, `packages/sim/src/combat/
   * weapon-power.ts`):
   *
   * ```text
   * maxDamage = round(coefficient × attackFactor × attack × skill + ⌊level/5⌋) × vocationMultiplier
   * minDamage = ⌊level/5⌋ (corpo a corpo: 0 se attack ≤ 0)
   * damage    = normalRandom(minDamage, maxDamage)
   * ```
   *
   * `meleeCoefficient`/`distanceCoefficient` são os `0,085`/`0,09` do Canary
   * (`Weapons::getMaxWeaponDamage`, `isMelee`). `attackFactor` NÃO é conteúdo: é o
   * `getAttackFactor()` da POSTURA que o jogador escolheu (ofensivo 1,0 / equilibrado 0,75 /
   * defensivo 0,5) e mora no estado do personagem (`CharacterRuntime.fightMode`, M30-03, #550) —
   * uma constante aqui o fixaria numa postura só, que é o que o campo fazia até essa issue. A
   * tabela dos três fatores é MECANISMO do Canary, código puro em `sim/src/combat/fight-mode.ts`.
   * `vocationMultiplier` vem de `vocation.meleeDamageMultiplier`/`distDamageMultiplier` — 1,0 em
   * toda vocação no Canary hoje (`vocations.xml`), e por isso em conteúdo e não constante mágica.
   * Obrigatório quando `compatibilityProfile` é `combat-v2`; `buildContent` recusa a ausência.
   */
  weaponDamage: z.object({
    meleeCoefficient: z.number().positive(),
    distanceCoefficient: z.number().positive(),
  }).optional(),
  /**
   * A chance de acerto à distância do `combat-v2` (#522): só a DISTÂNCIA rola acerto ofensivo —
   * corpo a corpo continua sem rolagem (`player-always-hit-melee`). Mecanismo original do
   * Draconya (ADR 0019: só número e caso de borda vêm do Canary, nunca código) que reproduz
   * `WeaponDistance::useWeapon` — as TRÊS tabelas que o Canary modela (baldes 75 uma mão, 90
   * duas mãos e 100), não só a de 90% que o catálogo usa hoje:
   *
   * ```text
   * se ammunition.hitChance declarado e ≠ 0:
   *   percent = ammunition.hitChance                    (caminho DIRETO — ignora tudo abaixo)
   * senão:
   *   balde   = ammunition.maxHitChance ?? defaultMaxHitChance
   *   bucket  = buckets.find(b => b.maxHitChance === balde)
   *   se bucket ausente:  percent = balde                (balde que a tabela não modela: flat)
   *   senão:
   *     tier = bucket.tiers.find(t => t.distance === distância)
   *     se tier ausente:  percent = 0                     (distância fora da tabela: MISS)
   *     senão:            percent = clamp(⌊min(skill, tier.skillCap) × tier.perSkill⌋ + tier.flat, 0, 100)
   * percent = clamp(percent + (weapon.hitChance ?? 0), 0, 100)   (bônus/malus do arco, #524)
   * hit     = rng.chance(percent / 100)               (uma rolagem por tiro, sempre consumida)
   * ```
   *
   * `ammunition.hitChance` (#522, inteiro 0–100) é o `it.hitChance` DIRETO do Canary — conferido
   * ANTES de `maxHitChance`, e quando ≠ 0 ignora a tabela inteira (a munição/arma de arremesso
   * avulsa com chance fixa: viper star 80%, leaf star 90%).
   * `ammunition.maxHitChance` (#524, inteiro 0–100) é o `it.maxHitChance` do Canary: ausente,
   * usa `defaultMaxHitChance` (90 — munição de duas mãos é a única família que o catálogo tem);
   * um valor que não bate nenhum `bucket.maxHitChance` declarado — o power bolt do Tibia declara
   * 91, e nem 75 nem 90 nem 100 estão nos `buckets` de baixo se algum dia sobrar de fora — vira
   * chance FIXA (`else { chance = maxHitChance; }` do Canary), nunca um erro.
   * Distância fora de `tiers`, DENTRO de um balde reconhecido, é MISS (0%) — o `default: chance
   * = it.hitChance;` de cada `switch` do Canary, que vale 0 porque só se chega a essa tabela
   * quando `it.hitChance` já é 0. **Não** é o teto do balde: um catálogo real nunca teria uma
   * arma de alcance > 7 hoje, mas se tivesse, o Canary erraria sempre no tile 8 — não acertaria
   * quase sempre.
   * `weapon.hitChance` (#524, inteiro -100–100) é o bônus/malus da ARMA — a besta real soma ao
   * percentual que a munição calculou, por QUALQUER um dos caminhos acima, sempre. Os três
   * campos de item são "só dado" desde o #524 (`ammunition.maxHitChance`, `weapon.hitChance`) e
   * o #522 (`ammunition.hitChance`); o #522 é quem passa a lê-los todos. Obrigatório quando
   * `compatibilityProfile` é `combat-v2`; `buildContent` recusa a ausência.
   */
  distanceHitChance: z.object({
    /**
     * O balde default (90, munição de duas mãos) quando `ammunition.maxHitChance` está ausente
     * — o Canary auto-seleciona por `ammoType` (`!= AMMO_NONE` → 90, senão 75); o catálogo do
     * Draconya só tem munição de duas mãos hoje, então o default é sempre 90.
     */
    defaultMaxHitChance: z.number().int().min(0).max(100),
    /**
     * As tabelas por balde RECONHECIDO. O Canary só tem fórmula própria para 75/90/100 — um
     * `maxHitChance` fora daqui (declarado na munição, ou este `defaultMaxHitChance`) vira
     * chance FIXA, nunca erro de conteúdo.
     */
    buckets: z.array(z.object({
      maxHitChance: z.number().int().min(0).max(100),
      tiers: z.array(z.object({
        distance: z.number().int().positive(),
        skillCap: z.number().nonnegative(),
        perSkill: z.number().nonnegative(),
        flat: z.number(),
      })),
    })).superRefine((buckets, context) => {
      const seen = new Set<number>();
      for (const bucket of buckets) {
        if (seen.has(bucket.maxHitChance)) {
          context.addIssue({
            code: 'custom', message: `distanceHitChance.buckets tem maxHitChance ${bucket.maxHitChance} duplicado`,
          });
        }
        seen.add(bucket.maxHitChance);
      }
    }),
  }).optional(),
  /**
   * A trava de ataque ao trocar de andar (M30-07, #554, ADR 0040 decisão 1): `stairJumpExhaustion`
   * do Canary (`config.lua.dist:45`, `2 * 1000`), aplicada em `Player::onChangeZone`
   * (`player.cpp:2857-2866`) e na mudança de posição com teleporte ou troca de `z`
   * (`player.cpp:12417-12423`, `teleport || oldPos.z != newPos.z`) — `CONDITION_PACIFIED` por
   * `STAIRHOP_DELAY`, só para jogador. Em milissegundos: o passo que troca de `z` OU redireciona
   * por teleporte (escada e teleporte passam pelo mesmo `move()`, `packages/sim/src/movement.ts`)
   * APLICA a condição `pacified` (M44-04, #622) por `stairhopDelayMs` ao personagem, e nem o
   * golpe corpo a corpo nem a magia AGRESSIVA (`damage`/`damage-over-time`) saem enquanto ela
   * durar — cura, condição e o resto do vocabulário continuam liberados, como o Canary libera
   * tudo que não é `aggressive` sob `CONDITION_PACIFIED` (`spells.cpp:517`, `Spell::aggressive` é
   * `true` por padrão). **Ausente é IDENTIDADE**: sem o campo, nenhum passo aplica a trava, e todo
   * conteúdo que não o declara — `combat-v1`/`v2` inclusive — segue bit a bit. Só o `combat-v3`
   * lê (`HuntRuleset#isV3`); um `combat-v1`/`v2` que declarasse o campo por engano seria
   * ignorado do mesmo jeito. Antes do #622 a trava era um instante solto no personagem
   * (`attackLockedUntil`); agora é a condição de verdade, e o snapshot antigo com o campo é lido
   * como um `pacified` que vence no mesmo instante.
   */
  stairhopDelayMs: z.number().int().positive().optional(),
  _open: z.string().optional(),
}).superRefine((combat, context) => {
  // A #522/ADR 0037: perfil `combat-v2` sem os blocos novos é conteúdo que o resolver de poder
  // de arma não sabe executar — recusar no boot, nunca por um `??` silencioso no caminho quente.
  // O `combat-v3` (#548, ADR 0040) HERDA a exigência: ele não substitui o lado ofensivo do v2,
  // só o pipeline de RECEBIMENTO (defesa/armadura/mitigação) — um conteúdo v3 sem esses blocos
  // continua sem fórmula de dano de arma nenhuma.
  if (
    combat.compatibilityProfile === 'combat-v2' || combat.compatibilityProfile === 'combat-v3'
    || combat.compatibilityProfile === 'combat-v4'
  ) {
    if (combat.weaponDamage === undefined) {
      context.addIssue({
        code: 'custom', message: `${combat.compatibilityProfile} exige o bloco "weaponDamage"`,
      });
    }
    if (combat.distanceHitChance === undefined) {
      context.addIssue({
        code: 'custom', message: `${combat.compatibilityProfile} exige o bloco "distanceHitChance"`,
      });
    }
  }
});

export type Combat = z.infer<typeof combatSchema>;

/**
 * Stamina (§10). Dois números, e o desenho inteiro está em não haver um terceiro.
 *
 * Não existe taxa de consumo: dentro da hunt a stamina cai 1:1 com o tempo simulado, e fora
 * dela sobe 1:1 com o tempo de relógio. Um multiplicador aqui viraria a tentação de "queimar
 * mais rápido nas hunts difíceis", e aí a stamina deixaria de ser o teto de simulação que o
 * ADR 0001 usa para projetar custo — que é a razão de ela existir antes de ser regra de jogo.
 */
export const staminaSchema = z.object({
  id: z.literal('baseline'),
  /**
   * Teto, em milissegundos. Aplicado na LEITURA, não só na escrita. §10 previa 24 h; desde
   * M32-01 (#562, ADR 0043 emenda 2026-09-25) o valor real é 12 h — o teto que o Huntera mostra
   * cheio na Cidade.
   */
  maxMs: z.number().int().positive(),
  /** Milissegundos recuperados por milissegundo fora de hunt. §10: 1:1. */
  recoveryRatio: z.number().positive(),
  _open: z.string().optional(),
});

export type Stamina = z.infer<typeof staminaSchema>;

/**
 * O Treino do Tibia (#631, M44-13; ADR 0059, que implementa a decisão 4 do ADR 0045): exercise
 * weapons num boneco e o banco de offline training. Substitui os Trainer Monks do PRD §11 —
 * `docs/product/training.md` foi reescrito.
 *
 * **Tudo aqui é número do Canary** (`data/scripts/actions/items/exercise_training_weapons.lua`,
 * `data/scripts/creaturescripts/player/offline_training.lua`, `src/creatures/players/player.cpp`,
 * `data/items/items.xml`) — a fonte de cada valor está no `_open`/no comentário do campo, e o que
 * o ADR 0059 decide por conta própria (teto por conta Free/Premium, o boneco no mapa da Cidade)
 * está marcado. Nenhum destes valores mora em código (`sim` só lê o que vier daqui).
 */
export const trainingSchema = z.strictObject({
  id: z.literal('baseline'),
  /**
   * O boneco (`<item id="28558|28565" name="exercise dummy">`, `type="dummy"` com `rate` 100 no
   * `items.xml`). `rate` é o percentual do Canary (`dummies[dummyId] / 100`): 100 é 1× — os
   * bonecos de casa, "expert", valem 110. Só o boneco livre entra (o de casa é a #630/casas).
   */
  dummy: z.strictObject({
    id: z.string().min(1),
    rate: z.number().int().positive(),
  }),
  /**
   * O que cada golpe rende (`exercise_training_weapons.lua`): `addSkillTries(skill, 7 * rate)` e
   * `addManaSpent(600 * rate)` para wand/rod — o `rate` já dividido por 100. Truncado (o Lua
   * passa `double` a um `uint64_t`): com rate 100 é exato.
   */
  strike: z.strictObject({
    triesPerCharge: z.number().int().positive(),
    manaSpentPerCharge: z.number().int().positive(),
  }),
  /**
   * A espera entre dois inícios de Treino (`exhaustionTime = 10` de `exercise_training_weapons.lua`):
   * ao começar, o Canary faz `player:setExhaustion("training-exhaustion", 10)`, e recusa um novo
   * início enquanto ela vale ("This exercise dummy can only be used after a 10 seconds cooldown.").
   * Em ms. É cooldown de PAREDE (ADR 0052 d.6): um carimbo do instante de início no registro do
   * personagem, comparado com o relógio que o servidor passa — não tempo de sessão.
   */
  startCooldownMs: z.number().int().nonnegative(),
  /**
   * Onde o boneco está NO MAPA DA CIDADE (ADR 0059 d.1 fala de "um mapa mínimo"; o boneco livre da
   * Thais é um `exercise dummy` do próprio recorte OTBM da Cidade — `things/maps/otservbr.otbm`,
   * item 28565 em (32347, 32240, 7) —, então a sessão de Treino reaproveita o mapa da Cidade em
   * vez de importar um segundo recorte). Coordenadas do MAPA (`city.mapId`), não do OTBM: `stand`
   * é o tile em que o personagem fica (adjacente ao boneco, que é bloqueante), `dummy` o do boneco.
   */
  place: z.strictObject({
    stand: z.strictObject({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), z: z.number().int() }),
    dummy: z.strictObject({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), z: z.number().int() }),
  }),
  /** O offline training (`offline_training.lua`, `player.cpp`) e o teto por conta do ADR 0059 d.4. */
  offline: z.strictObject({
    /** O banco (`Player::addOfflineTrainingTime`: `min(12 * 3600 * 1000, …)`), em ms. */
    bankCapMs: z.number().int().positive(),
    /** Carência: `if offlineTime < 600 then` não treina (600 s). */
    graceMs: z.number().int().nonnegative(),
    /** `math.min(os.time() - lastLogout, 86400 * 21)`: o "fora" nunca conta mais que 21 dias. */
    maxAwayMs: z.number().int().positive(),
    /**
     * O teto de gasto por CONTA (ADR 0059 d.4, a forma do PRD §11.3): Free 6 h, Premium 12 h. É a
     * divergência registrada do Tibia, onde offline training é só Premium — Premium é decisão de
     * monetização, não mecânica de caça (ADR 0037 d.2 não a cobre).
     */
    spendCapMs: z.strictObject({
      free: z.number().int().positive(),
      premium: z.number().int().positive(),
    }),
    /** O escudo treina junto (`addOfflineTrainingTries(SKILL_SHIELD, trainingTime / 4)`). */
    shieldingDivisor: z.number().int().positive(),
    /**
     * As skills que o livro (as estátuas `16198`–`16202`) oferece. `attacks`: `tries =
     * (segundos / ataqueBase) / divisor` (melee 2, distância 4); `mana`: `segundos ×
     * manaGainAmount / manaGainTicks` de mana gasta (magic level). Sem `fist`: a estátua de fist
     * (50296) é do Monk, pós-13.32 (ADR 0038 d.5).
     */
    skills: z.array(z.discriminatedUnion('kind', [
      z.strictObject({
        skillId: z.string().min(1), kind: z.literal('attacks'), divisor: z.number().int().positive(),
      }),
      z.strictObject({ skillId: z.string().min(1), kind: z.literal('mana') }),
    ])).min(1),
  }),
  _open: z.string().optional(),
});

export type Training = z.infer<typeof trainingSchema>;

/**
 * A party de hunt (§15, ADR 0027, #188; fórmula e elegibilidade emendadas pelo ADR 0027 em
 * 2026-09-24 e 2026-09-25, #525, fidelidade Canary do ADR 0037 decisão 4): o teto de membros e
 * a elegibilidade de XP compartilhada (`Party::canUseSharedExperience` do TFS/Canary) — nível
 * dentro de 2/3 do maior level do roster, alcance/andar do líder e atividade recente.
 *
 * O MULTIPLICADOR de XP não é mais tabela: é `sharedExperiencePercent` em `packages/sim/src/
 * party.ts`, a fórmula do Canary (`Party:onShareExperience`) copiada em código — não é número
 * de balanceamento, é MECANISMO, a mesma categoria de `movementDuration`/`resolveDamage`. Uma
 * tabela indexada só por vocações únicas não conseguiria expressar o desconto do Canary por
 * TAMANHO da party (`≥ 4` membros, não `≥ 4` vocações — ver o comentário de `sharedExperiencePercent`),
 * e é por isso que saiu do conteúdo: `xpPoolPercentByUniqueVocations` existiu aqui até o #525
 * corrigir contra a fonte, e uma chave desse nome num `RawContent` antigo é ignorada (schema não
 * estrito) — não precisa migração.
 */
export const partySchema = z.object({
  id: z.literal('baseline'),
  maxMembers: z.number().int().min(2).max(8),
  /** §43.2, ainda aberto. `0` desliga: qualquer level entra na mesma fila. */
  matchmakingLevelRange: z.number().int().nonnegative().default(0),
  /**
   * Quantos TIPOS de item o líder pode marcar para venda automática (§8, §42.1, ADR 0035 d.2).
   * `free`/`premium` são o status do PERSONAGEM líder (D3 do plano) — a conta não entra aqui.
   * OPCIONAL no TIPO e preenchido com `{ free: 5, premium: 20 }` no parse: fixtures antigas de
   * `RawContent` (content.test.ts, server/testing, tools/bench) não conhecem VIP e continuam
   * válidas sem tocar o campo, e as que montam uma `PartyConfig` à mão não declaram o default.
   */
  autoSellItemTypes: z.object({
    free: z.number().int().nonnegative(),
    premium: z.number().int().nonnegative(),
  }).optional(),
  /**
   * A elegibilidade de XP compartilhada (`Party::canUseSharedExperience`, ADR 0027 emenda
   * 2026-09-24, #525). `rangeTiles`/`floors` são os `EXPERIENCE_SHARE_RANGE`/`FLOORS` do TFS
   * (`src/party.h`) e o `Position::areInRange<30, 30, 1>` do Canary (`party.cpp`) — as duas
   * engines concordam em 30 tiles / 1 andar. `levelRangeDivisor` é o `partyShareRangeMultiplier`
   * do Canary (`configmanager.cpp`, default `1.5`): `minLevel = ceil(maiorLevel / divisor)`, que
   * com `1.5` é o "2/3 do level" do TFS (`getMemberSharedExperienceStatus`, hardcoded). Sem
   * TFS/Canary concordando num divisor CONFIGURÁVEL, fixamos `1.5` — o valor observado nas duas.
   * `activityWindowMs` segue o CANARY (`Party::isPlayerActive`, 2 minutos) por precedência do
   * ADR 0037 d.4: o TFS usa `pzLocked` (1 minuto por padrão), que é config de PZ, não de party.
   * OPCIONAL e preenchido com os defaults acima no parse, pelo mesmo motivo de
   * `autoSellItemTypes`: fixtures antigas continuam válidas sem o campo.
   */
  sharedExperience: z.object({
    rangeTiles: z.number().int().positive(),
    floors: z.number().int().nonnegative(),
    levelRangeDivisor: z.number().positive(),
    activityWindowMs: z.number().int().positive(),
  }).optional(),
  _open: z.string().optional(),
}).transform((party): {
  id: 'baseline';
  maxMembers: number;
  matchmakingLevelRange: number;
  autoSellItemTypes?: { free: number; premium: number } | undefined;
  sharedExperience?: {
    rangeTiles: number; floors: number; levelRangeDivisor: number; activityWindowMs: number;
  } | undefined;
  _open?: string | undefined;
} => ({
  ...party,
  autoSellItemTypes: party.autoSellItemTypes ?? { free: 5, premium: 20 },
  sharedExperience: party.sharedExperience
    ?? { rangeTiles: 30, floors: 1, levelRangeDivisor: 1.5, activityWindowMs: 120_000 },
}));

export type PartyConfig = z.infer<typeof partySchema>;

/**
 * A entrada de Bestiário de UM monstro (#520, Canary `Bestiary`/TFS `bestiary`, referência
 * §15-19). `class` é o MESMO vocabulário de `MONSTER_CLASSES` (a categoria do Cyclopedia); `race`
 * é a família usada pelo sistema de Charms do Tibia — string livre, porque o Draconya ainda não
 * tem Charms, e `race` entra só como dado (como `class` fez antes do primeiro monstro real).
 *
 * Os três limiares (Canary `FirstUnlock`/`SecondUnlock`/`toKill`, TFS `prowess`/`expertise`/
 * `mastery`) são CRESCENTES por definição — o segundo desbloqueio não pode pedir menos abates
 * que o primeiro, nem a ficha completa menos que o segundo —, e o `.refine` o exige.
 */
export const bestiaryEntrySchema = z.strictObject({
  class: z.enum(MONSTER_CLASSES),
  race: z.string().min(1),
  /**
   * O `monster.raceId` do Canary — o id do monstro no Bestiário/Cyclopedia do cliente Tibia (34
   * para o Dragon). Opcional: só entrada importada (#578) o traz; é dado à espera de consumidor,
   * como o resto da ficha.
   */
  raceId: z.number().int().positive().optional(),
  /** Abates para a ficha completa (Canary `toKill`, TFS `mastery`). */
  toKill: z.number().int().positive(),
  /** Abates para o primeiro desbloqueio — a ficha básica (Canary `FirstUnlock`, TFS `prowess`). */
  firstUnlock: z.number().int().positive(),
  /** Abates para o segundo desbloqueio — quase completa (Canary `SecondUnlock`, TFS `expertise`). */
  secondUnlock: z.number().int().positive(),
  /** Pontos de Charm ganhos ao completar a ficha (Canary `CharmsPoints`, TFS `charmPoints`). */
  charmsPoints: z.number().int().nonnegative(),
  /**
   * Estrelas de dificuldade do Cyclopedia (Canary `Stars`): 0 (inofensivo) a 5 (desafiador). Era
   * 1 a 4 antes do leitor de monstros (#578), que achou os dois extremos no Canary (47dfd51): 13
   * monstros com 0 estrela (o Northern Pike, por exemplo) e 53 com 5.
   */
  stars: z.number().int().min(0).max(5),
  /** Raridade de encontro do Cyclopedia: 0 comum … 3 muito raro (Canary `Occurrence`). */
  occurrence: z.number().int().min(0).max(3),
  _open: z.string().optional(),
}).refine(
  (entry) => entry.firstUnlock <= entry.secondUnlock && entry.secondUnlock <= entry.toKill,
  { message: 'bestiary: firstUnlock <= secondUnlock <= toKill' },
);
export type BestiaryEntry = z.infer<typeof bestiaryEntrySchema>;

/**
 * O Bestiário (§18, FUN-113): os marcos de abates por monstro e o que cada marco vale.
 *
 * Só a recompensa PADRÃO — +1 % de XP PvE por marco, global (DT-01 da FUN-113). As
 * recompensas especiais por monstro (§18.4) entram com o primeiro monstro que as pedir; um
 * campo hoje seria forma sem uso. Os marcos são CRESCENTES, e o schema o exige: uma lista
 * fora de ordem faria "próximo marco" apontar para trás.
 */
export const bestiarySchema = z.object({
  id: z.literal('baseline'),
  /** Os abates de cada marco, em ordem. §18.2: cinco, de 10 000 a 200 000. */
  milestones: z.array(z.number().int().positive()).min(1).superRefine((milestones, context) => {
    for (let index = 1; index < milestones.length; index += 1) {
      const previous = milestones[index - 1];
      const current = milestones[index];
      if (previous === undefined || current === undefined || current > previous) continue;
      context.addIssue({
        code: 'custom',
        message: `marcos fora de ordem em ${index}: ${previous} antes de ${current}`,
      });
      return;
    }
  }),
  /**
   * Quanto cada marco acrescenta à XP PvE, em pontos percentuais. §18.3: 1.
   *
   * INTEIRO, e é regra de forma que sustenta uma de conta: `Bestiary.xpBonusPercent` devolve
   * `p × marcos` e `applyExperienceBonus` faz `floor(xp × (100 + soma) / 100)` em inteiro, e a
   * garantia de que o `floor` acerta depende de `p × marcos` ser inteiro. Meio ponto percentual
   * voltaria a pôr resíduo de ponto flutuante na frente do arredondamento — a armadilha que a
   * conta em inteiro evita.
   */
  xpBonusPercentPerMilestone: z.number().int().nonnegative(),
  /**
   * A ficha de Bestiário de cada monstro (#520, Canary `Bestiary`/TFS `bestiary`, referência
   * §15-19): os limiares de abate que desbloqueiam a ficha e a classificação do próprio Tibia.
   * Chave é `monsterId`; `buildContent` confere que ele existe (como `class` já fazia sozinho) e
   * que `class` bate com o `class` do monstro — duas fontes da mesma verdade divergiriam na
   * primeira mudança em uma delas.
   *
   * **Declarado, e ainda não lido por ninguém** — como `staticAttack` (#518): o Cyclopedia
   * (#321) hoje mostra só progresso por marco global, e a UI de estrelas/desbloqueio é dado à
   * espera de consumidor. Registrado como divergência em `docs/product/bestiary.md`.
   */
  entries: z.record(z.string().min(1), bestiaryEntrySchema).default({}),
  _open: z.string().optional(),
});

export type Bestiary = z.infer<typeof bestiarySchema>;

/**
 * Os 25 Charms do Canary `main` (M39-02, #602; ADR 0053 d.3 — revisão de sistema existente em
 * 13.32, segue o Canary por precedência do ADR 0037 d.4, não a forma de 13.32 sem tiers).
 * `content/data/charms/generated/charms.json` (`scripts/catalog/charms.ts`).
 *
 * Só os sete campos que a Direção da issue pede: `description`/`messageCancel`/
 * `messageServerLog`/`effect` do Canary (arte e texto de log, invariante 6) não entram.
 *
 * `damageType` usa um vocabulário PRÓPRIO deste catálogo (ver `scripts/catalog/charms.ts`), e
 * não `DAMAGE_TYPES`: três charms usam `COMBAT_NEUTRALDAMAGE`, que o resto do conteúdo nunca
 * declara. A resolução em combate é do `combat-v4` (#603) — este schema só transcreve o Canary.
 */
export const charmCategorySchema = z.enum(['major', 'minor']);
export type CharmCategory = z.infer<typeof charmCategorySchema>;

export const charmTypeSchema = z.enum(['offensive', 'defensive', 'passive']);
export type CharmType = z.infer<typeof charmTypeSchema>;

export const charmSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  /** A posição do Canary (`Game.createBestiaryCharm(charmId - 1)`), só para proveniência. */
  canaryCharmId: z.number().int().nonnegative(),
  category: charmCategorySchema,
  type: charmTypeSchema,
  damageType: z.string().min(1).optional(),
  /** Percentual da vida inicial do alvo (charm ofensivo) ou de leech/crítico (passivo). */
  percent: z.number().optional(),
  /** Chance por tier (1/2/3), em percentual — `chance[tier] ≥ normal_random(1,10000)/100`. */
  chance: z.tuple([z.number(), z.number(), z.number()]),
  /** Custo em pontos de Charm (major) ou echoes (minor) por tier (1/2/3). */
  points: z.tuple([z.number().int().positive(), z.number().int().positive(), z.number().int().positive()]),
  /** Proveniência (ADR 0038 d.2) — toda entidade GERADA carrega este bloco. */
  source: catalogSourceSchema.optional(),
  _open: z.string().optional(),
});
export type Charm = z.infer<typeof charmSchema>;

/**
 * A escala das chances do `skinning.lua` do Canary (#626, `data-otservbr-global/scripts/actions/
 * tools/skinning.lua`): `math.random(1, chanceRange)` com `chanceRange = 100000` e sucesso
 * quando `random <= value`. `Skinning.chance` (`value` do Lua) é lido nesta escala — 25 000 é
 * 25 %. O Scavenge mexe no `chanceRange`, não no `value` (ver `sim/skinning.ts`).
 */
export const SKINNING_CHANCE_SCALE = 100_000;

/**
 * Um estágio esfolável do cadáver (#626). O Canary decide "posso esfolar?" pelo id do ITEM que
 * o cadáver é naquele instante — a chave de `config[ferramenta][id]` do `skinning.lua` — e o
 * cadáver troca de id ao decair (`items.xml`: `decayTo`/`duration`). Por isso a janela de esfola
 * de um monstro não é a vida inteira do cadáver: o Dragon (`5973` 10 s → `4025` 300 s → `4026`
 * 300 s → `4027` 60 s) só é esfolável nos dois primeiros estágios, 310 s dos 670 s.
 *
 * `canaryItemId` é a IDENTIDADE do estágio no Canary — o que o Scavenge compara
 * (`charmCorpse == target.itemid or ItemType(charmCorpse):getDecayId() == target.itemid`), e
 * por isso também vale entre monstros que compartilham o mesmo cadáver (o Minotaur, o Minotaur
 * Bruiser e o Depowered Minotaur são todos `5969`). É um número de PROVENIÊNCIA e de identidade,
 * nunca arte (invariante 6): a arte do cadáver é `appearances.corpses`, pelo monstro.
 *
 * `afterTtlMs` é a vida que o cadáver TEM DEPOIS da tentativa: o Canary roda
 * `topItem:transform(skin.after)` com ou sem sucesso, e o `Item::setID` do item novo reinicia o
 * decaimento — `duration` do `after` e a cadeia `decayTo` dele (o Dragon esfolado vira `4026`:
 * 300 s + o `4027` de 60 s = 360 s, qualquer que seja a idade em que se esfolou). É a soma que o
 * importador tira do `items.xml` a partir do `after` DESTE estágio (`corpseTtlMsFromChain`), e é
 * o que reagenda o fim do cadáver: ele deixa de viver os 670 s de `corpseTtlMs`.
 */
export const skinningStageSchema = z.strictObject({
  canaryItemId: z.number().int().positive(),
  durationMs: z.number().int().positive(),
  afterTtlMs: z.number().int().positive(),
});
export type SkinningStage = z.infer<typeof skinningStageSchema>;

/**
 * Como o cadáver de UM monstro é esfolado (#626, ADR 0048 d.5/d.6, ADR 0053 d.5):
 * `content/data/skinning/generated/skinning.json` (`scripts/catalog/skinning.ts`), lido do
 * `skinning.lua` do Canary e cruzado com o `monster.corpse` e a cadeia de decaimento de cada
 * monstro do catálogo. O `id` é o id do MONSTRO (um por monstro: a chave do Lua é o id do
 * cadáver, e um id de cadáver só aparece sob uma ferramenta).
 */
export const skinningSchema = z.strictObject({
  /** O id do monstro esfolado. */
  id: z.string().min(1),
  /** O item que esfola (o `itemid` do `config` do Lua: obsidian knife 5908, blessed wooden stake 5942). */
  toolId: z.string().min(1),
  /** O que a esfola rende (`newItem`). Uma unidade — o `amount` do Lua só existe no boss da abóbora. */
  materialId: z.string().min(1),
  /** O `value` do Lua, em `SKINNING_CHANCE_SCALE` (25 000 = 25 %). */
  chance: z.number().int().positive().max(SKINNING_CHANCE_SCALE),
  /**
   * Os estágios ESFOLÁVEIS do cadáver, em ordem, desde a morte: o cadáver só pode ser esfolado
   * enquanto o item dele é um destes. A soma das durações é o fim da janela.
   */
  stages: z.array(skinningStageSchema).min(1),
  /** Proveniência (ADR 0038 d.2) — toda entidade GERADA carrega este bloco. */
  source: catalogSourceSchema.optional(),
  _open: z.string().optional(),
});
export type Skinning = z.infer<typeof skinningSchema>;

/**
 * A Boosted Creature diária (M42, #615, ADR 0054 decisão 7): quando o dia troca no relógio de
 * parede. `rolloverHourUtc` é a hora UTC (0–23) em que o `jobs` sorteia o monstro do próximo
 * dia — o mesmo instante em que o Canary vira o server-save (`SpawnMonster::addMonster`,
 * `spawn_monster.cpp:379-386`, e `data/globalevents/scripts/serverlog.lua` para o horário).
 * Sem outro parâmetro: o CANDIDATO é o bestiário inteiro (`content.bestiary.entries`), não uma
 * lista separada — todo monstro com ficha de Bestiário é elegível, como o Canary faz com
 * `g_game().getBestiaryList()`.
 */
export const boostedSchema = z.object({
  id: z.literal('baseline'),
  rolloverHourUtc: z.number().int().min(0).max(23),
});
export type Boosted = z.infer<typeof boostedSchema>;

/**
 * O Loyalty (M44, #628, ADR 0052 decisão 5): o bônus percentual que a idade da CONTA dá a toda
 * skill e ao magic level. Os números são do Canary — `config.lua.dist:239-244`
 * (`loyaltyEnabled`, `loyaltyPointsPerCreationDay`, `loyaltyBonusPercentageMultiplier`) e a tabela
 * `loyaltySystem.bonus` de `data/libs/functions/player.lua:762-790` (`initializeLoyaltySystem`).
 *
 * `pointsPerCreationDay` × dias de conta = pontos de Loyalty (`iologindata_load_player.cpp:114`);
 * o bônus é o `percent` do MAIOR degrau cujo `minPoints` os pontos alcançam, multiplicado por
 * `bonusPercentageMultiplier` e TRUNCADO para inteiro (`setLoyaltyBonus(uint16_t)`). Os dois
 * parâmetros de Premium do Canary (`loyaltyPointsPerPremiumDay*`) valem 0 no `config.lua.dist` e
 * o Draconya não rastreia dias de Premium comprados, então ficam de fora — o resultado é o mesmo.
 *
 * Quem calcula é a `api`, na emissão do ticket (`packages/server/src/loyalty.ts`); o valor
 * viaja no ticket e fica FIXO no personagem pela sessão (invariante 7) — o `sim` nunca lê conta
 * nem relógio (invariante 1). Opcional no conteúdo: o de teste não fala de Loyalty, e sem ele
 * nenhum ticket carrega bônus.
 */
export const loyaltyTierSchema = z.object({
  /** Pontos de Loyalty mínimos para este degrau (`minPoints` do Canary). */
  minPoints: z.number().int().nonnegative(),
  /** O bônus em percentual inteiro sobre os tries/mana totais (`percentage` do Canary). */
  percent: z.number().int().positive(),
});
export type LoyaltyTier = z.infer<typeof loyaltyTierSchema>;

export const loyaltySchema = z.object({
  id: z.literal('baseline'),
  /** `loyaltyEnabled` do Canary. Desligado, nenhum ticket carrega bônus. */
  enabled: z.boolean(),
  /** `loyaltyPointsPerCreationDay` do Canary (padrão 1). */
  pointsPerCreationDay: z.number().int().nonnegative(),
  /** `loyaltyBonusPercentageMultiplier` do Canary (padrão 1.0). */
  bonusPercentageMultiplier: z.number().nonnegative(),
  /** Os degraus em ordem CRESCENTE de `minPoints` — o laço do Canary fica com o último que cabe. */
  tiers: z.array(loyaltyTierSchema).min(1),
  _open: z.string().optional(),
}).superRefine((value, context) => {
  for (let i = 1; i < value.tiers.length; i += 1) {
    const previous = value.tiers[i - 1];
    const tier = value.tiers[i];
    if (previous !== undefined && tier !== undefined && tier.minPoints <= previous.minPoints) {
      context.addIssue({
        code: 'custom', path: ['tiers', i, 'minPoints'],
        message: 'os degraus de Loyalty precisam vir em ordem crescente de minPoints',
      });
    }
  }
});
export type Loyalty = z.infer<typeof loyaltySchema>;

/**
 * Os níveis do Bosstiary por raridade (#629): quantos abates levam a cada um dos três níveis e
 * quantos pontos de boss o nível rende — a tabela `IOBosstiary::levelInfos` do Canary
 * (`src/io/io_bosstiary.hpp`, 47dfd51: Bane 25/100/300 abates → 5/15/30 pontos, Archfoe 5/20/60 →
 * 10/30/60, Nemesis 1/3/5 → 10/30/60). Os abates são CRESCENTES por definição — o nível 2 não
 * pode pedir menos que o 1 —, e o schema o exige.
 */
export const bosstiaryLevelInfoSchema = z.strictObject({
  /** Abates do boss para alcançar este nível (`LevelInfo::kills`). */
  kills: z.number().int().positive(),
  /** Pontos de boss que alcançar este nível rende (`LevelInfo::points`). */
  points: z.number().int().positive(),
});
export type BosstiaryLevelInfo = z.infer<typeof bosstiaryLevelInfoSchema>;

const bosstiaryLevelsSchema = z.tuple([bosstiaryLevelInfoSchema, bosstiaryLevelInfoSchema, bosstiaryLevelInfoSchema])
  .refine(
    ([first, second, third]) => first.kills < second.kills && second.kills < third.kills,
    { message: 'bosstiary: os abates de cada nível são crescentes' },
  );

export const bosstiarySchema = z.strictObject({
  id: z.literal('baseline'),
  levels: z.strictObject({
    bane: bosstiaryLevelsSchema,
    archfoe: bosstiaryLevelsSchema,
    nemesis: bosstiaryLevelsSchema,
  }),
  /**
   * De onde a tabela saiu (ADR 0038 d.2) — a tabela é transcrita à mão de UM arquivo do Canary
   * (`IOBosstiary::levelInfos`), sem importador, então o bloco de proveniência é gravado no JSON
   * em vez de virar `_open` (o boot avisa todo `_open` como valor não decidido, e este é decidido).
   */
  source: catalogSourceSchema.optional(),
  _open: z.string().optional(),
});
export type Bosstiary = z.infer<typeof bosstiarySchema>;

/**
 * Vocabulário do bot (FUN-73, ADR 0002, §13).
 *
 * **Fechado** porque o compilador só transforma em predicado o que conhece: uma linguagem de
 * script no lugar disto seria código do jogador rodando no servidor, e o ADR 0002 descartou
 * isso por segurança e por custo. Fechado também é o que permite versionar.
 *
 * **Versionado** porque a configuração é dado PERSISTIDO do jogador. Um vocabulário que muda
 * sem número quebra a regra de quem a salvou — e quebra em silêncio, que é o formato pior:
 * o bot simplesmente para de curar e ninguém liga uma coisa à outra.
 *
 * A referência (ADR 0019, §35) confirma o caminho: dados em JSON validados por schema mais
 * registries tipados, e **Lua adiada** até haver evidência de que conteúdo exige deploy para
 * mudança trivial. Não há.
 */
export const BOT_VOCABULARY_VERSION = 2;

/**
 * A v1 continua existindo como ENTRADA da migração.
 *
 * O vocabulário do CONTEÚDO subiu para 2 (a barra é a configuração) e o motor lê a v2; a config
 * que o jogador salvou e que o `sim` ainda aceita continua na v1 — e é `migrateBotConfigV1` quem
 * a converte no boundary.
 */
export const BOT_VOCABULARY_VERSION_V1 = 1;

/** Quatro conjuntos (loadouts) de 24 slots cada (ADR 0032 d.1/d.4). */
export const BOT_SET_COUNT = 4;
export const BOT_SLOTS_PER_SET = 24;
/** Rótulos do kit (ADR 0032 d.4): são do cliente, não mecânica. */
export const BOT_SET_NAMES = ['Energia', 'Fogo', 'Gelo', 'Sagrado'] as const;

/**
 * 1–9, 0, F1–F12 = 22 teclas SEM modificador, e as mesmas 22 COM Shift = 32 no total, para 24
 * slots (ADR 0049 decisão 1, emenda ao DT-02 do ADR 0032: 22 teclas para 24 slots deixava dois
 * sem tecla própria). `hotkey` continua OPCIONAL — slot sem tecla dispara só pelo clique
 * (AB-09/ADR 0049 decisão 1). Alargamento ADITIVO do enum: config salva com as 22 teclas antigas
 * continua válida, sem bump de `BOT_VOCABULARY_VERSION`.
 */
export const BOT_HOTKEYS = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '0',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  'shift+1', 'shift+2', 'shift+3', 'shift+4', 'shift+5',
  'shift+6', 'shift+7', 'shift+8', 'shift+9', 'shift+0',
  'shift+F1', 'shift+F2', 'shift+F3', 'shift+F4', 'shift+F5', 'shift+F6',
  'shift+F7', 'shift+F8', 'shift+F9', 'shift+F10', 'shift+F11', 'shift+F12',
] as const;
export const botHotkeySchema = z.enum(BOT_HOTKEYS);
export type BotHotkey = z.infer<typeof botHotkeySchema>;

/** Os quatro comparadores do §13.3. Sem `==`: comparar percentual exato é armadilha. */
const botOperator = z.enum(['<', '<=', '>', '>=']);

/**
 * `kind` É o nome da condição, e não um rótulo ao lado dela.
 *
 * União discriminada de propósito: sem discriminador, um `when` malformado produz o erro
 * "nenhuma das N variantes casou", que não diz qual campo está errado — e o critério desta
 * issue é que regra fora do vocabulário seja **recusada com motivo**, nunca ignorada.
 */
/**
 * Uma skill que sobe pelo USO (§9.4 **[DECIDIDO]**, FUN-75).
 *
 * Paradigma do Tibia: skill não vem de level, vem de fazer. Quem a alimenta, quanto cada uso
 * rende, quantos pontos custa cada nível e quanto ela acrescenta ao golpe — tudo é conteúdo.
 * Se algum desses números aparecesse em `sim`, mudar a curva viraria deploy de lógica.
 *
 * **Quais skills existem também é dado.** A lista mínima é a que o combate atual precisa: uma
 * de arma e uma de magia. Distância e defesa entram quando houver arma de alcance e bloqueio.
 */
export const skillSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Onde ela começa. Um personagem novo nasce aqui, e daqui o dano é o de base. */
  startingLevel: z.number().int().nonnegative(),
  /**
   * Pontos para sair do nível N: `base * factor^(N - startingLevel)`.
   *
   * Fórmula, e não tabela, pela mesma razão que a curva de XP é fórmula: uma tabela precisa
   * ter fim, e o fim vira o teto acidental que ninguém decidiu.
   */
  curve: z.object({
    base: z.number().positive(),
    factor: z.number().min(1),
  }),
  /**
   * O que a alimenta, e quanto.
   *
   * `spell-cast` rende por MANA GASTA, não por lançamento — é o modelo do Tibia, e ele existe
   * por um motivo que vale copiar: sem ele, a forma ótima de subir magia é lançar mil vezes a
   * magia mais barata, e o jogo vira macro de spam.
   */
  gain: z.discriminatedUnion('on', [
    z.object({ on: z.literal('melee-hit'), points: z.number().positive() }),
    /** Um tiro de arma de distância (#152). Como o golpe: rende por uso, acerte ou não. */
    z.object({ on: z.literal('distance-hit'), points: z.number().positive() }),
    z.object({ on: z.literal('spell-cast'), pointsPerMana: z.number().positive() }),
    /**
     * Um bloqueio físico ELEGÍVEL (CMB-04): o defensor tinha escudo ou arma de uma mão e o
     * ataque era de um tipo aprovado. Rende uma vez por ataque recebido, nunca por tick e
     * nunca condicionado ao HP perdido.
     */
    z.object({ on: z.literal('shield-block'), points: z.number().positive() }),
  ]),
  /** Fração acrescentada ao poder por nível ACIMA do inicial. `0` é skill que não bate. */
  damagePerLevel: z.number().nonnegative().default(0),
  _open: z.string().optional(),
});

export type Skill = z.infer<typeof skillSchema>;

/** Os quatro tipos de condição da v1, como lista (FUN-81). */
export const BOT_CONDITION_KINDS = ['hp', 'mana', 'targets', 'target-hp'] as const;
export type BotConditionKind = (typeof BOT_CONDITION_KINDS)[number];

/**
 * A condição da v1: HP, mana, alvos e vida do alvo. É o INPUT da migração — o motor executa a v2.
 */
export const botConditionSchemaV1 = z.discriminatedUnion('kind', [
  /** HP do personagem, em percentual do máximo. */
  z.object({
    kind: z.literal('hp'), op: botOperator, percent: z.number().int().min(0).max(100),
  }),
  /** Mana do personagem, em percentual do máximo. */
  z.object({
    kind: z.literal('mana'), op: botOperator, percent: z.number().int().min(0).max(100),
  }),
  /** Quantos alvos estão ao alcance. É o que sustenta "3 ou mais → onda". */
  z.object({
    kind: z.literal('targets'), op: botOperator, count: z.number().int().nonnegative(),
  }),
  /** Vida do alvo atual, em percentual. Sem alvo, a condição é falsa — nunca um erro. */
  z.object({
    kind: z.literal('target-hp'), op: botOperator, percent: z.number().int().min(0).max(100),
  }),
]);

/** Os seis tipos de condição da v2 (ADR 0032 d.2; `summons` do #598, M38-01, ADR 0057 d.4). */
export const BOT_CONDITION_KINDS_V2 = [
  'hp', 'mana', 'targets', 'target-hp', 'condition', 'summons',
] as const;
export type BotConditionKindV2 = (typeof BOT_CONDITION_KINDS_V2)[number];

/**
 * A condição da v2. As quatro da v1 mais `condition` — efeito ativo/ausente ("castar haste só
 * sem haste"). `conditionId` é o id semântico do efeito no conteúdo; o catálogo de conditions
 * entra com o motor do AB-07.
 */
export const botConditionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('hp'), op: botOperator, percent: z.number().int().min(0).max(100),
  }),
  z.object({
    kind: z.literal('mana'), op: botOperator, percent: z.number().int().min(0).max(100),
  }),
  z.object({
    kind: z.literal('targets'), op: botOperator, count: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('target-hp'), op: botOperator, percent: z.number().int().min(0).max(100),
  }),
  z.object({
    kind: z.literal('condition'),
    conditionId: z.string().min(1),
    present: z.boolean().default(true),
  }),
  /**
   * Quantas invocações VIVAS este personagem tem agora (#598, M38-01, ADR 0057 decisão 4 —
   * "sem invocação viva → invocar" do preset Druid/Sorcerer). Campo NOVO no vocabulário v2, com
   * o MESMO desenho de `targets` — contagem, nunca a lista —, e por isso não sobe
   * `BOT_VOCABULARY_VERSION` (aditivo, como `condition` foi ao entrar).
   */
  z.object({
    kind: z.literal('summons'), op: botOperator, count: z.number().int().nonnegative(),
  }),
]);

/**
 * O que uma regra dispara.
 *
 * `spellId`, `supplyId` e `itemId` apontam catálogos que ainda não existem por inteiro (M7 e
 * M8). O schema valida a FORMA agora; a referência cruzada entra quando o catálogo existir,
 * pelo mesmo mecanismo que `loot.items` já usa em `buildContent` — recusar o que não tem
 * catálogo, em vez de aceitar e descobrir na hora de executar.
 */
export const botActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('spell'), spellId: z.string().min(1) }),
  z.object({ kind: z.literal('supply'), supplyId: z.string().min(1) }),
  z.object({ kind: z.literal('item'), itemId: z.string().min(1) }),
]);

/** A ação da v1, com `supply`, `spell` e `item` — a config salva ainda a usa e a migração a converte. */
export const botActionV1Schema = botActionSchema;

/**
 * A ação da v2: `spell` ou `supply`. O suprimento voltou a ser ABSTRATO (gold no uso), então o
 * token `supplyId` volta ao vocabulário; o `item` de slot saiu — item de equipamento é das
 * automações, não de um slot da barra.
 *
 * `monsterId` em `spell` (#598, M38-01, ADR 0057 decisão 4) é o PARÂMETRO de uma magia cujo
 * efeito é `summon` — "Summon Creature com parâmetro": a barra escolhe QUAL `summonable`
 * nascer, e a magia (level, vocação, cooldown, grupo) continua sendo o `spellId` de sempre.
 * Campo NOVO e OPCIONAL: uma ação `spell` sem `monsterId` continua válida — é toda magia que
 * não é invocação —, então nenhuma configuração salva antes desta issue muda de forma, e
 * `BOT_VOCABULARY_VERSION` não sobe.
 */
export const botActionV2Schema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('spell'), spellId: z.string().min(1), monsterId: z.string().min(1).optional(),
  }),
  z.object({ kind: z.literal('supply'), supplyId: z.string().min(1) }),
]);

/**
 * Como o bot ESCOLHE o alvo (§13.6).
 *
 * Fechado como o resto do vocabulário: o compilador só transforma em política o que conhece.
 * `nearest` é o padrão e é o que a hunt sempre fez — as outras duas existem porque "termine o
 * que está quase morto" e "bata no mais gordo primeiro" são estratégias diferentes, e escolher
 * entre elas é do jogador.
 */
export const botTargetPolicySchema = z.enum(['nearest', 'lowest-hp', 'highest-hp', 'follow']);

/**
 * Como o personagem se POSICIONA em relação ao alvo (§13.6).
 *
 * `stand` é o padrão e é o comportamento de hoje: o personagem percorre a rota e deixa o
 * monstro vir (ADR 0009). As outras duas são o primeiro caso em que ele sai da rota por
 * decisão própria — e é por isso que a postura é dado do jogador, não constante do motor.
 *
 * `keep-distance` só faz sentido com arma de alcance maior que 1, que ainda não existe: a
 * postura entra por interface agora para a geometria já ter teste, e passa a valer no dia em
 * que houver arco ou varinha.
 */
export const botPostureSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('stand') }),
  z.object({ kind: z.literal('follow') }),
  z.object({ kind: z.literal('keep-distance'), tiles: z.number().int().positive() }),
]);

/**
 * A política de alvo inteira.
 *
 * **Não sobe `BOT_VOCABULARY_VERSION`.** Todo campo tem default, então uma configuração salva
 * antes desta issue continua válida e ganha o comportamento de sempre — `nearest` + `stand`.
 * Subir a versão invalidaria configuração de jogador para acrescentar um campo que ela nem
 * precisa ter, que é o oposto do que o versionamento existe para proteger.
 */
export const botTargetingSchema = z.object({
  policy: botTargetPolicySchema.default('nearest'),
  /**
   * Ids de monstro preferidos. Priorizado ganha de não-priorizado ANTES da política — é o que
   * faz "mate o mago primeiro" valer mesmo quando o mago está mais longe.
   */
  prioritize: z.array(z.string().min(1)).default([]),
  /** Ids de monstro que o bot não ataca, e que também não contam em `targets`. */
  ignore: z.array(z.string().min(1)).default([]),
  posture: botPostureSchema.default({ kind: 'stand' }),
});

export type BotExitRule = z.infer<typeof botExitRuleSchema>;
export type BotLure = z.infer<typeof botLureSchema>;
export type BotRingSwap = z.infer<typeof botRingSwapSchema>;
export type BotTargetPolicy = z.infer<typeof botTargetPolicySchema>;
export type BotPosture = z.infer<typeof botPostureSchema>;
export type BotTargeting = z.infer<typeof botTargetingSchema>;

/**
 * O padrão, escrito por extenso.
 *
 * Zod exige a forma de SAÍDA num `.default`, então `{}` não serve mesmo com todo campo tendo
 * default próprio. Escrever à mão tem uma vantagem: o comportamento herdado por quem nunca
 * configurou targeting fica legível num lugar, em vez de espalhado por quatro `.default()`.
 *
 * FUNÇÃO, e não constante: um objeto só, entregue por referência a toda configuração parseada,
 * é uma configuração mutando a de todo mundo no dia em que alguém escrever nele.
 */
const defaultTargeting = (): BotTargeting => ({
  policy: 'nearest', prioritize: [], ignore: [], posture: { kind: 'stand' },
});

/**
 * Quando a hunt encerra sozinha (§13.9, §14.8).
 *
 * Encerrar é diferente de agir: uma regra de saída não escolhe magia nem alvo, ela decide que a
 * sessão acabou. Por isso mora numa lista própria e não numa das cinco categorias — e por isso
 * o extrato registra QUAL regra disparou, em vez de um "encerrou por regra" que faz o jogador
 * desconfiar do bot que ele mesmo configurou.
 *
 * `hp-below` é a mais óbvia para quem caça ausente, e é a única das três que o §13.9 não cita:
 * ela entra porque `HuntView` já a suporta e porque sem ela a única defesa contra morrer AFK é
 * a poção nunca falhar.
 */
export const botExitRuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('hp-below'), percent: z.number().int().min(1).max(100) }),
  /**
   * §20.3: sem esta regra o personagem FICA na hunt sem conseguir pagar supply, e pode morrer.
   * Com ela, sai — e sai por `exit-rule`, nunca por `manual-exit`: o extrato tem que dizer a
   * verdade sobre quem encerrou.
   */
  z.object({ kind: z.literal('out-of-gold') }),
  /**
   * §13.9. Party é F3, então esta regra é INERTE numa hunt de um — e entra agora para a
   * configuração salva não mudar de forma quando party existir.
   */
  z.object({ kind: z.literal('party-member-lost') }),
  /**
   * SV-06: encerra quando o peso carregado alcança ou ultrapassa a capacidade total.
   */
  z.object({ kind: z.literal('out-of-capacity') }),
]);

/**
 * Lure dinâmico (§13.7, FUN-87) — o bot AVANÇADO.
 *
 * Abaixo de `min` o personagem volta a percorrer a rota acumulando inimigos; ao chegar em `max`
 * ele para e limpa o grupo; e volta a correr quando cai abaixo de `min`.
 *
 * **`max` igual a `min` é permitido**, diferente do ring swap — e a diferença não é descuido.
 * Ali os limiares comparam HP, que muda a cada golpe: iguais, o anel trocaria sem parar. Aqui
 * eles comparam uma CONTAGEM de monstros, que só muda quando alguém morre ou nasce, e "manter
 * exatamente N ao meu redor" é uma política coerente — `{ min: 1, max: 1 }` é o comportamento
 * de quem não configurou lure, escrito como configuração.
 *
 * O que a validação recusa é `max` ABAIXO de `min`: aí a máquina sairia de "correndo" ao chegar
 * no máximo e voltaria na mesma avaliação, por estar abaixo do mínimo.
 */
export const botLureSchema = z.object({
  min: z.number().int().positive(),
  max: z.number().int().positive(),
}).refine((lure) => lure.max >= lure.min, 'o máximo do lure precisa ser >= o mínimo');

/**
 * Troca de anel por limiar (§13.8, FUN-87) — o bot AVANÇADO.
 *
 * **Os limiares de entrada e saída são SEPARADOS**, e é essa a coisa que a issue pede: com um
 * limiar só, o HP oscilando em torno dele troca o anel a cada golpe — e trocar anel é uma ação
 * por vez que o personagem não está usando para lutar.
 *
 * `manaFloor` desativa a máquina inteira: um anel que consome mana não vale a mana que falta
 * para curar.
 */
export const botRingSwapSchema = z.object({
  itemId: z.string().min(1),
  /** Equipa quando o HP cai ABAIXO deste percentual. */
  equipBelow: z.number().int().min(0).max(100),
  /** Retira quando o HP sobe ACIMA deste. Precisa ser maior que `equipBelow`. */
  removeAbove: z.number().int().min(0).max(100),
  /** Abaixo desta mana, a máquina não equipa nada. Zero é "não desativa por mana". */
  manaFloor: z.number().int().min(0).max(100).default(0),
  /** Ao retirar, devolve o anel que estava antes, ou deixa o dedo vazio (§13.8). */
  restorePrevious: z.boolean().default(true),
}).refine(
  (ring) => ring.removeAbove > ring.equipBelow,
  'removeAbove precisa ser maior que equipBelow: limiares iguais trocam o anel a cada golpe',
);

/** O alvo de uma regra de cura/suporte (§26-30, ADR 0035 d.10). */
export const botRuleTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('self') }),
  z.object({ kind: z.literal('lowest-hp-member') }),
  z.object({ kind: z.literal('member'), characterId: z.string().min(1) }),
]);
export type BotRuleTarget = z.infer<typeof botRuleTargetSchema>;

/**
 * Uma linha de slot da v1: a condição e o que fazer quando ela vale. Preservada com outro nome
 * porque é o INPUT da migração — o motor executa a v2.
 */
export const botRuleV1Schema = z.object({
  /**
   * O interruptor da linha (#162, ADR 0026 d.7 — o `BotSwitch` do vBot). Desligada, a regra
   * fica na configuração e no slot, e sai só da avaliação. Opcional, e AUSENTE É LIGADA: toda
   * configuração gravada antes disto continua valendo igual, e nenhuma fixture precisa dizer
   * o óbvio — quem lê é `compileBot`, e só ele.
   */
  enabled: z.boolean().optional(),
  when: botConditionSchemaV1,
  do: botActionV1Schema,
  /**
   * Quem recebe a ação (§26-30, ADR 0035 d.10). Só faz sentido em `heal`/`potion`/`support` —
   * `validateBotConfig` recusa `target ≠ self` em `attack`/`rune` e em ação cujo efeito não
   * aceita amigo. Com alvo ≠ `self`, a condição `hp` do `when` passa a ler o HP do CANDIDATO
   * (o `sim` resolve isso — aqui é só a forma).
   *
   * OPCIONAL no TIPO, preenchido com `self` no parse: a configuração é persistida e as fixtures
   * de `sim`/cliente montam a regra à mão, então exigir o campo obrigaria toda fixture a
   * declarar o default. O comportamento é o de `.default({ kind: 'self' })`.
   */
  target: botRuleTargetSchema.optional(),
}).transform((rule): {
  enabled?: boolean | undefined;
  when: z.infer<typeof botConditionSchemaV1>;
  do: z.infer<typeof botActionV1Schema>;
  target?: BotRuleTarget | undefined;
} => ({
  ...rule,
  target: rule.target ?? { kind: 'self' },
}));

/** Alias da v1, para o motor e os leitores que ainda não migraram. */
export const botRuleSchema = botRuleV1Schema;

/**
 * As cinco categorias do §13.5. Independentes: uma ação de poção não consome o cooldown de
 * runa, e não há prioridade global entre elas — cada uma avalia os próprios slots de cima
 * para baixo, e a primeira regra válida executa.
 *
 * **Saem no AB-07**: a barra v2 usa a ORDEM do slot e o grupo do conteúdo (ADR 0032 d.2). Aqui
 * elas continuam só como vocabulário da v1, que a migração converte.
 */
export const BOT_CATEGORIES = ['heal', 'potion', 'attack', 'rune', 'support'] as const;
export type BotCategory = (typeof BOT_CATEGORIES)[number];

/**
 * Um slot da barra. `do` só existe quando o slot está ocupado; `null` é slot vazio (a barra
 * desenha os 24 sempre, AB-10). `when` vazio é ação sem condição — elegível sempre (RG-007).
 */
export const botSlotSchema = z.object({
  /** Ausente é ligada — mantém a v1. */
  enabled: z.boolean().optional(),
  /** `spell` | `supply` (o suprimento voltou a ser abstrato; o `item` de slot saiu). */
  do: botActionV2Schema,
  /** E entre elas (RG-006). */
  when: z.array(botConditionSchema).default([]),
  hotkey: botHotkeySchema.optional(),
  auto: z.boolean().default(true),
/**
   * Quem recebe a ação (§26-30, ADR 0035 d.10). OPCIONAL: a barra v2 nasce da migração e as
   * fixtures montam o slot à mão; ausente é `self` (quem compila resolve com `?? { kind: 'self' }`).
   * Com alvo ≠ `self`, a condição `hp` de `when` lê o HP do CANDIDATO resolvido pelo ruleset.
   */
  target: botRuleTargetSchema.optional(),
});
export type BotSlot = z.infer<typeof botSlotSchema>;

/** Um conjunto: 24 posições; tecla é única DENTRO do conjunto (ADR 0032 d.1/d.3). */
export const botSetSchema = z.object({
  slots: z.array(botSlotSchema.nullable()).length(BOT_SLOTS_PER_SET),
}).superRefine((set, ctx) => {
  const seen = new Set<string>();
  set.slots.forEach((slot, index) => {
    if (slot === null) return;
    if (slot.hotkey !== undefined) {
      if (seen.has(slot.hotkey)) {
        ctx.addIssue({
          code: 'custom', path: ['slots', index, 'hotkey'],
          message: `tecla ${slot.hotkey} repetida no conjunto (slot ${index + 1})`,
        });
      }
      seen.add(slot.hotkey);
    }
  });
});

/** Os cinco modelos do catálogo fechado (ADR 0032 d.9). */
export const BOT_AUTOMATION_MODELS = [
  'renew-ring', 'renew-amulet', 'swap-ammo-by-targets',
  'swap-weapon-shield-by-hp', 'swap-ring',
] as const;
export type BotAutomationModel = (typeof BOT_AUTOMATION_MODELS)[number];

const automationCommon = {
  enabled: z.boolean().optional(),
  /** Entrada em OU (ADR 0032 d.9): basta uma verdadeira para a automação agir. */
  enter: z.array(botConditionSchema).default([]),
  /** Saída em E: todas precisam ser verdadeiras para desfazer. */
  exit: z.array(botConditionSchema).default([]),
};

export const botAutomationSchema = z.discriminatedUnion('model', [
  z.object({
    model: z.literal('renew-ring'), ...automationCommon,
    params: z.object({ itemId: z.string().min(1) }),
  }),
  z.object({
    model: z.literal('renew-amulet'), ...automationCommon,
    params: z.object({ itemId: z.string().min(1) }),
  }),
  z.object({
    model: z.literal('swap-ammo-by-targets'), ...automationCommon,
    params: z.object({ ammoA: z.string().min(1), ammoB: z.string().min(1) }),
  }),
  z.object({
    model: z.literal('swap-weapon-shield-by-hp'), ...automationCommon,
    params: z.object({
      oneHanded: z.string().min(1), shield: z.string().min(1), twoHanded: z.string().min(1),
    }),
  }),
  z.object({
    model: z.literal('swap-ring'), ...automationCommon,
    params: z.object({
      itemId: z.string().min(1),
      manaFloor: z.number().int().min(0).max(100).default(0),
      restorePrevious: z.boolean().default(true),
    }),
  }),
]);
export type BotAutomation = z.infer<typeof botAutomationSchema>;

export const botStanceSchema = z.enum(['offensive', 'balanced', 'defensive']);
export type BotStance = z.infer<typeof botStanceSchema>;

/**
 * Quem o personagem segue (§24-25, ADR 0035 d.9). Campo SEPARADO da postura
 * (`targeting.posture.kind === 'follow'` continua "persegue o monstro atual") — não é
 * renomeação, é vocabulário novo. `characterId` não é conferido contra a party aqui: a
 * configuração sobrevive à hunt, e quem valida o membro é o `sim` (§30).
 */
export const botFollowSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('leader') }),
  z.object({ kind: z.literal('member'), characterId: z.string().min(1) }),
]);
export type BotFollow = z.infer<typeof botFollowSchema>;

/**
 * O filtro de Quick Loot do personagem (ADR 0048 decisão 2, `quickLootFilter`/`autoLoot` do
 * Canary). Default: `skip` com `itemIds` vazia — pega tudo, o comportamento de antes deste ADR.
 * `autoSell` é a autovenda INDIVIDUAL (PRD §22.1): vende ao `value` do catálogo, cortada pelo
 * limite do PRÓPRIO Premium (`party.autoSellItemTypes`, lido pelo `sim`).
 */
export const botLootSchema = z.object({
  filter: z.enum(['accept', 'skip']).default('skip'),
  itemIds: z.array(z.string().min(1)).default(() => []),
  autoSell: z.array(z.string().min(1)).default(() => []),
});
export type BotLoot = z.infer<typeof botLootSchema>;

/**
 * A configuração v2 (ADR 0032 d.1): quatro conjuntos de 24 slots, automações, postura, e o
 * `targeting`/`exit`/`lure` herdados da v1 (a migração os copia intactos).
 */
export const botConfigV2Schema = z.object({
  version: z.literal(BOT_VOCABULARY_VERSION),
  activeSet: z.number().int().min(0).max(BOT_SET_COUNT - 1).default(0),
  sets: z.array(botSetSchema).length(BOT_SET_COUNT),
  automations: z.array(botAutomationSchema).default(() => []),
  stance: botStanceSchema.default('balanced'),
  targeting: botTargetingSchema.default(defaultTargeting),
  exit: z.array(botExitRuleSchema).default(() => []),
  lure: botLureSchema.optional(),
  /**
   * Quem o personagem segue (§24-25, ADR 0035 d.9), herança da v1 (a migração o copia intacto).
   * Campo SEPARADO da postura. `characterId` não é conferido contra a party aqui: a
   * configuração sobrevive à hunt, e quem valida o membro é o `sim` (§30).
   */
  follow: botFollowSchema.default({ kind: 'none' }),
  /**
   * O filtro de Quick Loot (ADR 0048 decisão 2). Campo NOVO com default, como `follow`: uma
   * config salva antes deste ADR volta com `{ filter: 'skip', itemIds: [], autoSell: [] }` —
   * pega tudo, sem venda automática, exatamente o que acontecia sem filtro nenhum.
   */
  loot: botLootSchema.default(() => botLootSchema.parse({})),
});
export type BotConfigV2 = z.infer<typeof botConfigV2Schema>;

/**
 * Os limites do bot, em CONTEÚDO e não em código (§13.3).
 *
 * Quantos slots cada categoria tem é balanceamento, e balanceamento mora onde um designer o
 * alcança sem deploy. **Sai no AB-07** (DT-06): a v1 carrega `categoryCooldownMs` e `slots`,
 * que só a migração lê. O gate de level do bot avançado foi REVOGADO no AB-03 (ADR 0032 d.4).
 */
export const botSchema = z.object({
  id: z.literal('baseline'),
  /** A versão do vocabulário que este conteúdo entende. Recusa configuração de outra. */
  vocabularyVersion: z.number().int().positive(),
  /** Cooldown de cada categoria, independente das outras. §13.5: 1 s. */
  categoryCooldownMs: z.number().int().positive(),
  /**
   * Até que distância, em tiles, o bot ENXERGA um alvo (FUN-85).
   *
   * Não é o alcance de ataque: é o quanto ele considera ao escolher para onde ir. Só importa
   * com postura `follow` ou `keep-distance` — com `stand` o personagem nunca sai da rota, e
   * quem ele bate continua sendo limitado pelo alcance da arma.
   *
   * Balanceamento, e por isso mora aqui: um raio grande faz o bot atravessar a hunt atrás de
   * um monstro e voltar sem ter limpado nada. Tem default para configuração e conteúdo
   * gravados antes desta issue continuarem válidos.
   */
  targetSearchRadius: z.number().int().positive().default(8),
  /**
   * A configuração com que todo personagem NASCE (FUN-114): a que o `api` grava em
   * `bot_config` ao criar. Sem ela o personagem novo entrava na hunt só no golpe básico até
   * abrir a tela e escrever regras — e "magia + poção" do MVP não existia no primeiro minuto.
   *
   * É uma `BotConfig` inteira, validada no boot pelo MESMO `validateBotConfig` que julga a do
   * jogador: magia ou supply que não existe reprova o conteúdo, não o personagem. Opcional
   * porque conteúdo de teste não fala de onboarding; o conteúdo real a tem. `z.lazy` porque
   * `botConfigSchema` é declarado mais abaixo.
   */
  defaultConfig: z.lazy(() => botConfigSchema).optional(),
  /**
   * As baselines v2 por vocação (ADR 0032 d.4): com que kit cada vocação nasce no vocabulário
   * novo. Opcional — o conteúdo de teste não fala de onboarding —, e o conteúdo real a tem.
   * Validado no boot por `validateBotConfigV2`.
   */
  defaultConfigByVocation: z.record(z.string(), z.lazy(() => botConfigV2Schema)).optional(),
  /** Slots por categoria. §13.3: cura 3, poção 4, ataque 10, runa 10, suporte 10. */
  slots: z.object({
    heal: z.number().int().nonnegative(),
    potion: z.number().int().nonnegative(),
    attack: z.number().int().nonnegative(),
    rune: z.number().int().nonnegative(),
    support: z.number().int().nonnegative(),
    /**
     * Quantas regras de SAÍDA cabem (FUN-86). Não é categoria — regra de saída não age, ela
     * encerra —, mas precisa de teto pela mesma razão que as outras: a lista é avaliada a cada
     * 250 ms, e nada no schema impediria mil regras salvas.
     *
     * Quatro: os três tipos do vocabulário mais folga. Tem default para o conteúdo gravado
     * antes desta issue continuar válido.
     */
    exit: z.number().int().nonnegative().default(4),
  }),
  _open: z.string().optional(),
});

/**
 * A configuração v1 que o JOGADOR salvou. Não é conteúdo — é dado dele —, mas o schema mora
 * aqui porque quem define o que é aceitável é o vocabulário, e o vocabulário é conteúdo.
 *
 * Preservada com outro nome porque é o INPUT de `migrateBotConfigV1`; o motor executa a v2 e
 * `botConfigSchema` continua sendo o alias dela para os leitores que ainda não migraram.
 *
 * Os limites de slot NÃO são checados aqui: eles vêm de `bot/baseline.json`, que o schema não
 * enxerga. Quem cruza os dois é `validateBotConfig`.
 */
export const botConfigV1Schema = z.object({
  version: z.number().int().positive(),
  /** Alvo e postura (FUN-85). Ausente é `nearest` + `stand`, o comportamento de sempre. */
  targeting: botTargetingSchema.default(defaultTargeting),
  /**
   * Regras de saída (FUN-86). Lista vazia é a hunt que só encerra por morte ou por ação do
   * jogador — o comportamento de antes desta issue, e o default para quem não configurou.
   */
  exit: z.array(botExitRuleSchema).default(() => []),
  /**
   * O bot AVANÇADO (§13.2, FUN-87). Ausente é o bot básico. O gate de level foi revogado no
   * AB-03; `lure` e `ringSwap` continuam existindo como vocabulário da v1, que a migração
   * converte para as automações v2.
   */
  lure: botLureSchema.optional(),
  ringSwap: botRingSwapSchema.optional(),
  /**
   * Quem o personagem segue (§24-25, ADR 0035 d.9). Campo SEPARADO da postura
   * (`targeting.posture.kind === 'follow'` continua "persegue o monstro atual") — não é
   * renomeação, é vocabulário novo.
   */
  follow: botFollowSchema.default({ kind: 'none' }),
  heal: z.array(botRuleV1Schema),
  potion: z.array(botRuleV1Schema),
  attack: z.array(botRuleV1Schema),
  rune: z.array(botRuleV1Schema),
  support: z.array(botRuleV1Schema),
});

/** Alias da v1, para o motor e os leitores que ainda não migraram. */
export const botConfigSchema = botConfigV1Schema;

export type BotOperator = z.infer<typeof botOperator>;
/** O tipo da condição v1 — o que o motor v1 ainda compila (sem `condition`). */
export type BotCondition = z.infer<typeof botConditionSchemaV1>;
export type BotConditionV2 = z.infer<typeof botConditionSchema>;
export type BotAction = z.infer<typeof botActionSchema>;
export type BotActionV2 = z.infer<typeof botActionV2Schema>;
export type BotRule = z.infer<typeof botRuleV1Schema>;
export type BotLimits = z.infer<typeof botSchema>;
export type BotConfig = z.infer<typeof botConfigV1Schema>;

export const SPELL_GROUPS = ['attack', 'healing', 'support'] as const;
export const SECONDARY_GROUPS = ['stance', 'focus', 'great-beams', 'special', 'ultimatestrikes'] as const;

/**
 * O efeito de uma magia, como o ARQUIVO o descreve. Fica separado de `spellSchema` porque o
 * campo `effect` o transforma depois: `target` é OPCIONAL no TIPO e preenchido com `self` no
 * parse (ver `spellSchema`), para as fixtures de `sim`/cliente que montam uma `Spell` à mão não
 * precisarem declarar o default.
 */
export const spellEffectSchema = z.discriminatedUnion('kind', [
  /** Cura o próprio lançador, ou um membro da party com `target: 'friend'` (§26, ADR 0035 d.10), ou aliados em área (Mass Healing, #475). */
  z.object({
    kind: z.literal('heal'),
    basePower: z.number().int().positive().optional(),
    amount: z.number().int().positive().optional(),
    formula: spellFormulaSchema.optional(),
    /** `self` cura quem lança (o de hoje); `friend` cura um membro da party. */
    target: z.enum(['self', 'friend']).optional(),
    /** Obrigatório com `target: 'friend'`, proibido com `'self'` — `buildContent` confere. */
    range: z.number().int().positive().optional(),
    /** Forma de grupo (Mass Healing): `circle` centrado no lançador. `buildContent` confere. */
    area: spellAreaSchema.optional(),
    /**
     * A cura COMPOSTA (#590, Canary `fair_wound_cleansing.lua`/`nature's_embrace.lua`/
     * `restoration.lua`: `COMBAT_PARAM_DISPEL` ao lado de `COMBAT_PARAM_TYPE, COMBAT_HEALING`).
     * Ausente é a cura de sempre, sem remoção nenhuma; declarado, o alvo perde as condições
     * destas chaves no MESMO lançamento que cura — nunca um segundo efeito.
     */
    dispel: z.object({
      types: z.array(z.string().min(1)).min(1),
    }).optional(),
  }),
  /**
   * Dano no alvo. Passa por `resolveDamage` com `kind: 'magic'`, então armadura mágica e
   * esquiva valem — os dois são conteúdo (`combat/baseline.json`), não motor. `range` é o
   * alcance até o alvo principal; obrigatório em forma centrada no alvo, proibido em forma
   * self-origin (`buildContent` confere).
   */
  z.object({
    kind: z.literal('damage'),
    basePower: z.number().int().positive().optional(),
    power: z.number().int().positive().optional(),
    /**
     * A fórmula canônica (#474). Presente, ela VENCE o `basePower` na hora do cálculo; o
     * `basePower` continua sendo o número de exibição do catálogo (ADR 0033). Ausente, o
     * caminho é o `basePower` × `combat.spellPower` de sempre, bit a bit.
     */
    formula: spellFormulaSchema.optional(),
    range: z.number().int().positive().optional(),
    area: spellAreaSchema.optional(),
    /**
     * O TIPO de dano da magia (CMB-03). Ausente é `arcane` — o `kind: magic` do v1 —, para a
     * magia cujo elemento o conteúdo ainda não declarou. Onde o catálogo o diz (fogo, gelo,
     * energia, terra, morte, sagrado), o arquivo declara.
     */
    damageType: z.enum(DAMAGE_TYPES).default('arcane'),
  }),
  /**
   * Cura `amount` a cada `intervalMs`, por `durationMs` (Recovery), no lançador — ou em CADA
   * membro da party no alcance com `target: 'party'` (Heal Party, #588: `CONDITION_REGENERATION`
   * do Canary, `data/scripts/spells/party/heal_party.lua` — 20 de vida a cada 2000 ms por 2
   * minutos). `sim` resolve os membros da MESMA sessão dentro de `range` e aplica a MESMA
   * condição a cada um — sem sorteio por membro, os números do script são fixos.
   */
  z.object({
    kind: z.literal('heal-over-time'),
    amount: z.number().int().positive(),
    intervalMs: z.number().int().positive(),
    durationMs: z.number().int().positive(),
    /** `self` (default) cura só o lançador; `party` cura cada membro da party no alcance. */
    target: z.enum(['self', 'party']).optional(),
    /** Obrigatório com `target: 'party'` — o raio em tiles (Canary: 36, distância Chebyshev). */
    range: z.number().int().positive().optional(),
  }),
  /**
   * Dano ao longo do tempo (CMB-07): `amount` a cada `intervalMs`, por `durationMs`, aplicado
   * ao ALVO. Cada tique passa pelo MESMO resolver canônico do golpe (`resolveDamage`), com o
   * `source: 'spell'` e o tipo declarado — nunca escrita direta de vida.
   */
  z.object({
    kind: z.literal('damage-over-time'),
    amount: z.number().int().positive(),
    intervalMs: z.number().int().positive(),
    durationMs: z.number().int().positive(),
    range: z.number().int().positive(),
    damageType: z.enum(DAMAGE_TYPES).default('arcane'),
  }),
  /**
   * Velocidade +`speedPercent` % por `durationMs`. `pacifies` (M44-04, #622) é o Swift Foot do
   * Canary (`data/scripts/spells/support/swift_foot.lua`): a mesma magia que acelera aplica
   * `CONDITION_PACIFIED` por `spellDuration` — o jogador corre, mas não ataca (nem golpe, nem
   * magia agressiva) enquanto a haste dura. É o efeito do ramo sem Roda (`WHEEL_GRADE_NONE`); a
   * Roda da Destino está fora do recorte. Ausente é a haste de sempre.
   */
  z.object({
    kind: z.literal('haste'),
    speedPercent: z.number().int().positive(),
    durationMs: z.number().int().positive(),
    damageDealtPercent: damagePercentBySource.optional(),
    pacifies: z.boolean().optional(),
  }),
  /**
   * Postura (Protector, Blood Rage, Sharpshooter…): percentuais por `durationMs` — no lançador,
   * ou em CADA membro da party no alcance com `target: 'party'` (Protect/Enchant/Train Party,
   * #588: `CONDITION_ATTRIBUTES` do Canary, `data/scripts/spells/party/*.lua`).
   *
   * `skillDeltas` (bônus FLAT por skill, #576: shielding +3 do Protect, magic +1 do Enchant,
   * melee +3/distance +3 do Train — o MESMO campo que `conditionEffectSchema` já declara para
   * ability/defesa de monstro) entra aqui pela primeira vez do lado da MAGIA de JOGADOR: o
   * consumo é o MESMO mecanismo já ativo (`Conditions.skillBonus`, somado em `#skillLevelOf`/
   * `#spellScaling`/`#defenseSourceOf`, `sim/rulesets/hunt.ts`) — ele não distingue de onde a
   * condição veio, só soma `skillDeltas` de toda condição ATIVA do personagem. Nenhum consumo
   * novo a escrever: `castSpell` só precisa propagar o campo para o `ConditionState`.
   */
  z.object({
    kind: z.literal('buff'),
    durationMs: z.number().int().positive(),
    damageDealtPercent: damagePercentBySource.optional(),
    damageTakenPercent: z.number().int().optional(),
    skillDeltas: z.record(z.string(), z.number().int()).optional(),
    /** `self` (default) afeta só o lançador; `party` afeta cada membro da party no alcance. */
    target: z.enum(['self', 'party']).optional(),
    /** Obrigatório com `target: 'party'` — o raio em tiles (Canary: 36, distância Chebyshev). */
    range: z.number().int().positive().optional(),
  }),
  /**
   * Provocação (#589, Canary `doChallengeCreature`/`challengeFocusDuration`): força quem ela
   * atinge a mirar o LANÇADOR por `durationMs`, suspendendo a fuga enquanto durar. Mesma forma de
   * `damage` — alvo único centrado no alvo (`range`) OU área centrada no lançador (`area`,
   * `buildContent` recusa a combinação errada) — porque é a MESMA mira: sempre um monstro inimigo,
   * nunca a própria party.
   */
  z.object({
    kind: z.literal('challenge'),
    durationMs: z.number().int().positive(),
    range: z.number().int().positive().optional(),
    area: spellAreaSchema.optional(),
  }),
  /** Dano vira mana enquanto vale. */
  z.object({ kind: z.literal('mana-shield'), durationMs: z.number().int().positive() }),
  /**
   * Invisibilidade do LANÇADOR (#592, Canary `invisible.lua`: level 35, mana 440, 200 s,
   * `isSelfTarget(true)`). Sem campo além do prazo — a chave reservada `invisible`
   * (`INVISIBLE_CONDITION_KEY`) é quem o `sim` reconhece, como `mana-shield`.
   */
  z.object({ kind: z.literal('invisible'), durationMs: z.number().int().positive() }),
  /**
   * Remove condição do lançador, sem curar (#590, Canary `cure_{poison,burning,curse,
   * electrification,bleeding}.lua`: só `COMBAT_PARAM_DISPEL`, sem `COMBAT_PARAM_TYPE,
   * COMBAT_HEALING`). `types` são as CHAVES de `ConditionState.key` que a magia remove — o
   * mesmo vocabulário que `field.condition.key` já declara (`"burning"` no Dragon Lord). Chave
   * ausente no alvo não é erro: a magia sai igual, sem efeito nenhum a remover.
   *
   * `area` (#592, Cancel Invisibility: `combat:setArea(createCombatArea(AREA_CIRCLE3X3))`) é a
   * forma centrada no LANÇADOR — `AREA_CIRCLE3X3` é o círculo de RAIO 3 (37 tiles), não o 3x3 do
   * nome — cujos MONSTROS perdem as chaves: nunca o lançador nem os aliados, porque o `combat` do
   * script é agressivo por default e `Combat::CombatFunc` (`combat.cpp:1562`/`1610`) exclui o
   * lançador (#559). Ausente é o dispel de sempre, só no `recipient`.
   */
  z.object({
    kind: z.literal('dispel'),
    types: z.array(z.string().min(1)).min(1),
    area: spellAreaSchema.optional(),
  }),
  /**
   * Invocação do jogador (#598, M38-01, ADR 0057; TFS/Canary `summon_creature.lua`): SEM
   * `monsterId` fixo no conteúdo — o parâmetro vem da barra (`BotAction` `kind: 'spell'` com
   * `monsterId`, ver `botActionV2Schema`) ou do preset do bot, e é ele que escolhe QUAL
   * `summonable` nascer. A magia em si só declara o portão (level, vocação, cooldown, grupo) —
   * `manaCost` do CATÁLOGO desta magia fica sem uso aqui: o custo real é o `manaCost` do
   * MONSTRO (`MonsterType::info.manaCost`), e é assim que a mesma "Summon Creature" custa mais
   * mana para um Fire Elemental do que para um Poison Spider. `HuntRuleset#castSpell` lê o
   * monstro do catálogo e faz esse desvio — `casting.ts` continua puro e genérico, sem
   * conhecer monstro nenhum.
   */
  z.object({ kind: z.literal('summon') }),
  /**
   * O familiar de vocação (#599, M38-02, ADR 0057 d.3; Canary `data/scripts/spells/familiar/*.lua`
   * e `Player:CreateFamiliarSpell`, `data/libs/functions/player.lua`): invoca o monstro
   * `monsterId` (um `familiar: true`) por `durationMs`, e depois disso a magia só sai de novo
   * passados `cooldownMs` do LANÇAMENTO — no Canary o cooldown é a `CONDITION_SPELLCOOLDOWN` que
   * `CreateFamiliarSpell` arma com `ticks = 2 × duração` (`familiarTime` 30 min ÷ 2 = 15 min, ×
   * 2 = 30 min), e o `spell:cooldown(0)` do script só diz que quem cobra é ela.
   *
   * Por isso o `cooldownMs` DA MAGIA (`spellSchema.cooldownMs`) fica no valor do grupo (2 s,
   * `groupCooldown` do script) e o cooldown de verdade mora aqui: ele atravessa a saída da hunt
   * como carimbo de relógio de parede no `CharacterRuntime` (ADR 0052 d.6), e um cooldown de 30
   * min no `Cooldowns` da sessão (instante LÓGICO dela) não sobreviveria a ela. `buildContent`
   * confere que o monstro existe e é `familiar`, e que a magia declara vocação — cada vocação
   * tem o SEU familiar (`FAMILIAR_ID`).
   */
  z.object({
    kind: z.literal('familiar'),
    monsterId: z.string().min(1),
    /** Por quanto tempo a invocação dura — `60 × familiarTime / 2` s do Canary. */
    durationMs: z.number().int().positive(),
    /** Quanto tempo depois do lançamento a magia volta — `2 × duração` no Canary. */
    cooldownMs: z.number().int().positive(),
  }),
  /**
   * Remove uma condição do PRÓPRIO lançador, na hora (Cancel Magic Shield, #596) — o
   * `creature:removeCondition(...)` do Canary. Ao contrário de toda outra `SpellEffect`, esta não
   * AGENDA nada: `castSpell` devolve `CastSuccess.removeConditionKey`, e quem tem a `Conditions`
   * (o ruleset) remove no mesmo instante, sem evento na fila — não há "vencimento" para uma
   * remoção. `key` é a MESMA chave reservada que a condição alvo usa (`mana-shield` para a
   * Cancel Magic Shield); string livre porque o vocabulário de condição já não é fechado aqui
   * (`speed`/`drunk`/etc. usam a mesma convenção de chave reservada, CMB-11).
   */
  z.object({ kind: z.literal('remove-condition'), key: z.string().min(1) }),
  /**
   * Conjuração (#594, ADR 0044): `creature:conjureItem(blankId, itemId, charges)` do Canary
   * (`data/scripts/spells/conjuring/*.lua`). SEMPRE self-only — o lançador credita CARGAS no
   * próprio estoque abstrato de suprimento (runa) OU munição, nunca no de outro personagem, e
   * por isso não tem `target`/`range`/`area`: a runa avulsa que a magia conjura é quem mira,
   * depois, no uso — a conjuração em si nunca mira ninguém.
   *
   * Suprimento continua ABSTRATO (ADR 0026 d.8/0032 d.6/d.7, ADR 0044 decisão 1): nasce carga no
   * `Map` de `CharacterRuntime.supplyStock`/`ammunitionStock`, nunca item físico novo — o mesmo
   * modelo que o loot (#520) já credita, só que pela mão do lançador em vez do abate.
   * `buildContent` confere que exatamente um entre `supplyId`/`ammunitionId` está presente E
   * que o id aponta para o catálogo correspondente — magia de conjuração para runa/munição que
   * não existe subiria muda, creditando um id que `useSupply`/o tiro nunca reconhecem.
   */
  z.object({
    kind: z.literal('conjure'),
    supplyId: z.string().min(1).optional(),
    ammunitionId: z.string().min(1).optional(),
    /** Cargas creditadas por lançamento — o terceiro argumento de `conjureItem` no Canary. */
    charges: z.number().int().positive(),
    /**
     * O preço da runa em branco (10 gold, `npc/alexander.lua`), cobrado do gold JUNTO da
     * mana/alma — nunca criada como item: é o mesmo gold que `useSupply` já debita, só que na
     * hora de CRIAR a carga em vez de gastá-la. Ausente ou `0`: a conjuração de MUNIÇÃO
     * (paladin) não compra runa em branco nenhuma — `conjureItem(0, …)` no Canary, `blankId`
     * zero é "nada a consumir".
     */
    blankPrice: z.number().int().nonnegative().default(0),
  }).refine(
    (effect) => (effect.supplyId !== undefined) !== (effect.ammunitionId !== undefined),
    { message: 'conjure precisa de exatamente um entre "supplyId" e "ammunitionId"' },
  ),
  /**
   * Luz do LANÇADOR (#623, M44-05; Canary `data/scripts/spells/support/{light,great_light,
   * ultimate_light}.lua`: `CONDITION_LIGHT` com `CONDITION_PARAM_LIGHT_LEVEL`/`_LIGHT_COLOR`/
   * `_TICKS`). É condição de APRESENTAÇÃO — o `sim` guarda e vence a condição, mas nenhuma regra
   * de jogo a lê (visão do monstro, mira e dano não dependem de luz): o cliente é quem ajusta a
   * escuridão. `level` é o raio inicial em tiles e decai 1 a cada `durationMs / level` (o
   * `lightChangeInterval` do `ConditionLight`); `color` é o índice da paleta de 216 cores do
   * Tibia (215 nas três magias), a mesma que `world-lights` já resolve para o explorador.
   */
  z.object({
    kind: z.literal('light'),
    level: z.number().int().min(1).max(255),
    color: z.number().int().min(0).max(255),
    durationMs: z.number().int().positive(),
  }),
  /**
   * Levitate (#623; Canary `support/levitate.lua`): sobe ou desce UM andar para o tile da frente
   * do lançador — a direção do parâmetro (`exani hur up`/`down`) vira DUAS magias do catálogo,
   * porque o parâmetro de texto do Canary não tem lugar na barra de ações (que é do Draconya) e
   * dois ids dão o mesmo resultado sem plumbing novo. O destino sai das regras de tile do mapa
   * multiandar (`utility-spells.ts`, `sim`).
   */
  z.object({ kind: z.literal('levitate'), direction: z.enum(['up', 'down']) }),
  /**
   * Magic Rope (#623; Canary `support/magic_rope.lua`): quem está EM CIMA de um rope spot sobe
   * um andar, como a corda faria (`Position:moveUpstairs`). Sem campo: o mecanismo é fixo.
   */
  z.object({ kind: z.literal('magic-rope') }),
  /**
   * Find Person / Find Fiend (#623; Canary `support/find_person.lua`/`find_fiend.lua`): não muda
   * nada no mundo, só devolve UMA mensagem de direção e distância. `person` mira um personagem da
   * MESMA sessão (o parâmetro de nome do Canary vira o alvo manual do `use-slot`); `fiend` procura
   * o monstro fiendish mais próximo (Exaltation Forge — ainda fora do catálogo, ver
   * `docs/product/utility-spells.md`).
   */
  z.object({ kind: z.literal('find'), target: z.enum(['person', 'fiend']) }),
  /**
   * Food (#623; Canary `support/food.lua`): cria comida na mochila do lançador — UM item
   * garantido e um segundo com 50 % (`math.random(0, 1) == 1`), cada um sorteado UNIFORME da lista
   * `items`, NA ORDEM declarada (o índice do sorteio é a posição — trocar a ordem troca o que a
   * mesma semente rende). Cada id precisa ser um consumível `food` do catálogo de itens
   * (`buildContent` confere).
   */
  z.object({
    kind: z.literal('food'),
    items: z.array(z.string().min(1)).min(1),
  }),
]);
export type SpellEffect = z.infer<typeof spellEffectSchema>;

/**
 * O custo de mana de uma magia (#588): o número FIXO de sempre, OU escalado pelo tamanho da
 * party no alcance (Heal/Protect/Enchant/Train Party) — `Party::onCastSpell` do Canary,
 * `data/scripts/spells/party/*.lua`: `mana = ceil((decay^(n-1) × base) × n)`, `n` sendo quantos
 * membros do roster (líder incluso) estão dentro do alcance do efeito. `decay` é 0,9 nas
 * quatro magias do Canary — campo, não constante, porque o número é conteúdo, não motor.
 *
 * Só faz sentido ao lado de um efeito com `target: 'party'` — `buildContent` confere que os
 * dois andam juntos, nos dois sentidos.
 */
export const spellManaCostSchema = z.union([
  z.number().int().nonnegative(),
  z.object({
    kind: z.literal('party-scaled'),
    /** O mana de UM lançador sozinho — nunca cobrado sozinho: `n <= 1` recusa antes (no-target). */
    base: z.number().int().positive(),
    /** O fator de decaimento por membro afetado (Canary: 0,9). */
    decay: z.number().positive().max(1),
  }),
]);
export type SpellManaCost = z.infer<typeof spellManaCostSchema>;

/**
 * O mana de EXIBIÇÃO de uma magia (#588): o número fixo de sempre, ou o `base` do custo
 * escalado pela party — o mesmo que o Tibia anuncia no grimório (`spell:mana(120)` do Canary é
 * o `base`, separado da conta de `onCastSpell`). Nunca o custo real de um lançamento
 * específico, que depende de quantos estão no alcance — só quem tem a sessão (`sim`) sabe isso.
 */
export function manaCostDisplayOf(manaCost: SpellManaCost): number {
  return typeof manaCost === 'number' ? manaCost : manaCost.base;
}

/**
 * Uma magia (FUN-74, §4.1, §9.2; o catálogo do Tibia em #155).
 *
 * Tudo em CONTEÚDO: custo, cooldown, grupo, alcance, forma e efeito. O motor não sabe quanto
 * cura nem quanto custa — ele sabe *que* cura e *que* custa. É a mesma regra que vale para
 * monstro e progressão, e é o que permite balancear sem deploy.
 *
 * O `kind` do efeito é fechado como o do bot, e pela mesma razão: o `sim` só executa o que
 * conhece, e uma magia com efeito desconhecido é recusada no boot em vez de virar uma linha
 * morta que ninguém explica. Dano e cura vêm por `basePower` (o BP do TibiaWiki, convertido
 * por `combat.spellPower`) OU por número fixo (`power`/`amount`) — um dos dois, nunca ambos
 * (`buildContent` confere). Dano de ataque pode declarar ainda a `formula` canônica (#474), que
 * vence o `basePower` no cálculo; ela é ADITIVA e não muda a magia que não a declara.
 */
export const spellSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /**
   * O texto de apresentação da magia (#436, ADR 0033), em português — o que o
   * `ActionConfigModal` mostra abaixo dos números. Opcional: a sub-issue das descrições
   * preenche os 78 arquivos reais; sem o campo, o cliente cai no fallback fixo por Tipo.
   */
  description: z.string().min(1).optional(),
  /** Mana gasta ao lançar. Sem mana, o lançamento é RECUSADO — não fica devendo. */
  manaCost: spellManaCostSchema,
  /**
   * Alma gasta ao lançar (#593), a `spell:soul(n)` do Canary — hoje só a conjuração de runa a
   * declara (`spells/conjuring/*.lua`), e a conjuração em si é a #594, fora desta issue.
   * OPCIONAL, como `group`/`groupCooldownMs`, e não `.default(0)`: um default preenchido
   * obrigaria todo `Spell` literal do repositório (as `.trace.ts` e os testes de conformidade)
   * a declarar o campo mesmo sem custo nenhum. Ausente é toda magia de hoje: sem recusa nova.
   * Como a mana, sem alma o lançamento é RECUSADO, nunca fica devendo — e sai por ÚLTIMO, junto
   * da mana.
   */
  soulCost: z.number().int().nonnegative().optional(),
  /** O cooldown DA MAGIA. Evento na fila, nunca acumulador (ADR 0020). */
  cooldownMs: z.number().int().positive(),
  /**
   * O grupo do Tibia (#155) e por quanto tempo esta magia o tranca. Ausente é magia fora dos
   * grupos — só o cooldown próprio —, que é o que as três genéricas eram antes de #155; o
   * catálogo real declara os dois. `groupCooldownMs` sem `group` é recusado no boot.
   */
  group: z.enum(SPELL_GROUPS).optional(),
  groupCooldownMs: z.number().int().positive().optional(),
  /** Grupo secundário exclusivo (Stance, Focus, Great Beams, Special). Tranca só as magias que o têm. */
  secondaryGroup: z.object({
    name: z.enum(SECONDARY_GROUPS),
    cooldownMs: z.number().int().positive(),
  }).optional(),
  /** Level mínimo. */
  minLevel: z.number().int().positive().default(1),
  /**
   * O preço, em gold, de APRENDER a magia (#624, ADR 0058 d.3): no Tibia toda magia
   * instantânea é comprada de um NPC (`StdModule.learnSpell`) e o cast confere
   * `hasLearnedInstantSpell`. Importado dos NPCs do Canary por `pnpm catalog:spell-prices` — o
   * MENOR preço entre os que ensinam à vocação (ADR 0038 d.6) —, com TibiaWiki curado à mão
   * para a magia que nenhum NPC ensina (fonte no `_open`). `0` é magia grátis (as básicas de
   * cada vocação, como no Canary); AUSENTE é "nenhum NPC a ensina" (Great Death Beam, que só a
   * Wheel of Destiny concede): `learn-spell` recusa `not-for-sale`. OPCIONAL no tipo, como
   * `soulCost`: o `Spell` literal de fixture de `sim`/cliente não precisa declarar o campo.
   */
  learnPrice: z.number().int().nonnegative().optional(),
  /**
   * Vocação exigida (§9.2, FUN-92). Ausente é magia que qualquer um lança.
   *
   * O personagem nasce SEM vocação e escolhe no level 8 (§7.4), então uma magia com requisito
   * é inacessível até lá — por construção, não por regra escrita em outro lugar.
   */
  vocationId: z.string().min(1).optional(),
  /**
   * O efeito, com `target` preenchido com `self` no parse quando ausente — o comportamento de
   * `.default('self')`, mas OPCIONAL no tipo, pela razão registrada em `spellEffectSchema`.
   */
  effect: spellEffectSchema.transform((effect): SpellEffect =>
    effect.kind === 'heal' ? { ...effect, target: effect.target ?? 'self' } : effect,
  ),
  /** De onde uma magia IMPORTADA veio (ADR 0038 decisão 2). Ausente em magia autorada à mão. */
  source: catalogSourceSchema.optional(),
  _open: z.string().optional(),
});

export type Spell = z.infer<typeof spellSchema>;

/** O monstro como o ARQUIVO o descreve — sem aparência, que vive na tabela (FUN-94). */
export type MonsterDefinition = z.infer<typeof monsterSchema>;

/** O monstro pronto para uso, com o `outfitId` já resolvido por `buildContent`. */
export type Monster = Omit<
  MonsterDefinition, 'mitigation' | 'abilities' | 'defenses' | 'elementHealing' | 'reflect'
> & {
  readonly outfitId: number;
  /** A aparência do cadáver (FUN-123), quando a tabela tem uma. Ausente: não deixa cadáver. */
  readonly corpseAppearanceId?: number;
  /** A mitigação compilada (CMB-03): lookup por tipo e Set de imunidade. */
  readonly mitigation: CompiledMitigation;
  /**
   * A cura por elemento compilada (#683): a tabela COMPLETA por tipo, em percentual inteiro,
   * zero onde não cura. Ausente no monstro que não cura com tipo nenhum — o caso comum.
   */
  readonly elementHealing?: Readonly<Record<DamageType, number>>;
  /** O reflexo compilado (#683), na forma do item (#552). Ausente no monstro que não reflete. */
  readonly reflect?: CompiledReflect;
  /**
   * As abilities JÁ NORMALIZADAS (CMB-06): nunca vazio — ausência vira a básica do boot. É o
   * que o `sim` lê, e é por isso que ele não conhece o par `attack`/`attackIntervalMs`.
   */
  readonly abilities: readonly MonsterAbility[];
  /**
   * As defesas JÁ NORMALIZADAS (#518): nunca `undefined` — ausência vira lista vazia, para o
   * `sim` iterar sem `?? []`. Ao contrário das abilities, não há básica a sintetizar: nenhum
   * monstro cura sozinho por padrão.
   */
  readonly defenses: readonly MonsterDefense[];
};
export type MonsterAttack = MonsterDefinition['attack'];

/** A faixa de ataque de um monstro: um número é a faixa de um valor só. */
export function attackRange(attack: MonsterAttack): { readonly min: number; readonly max: number } {
  return typeof attack === 'number' ? { min: attack, max: attack } : attack;
}

/** O poder de uma ability declarada, normalizado para faixa — um número é `[n, n]`. */
export function abilityPower(power: MonsterAbilityDefinition['power']): MonsterAbilityPower {
  return typeof power === 'number' ? { min: power, max: power } : power;
}

/**
 * Até onde o monstro PARA para atacar (CMB-06): o MAIOR alcance entre as abilities.
 *
 * É o que o passo guloso consulta para decidir "bater ou aproximar". Sem isto, um monstro de
 * ability à distância 4 continuaria colando no alvo como um corpo a corpo — e o defeito que a
 * issue descreve (alcance muda a distância, mas o golpe continua melee) voltaria por outra porta.
 */
export function monsterAttackRange(monster: Monster): number {
  let range = monster.attackRange;
  for (const ability of monster.abilities) {
    if (ability.target.range > range) range = ability.target.range;
  }
  return range;
}
export type LootTable = z.infer<typeof lootTableSchema>;
/** Uma linha da tabela, sem o `itemId`: é o que gold e item têm em comum. */
export type LootRoll = NonNullable<LootTable['gold']>;
export type Hunt = z.infer<typeof huntSchema>;
export type Vocation = z.infer<typeof vocationSchema>;

// --- mundo (#829, OW-08, ADR 0060) ---------------------------------------------------------

/**
 * Os tipos de mundo que o motor sabe ser. É o `worldType` do Canary, que aceita "expert-pvp",
 * "retro-pvp", "pvp", "no-pvp" e "pvp-enforced" (`canary/config.lua.dist:28-33`) — mas o
 * Draconya só implementa o `no-pvp` (ADR 0060 d.1): não existe dano entre jogadores no `sim`, e
 * aceitar `retro-pvp` num arquivo de conteúdo seria um mundo que promete o que o motor não faz.
 * Vocabulário FECHADO, como `COMBAT_PROFILES` (ADR 0031): um tipo novo entra por ADR e por esta
 * lista, nunca por um valor que passou em silêncio.
 */
export const WORLD_TYPES = ['no-pvp'] as const;
export type WorldType = (typeof WORLD_TYPES)[number];

/**
 * Uma coordenada ABSOLUTA do mapa do Tibia (a do `otservbr.otbm`), e não a local de um recorte.
 * É a mesma que `characters.world_x/y/z` guardará (ADR 0060 d.3.b): o que liga as duas é
 * `source.region` do mapa (`absoluteToLocal`, em `map.ts`). O andar `z` é de 0 (céu) a 15
 * (subsolo mais fundo), o do protocolo do Tibia.
 */
const absolutePoint = z.strictObject({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  z: z.number().int().min(0).max(15),
});

/**
 * Uma cidade do mundo: id, nome e templo (`canary/src/map/town.hpp`, `Town`). O Canary a guarda
 * com um id numérico; aqui o id é o slug, como todo id de conteúdo. O templo é para onde o
 * personagem volta ao morrer e onde nasce sem posição salva (ADR 0060 d.4 e d.9).
 */
const worldTownSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  temple: absolutePoint,
});

/**
 * Um mundo (`data/worlds/<id>.json`, ADR 0060 d.1 e d.2): o `Game` único do Canary, que no
 * Draconya é uma sessão compartilhada num processo `game`. É o conteúdo de que a topologia (OW-13)
 * e as colunas de `characters` (OW-15) precisam antes de existir. Os spawns entram à parte (OW-25).
 *
 * Só dado, sem arte (invariante 6): o `strictObject` recusa `appearanceId` e qualquer chave que
 * ninguém lê. A coerência com o mapa — o templo cair num tile andável do recorte — não cabe a um
 * schema, que só vê este arquivo: `buildContent` a confere.
 */
export const worldSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  /** O tipo do mundo, no conteúdo e não no código: `worldType` do Canary. Ver `WORLD_TYPES`. */
  worldType: z.enum(WORLD_TYPES),
  /** O mapa sobre o qual o mundo roda — um `data/maps/<id>.json` importado do OTBM. */
  map: z.string().min(1),
  /** Ao menos uma: sem cidade não há templo, e sem templo ninguém tem onde nascer nem morrer. */
  towns: z.array(worldTownSchema).min(1),
  /**
   * O teto de gente no mundo (ADR 0060 d.2.b): vale só na entrada, vindo do repouso; quem volta
   * de uma instância sempre entra. Começa em 200, o `CITY_SHARD_CAPACITY` de hoje.
   */
  capacity: z.number().int().positive(),
});

export type World = z.infer<typeof worldSchema>;
export type WorldTown = World['towns'][number];

// --- mapa e rota (FUN-9) -------------------------------------------------------------------

const point = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  z: z.number().int(),
});

/**
 * O mapa vem como grade de caracteres, uma string por linha: `#` bloqueia, qualquer outro
 * caractere é livre.
 *
 * Escolha deliberada sobre um formato binário compacto: mapa é conteúdo, e conteúdo se edita
 * e se revisa. Numa grade ASCII o diff de um pull request mostra a parede que mudou; num
 * blob base64 mostra que "o mapa mudou". O custo é tamanho de arquivo, que não importa para
 * dezenas de mapas — e a conversão para bitmap acontece uma vez, no carregamento.
 */
/**
 * Um andar (FUN-119, ADR 0025): a grade de bloqueio e, opcionalmente, a de velocidade de
 * chão — um caractere por tile, resolvido por `speedPalette`. Sem `speed`, todo tile anda a
 * `DEFAULT_GROUND_SPEED`; é o caso dos mapas autorados à mão.
 */
const floorSchema = z.object({
  grid: z.array(z.string().min(1)).min(1),
  speed: z.array(z.string().min(1)).optional(),
  /**
   * Bloqueio de LINHA DE VISÃO (#553): `#` bloqueia projétil/vista, o resto é livre — a mesma
   * convenção de `grid`, em camada SEPARADA porque bloquear passo e bloquear vista são flags
   * distintas do pacote de aparências (`unpass` vs. `unsight`): uma peça de decoração pode ter
   * uma sem a outra. Ausente: nada bloqueia visão neste andar (mapa autorado à mão, ou ainda
   * não reimportado com a camada nova).
   */
  sight: z.array(z.string().min(1)).optional(),
  /**
   * Zonas do tile (#830, OW-09, ADR 0060 d.8): protect zone, no-pvp, no-logout e arena, lidas do
   * `OTBM_ATTR_TILE_FLAGS` de cada tile — um caractere por tile, na mesma forma de `speed` e
   * `sight`, resolvido pela paleta FIXA `ZONE_PALETTE` (`./map.ts`; `.` é o tile normal). Fixa e
   * não por mapa, como `speedPalette`, porque são só oito estados e o significado é o do Canary,
   * nunca uma escolha do mapa. Ausente: nenhum tile deste andar tem zona (tudo normal) — o mapa
   * autorado à mão e o recorte ainda não reimportado com a camada, e as hunts não mudam.
   */
  zones: z.array(z.string().min(1)).optional(),
});

export const tilemapSchema = z.object({
  id: z.string().min(1),
  /** O andar padrão: o de um mapa de grade única, e onde um `entryPoint` sem `z` cai. */
  z: z.number().int(),
  /** A forma de um andar só — açúcar para `floors: { [z]: { grid } }`. */
  grid: z.array(z.string().min(1)).min(1).optional(),
  /** Vários andares, pela chave `z` (FUN-119). Exatamente um de `grid`/`floors`. */
  floors: z.record(z.string().regex(/^-?\d+$/), floorSchema).optional(),
  /** Caractere da grade de velocidade → `bank.waypoints` do chão. */
  speedPalette: z.record(z.string().length(1), z.number().int().positive()).optional(),
  /**
   * Onde um personagem nasce neste mapa (FUN-60, FUN-69). É CONTEÚDO, não código: o valor
   * antigo era um literal `(0,0)` no servidor, que é parede na borda de qualquer tilemap. O
   * `buildContent` valida contra `isBlocked` — ponto de entrada em parede quebra o boot, e
   * não o jogador. Sem `z`, é o andar padrão.
   */
  entryPoint: z.object({
    x: z.number().int(), y: z.number().int(), z: z.number().int().optional(),
  }).optional(),
  /**
   * Escadas, buracos e rampas (FUN-119): pisar em `from` leva a `to`, que pode estar em outro
   * andar e não precisa ser adjacente — no Tibia, descer uma escada desloca um tile. Autorado
   * à mão para o recorte; o importador só lista candidatos.
   */
  floorChanges: z.array(z.object({ from: point, to: point })).default([]),
  /**
   * Cenário usável (#727, ADR 0050 d.1): porta, capim, stone pile, rope spot, ladder, alavanca,
   * baú, placa — o que o importador CLASSIFICA a partir de `aid`/`uid`/`text` do OTBM e das
   * tabelas do Canary transcritas como dado (`data/scenery/canary-tables.json`). Só classificação
   * e geometria aqui: o mecanismo que muda de estado por sessão é `TileOverrides` (#728), que
   * ainda não existe — até ele pousar, `initialState`/`blocking` descrevem o que o OTBM tinha no
   * instante da importação, e o `sim` não lê este campo.
   */
  interactables: z.array(z.object({
    at: point,
    /**
     * O que este tile é (ADR 0050 d.1). `pressure-plate` entra no T3 (#734): reage a
     * step-in/step-out, nunca a `useOnMap` — o mesmo par de estados de `lever`
     * (`TOGGLE_PAIR`/`links`), só que quem troca o estado é o passo, não o clique.
     */
    kind: z.enum([
      'door', 'locked-door', 'level-door', 'quest-door', 'grass', 'stone-pile', 'hole',
      'rope-spot', 'ladder', 'lever', 'chest', 'sign', 'teleport', 'pressure-plate',
    ]),
    /** O estado no instante da importação (`locked`/`closed`/`open`, `uncut`/`cut`, `down`/`up`,
     * `pile`/`hole`, ou `default` para o que só tem um estado). Vocabulário por `kind`, não
     * fechado aqui — fechá-lo obrigaria este schema a mudar a cada `kind` novo. */
    initialState: z.string().min(1),
    /** A chave em `appearances.scenery` que resolve `initialState` para um id de aparência. */
    appearanceKey: z.string().min(1),
    /** `ATTR_ACTION_ID` do item, quando o OTBM o carrega (porta, alavanca). */
    aid: z.number().int().positive().optional(),
    /** `ATTR_UNIQUE_ID` do item — baú e item com storage por personagem. */
    uid: z.number().int().positive().optional(),
    /** `ATTR_TEXT` do item — placa e livro, lidos no Look. */
    text: z.string().min(1).optional(),
    requires: z.object({
      tool: z.enum(['machete', 'rope', 'shovel', 'pick', 'key']).optional(),
      level: z.number().int().positive().optional(),
      storageKey: z.string().min(1).optional(),
      keyId: z.number().int().positive().optional(),
    }).optional(),
    /** Alavancas ligadas a outros interativos por `aid` (#728: quem liga o quê). */
    links: z.array(z.string().min(1)).optional(),
    /** Em ms — quanto tempo até reverter sozinho (o `duration` do `items.xml`, #728). */
    revertMs: z.number().int().positive().optional(),
    /** Destino de um teleporte. */
    target: point.optional(),
    /**
     * O que um baú de quest dá (#733, ADR 0050 d.6 T2) — só faz sentido em `kind: 'chest'`
     * (`superRefine` abaixo recusa a combinação errada, o mesmo padrão de `itemSchema.use.keyId`
     * só em `tool: 'key'`). `itemId` pode apontar um item fora do catálogo carregado — o `sim`
     * recusa em runtime (`unknown-item`), nunca no boot: o mapa é importado antes do catálogo de
     * itens estar completo (#573/#754), e o boot não pode depender da ordem das duas coisas.
     */
    reward: z.object({
      itemId: z.string().min(1),
      quantity: z.number().int().positive().default(1),
    }).optional(),
  }).superRefine((interactable, ctx) => {
    // `reward` só em `chest` (#733) — declará-lo em porta/capim/placa seria um item que
    // nada entrega, e pareceria decisão de conteúdo sem ser.
    if (interactable.reward !== undefined && interactable.kind !== 'chest') {
      ctx.addIssue({ code: 'custom', message: '`reward` só em `kind: "chest"`' });
    }
  })).default([]),
  /** De onde um mapa importado veio (ADR 0025). Ausente em mapa autorado à mão. */
  source: z.object({
    file: z.string().min(1),
    sha256: z.string().min(1),
    region: z.object({
      x: z.tuple([z.number().int(), z.number().int()]),
      y: z.tuple([z.number().int(), z.number().int()]),
      z: z.tuple([z.number().int(), z.number().int()]),
    }),
  }).optional(),
}).refine((map) => (map.grid === undefined) !== (map.floors === undefined), {
  message: 'um mapa tem `grid` (um andar) ou `floors` (vários), nunca os dois nem nenhum',
});

export const routeSchema = z.object({
  id: z.string().min(1),
  mapId: z.string().min(1),
  /** Ordenada, e fecha um laço: o último tile é adjacente ao primeiro (§14.4). */
  tiles: z.array(point).min(2),
  spawnPoints: z.array(
    z.object({
      /** Índice na rota. Ancorar no índice, e não em coordenada, mantém rota e spawn juntos. */
      routeIndex: z.number().int().nonnegative(),
      radius: z.number().int().positive().default(3),
      /**
       * O monstro DESTE ponto (#519, hunt copiada do Tibia) — é como o spawn do Canary funciona,
       * um `<monster name>` por posição, nunca um sorteio por zona. Desde o #583 (fim do pull
       * por dificuldade, ADR 0039), é OBRIGATÓRIO declarar este campo OU `monsters` — o antigo
       * fallback ("ausente sorteia pela composição da dificuldade") não existe mais porque a
       * dificuldade também não existe mais: toda hunt nasce do recorte de mapa mais os pontos de
       * spawn reais, nunca de uma composição sorteada por tamanho de pull.
       */
      monsterId: z.string().min(1).optional(),
      /**
       * Vários monstros no MESMO ponto, cada um com peso (#582) — o caso do Canary em que dois
       * `<monster>` do mesmo `<spawn>` caem exatamente na mesma posição: `spawn_monster.cpp`
       * aceita um `weight` por candidato e sorteia entre eles, nunca entre os pontos vizinhos.
       * Mutuamente exclusivo com `monsterId` (`.refine` abaixo) — um ponto ou declara UM
       * monstro fixo, ou uma lista para sortear; nunca os dois ao mesmo tempo.
       */
      monsters: z.array(z.object({
        monsterId: z.string().min(1),
        weight: z.number().int().positive().default(1),
      })).min(2).optional(),
      /**
       * A posição EXATA do spawn (#519), quando ela não é o tile do `routeIndex` — o caso do
       * Canary, cujos pontos raramente caem em cima da rota do bot. Ausente é o tile da rota
       * nesse índice, como sempre foi. `routeIndex` continua obrigatório mesmo com `at`: é o
       * ANCORADOR ao laço (ordem, andar de referência), nunca a posição de nascimento.
       */
      at: point.optional(),
      /**
       * O `spawntime` DESTE ponto, em ms (#519) — no Canary é um atributo por `<monster>`
       * dentro do `<spawn>`, não da zona: cada ponto pode render num ritmo diferente do vizinho.
       * Desde o #583, OBRIGATÓRIO: o fallback na dificuldade não existe mais, pela mesma razão
       * de `monsterId`/`monsters` acima — sem dificuldade, não há para onde cair.
       */
      respawnDelayMs: z.number().int().positive(),
    })
      .refine((s) => s.monsterId === undefined || s.monsters === undefined, {
        message: '`monsterId` e `monsters` são exclusivos — um ponto declara um monstro fixo OU uma lista com peso, nunca os dois',
      })
      .refine((s) => s.monsterId !== undefined || s.monsters !== undefined, {
        message: 'todo spawnPoint precisa declarar `monsterId` OU `monsters` (#583) — não há mais composição de dificuldade para cair como fallback',
      }),
  ).default([]),
});

export type TilemapData = z.infer<typeof tilemapSchema>;
/** O que se ESCREVE num arquivo de mapa — `floorChanges` opcional, antes do default. */
export type TilemapInput = z.input<typeof tilemapSchema>;
/**
 * Um item de `tilemapSchema.interactables[]`, já resolvido (#728, ADR 0050 d.1-d.2). O `sim`
 * lê esta forma para montar o overlay de estado por sessão (`TileOverrides`) — antes da #728
 * ninguém a lia, e `interactables` só existia para o importador escrever.
 */
export type TilemapInteractable = TilemapData['interactables'][number];
export type RouteData = z.infer<typeof routeSchema>;
export type Point = z.infer<typeof point>;
