// O plano da party de dragões (#526): quem são os quatro personagens, com que skills, que
// equipamento, que munição, que ouro e que bot cada um nasce. Puro — nenhuma função aqui toca
// rede ou banco; `dragon-party-seed.ts` e `dragon-party-runner.ts` é quem escreve.
//
// Os números de skill vêm da issue (Knight melee 105/shield 95/ML 10; Paladin distância 110/
// shield 90/ML 28; Sorcerer e Druid ML 90/shield 28) — o ponto de partida "level 200 realista"
// do PRD, não uma medição. O kit é o do #524 (level 200), e o bot usa só magia/supply que já
// existem no conteúdo desta branch — `botConfigFor` é conferido por `validateBotConfigV2` em
// `dragon-party-seed.ts` antes de qualquer escrita.

import {
  BOT_SET_COUNT, BOT_SLOTS_PER_SET, BOT_VOCABULARY_VERSION,
  botConfigV2Schema,
  type BotActionV2, type BotConditionV2, type BotConfigV2, type BotFollow, type BotRuleTarget,
  type Content, type Supply,
} from '@draconya/content';

export type DragonPartyVocation = 'knight' | 'paladin' | 'sorcerer' | 'druid';

export interface DragonPartyMemberPlan {
  readonly vocationId: DragonPartyVocation;
  readonly email: string;
  readonly characterName: string;
}

/** Nível alvo da semente: o total do Tibia para 200 vem de `totalXpForLevel` (sim), não daqui. */
export const DRAGON_PARTY_LEVEL = 200;

/**
 * Uma conta por personagem (#526): no máximo dois personagens ativos por conta
 * (`DEFAULT_ACTIVE_LIMIT`, `packages/server/src/directory.ts`), e o `start` da party emite um
 * ticket por membro — quatro contas evita esbarrar no teto com folga nenhuma.
 */
export const DRAGON_PARTY_MEMBERS: readonly DragonPartyMemberPlan[] = [
  { vocationId: 'knight', email: 'knight@draconya.test', characterName: 'Draco Knight' },
  { vocationId: 'paladin', email: 'paladin@draconya.test', characterName: 'Draco Paladin' },
  { vocationId: 'sorcerer', email: 'sorcerer@draconya.test', characterName: 'Draco Sorcerer' },
  { vocationId: 'druid', email: 'druid@draconya.test', characterName: 'Draco Druid' },
];

/** O Knight lidera a party e puxa a rota; os outros três seguem (`botConfig.follow`). */
export const DRAGON_PARTY_LEADER_VOCATION: DragonPartyVocation = 'knight';

export function leaderMember(): DragonPartyMemberPlan {
  const leader = DRAGON_PARTY_MEMBERS.find((member) => member.vocationId === DRAGON_PARTY_LEADER_VOCATION);
  if (leader === undefined) throw new Error('dragon-party: líder não está na lista de membros');
  return leader;
}

// --- skills (issue #526, skill ids do #521) ---------------------------------------------------

export interface SkillSeed {
  readonly level: number;
  readonly points: number;
}
export type SkillsSeed = Readonly<Record<string, SkillSeed>>;

const at = (level: number): SkillSeed => ({ level, points: 0 });

const SKILLS_BY_VOCATION: Readonly<Record<DragonPartyVocation, SkillsSeed>> = {
  knight: { melee: at(105), shielding: at(95), magic: at(10) },
  paladin: { distance: at(110), shielding: at(90), magic: at(28) },
  sorcerer: { magic: at(90), shielding: at(28) },
  druid: { magic: at(90), shielding: at(28) },
};

export function skillsFor(vocationId: DragonPartyVocation): SkillsSeed {
  return SKILLS_BY_VOCATION[vocationId];
}

// --- equipamento (kit level 200, #524) ----------------------------------------------------------

/**
 * Só os ids — o SLOT vem do catálogo (`resolveEquipment`), nunca duplicado à mão aqui: um par
 * id/slot divergente do item real é exatamente o tipo de erro que só aparece na hunt.
 */
const EQUIPMENT_ITEM_IDS_BY_VOCATION: Readonly<Record<DragonPartyVocation, readonly string[]>> = {
  knight: [
    'backpack', 'crusader-helmet', 'magic-plate-armor', 'knight-legs', 'boots-of-haste',
    'mastermind-shield', 'mystic-blade', 'dragon-necklace', 'might-ring',
  ],
  paladin: [
    'backpack', 'royal-helmet', 'paladin-armor', 'crown-legs', 'boots-of-haste',
    'royal-crossbow', 'dragon-necklace', 'might-ring',
  ],
  sorcerer: [
    'backpack', 'hat-of-the-mad', 'focus-cape', 'zaoan-legs', 'boots-of-haste',
    'wand-of-starstorm', 'spellbook-of-mind-control', 'dragon-necklace', 'might-ring',
  ],
  druid: [
    'backpack', 'hat-of-the-mad', 'focus-cape', 'zaoan-legs', 'boots-of-haste',
    'hailstorm-rod', 'spellbook-of-mind-control', 'dragon-necklace', 'might-ring',
  ],
};

export interface ResolvedEquipmentPiece {
  readonly itemId: string;
  readonly slot: string;
}

/** Resolve o slot de cada peça contra o conteúdo — lança com uma mensagem clara se o item ou o
 * slot faltar nesta branch (a preamble pode rodar antes do #524 estar integrado). */
export function resolveEquipment(
  content: Content, vocationId: DragonPartyVocation,
): readonly ResolvedEquipmentPiece[] {
  return EQUIPMENT_ITEM_IDS_BY_VOCATION[vocationId].map((itemId) => {
    const item = content.items.get(itemId);
    if (item === undefined) {
      throw new Error(`dragon-party: item "${itemId}" (${vocationId}) não existe no conteúdo desta branch`);
    }
    if (item.slot === undefined) {
      throw new Error(`dragon-party: item "${itemId}" (${vocationId}) não declara slot de equipamento`);
    }
    return { itemId, slot: item.slot };
  });
}

// --- munição (#151, ADR 0032 d.7) ---------------------------------------------------------------

/** Só o Paladin atira — a Royal Crossbow é `ammoFamily: 'bolt'` (#524). */
export function ammoFor(vocationId: DragonPartyVocation): Readonly<Record<string, string>> | null {
  return vocationId === 'paladin' ? { bolt: 'power-bolt' } : null;
}

// --- ouro para uma hora de suprimento -----------------------------------------------------------
//
// Suprimento é abstrato (ADR 0032 d.6): cada uso de poção/runa debita `price` do gold direto, e
// cada tiro debita o `price` da munição. Não há como calcular "o custo real de uma hora" sem
// medir uma hunt de verdade — os números abaixo são uma estimativa GROSSEIRA de teste local, não
// dado de balanceamento. O orçamento soma só o que o PRÓPRIO bot config desta vocação usa, para
// nunca divergir em silêncio do que o personagem realmente gasta.

/** Cadência de quem bebe/cura — uma vez a cada ~30 s, o "topar quando precisa" de sempre. */
const ESTIMATED_POTION_USES_PER_HOUR = 120;
const MS_PER_HOUR = 3_600_000;
const GOLD_SAFETY_MULTIPLIER = 1.25;

/**
 * Quantas vezes por hora este suprimento sai, na cadência que o PRÓPRIO conteúdo declara.
 *
 * Uma runa de grupo `attack` (Avalanche, por exemplo) NÃO bebe como poção — o schema é claro
 * sobre isso: "a runa de `attack` declara o [`groupCooldownMs`] dela para se alinhar às magias
 * de ataque" (`packages/content/src/schemas.ts`, comentário de `supplySchema.groupCooldownMs`).
 * Ela sai a cada golpe possível, não a cada "preciso curar" — tratar as duas cadências como uma
 * só subestimava o gasto de quem ataca com runa em várias vezes (Sorcerer/Druid nesta party).
 */
function usesPerHour(supply: Supply): number {
  if (supply.group === 'attack') return Math.floor(MS_PER_HOUR / supply.groupCooldownMs);
  return ESTIMATED_POTION_USES_PER_HOUR;
}

export function goldForOneHour(
  content: Content, config: BotConfigV2, ammo: Readonly<Record<string, string>> | null,
): number {
  let total = 0;
  for (const set of config.sets) {
    for (const slot of set.slots) {
      if (slot === null || slot.do.kind !== 'supply') continue;
      const supply = content.supplies.get(slot.do.supplyId);
      if (supply !== undefined) total += supply.price * usesPerHour(supply);
    }
  }
  if (ammo !== null) {
    const shotsPerHour = Math.floor(MS_PER_HOUR / content.combat.player.attackIntervalMs);
    for (const itemId of Object.values(ammo)) {
      const ammunition = content.ammunition.get(itemId);
      if (ammunition !== undefined) total += ammunition.price * shotsPerHour;
    }
  }
  return Math.ceil((total * GOLD_SAFETY_MULTIPLIER) / 100) * 100;
}

// --- bot config v2 (AB-03) -----------------------------------------------------------------------

interface SlotInput {
  readonly do: BotActionV2;
  readonly when: readonly BotConditionV2[];
  readonly target?: BotRuleTarget;
}

function spell(spellId: string, when: readonly BotConditionV2[], target?: BotRuleTarget): SlotInput {
  return target === undefined
    ? { do: { kind: 'spell', spellId }, when }
    : { do: { kind: 'spell', spellId }, when, target };
}

function supply(supplyId: string, when: readonly BotConditionV2[]): SlotInput {
  return { do: { kind: 'supply', supplyId }, when };
}

/** Recasta assim que o efeito de haste cai — o mesmo `utito tempo`/`utani hur` do Tibia. */
function haste(spellId: string): SlotInput {
  return spell(spellId, [{ kind: 'condition', conditionId: 'haste', present: false }]);
}

function hpBelow(percent: number): BotConditionV2 {
  return { kind: 'hp', op: '<=', percent };
}
function manaBelow(percent: number): BotConditionV2 {
  return { kind: 'mana', op: '<=', percent };
}
function targetsAtLeast(count: number): BotConditionV2 {
  return { kind: 'targets', op: '>=', count };
}

/**
 * Um slot por magia da lista que EXISTE no conteúdo desta branch, do mais forte pro mais barato,
 * todos com a mesma condição.
 *
 * Não precisa de limiar de mana escrito à mão: `#perform` (`packages/sim/src/rulesets/hunt.ts`)
 * já cai para o PRÓXIMO slot do mesmo ciclo quando o de cima está em cooldown ou sem mana
 * (`recusa por COOLDOWN carrega prazo; as outras ENGATILHAM` — a recusa por mana não tranca
 * nada, só passa para a próxima regra elegível). Listar do mais forte pro mais fraco monta a
 * rotação sozinho: o personagem lança o melhor que consegue pagar naquele instante.
 *
 * Filtra contra `content.spells` em vez de presumir que a lista inteira existe — uma branch que
 * ainda não integrou a magia mais nova (ex.: Fierce Berserk, #523) perde só aquele degrau da
 * rotação, não o bot inteiro.
 */
function spellCascade(
  content: Content, candidates: readonly string[], when: readonly BotConditionV2[],
): SlotInput[] {
  return candidates.filter((id) => content.spells.has(id)).map((id) => spell(id, when));
}

function padSlots(filled: readonly SlotInput[]): (SlotInput | null)[] {
  if (filled.length > BOT_SLOTS_PER_SET) {
    throw new Error(`dragon-party: ${filled.length} regras não cabem nos ${BOT_SLOTS_PER_SET} slots do conjunto`);
  }
  const slots: (SlotInput | null)[] = [...filled];
  while (slots.length < BOT_SLOTS_PER_SET) slots.push(null);
  return slots;
}

const EMPTY_SET = { slots: padSlots([]) };

/**
 * Monta a v2 inteira via `botConfigV2Schema.parse` — cada campo omitido cai no default do
 * schema (`activeSet: 0`, `stance: 'balanced'`, `targeting: nearest/stand`), em vez de repetido
 * à mão aqui. `exit: [hp-below 10%]` é rede de segurança: o teste é local e não presenciado boa
 * parte do tempo (invariante 3/11), e sem uma saída o personagem fica na hunt até morrer.
 */
function buildConfig(follow: BotFollow, primarySlots: readonly SlotInput[]): BotConfigV2 {
  const sets = Array.from({ length: BOT_SET_COUNT }, (_unused, index) => (
    index === 0 ? { slots: padSlots(primarySlots) } : EMPTY_SET
  ));
  const raw: unknown = {
    version: BOT_VOCABULARY_VERSION,
    follow,
    exit: [{ kind: 'hp-below', percent: 10 }],
    sets,
  };
  return botConfigV2Schema.parse(raw);
}

/**
 * A prioridade dentro de cada conjunto é a ORDEM do slot (content/AGENTS.md, "A barra v2 usa a
 * ORDEM do slot"): cura vem antes de poção, poção antes de buff, buff antes de ataque — a
 * primeira regra cujo `when` bate é a que executa naquele ciclo.
 *
 * Contra o dragão (issue #526): fogo é IMUNE, gelo é FRAQUEZA (−10 %), energia resiste 20 %,
 * terra resiste 80 %. Isso risca Hell's Core (fogo) do Sorcerer e Terra Wave/Wrath of Nature
 * (terra) do Druid — dano zero ou quase — e deixa a Avalanche Rune (gelo, sem restrição de
 * vocação) como o ataque de base dos dois; Rage of the Skies (energia) e Eternal Winter (gelo,
 * a própria fraqueza) entram como o nuke de área para grupo grande, um por vocação porque só o
 * Druid tem magia de gelo de área no catálogo.
 *
 * `mass-healing` do Druid dispara pelo HP do PRÓPRIO Druid, não por "dois ou mais feridos": o
 * vocabulário do bot (`botConditionSchema`, packages/content/src/schemas.ts) não tem condição de
 * contagem de feridos na party — só `hp`/`mana` do lançador ou do candidato resolvido por
 * `target`, `targets`/`target-hp` do monstro, e `condition` de efeito ativo. Como o Druid está no
 * meio do mesmo respiro de área que fere o resto da party, o HP dele é o proxy disponível; um
 * vocabulário com contagem de feridos é trabalho de bot, fora do escopo desta issue.
 */
export function botConfigFor(content: Content, vocationId: DragonPartyVocation): BotConfigV2 {
  switch (vocationId) {
    case 'knight':
      // Knight puxa a rota (não segue ninguém). Rotação de ataque do mais forte pro mais barato:
      // exori gran (Fierce Berserk, #523) → exori min (Front Sweep) → exori (Berserk) → exori
      // ico (Whirlwind Throw) como filler barato de mana. `spellCascade` já cai para o próximo
      // degrau sozinho quando o de cima está em cooldown ou sem mana.
      return buildConfig({ kind: 'none' }, [
        supply('supreme-health-potion', [hpBelow(60)]),
        // Strong Mana Potion (Canary `potions.lua`, item 237: nível 50, sem restrição de
        // vocação — ao contrário das outras três poções de mana do kit, que são só
        // Sorcerer/Druid ou Paladin) é a ÚNICA poção de mana que o Knight pode beber. Sem ela, a
        // rotação inteira de magia dele (#527, achado na QA do M28: mana zerou em 3/1050 e o
        // Knight parou de lançar) depende de nunca gastar mais mana do que a regeneração
        // repõe — falso a partir do segundo Fierce Berserk.
        supply('strong-mana-potion', [manaBelow(40)]),
        haste('haste-knight'),
        ...spellCascade(
          content, ['fierce-berserk', 'front-sweep', 'berserk', 'whirlwind-throw'],
          [targetsAtLeast(1)],
        ),
      ]);
    case 'paladin':
      return buildConfig({ kind: 'leader' }, [
        supply('ultimate-spirit-potion', [hpBelow(60)]),
        haste('haste-paladin'),
        // exevo mas san (Divine Caldera, área) quando há gente o bastante para valer o mana;
        // senão, alvo único do mais forte pro mais barato: exori gran con (Strong Ethereal
        // Spear, #523) → exori san (Divine Missile) → exori con (Ethereal Spear).
        ...spellCascade(content, ['divine-caldera'], [targetsAtLeast(3)]),
        ...spellCascade(
          content, ['strong-ethereal-spear', 'divine-missile', 'ethereal-spear'],
          [targetsAtLeast(1)],
        ),
      ]);
    case 'sorcerer':
      return buildConfig({ kind: 'leader' }, [
        supply('ultimate-mana-potion', [manaBelow(40)]),
        supply('health-potion', [hpBelow(30)]),
        haste('haste-sorcerer'),
        spell('ultimate-healing-sorcerer', [hpBelow(60)]),
        // Rage of the Skies (energia) para grupo grande — não Hell's Core: fogo não faz nada no
        // dragão. Avalanche (gelo) é o ataque de base: o Sorcerer não tem magia de gelo própria
        // no catálogo, só a runa.
        ...spellCascade(content, ['rage-of-the-skies'], [targetsAtLeast(4)]),
        supply('avalanche-rune', [targetsAtLeast(1)]),
      ]);
    case 'druid':
      return buildConfig({ kind: 'leader' }, [
        // Heal Friend no membro mais ferido da party.
        spell('heal-friend-druid', [hpBelow(70)], { kind: 'lowest-hp-member' }),
        spell('mass-healing', [hpBelow(70)]),
        supply('ultimate-mana-potion', [manaBelow(40)]),
        supply('health-potion', [hpBelow(30)]),
        haste('haste-druid'),
        // Eternal Winter (gelo) para grupo grande — a própria fraqueza do dragão, e o único nuke
        // de área do Druid que não é terra (Terra Wave/Wrath of Nature ficam de fora: 80 % de
        // resistência). Avalanche (gelo) é o ataque de base.
        ...spellCascade(content, ['eternal-winter'], [targetsAtLeast(4)]),
        supply('avalanche-rune', [targetsAtLeast(1)]),
      ]);
  }
}
