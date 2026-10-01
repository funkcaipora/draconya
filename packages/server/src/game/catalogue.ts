// O catálogo que o cliente recebe: o que existe para jogar e para configurar (FUN-79, FUN-89).
//
// **Uma mensagem, e não duas.** A seleção de hunt e a UI do bot perguntam a mesma coisa — "o que
// este servidor tem" —, chegam no mesmo instante e mudam pela mesma razão: a versão de conteúdo,
// que é fixada na sessão (invariante 7). Separar daria dois pacotes que nunca aparecem um sem o
// outro.
//
// **A tela do bot não tem lista de opções em código.** O que ela oferece é o que este arquivo
// diz que existe — se as duas divergirem, o jogador configura o que o bot recusa, e descobre isso
// pelo extrato que não fecha em vez de por uma mensagem de erro.
//
// **O que entra desde o ADR 0033: os números de EXIBIÇÃO** — cooldown, área, alcance, tipo de
// dano, Base Power ou fixo, duração, descrição. O `ActionConfigModal` do cliente Tibia (a régua
// da imagem, #435) mostra esses números; sem eles o jogador configura a barra às cegas e
// descobre o efeito pelo extrato. Mostrar a faixa de dano que o servidor vai sortear não dá ao
// cliente nada que fabrique resultado — o servidor continua rolando e continua sendo o único que
// escreve vida, mana e gold (invariante 4).
//
// **O que continua fora: o que DECIDE.** Elegibilidade, cooldown corrente e estoque vêm de
// `slot-state`, nunca daqui — o catálogo é conteúdo fixado na sessão (invariante 7), e essas três
// coisas mudam a cada golpe.

import type { S2CProps } from '@draconya/protocol';
import type { Content, Spell, Supply } from '@draconya/content';
import {
  BOT_AUTOMATION_CATALOGUE, BOT_HOTKEYS, BOT_SET_COUNT, BOT_SET_NAMES, BOT_SLOTS_PER_SET,
  manaCostDisplayOf,
} from '@draconya/content';
import { DEFAULT_DIFFICULTY_NAME, huntListings } from '@draconya/sim';

export type Catalogue = S2CProps<'catalogue'>;

type EffectDetail = NonNullable<Catalogue['bot']['spells'][number]['detail']>;

/**
 * O detalhe de exibição de um efeito (ADR 0033): só os campos que o `kind` tem. `power`/
 * `amount`/`basePower` são exclusivos por construção (`buildContent` confere), então no máximo
 * um deles aparece.
 */
function detailOf(effect: Spell['effect'] | Supply['effect']): EffectDetail {
  const detail: { -readonly [K in keyof EffectDetail]: EffectDetail[K] } = {};
  if ('range' in effect && effect.range !== undefined) detail.range = effect.range;
  if ('area' in effect && effect.area !== undefined) detail.area = effect.area;
  if ('damageType' in effect) detail.damageType = effect.damageType;
  if ('basePower' in effect && effect.basePower !== undefined) detail.basePower = effect.basePower;
  if ('power' in effect && effect.power !== undefined) detail.power = effect.power;
  if ('amount' in effect) detail.amount = effect.amount;
  // A faixa fixa da poção do Tibia (#524, kit level 200) — `amount` sorteado, não escalado por
  // level/ML; e a mana da poção de espírito, reposta no MESMO uso. Só `supply.effect.heal` tem
  // os dois; `'in'` estreita por construção, como todo campo acima.
  if ('amountRange' in effect && effect.amountRange !== undefined) detail.amountRange = effect.amountRange;
  if ('alsoMana' in effect && effect.alsoMana !== undefined) detail.alsoMana = effect.alsoMana;
  if ('intervalMs' in effect) detail.intervalMs = effect.intervalMs;
  if ('durationMs' in effect) detail.durationMs = effect.durationMs;
  if ('speedPercent' in effect) detail.speedPercent = effect.speedPercent;
  return detail;
}

/**
 * Monta o catálogo UMA vez, no boot.
 *
 * A versão de conteúdo é fixada e não muda enquanto o processo vive, então recalcular por
 * conexão seria refazer o mesmo trabalho para todo mundo que entra.
 */
export function buildCatalogue(content: Content): Catalogue {
  return {
    hunts: huntListings(content).map((hunt) => ({
      id: hunt.id,
      name: hunt.name,
      recommendedLevel: hunt.recommendedLevel,
      // Cópia mutável: `HuntListing` traz a união fechada e `readonly`, e a mensagem leva
      // `string` — quem define quais dificuldades existem é o conteúdo, não o protocolo.
      difficulties: [...hunt.difficulties],
      ...(hunt.description === undefined ? {} : { description: hunt.description }),
      difficultyDetails: difficultyDetailsOf(content, hunt.id),
      outfitIds: monsterOutfitsOf(content, hunt.id),
      lootDrops: lootDropsOf(content, hunt.id),
      monsters: monstersOf(content, hunt.id),
      loot: lootOf(content, hunt.id),
    })),
    bot: {
      vocabularyVersion: content.bot.vocabularyVersion,
      setCount: BOT_SET_COUNT,
      slotsPerSet: BOT_SLOTS_PER_SET,
      setNames: [...BOT_SET_NAMES],
      hotkeys: [...BOT_HOTKEYS],
      groups: groupsOf(content),
      spells: [...content.spells.values()].map((spell) => ({
        id: spell.id,
        name: spell.name,
        // O ANUNCIADO (#588): o custo escalado pela party depende de quem está no alcance no
        // instante do cast, e só a sessão sabe isso — o catálogo é conteúdo fixado (invariante
        // 7) e mostra o `base`, como o grimório do Tibia sempre mostrou.
        manaCost: manaCostDisplayOf(spell.manaCost),
        minLevel: spell.minLevel,
        // O preço de aprender (#624, ADR 0058 d.3): ausente é "ninguém a ensina" — a tela não
        // oferece a compra. `0` é de graça, e por isso a checagem é `undefined`, nunca truthy.
        ...(spell.learnPrice === undefined ? {} : { learnPrice: spell.learnPrice }),
        // `null` e não ausente: a tela precisa distinguir "qualquer um lança" de "o servidor
        // não disse", e campo opcional colapsa os dois no mesmo `undefined`.
        vocationId: spell.vocationId ?? null,
        // Só o `kind`: é o que separa em qual categoria a magia cabe. O detalhe (dano, cura,
        // alcance…) vem em `detail`, resolvido por `detailOf`.
        effect: spell.effect.kind,
        // O grupo (#155): a tela mostra ao lado do nome.
        group: spell.group ?? 'attack',
        // Find Person (#623) precisa de MIRA: o "nome" do Canary é o personagem clicado, e o
        // servidor não tem como adivinhar quem. É o campo `aim`, e NÃO `targets: 'friend'`: este
        // também abre o seletor de alvo do editor de slot do bot (`acceptsFriend`), e a validação
        // do bot recusa salvar alvo que não seja de cura/mana. Só a barra de ação lê `aim`, para
        // armar a mira do `use-slot` (ADR 0049 d.2). Só ela declara.
        ...(spell.effect.kind === 'find' && spell.effect.target === 'person'
          ? { aim: 'character' as const } : {}),
        // Os números de EXIBIÇÃO (ADR 0033): cooldown, grupo, descrição e o detalhe do efeito.
        cooldownMs: spell.cooldownMs,
        ...(spell.groupCooldownMs === undefined ? {} : { groupCooldownMs: spell.groupCooldownMs }),
        ...(spell.description === undefined ? {} : { description: spell.description }),
        detail: detailOf(spell.effect),
      })),
      /**
       * Os suprimentos abstratos (§20.1, ADR 0026 d.3): poção e runa NÃO são itens — usar debita
       * gold. O `price` e o `group` são o que a tela mostra para escolher; o detalhe (ADR 0033)
       * é o mesmo mecanismo da magia.
       */
      supplies: [...content.supplies.values()].map((supply) => ({
        id: supply.id,
        name: supply.name,
        price: supply.price,
        effect: supply.effect.kind,
        group: supply.group,
        requires: {
          ...(supply.requires.level === undefined ? {} : { level: supply.requires.level }),
          ...(supply.requires.magicLevel === undefined
            ? {}
            : { magicLevel: supply.requires.magicLevel }),
        },
        // A vocação (#524, kit level 200): `null` — e não ausente — quando o suprimento não
        // exige nenhuma, como `spell.vocationId` já faz acima. Sem isto a tela do bot oferece a
        // Strong Health Potion (Knight/Paladin) para um Sorcerer configurar, e o servidor recusa
        // TODO uso em silêncio — o defeito que o cabeçalho deste arquivo descreve.
        vocationId: supply.requires.vocationId ?? null,
        groupCooldownMs: supply.groupCooldownMs,
        ...(supply.description === undefined ? {} : { description: supply.description }),
        detail: detailOf(supply.effect),
      })),
      // Os cinco modelos de automação e os parâmetros de cada um (AB-12), do descritor do
      // conteúdo. A engine é dona do mecanismo; o conteúdo, dos rótulos.
      automations: BOT_AUTOMATION_CATALOGUE.map((descriptor) => ({
        model: descriptor.model,
        label: descriptor.label,
        params: descriptor.params.map((param) => ({ name: param.name, kind: param.kind })),
      })),
      // Os coeficientes da conversão do Base Power (ADR 0033; ADR 0026 d.5), para o cliente
      // MOSTRAR a faixa "min~max" — a rolagem de verdade continua só no servidor.
      spellPower: content.combat.spellPower,
    },
    // As DEFINIÇÕES, uma vez cada. Atributo base é fixo (§21.2): duas espadas do mesmo id são
    // idênticas, então repetir nome e peso por instância mandaria o mesmo texto dezenas de
    // vezes a cada loot.
    items: [...content.items.values()].map((item) => ({
      id: item.id,
      name: item.name,
      appearanceId: item.appearanceId,
      // A forma ativa no slot vestido (#689): o Energy Ring ligado. Só quando a tabela a tem.
      ...(item.equippedAppearanceId === undefined ? {} : { equippedAppearanceId: item.equippedAppearanceId }),
      weight: item.weight,
      // `null` e não ausente: "não veste em lugar nenhum" é uma informação, e campo opcional
      // a confundiria com "o servidor não disse".
      slot: item.slot ?? null,
      twoHanded: item.twoHanded,
      // Valor de venda ao NPC, ataque e armadura (#337).
      value: item.value,
      attack: item.attack,
      armor: item.armor,
      // O tipo (AB-09): o editor de ação do AB-11 filtra consumível por aqui.
      kind: item.kind,
      // O rótulo curto da barra/Mochila (AB-13), só quando o conteúdo o declara.
      ...(item.shortLabel === undefined ? {} : { shortLabel: item.shortLabel }),
      // Como a arma bate (#152): tipo, alcance e família — para o tooltip. Mana por golpe e
      // faixa de dano ficam de fora: balanceamento (invariante 4).
      ...(item.weapon === undefined
        ? {}
        : {
          weapon: {
            kind: item.weapon.kind,
            range: item.weapon.range,
            ...(item.weapon.ammoFamily === undefined ? {} : { ammoFamily: item.weapon.ammoFamily }),
          },
        }),
    })),
    /**
     * A munição abstrata (#152, ADR 0026 d.3): o seletor no slot do escudo lista a família do
     * bow, com o preço por tiro e o `appearanceId` do ícone. `attack` é o único número de
     * balanceamento aqui, pela mesma razão do preço do supply: é o que o jogador olha.
     */
    ammunition: [...content.ammunition.values()].map((ammo) => ({
      id: ammo.id,
      name: ammo.name,
      family: ammo.family,
      attack: ammo.attack,
      price: ammo.price,
      appearanceId: ammo.appearanceId,
      requires: {
        ...(ammo.requires.level === undefined ? {} : { level: ammo.requires.level }),
      },
    })),
    // As vocações e o level da escolha (#154): o diálogo do level 8 lê daqui — a tela não
    // pode ter o 8 em código. Só os ganhos e a arma inicial (id de item); nada de fórmula.
    //
    // A arma de EXIBIÇÃO (#496) sai do kit quando é ele quem concede — o campo legado
    // `startingWeaponItemId` sobrevive como fallback do conteúdo de teste. A vocação sem
    // arma nenhuma (conteúdo de teste) fica de fora: sem arma não há o que escolher.
    vocations: [...content.vocations.values()]
      .map((vocation) => {
        const kitWeapon = vocation.startingKit
          .map((piece) => content.items.get(piece.itemId))
          .find((item) => item?.kind === 'weapon' && item.slot === 'hand');
        const weaponItemId = vocation.startingWeaponItemId ?? kitWeapon?.id;
        if (weaponItemId === undefined) return null;
        return {
          id: vocation.id,
          name: vocation.name,
          healthPerLevel: vocation.healthPerLevel,
          manaPerLevel: vocation.manaPerLevel,
          capacityPerLevel: vocation.capacityPerLevel,
          startingWeaponItemId: weaponItemId,
          // A promoção (#566, ADR 0042 decisão 1): nome, level e preço, para a tela de serviço
          // da Cidade — o mesmo motivo de `startingWeaponItemId` ir para o diálogo do level 8.
          ...(vocation.promotion === undefined ? {} : {
            promotion: {
              name: vocation.promotion.name,
              minLevel: vocation.promotion.minLevel,
              price: vocation.promotion.price,
            },
          }),
        };
      })
      .filter((vocation) => vocation !== null),
    vocationLevel: content.progression.vocationLevel,
    progression: {
      startingSpeed: content.progression.startingSpeed,
      speedPerLevel: content.progression.speedPerLevel,
      // O conteúdo guarda PULSOS (#678, `amount` a cada `ticksMs`); o contrato de protocolo segue
      // em pontos por segundo, derivado aqui — o cliente não lê o campo, e mudá-lo seria mudança
      // sem consumidor.
      regen: {
        healthPerSecond: (content.progression.regen.health.amount * 1000) / content.progression.regen.health.ticksMs,
        manaPerSecond: (content.progression.regen.mana.amount * 1000) / content.progression.regen.mana.ticksMs,
      },
    },
    // As sete bênçãos PvE (#570, ADR 0052): ausente sem catálogo/preço no conteúdo — a tela de
    // compra da Cidade não aparece, como `bestiary` some sem marco (mesma degradação de sempre).
    ...(content.blessings.size === 0 || content.progression.blessingPricing === undefined
      ? {}
      : {
        blessings: {
          list: [...content.blessings.values()]
            .map((blessing) => ({
              id: blessing.id, name: blessing.name, order: blessing.order, enhanced: blessing.enhanced,
            }))
            .sort((a, b) => a.order - b.order),
          pricing: content.progression.blessingPricing,
        },
      }),
    // Os monstros que existem, para a tela do Bestiário ter nome onde o contador tem id
    // (FUN-113). Vida e XP para o detalhe (SV-02, #338). Em ordem de id para a mensagem ser a
    // mesma a cada boot: a arte chega pelo `creature-appear`, e o resto é balanceamento que o
    // cliente não simula (invariante 4).
    monsters: [...content.monsters.values()]
      .map((monster) => {
        const bestiaryEntry = content.bestiary?.entries[monster.id];
        return {
          id: monster.id,
          name: monster.name,
          ...(monster.class !== undefined ? { class: monster.class } : {}),
          health: monster.health,
          experience: monster.experience,
          // A ficha do Canary (#601, ADR 0053 d.1): estágio e pontos são DERIVADOS no cliente a
          // partir destes limiares e do contador de `bestiary.counts` — não calculados aqui.
          ...(bestiaryEntry === undefined
            ? {}
            : {
              bestiary: {
                stars: bestiaryEntry.stars,
                occurrence: bestiaryEntry.occurrence,
                firstUnlock: bestiaryEntry.firstUnlock,
                secondUnlock: bestiaryEntry.secondUnlock,
                toKill: bestiaryEntry.toKill,
                charmsPoints: bestiaryEntry.charmsPoints,
              },
            }),
          // O boss no Bosstiary (#629): a raridade escolhe a linha da tabela de níveis abaixo, e o
          // `raceId` é a chave do contador de abates — nível e pontos são DERIVADOS no cliente.
          ...(monster.bosstiary === undefined
            ? {}
            : { bosstiary: { rarity: monster.bosstiary.rarity, raceId: monster.bosstiary.raceId } }),
        };
      })
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    // Os marcos e o bônus por marco, do conteúdo fixado na sessão (invariante 7). A chave só
    // existe quando o conteúdo tem Bestiário: ausente, a tela mostra só a contagem — e é o
    // conteúdo de teste, que não fala de progressão permanente. Só os dois campos: `id` e
    // `_open` são assunto do carregador, não do cliente.
    ...(content.bestiary === undefined
      ? {}
      : {
        bestiary: {
          milestones: [...content.bestiary.milestones],
          xpBonusPercentPerMilestone: content.bestiary.xpBonusPercentPerMilestone,
        },
      }),
    // Os níveis do Bosstiary por raridade (#629), do conteúdo fixado na sessão (invariante 7). A
    // chave só existe quando o conteúdo tem a tabela: ausente, a tela mostra só a contagem de
    // abates — o conteúdo de teste, que não fala de progressão permanente. Só `levels`: `id`,
    // `source` e `_open` são assunto do carregador.
    ...(content.bosstiary === undefined
      ? {}
      : {
        bosstiary: {
          levels: {
            bane: content.bosstiary.levels.bane.map((level) => ({ ...level })),
            archfoe: content.bosstiary.levels.archfoe.map((level) => ({ ...level })),
            nemesis: content.bosstiary.levels.nemesis.map((level) => ({ ...level })),
          },
        },
      }),
    // Os 25 Charms do Canary (M39-02, #602, ADR 0053 d.3), do conteúdo fixado na sessão
    // (invariante 7) — nome, categoria, tipo, elemento e custo/chance por tier, para a tela
    // do Cyclopedia mostrar ANTES de desbloquear. Em ordem de id, pela mesma razão de `monsters`.
    charms: [...content.charms.values()]
      .map((charm) => ({
        id: charm.id,
        name: charm.name,
        category: charm.category,
        type: charm.type,
        ...(charm.damageType === undefined ? {} : { damageType: charm.damageType }),
        ...(charm.percent === undefined ? {} : { percent: charm.percent }),
        chance: charm.chance,
        points: charm.points,
      }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}

/**
 * Os grupos de cooldown do conteúdo (AB-09, ADR 0032 d.2): a união de `spell.group` e
 * `supply.group`, em ordem estável. É o vocabulário que o editor do AB-11 oferece, e é o que o
 * motor de grupos usa para priorizar dentro de cada livro.
 */
function groupsOf(content: Content): string[] {
  const groups = new Set<string>();
  for (const spell of content.spells.values()) {
    if (spell.group !== undefined) groups.add(spell.group);
  }
  for (const supply of content.supplies.values()) {
    groups.add(supply.group);
  }
  return [...groups].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Todo `monsterId` que os pontos de spawn da rota desta hunt citam (#583, ADR 0039) — direto
 * (`monsterId`) ou entre os candidatos com peso (`monsters`, #582). Substitui a antiga leitura
 * de `Object.values(hunt.difficulties).composition`, removida junto do pull por dificuldade:
 * quem decide o monstro de uma hunt agora é a ROTA, nunca mais a dificuldade.
 */
function huntMonsterIdsOf(content: Content, huntId: string): readonly string[] {
  const hunt = content.hunts.get(huntId);
  if (hunt === undefined) return [];
  const route = content.routes.get(hunt.routeId);
  if (route === undefined) return [];
  const ids = new Set<string>();
  for (const point of route.spawnPoints) {
    if (point.monsterId !== undefined) ids.add(point.monsterId);
    for (const candidate of point.monsters ?? []) ids.add(candidate.monsterId);
  }
  return [...ids];
}

function monstersOf(content: Content, huntId: string): Array<{ id: string; name: string }> {
  const found = new Map<string, string>();
  for (const monsterId of huntMonsterIdsOf(content, huntId)) {
    const monster = content.monsters.get(monsterId);
    if (monster !== undefined) found.set(monster.id, monster.name);
  }
  return [...found.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function lootOf(content: Content, huntId: string): Array<{ itemId: string; name: string }> {
  const found = new Map<string, string>();
  for (const monsterId of huntMonsterIdsOf(content, huntId)) {
    const loot = content.monsters.get(monsterId)?.loot;
    if (loot === undefined) continue;
    for (const item of loot.items) {
      if (item.chance <= 0) continue;
      // Loot de supply (#520) não tem `itemId` — não é item físico, e esta lista é só do
      // catálogo de item (FUN-76). Fica fora da vitrine da hunt por enquanto; ver o `_open`
      // de `CharacterState.supplyStock`.
      if (item.itemId === undefined) continue;
      const definition = content.items.get(item.itemId);
      if (definition !== undefined) found.set(item.itemId, definition.name);
    }
  }
  return [...found.entries()]
    .map(([itemId, name]) => ({ itemId, name }))
    .sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
}

/**
 * Os outfits de todo monstro que pode nascer nesta hunt, em qualquer dificuldade (FUN-112).
 *
 * Únicos e em ordem, para a mensagem ser a mesma a cada boot: é o que o cliente aquece na
 * Cidade, e um id repetido seria uma folha pedida duas vezes. Vem do conteúdo fixado na
 * sessão (invariante 7) — o `outfitId` já resolvido pela tabela de aparências (FUN-94).
 */
/**
 * Quantos drops distintos a hunt tem (FUN-123): gold conta um se algum monstro dela solta, e
 * cada item distinto conta um — é o "2 drops de loot" que o Huntera mostra na Rat Cellars
 * (gold e queijo). Só o NÚMERO: a lista de loot possível é da tela de detalhe, que não existe.
 */
function lootDropsOf(content: Content, huntId: string): number {
  const items = new Set<string>();
  let gold = false;
  for (const monsterId of huntMonsterIdsOf(content, huntId)) {
    const loot = content.monsters.get(monsterId)?.loot;
    if (loot === undefined) continue;
    if (loot.gold !== undefined && loot.gold.chance > 0) gold = true;
    // Supply (#520) não conta aqui — mesma razão de `lootOf`, acima.
    for (const item of loot.items) {
      if (item.chance > 0 && item.itemId !== undefined) items.add(item.itemId);
    }
  }
  return items.size + (gold ? 1 : 0);
}

function monsterOutfitsOf(content: Content, huntId: string): number[] {
  const outfits = new Set<number>();
  for (const monsterId of huntMonsterIdsOf(content, huntId)) {
    const outfit = content.monsters.get(monsterId)?.outfitId;
    if (outfit !== undefined) outfits.add(outfit);
  }
  return [...outfits].sort((a, b) => a - b);
}

/**
 * Quantos monstros a hunt mantém vivos, NO TOTAL — antes do #583 era por dificuldade
 * (`huntDifficultySchema.monsterCount`, o "Ousado · 4" do Huntera); sem pull nenhum, o total é
 * simplesmente quantos pontos de spawn a rota tem, porque todos nascem (ADR 0039). Só existe
 * UM nome agora (`DEFAULT_DIFFICULTY_NAME`), a mesma fonte que `huntListings` usa para
 * `difficulties` (`packages/sim/src/hunt/catalogue.ts`) — o campo sobrevive no protocolo só
 * por compatibilidade (#584).
 */
function difficultyDetailsOf(content: Content, huntId: string): { id: string; monsterCount: number }[] {
  const hunt = content.hunts.get(huntId);
  if (hunt === undefined) return [];
  const route = content.routes.get(hunt.routeId);
  const details: { id: string; monsterCount: number }[] = [
    { id: DEFAULT_DIFFICULTY_NAME, monsterCount: route?.spawnPoints.length ?? 0 },
  ];
  return details;
}

