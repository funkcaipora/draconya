// Schemas de todo dado de jogo. São a definição normativa: o que não passa aqui não entra
// na simulação, e conteúdo inválido derruba o boot em vez de virar bug de balanceamento
// três semanas depois.

import { z } from 'zod';

/**
 * A taxonomia CANÔNICA de tipos de dano (CMB-03, emenda do ADR 0031). É a fonte ÚNICA: o
 * `sim` importa `DamageType` daqui e não redeclara o enum.
 *
 * Os sete primeiros são os tipos de dano do Tibia 13.32 (`CombatType` do TFS/Canary — só os
 * NOMES, que são fato de domínio; nenhum código GPL é copiado, ADR 0019): físico, energia,
 * terra, fogo, gelo, sagrado e morte. `arcane` é o tipo NÃO-ELEMENTAL da magia cujo elemento o
 * conteúdo ainda não declarou — é o vocabulário do `combat-v1` (`melee`/`magic`) preservado
 * para que a ausência de tipo continue rendendo bit a bit o mesmo dano (DT-03).
 *
 * Tipo é separado de ORIGEM (`DamageSource`) e de EFEITO VISUAL (`CreatureHit.source`), pela
 * DT-01: o mesmo elemento pode vir de fontes diferentes, e o mesmo efeito pode desenhar sem
 * dizer qual fórmula resolveu.
 */
export const DAMAGE_TYPES = [
  'physical', 'energy', 'earth', 'fire', 'ice', 'holy', 'death', 'arcane',
] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];

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
export const mitigationSchema = z.object({
  resistances: z.partialRecord(z.enum(DAMAGE_TYPES), z.number().gte(-1).lt(1)).default({}),
  immunities: z.array(z.enum(DAMAGE_TYPES)).default([]),
}).superRefine((mitigation, context) => {
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
});

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
 * vale o antigo `melee` (1), e todo tipo não-físico vale o antigo `magic` (0). É a REFERÊNCIA
 * da migração e o valor que uma fixture pode reusar; o conteúdo real declara a sua, porque o
 * schema exige os oito tipos e um default em código faria o balanceamento morar onde ninguém
 * procura.
 */
export const V1_ARMOR_EFFECTIVENESS: Readonly<Record<DamageType, number>> = {
  physical: 1, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0, arcane: 0,
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
 */
export const lootTableSchema = z.object({
  gold: lootRollSchema.optional(),
  /** Itens de verdade. `buildContent` confere cada `itemId` contra o catálogo (FUN-76). */
  items: z.array(lootRollSchema.safeExtend({ itemId: z.string().min(1) })).default([]),
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
 * - `regen-boost`: o Life Ring. Multiplica a regeneração passiva BASE — o ponto fixo por
 *   vencimento de `progression.regen`, sem nenhum outro bônus, porque hoje não existe nenhum.
 *   `percent: 300` é +300% (quadruplica o ponto por vencimento).
 */
export const RING_EFFECT_KINDS = ['energy-shield', 'regen-boost'] as const;
export type RingEffectKind = (typeof RING_EFFECT_KINDS)[number];

export const ringEffectSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('energy-shield') }),
  z.strictObject({ kind: z.literal('regen-boost'), percent: z.number().int().positive() }),
]);
export type RingEffect = z.infer<typeof ringEffectSchema>;

/** De onde uma instância veio. É a proveniência do §25.3, e ela existe desde o dia um. */
/**
 * De onde uma instância veio (§25.3). `starting-kit` e `vocation-choice` são as duas únicas
 * origens em que o item é DADO, não dropado (ADR 0026, decisões 2 e 3; #153 e #154).
 */
export const ITEM_ORIGINS = [
  'loot', 'boss', 'quest', 'market', 'admin', 'starting-kit', 'vocation-choice',
] as const;
export type ItemOrigin = (typeof ITEM_ORIGINS)[number];

/**
 * Os grupos de cooldown do consumível (ADR 0032 d.2/d.6). O motor v2 os lê: o uso do supply
 * tranca o livro do grupo, como a magia tranca o dela.
 */
export const CONSUMABLE_GROUPS = ['potion', 'attack', 'healing', 'support'] as const;
export type ConsumableGroup = (typeof CONSUMABLE_GROUPS)[number];

/**
 * O efeito do consumível. `blessing` entra agora (a TP-03 a consome em M22); o `sim` v1 a
 * recusa até lá — a projeção `Supply` a deixa de fora justamente por isso.
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
  z.object({ kind: z.literal('blessing') }),
]);
export type ConsumableEffect = z.infer<typeof consumableEffectSchema>;

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
   * é o único tipo que sobrevive ao modelo abstrato (a `blessing-charge`, M22): poção, runa e
   * munição NÃO são itens — são `supply`/`ammunition`, uma seleção que debita gold no uso/tiro.
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
   * Empilha na mesma linha de inventário? Queijo empilha; espada não. A `blessing-charge` NÃO
   * empilha — é carga única, e o schema não impõe mais `stackable: true` a consumível.
   */
  stackable: z.boolean().default(false),
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
   * O que o personagem precisa para equipar. Vazio é item que qualquer um veste.
   *
   * Vocação aqui é o mesmo campo que a magia usa (FUN-92): o personagem nasce sem uma e
   * escolhe no level 8, então item de vocação é inacessível até lá por construção.
   */
  requires: z.object({
    level: z.number().int().positive().optional(),
    vocationId: z.string().min(1).optional(),
    /** O `magicLevel` da runa (#165). Hoje só o supply de dano o usa. */
    magicLevel: z.number().int().nonnegative().optional(),
  }).default(() => ({})),
  /**
   * Cargas e duração (§21.3). **Declarados, e ainda não consumidos por ninguém.**
   *
   * Equipamento comum não tem durabilidade; anel gasta por TEMPO e colar por CARGA. A forma
   * entra agora para o catálogo não mudar quando a mecânica existir — e o dia em que ela
   * existir, quem a implementar acha os campos onde eles já estavam.
   */
  charges: z.number().int().positive().optional(),
  durationMs: z.number().int().positive().optional(),
  /**
   * O que o EQUIPAMENTO resiste e ao que é imune (CMB-03). Ausente é o item neutro — o default
   * preserva o v1, em que nenhum item tinha mitigação. Soma com os outros equipados no boot do
   * defensor (ver `Inventory.mitigation`).
   */
  mitigation: mitigationSchema.default(() => ({ resistances: {}, immunities: [] })),
  /** Efeito passivo de anel, ativo enquanto vestido (§13.9, SV-16). Só em `kind: 'ring'`. */
  ringEffect: ringEffectSchema.optional(),
  /** O efeito do consumível (M22). Só em `kind: 'consumable'` — a `blessing-charge`. */
  effect: consumableEffectSchema.optional(),
  _open: z.string().optional(),
}).superRefine((item, ctx) => {
  // O schema de campo opcional não sabe do `kind`; é aqui que a forma de um tipo não invade o
  // outro. Um `effect` num anel seria descartado em silêncio se o schema fosse aberto.
  if (item.kind === 'consumable') {
    if (item.effect === undefined) ctx.addIssue({ code: 'custom', message: 'consumível sem `effect`' });
  } else if (item.effect !== undefined) {
    ctx.addIssue({ code: 'custom', message: 'só `kind: consumable` tem `effect`' });
  }
});

/** O item como o ARQUIVO o descreve — sem aparência, que vive na tabela (FUN-94). */
export type ItemDefinition = z.infer<typeof itemSchema>;

/**
 * A forma da área (#155, ADR 0026 decisão 5; referência §19). `wave`, `cleave` e `beam` saem
 * do LANÇADOR na direção dele; `circle` é centrado no alvo — ou no lançador, e aí a magia não
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
  /** Cone à frente: a fileira k (1..length) tem largura 2·⌊k/2⌋+1 → 1, 3, 3, 5, 5. */
  z.object({ shape: z.literal('wave'), length: z.number().int().positive() }),
  /** Os três tiles imediatamente à frente (Front Sweep). */
  z.object({ shape: z.literal('cleave') }),
  /** Linha reta de `length` tiles à frente, largura 1. */
  z.object({ shape: z.literal('beam'), length: z.number().int().positive() }),
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
 * a skill que a vocação usa (`vocation.spellSkill` — `magic`, e `distance` no Paladin, `melee` no
 * Knight); na magia e na runa de CURA é sempre o MAGIC LEVEL. Sem `formula`, o efeito continua no
 * caminho provisório de `basePower` × `combat.spellPower`, bit a bit (ADR 0031, migração aditiva).
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
   * `spell.groupCooldownMs`. O supply não tem cooldown individual separado: o grupo É o livro
   * dele. Default 1000: o passo do Tibia para poção e a cadência que o pool `potion` já
   * respeitava; a runa de `attack` declara o dela para se alinhar às magias de ataque.
   */
  groupCooldownMs: z.number().int().positive().default(1_000),
  effect: z.discriminatedUnion('kind', [
    /**
     * Cura o usuário (poção) ou o alvo selecionado (runa de cura, #475). Os três mecanismos são
     * os mesmos da magia de cura — `amount` fixo, `basePower` provisório ou `formula` canônica —
     * e a runa escala pelo MAGIC LEVEL. `range` é o alcance da runa (catalogado; no motor v1 a
     * runa de cura cura o próprio usuário, como a poção).
     * `self` cura quem usa; `friend` cura um membro da party (§26, ADR 0035 d.10).
     */
    z.object({
      kind: z.literal('heal'),
      amount: z.number().int().positive().optional(),
      basePower: z.number().int().positive().optional(),
      formula: spellFormulaSchema.optional(),
      /** `self` cura quem usa; `friend` cura um membro da party (§26, ADR 0035 d.10). */
      target: z.enum(['self', 'friend']).optional(),
      range: z.number().int().positive().optional(),
      area: spellAreaSchema.optional(),
    }),
    z.object({
      kind: z.literal('mana'), amount: z.number().int().positive(),
      target: z.enum(['self', 'friend']).optional(),
      range: z.number().int().positive().optional(),
    }),
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
  ]),
  /** O que o personagem precisa para usar (§20.1). `magicLevel` é o level da skill `magic`. */
  requires: z.object({
    level: z.number().int().positive().optional(),
    magicLevel: z.number().int().nonnegative().optional(),
  }).default(() => ({})),
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
  requires: z.object({
    level: z.number().int().positive().optional(),
  }).default(() => ({})),
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
export type Item = Omit<ItemDefinition, 'weapon' | 'mitigation'> & {
  readonly appearanceId: number;
  /** A arma com o tipo de dano já resolvido (CMB-03). Ausente em item que não é arma. */
  readonly weapon?: ResolvedWeapon;
  /** A mitigação compilada (CMB-03): lookup por tipo e Set de imunidade. */
  readonly mitigation: CompiledMitigation;
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
 */
export const conditionMergeSchema = z.enum(['replace', 'refresh', 'strongest']);
export type ConditionMerge = z.infer<typeof conditionMergeSchema>;

/**
 * O efeito declarativo de uma condição (CMB-07). É o `ConditionEffect` do contrato da issue: um
 * estado com prazo que muda uma leitura (haste, postura, magic shield) ou dispara um tique (cura
 * ou DANO ao longo do tempo). O dano contínuo NÃO traz origem — quem aplica decide (`spell`,
 * `monster-attack`), e é a mesma divisão do `DamageSource` canônico (CMB-02).
 */
export const conditionEffectSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('haste'),
    speedPercent: z.number().int().positive(),
    damageDealtPercent: damagePercentBySource.optional(),
  }),
  z.object({
    kind: z.literal('buff'),
    damageDealtPercent: damagePercentBySource.optional(),
    damageTakenPercent: z.number().int().optional(),
  }),
  z.object({ kind: z.literal('mana-shield') }),
  z.object({
    kind: z.literal('heal-over-time'),
    amount: z.number().int().positive(),
    intervalMs: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal('damage-over-time'),
    amount: z.number().int().positive(),
    intervalMs: z.number().int().positive(),
    /** O tipo do tique (CMB-03). Ausente é `physical`, o default que preserva o v1. */
    damageType: z.enum(DAMAGE_TYPES).default('physical'),
  }),
]);
export type ConditionEffect = z.infer<typeof conditionEffectSchema>;

/**
 * A condição declarativa do conteúdo (CMB-07): chave, política de fusão, prazo e efeito. O
 * `sim` a compila para o estado de runtime com prazo LÓGICO absoluto. Nunca carrega arte
 * (invariante 6) — a apresentação, quando existir, é resolvida por id na tabela de aparências.
 */
export const conditionSpecSchema = z.object({
  key: z.string().min(1),
  merge: conditionMergeSchema.default('refresh'),
  durationMs: z.number().int().positive(),
  effect: conditionEffectSchema,
});
export type ConditionSpec = z.infer<typeof conditionSpecSchema>;

/**
 * Um CAMPO de tile declarativo (CMB-07): uma condição que vive no chão por um prazo, numa forma
 * (`spellAreaSchema`, a MESMA geometria da magia e da ability). O `sim` resolve os tiles no
 * momento da aplicação e indexa por chave NUMÉRICA de tile — nunca varre todos os campos por
 * passo. O campo pertence ao ruleset, nunca ao `Tilemap` (DT-01: conteúdo é imutável).
 */
export const fieldSpecSchema = z.object({
  id: z.string().min(1),
  durationMs: z.number().int().positive(),
  shape: spellAreaSchema,
  condition: conditionSpecSchema,
});
export type FieldSpec = z.infer<typeof fieldSpecSchema>;


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
 * O alvo de uma ability de monstro (CMB-06): o alcance até o alvo principal e, opcionalmente,
 * a forma de área. `area` é só `circle` — o monstro não carrega DIREÇÃO, e `wave`/`cleave`/
 * `beam` saem do lançador na direção dele; `buildContent` recusa as outras formas.
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
  target: monsterAbilityTargetSchema.default(() => ({ range: 1 })),
  power: z.union([
    z.number().int().nonnegative(),
    z.object({ min: z.number().int().nonnegative(), max: z.number().int().nonnegative() })
      .refine((range) => range.min <= range.max, 'power.min não pode passar de power.max'),
  ]),
  /** O tipo de dano da ability (CMB-03). Ausente é `physical`, o default que preserva o v1. */
  damageType: z.enum(DAMAGE_TYPES).default('physical'),
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
  _open: z.string().optional(),
});

export type MonsterAbilityDefinition = z.infer<typeof monsterAbilitySchema>;

/**
 * A ability como o `sim` a consome (CMB-06): poder já em faixa e sem os defaults do schema. É o
 * contrato que o ruleset lê — o mesmo papel do `WeaponProfile` para a arma.
 */
export interface MonsterAbility {
  readonly id: string;
  readonly cadenceMs: number;
  readonly target: { readonly range: number; readonly area?: SpellArea };
  readonly power: MonsterAbilityPower;
  readonly damageType: DamageType;
  readonly presentation?: { readonly missileKey?: string; readonly impactKey?: string };
  /** A condição que a ability aplica a quem acerta (CMB-07). Ausente: só o golpe. */
  readonly condition?: ConditionSpec;
  /** O campo que a ability deixa no chão, centrado no alvo (CMB-07). Ausente: nenhum. */
  readonly field?: FieldSpec;
}

/**
 * As classes de monstro que a Cyclopedia usa para agrupar o Bestiário (SV-20, ADR 0030,
 * `Modals.jsx:187-195` do kit renderizado — a SideList de categorias). Vocabulário FECHADO e
 * crescido por monstro real: hoje só `rat` existe em `packages/content/data/monsters/`, e ele é
 * um roedor — por isso o vocabulário nasce com UM valor. Uma classe nova entra na mesma PR que
 * cria o primeiro monstro dela, nunca antes (§1 de `docs/kit-fidelity-plan.md`: nenhum dado de
 * mentira vira constante — pré-popular as onze categorias do `data.js` do kit sem nenhum
 * monstro real de oito delas seria exatamente isso).
 *
 * Identificador em inglês, valor de exibição em português fica para quem desenhar a `SideList`
 * (RC-08/#321) — o mesmo desenho de `HUNT_DIFFICULTY_NAMES`/`cautious` (traduzido para
 * "Cauteloso" só no cliente, `packages/client/src/shell/HuntsModal.tsx:25`) e de
 * `BOT_CATEGORIES`/`heal` (traduzido para "Cura" em `packages/client/src/shell/BotPanel.tsx:39`).
 * Ver Decisão técnica DT-02.
 */
export const MONSTER_CLASSES = ['mammal'] as const;
export type MonsterClass = (typeof MONSTER_CLASSES)[number];

export const monsterSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  /**
   * A classe do monstro, para a Cyclopedia agrupar por categoria (SV-20). Vocabulário fechado
   * em `MONSTER_CLASSES` — ver o comentário dela. Ausente: o monstro só aparece em "Todas as
   * entradas" na tela (nenhuma categoria própria ainda).
   */
  class: z.enum(MONSTER_CLASSES).optional(),
  recommendedLevel: z.number().int().positive(),
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
   * O TIPO de dano do ataque do monstro (CMB-03). Ausente é `physical`, o default que preserva
   * o v1 — o rato morde, e mordida era dano físico. As abilities por tipo são do CMB-06.
   */
  damageType: z.enum(DAMAGE_TYPES).default('physical'),
  /**
   * O que o monstro RESISTE e ao que é IMUNE (CMB-03). Ausente é o monstro neutro, e o default
   * preserva o v1. É o lado do DEFENSOR: entra no resolver junto da armadura e do Dodge.
   */
  mitigation: mitigationSchema.default(() => ({ resistances: {}, immunities: [] })),
  /** Milissegundos entre ataques. Tempo decorrido, nunca contagem de tick (invariante 2). */
  attackIntervalMs: z.number().int().positive(),
  /**
   * Velocidade, na escala do Tibia (FUN-119, ADR 0025): o passo dura
   * `ceil50(chão × 1000 / speed)` ms, diagonal × 3. O rato do mapa real tem 172.
   */
  speed: z.number().int().positive(),
  /** Raio de agressão, em tiles. */
  aggroRadius: z.number().int().nonnegative(),
  /**
   * Até onde o monstro alcança para atacar, em tiles. `1` é corpo a corpo.
   *
   * Separado do raio de agressão de propósito: um monstro que persegue de longe e só bate
   * colado é comportamento diferente de um que atira à distância, e a diferença é conteúdo.
   */
  attackRange: z.number().int().positive().default(1),
  /** Raio a partir do qual ele desiste do alvo e volta ao posto. Zero = nunca desiste. */
  leashRadius: z.number().int().nonnegative().default(0),
  loot: lootTableSchema.default({ items: [] }),
  /**
   * As abilities declaradas (CMB-06, DT-01). AUSENTE (ou vazia) normaliza no boot para UMA
   * ability básica montada do `attack`/`attackIntervalMs`/`attackRange`/`damageType` — é o que
   * preserva o monstro legado bit a bit, e é o caminho do rato. Quando declaradas, o
   * `attack`/`attackIntervalMs`/`attackRange` acima continuam no arquivo, mas quem manda são
   * elas (o boot NÃO sintetiza a básica). O id `basic` é reservado ao boot.
   */
  abilities: z.array(monsterAbilitySchema).optional(),
});

/**
 * Os três tamanhos de pull do Huntera (FUN-123): Cauteloso, Ousado, Agressivo. O PRD tinha
 * quatro dificuldades; o produto copiou os três — ver `docs/product/hunt.md`, "Divergências".
 */
export const HUNT_DIFFICULTY_NAMES = ['cautious', 'bold', 'reckless'] as const;

export const huntDifficultySchema = z.object({
  /**
   * Quantos monstros a instância mantém vivos, NO TOTAL — o `monsterCount` do Huntera (2, 5
   * e 8 no bueiro), espalhado pelos pontos de spawn da rota (`Spawner`: o lugar `i` no ponto
   * `⌊i × pontos / total⌋`). Sem variação aleatória de densidade no MVP (§14.5).
   */
  monsterCount: z.number().int().positive(),
  composition: z.array(
    z.object({ monsterId: z.string().min(1), weight: z.number().positive() }),
  ).min(1),
  respawnDelayMs: z.number().int().positive(),
});

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
   * `partialRecord`, e não `record`: uma hunt define as dificuldades que fazem sentido para
   * ela, não obrigatoriamente as quatro. É o que o `refine` abaixo sempre disse — exigir ao
   * menos uma só faz sentido se nem todas forem obrigatórias.
   *
   * A distinção passou a ser explícita no zod 4, onde `record` com chave de enum virou
   * exaustivo. No zod 3 as duas se escreviam igual, e o comportamento era este.
   */
  difficulties: z.partialRecord(
    z.enum(HUNT_DIFFICULTY_NAMES),
    huntDifficultySchema,
  ).refine((d) => Object.keys(d).length > 0, 'a hunt precisa de ao menos uma dificuldade'),
  /**
   * Quanto tempo o cadáver de um monstro fica no chão, em milissegundos (FUN-123). Só visual:
   * o loot vai direto à caixa da sessão, e o cadáver some sozinho. Ausente é hunt sem
   * cadáver — o conteúdo de teste que não fala de arte.
   */
  corpseTtlMs: z.number().int().positive().optional(),
  /**
   * Contagem regressiva de saída da hunt em milissegundos (#360).
   * Ausente é saída imediata.
   */
  exitDelayMs: z.number().int().positive().optional(),
  /**
   * A menos de quantos tiles (Chebyshev) de um participante VIVO o monstro NÃO nasce (#236).
   * O lugar não é perdido — o spawn espera e tenta de novo (`SPAWN_RETRY_MS` do ruleset); a
   * densidade continua sendo a da dificuldade. `0` desliga, e é o default: o conteúdo de
   * teste que cabe numa sala de 4×3 continua nascendo em cima de quem está lá.
   */
  spawnClearRadius: z.number().int().nonnegative().default(0),
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

export const vocationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  healthPerLevel: z.number().int().nonnegative(),
  manaPerLevel: z.number().int().nonnegative(),
  capacityPerLevel: z.number().int().nonnegative(),
  /** A skill que escala as magias de ATAQUE desta vocação (#155, ADR 0026 d.5): `magic`, e `distance` no Paladin. */
  spellSkill: z.string().min(1).default('magic'),
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
   * Marcador de valor ainda não decidido no PRD. Palpite disfarçado de decisão é o que faz
   * ninguém lembrar de voltar — o carregador avisa no boot, e o `docs-check` conta.
   */
  _open: z.string().optional(),
});

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
   * Regeneração passiva, em pontos por segundo (FUN-36, FUN-68).
   *
   * Por SEGUNDO, e não por tick. Uma taxa de `r` por segundo vira um evento periódico de
   * `1000 / r` milissegundos na fila da sessão, que vence no instante exato — nada de somar
   * `taxa * dtMs / 1000` num acumulador fracionário, que derivava: `0,1` dez vezes em ponto
   * flutuante dá `0,9999…` e some uma unidade a cada dez. É o que faz a hunt desanexada a
   * 1 Hz regenerar exatamente o mesmo que a anexada a 10 Hz.
   */
  regen: z.object({
    healthPerSecond: z.number().nonnegative(),
    manaPerSecond: z.number().nonnegative(),
  }),
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
   * A curva de XP, como FÓRMULA e não como tabela: `base * level^exponent` é a XP para
   * completar aquele level.
   *
   * Tabela de 500 linhas seria mais expressiva e é o caminho errado aqui. A curva vai ser
   * rebalanceada muitas vezes, e rebalancear uma tabela é reescrever 500 linhas à mão — o que
   * na prática significa que ela nunca é rebalanceada. Dois números mudam a curva inteira, e
   * a forma continua legível para quem balanceia.
   */
  xp: z.object({
    base: z.number().positive(),
    exponent: z.number().positive(),
  }),
  /**
   * Penalidade de morte (§26.2). Mora aqui, junto da curva, porque ela é definida COMO
   * fração da curva — separar as duas é como as duas divergem numa rebalanceada.
   */
  deathPenalty: z.object({
    /** Fração da XP necessária para completar o level atual. §26.2: 60%. */
    fraction: z.number().min(0).max(1),
    /** A mesma fração para quem tem Premium. §26.2: 54%. */
    premiumFraction: z.number().min(0).max(1),
    /** Abaixo deste level a penalidade não derruba ninguém. §26.2: 8. */
    levelFloor: z.number().int().positive(),
  }),
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
 * Os perfis que o motor sabe executar. Perfil fora daqui derruba o boot, sem fallback: o
 * resolver não reinterpreta uma fórmula que não conhece (ADR 0031).
 */
export const COMBAT_PROFILES: ReadonlyMap<string, CombatCompatibilityProfile> =
  new Map([[COMBAT_V1.id, COMBAT_V1]]);

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
   * `physical` fica com o antigo `melee`; TODO tipo não-físico fica com o antigo `magic`.
   * O `z.record` de chave enum é EXAUSTIVO no zod 4: o conteúdo declara os oito tipos, sem
   * default em código — mudar a efetividade de um elemento é editar JSON, nunca lógica.
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
  _open: z.string().optional(),
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
  /** Teto, em milissegundos. §10: 24 horas. Aplicado na LEITURA, não só na escrita. */
  maxMs: z.number().int().positive(),
  /** Milissegundos recuperados por milissegundo fora de hunt. §10: 1:1. */
  recoveryRatio: z.number().positive(),
  _open: z.string().optional(),
});

export type Stamina = z.infer<typeof staminaSchema>;

/**
 * A party de hunt (§15, ADR 0027, #188): o teto de membros e o pool de XP por número de
 * VOCAÇÕES ÚNICAS entre os membros elegíveis — `pool% = min(100 + 25 × únicas, 200)` é como a
 * tabela foi preenchida, mas quem manda é a tabela. Indexada só por vocações únicas: o número
 * de membros não entra no pool, só na divisão (o PRD pedia as duas dimensões; a segunda seria
 * coluna repetida). Percentuais NÃO DECRESCENTES e uma chave para cada `1..maxMembers`.
 */
export const partySchema = z.object({
  id: z.literal('baseline'),
  maxMembers: z.number().int().min(2).max(8),
  xpPoolPercentByUniqueVocations: z.record(z.string().regex(/^[1-9]\d*$/), z.number().int().min(100)),
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
  _open: z.string().optional(),
}).superRefine((party, ctx) => {
  let previous = 0;
  for (let n = 1; n <= party.maxMembers; n++) {
    const percent = party.xpPoolPercentByUniqueVocations[String(n)];
    if (percent === undefined) {
      ctx.addIssue({ code: 'custom', message: `xpPoolPercentByUniqueVocations sem a chave "${String(n)}"` });
      return;
    }
    if (percent < previous) {
      ctx.addIssue({ code: 'custom', message: `xpPoolPercentByUniqueVocations["${String(n)}"] é menor que a anterior` });
      return;
    }
    previous = percent;
  }
}).transform((party): {
  id: 'baseline';
  maxMembers: number;
  xpPoolPercentByUniqueVocations: Record<string, number>;
  matchmakingLevelRange: number;
  autoSellItemTypes?: { free: number; premium: number } | undefined;
  _open?: string | undefined;
} => ({
  ...party,
  autoSellItemTypes: party.autoSellItemTypes ?? { free: 5, premium: 20 },
}));

export type PartyConfig = z.infer<typeof partySchema>;

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
   * INTEIRO, e é regra de forma que sustenta uma de conta: `Bestiary.applyXpBonus` faz
   * `floor(xp × (100 + p × marcos) / 100)` em inteiro, e a garantia de que o `floor` acerta
   * depende de `p × marcos` ser inteiro. Meio ponto percentual voltaria a pôr resíduo de
   * ponto flutuante na frente do arredondamento — a armadilha que a conta em inteiro evita.
   */
  xpBonusPercentPerMilestone: z.number().int().nonnegative(),
  _open: z.string().optional(),
});

export type Bestiary = z.infer<typeof bestiarySchema>;

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

/** 1–9, 0, F1–F12 = 22 teclas para 24 slots: `hotkey` é OPCIONAL por isso (DT-02). */
export const BOT_HOTKEYS = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '0',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
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

/** Os cinco tipos de condição da v2 (ADR 0032 d.2). */
export const BOT_CONDITION_KINDS_V2 = ['hp', 'mana', 'targets', 'target-hp', 'condition'] as const;
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
 */
export const botActionV2Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('spell'), spellId: z.string().min(1) }),
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
export const SECONDARY_GROUPS = ['stance', 'focus', 'great-beams', 'special'] as const;

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
  /** Cura `amount` a cada `intervalMs`, por `durationMs` (Recovery). */
  z.object({
    kind: z.literal('heal-over-time'),
    amount: z.number().int().positive(),
    intervalMs: z.number().int().positive(),
    durationMs: z.number().int().positive(),
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
  /** Velocidade +`speedPercent` % por `durationMs`; Swift Foot também baixa o dano causado. */
  z.object({
    kind: z.literal('haste'),
    speedPercent: z.number().int().positive(),
    durationMs: z.number().int().positive(),
    damageDealtPercent: damagePercentBySource.optional(),
  }),
  /** Postura (Protector, Blood Rage, Sharpshooter…): percentuais por `durationMs`. */
  z.object({
    kind: z.literal('buff'),
    durationMs: z.number().int().positive(),
    damageDealtPercent: damagePercentBySource.optional(),
    damageTakenPercent: z.number().int().optional(),
  }),
  /** Dano vira mana enquanto vale. */
  z.object({ kind: z.literal('mana-shield'), durationMs: z.number().int().positive() }),
]);
export type SpellEffect = z.infer<typeof spellEffectSchema>;

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
  manaCost: z.number().int().nonnegative(),
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
  _open: z.string().optional(),
});

export type Spell = z.infer<typeof spellSchema>;

/** O monstro como o ARQUIVO o descreve — sem aparência, que vive na tabela (FUN-94). */
export type MonsterDefinition = z.infer<typeof monsterSchema>;

/** O monstro pronto para uso, com o `outfitId` já resolvido por `buildContent`. */
export type Monster = Omit<MonsterDefinition, 'mitigation' | 'abilities'> & {
  readonly outfitId: number;
  /** A aparência do cadáver (FUN-123), quando a tabela tem uma. Ausente: não deixa cadáver. */
  readonly corpseAppearanceId?: number;
  /** A mitigação compilada (CMB-03): lookup por tipo e Set de imunidade. */
  readonly mitigation: CompiledMitigation;
  /**
   * As abilities JÁ NORMALIZADAS (CMB-06): nunca vazio — ausência vira a básica do boot. É o
   * que o `sim` lê, e é por isso que ele não conhece o par `attack`/`attackIntervalMs`.
   */
  readonly abilities: readonly MonsterAbility[];
};
export type MonsterAttack = MonsterDefinition['attack'];
export type HuntDifficultyName = (typeof HUNT_DIFFICULTY_NAMES)[number];

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
export type HuntDifficulty = z.infer<typeof huntDifficultySchema>;
export type Vocation = z.infer<typeof vocationSchema>;

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
    }),
  ).default([]),
});

export type TilemapData = z.infer<typeof tilemapSchema>;
/** O que se ESCREVE num arquivo de mapa — `floorChanges` opcional, antes do default. */
export type TilemapInput = z.input<typeof tilemapSchema>;
export type RouteData = z.infer<typeof routeSchema>;
export type Point = z.infer<typeof point>;
