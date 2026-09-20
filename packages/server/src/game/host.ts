// Hospedagem de sessões num nó de jogo (FUN-13).
//
// O modelo inteiro está na relação entre estas duas coisas:
//
//   sessão      vive aqui, avança sozinha, sobrevive ao socket e ao restart
//   visualizador  um socket olhando uma sessão; entra e sai sem consequência nenhuma
//
// Se desanexar encerrar, pausar, creditar ou zerar qualquer coisa, o modelo está errado —
// é o ADR 0001 em uma frase, e é o teste que define esta issue.
//
// A `Session` do `sim` guarda só IDS de visualizador, porque ela não pode conhecer socket
// (invariante 1). Os objetos ficam aqui. A ponte entre os dois é `session.attached`, que é o
// que decide a taxa de tick — a sessão sabe SE alguém olha, nunca QUEM.

import { performance } from 'node:perf_hooks';
import type {
  Aggregates, CombatEvent, EndReason, FollowState, GridPoint, MemberLeft, PartyEvent, PresenceEvent,
  Receipt, Session, SessionSnapshot, SessionType, SkillProgress,
} from '@draconya/sim';
import { ACTIVE_CONDITION_KINDS } from '@draconya/protocol';
import type { ActiveConditionKind, C2SMessage, OutfitColors, S2CMessage, S2CProps } from '@draconya/protocol';
import { ITEM_SLOTS } from '@draconya/content';
import type { Ammunition, Appearances, BotConfig, Item, ItemSlot, Monster, Skill, Vocation } from '@draconya/content';
import { containerRulesFor, PartyFullError } from '@draconya/sim';
import type {
  CarriedItem, CharacterRuntime, ConfigurePartyResult, ContainerRules, HuntRuleset, InventoryRefusal,
  InventoryResult, InventoryState, PartyBagChanged, PartyEndVoteResult, PartySettingsPatch, Place,
  VocationRefusal,
} from '@draconya/sim';
import type { Progression } from '@draconya/content';
import type { SessionDirectory } from '../directory.js';
import type { SnapshotStore } from '../snapshots.js';
import type { ReceiptStore } from '../receipts.js';
import type { BoxedItem, LootBoxStore } from '../loot-box.js';
import type { Logger } from '../log.js';
import type { InitialCharacter, PartyTicket } from '../tickets.js';
import { AreaOfInterest } from './aoi.js';
import { Viewer, type ViewerOptions, type ViewerSocket } from './viewer.js';
import { REFUSAL_TEXT, TransitionError, refuseTransition } from './transitions.js';
import { TICK_LAG_BUDGET_MS, type GameMetrics } from './metrics.js';

/** Cria a sessão de um personagem que ainda não tem uma. */
export type SessionFactory = (
  characterId: string, initialCharacter?: InitialCharacter, party?: PartyTicket,
) => Session;

/** Reconstrói uma sessão a partir de um snapshot. `null` = não dá para retomar (FUN-28). */
export type SessionRestorer = (snapshot: SessionSnapshot) => Session | null;

/** Para onde o personagem quer ir. `huntId` e `difficulty` só valem para `to: 'hunt'`. */
export interface TransitionRequest {
  readonly to: SessionType;
  readonly huntId?: string;
  readonly difficulty?: string;
  /**
   * A configuração do bot deste personagem, JÁ VALIDADA (FUN-81). Preenchida pelo host, nunca
   * pelo cliente — o cliente manda a configuração numa mensagem própria, e o que chega aqui é
   * o que o servidor aceitou.
   */
  readonly botConfig?: BotConfig;
}

/**
 * Constrói a sessão de destino de uma transição (FUN-30, FUN-38).
 *
 * `null` significa "não sei construir essa": a transição é recusada, e no caminho da morte a
 * sessão é solta. É a MESMA costura para a morte que devolve à cidade e para o jogador que
 * entra numa hunt — dois caminhos separados dariam duas chances de o estado exclusivo furar,
 * e é o estado exclusivo que dispensa lock sobre o gold (invariante 9).
 */
/**
 * Constrói a sessão de destino de uma transição, para UM personagem.
 *
 * O `characterId` não é redundante com `from`: desde a FUN-71 a Cidade é compartilhada, e uma
 * sessão de origem pode ter duzentas pessoas. Sem ele, "quem está transicionando" viraria
 * "todo mundo que está nesta sessão" — e um jogador clicando em caçar levaria a praça junto.
 */
export type SessionBuilder = (
  request: TransitionRequest,
  from: Session,
  characterId: string,
) => Session | null;

export interface SessionHostOptions {
  readonly nodeId: string;
  readonly contentVersion: string;
  readonly createSession: SessionFactory;
  /**
   * Constrói UM personagem para entrar numa sessão que JÁ existe (#402, ADR 0033 D7). É a
   * costura equivalente a `createSession`, mas para o recém-chegado: o host chama `session.enter`
   * com ele DENTRO do ciclo da sessão dona (invariante 9), sem conhecer balanceamento.
   */
  readonly createParticipant?: (characterId: string, initialCharacter: InitialCharacter) => CharacterRuntime;
  readonly logger: Logger;
  readonly directory?: SessionDirectory;
  /** Onde as sessões são guardadas para sobreviver à queda do processo (FUN-28). */
  readonly snapshots?: SnapshotStore;
  /** Onde o extrato de uma sessão encerrada espera virar linha de ledger (FUN-29). */
  readonly receipts?: ReceiptStore;
  readonly restoreSession?: SessionRestorer;
  /** Constrói a sessão de destino de uma transição — a PZ na morte, a hunt no menu. */
  readonly buildSession?: SessionBuilder;
  readonly viewer?: ViewerOptions;
  /** Métricas do nó (FUN-47). Ausente: o host roda igual, só não conta nada. */
  readonly metrics?: GameMetrics;
  /** Relógio monotônico da simulação. Injetável para o teste não depender de tempo real. */
  readonly now?: () => number;
  /**
   * Aceita ou recusa uma configuração de bot (FUN-81). Ausente: `bot-config` é ignorada e o
   * jogador recebe um aviso — um host montado sem conteúdo não tem como julgar vocabulário.
   */
  readonly acceptBotConfig?: (raw: unknown, level: number) => BotConfigDecision;
  /**
   * Registra a preferência no Redis para jobs/api gravarem no Postgres (ADR 0028).
   * Ausente ou falhando: aplica na sessão, mas devolve falha de salvamento ao jogador.
   */
  readonly saveBotConfig?: (characterId: string, config: BotConfig) => Promise<void>;
  /**
   * O catálogo de itens (FUN-76), para as regras de equipar. Ausente: nada se veste, e a
   * recusa é honesta — um host sem conteúdo não sabe o que é uma espada.
   */
  readonly itemCatalog?: ReadonlyMap<string, Item>;
  /**
   * O catálogo de munição (#152), para a escolha pelo socket. Ausente: nada se escolhe, e a
   * recusa é honesta — como o de itens.
   */
  readonly ammunition?: ReadonlyMap<string, Ammunition>;
  /**
   * As vocações e o level da escolha (#154, ADR 0026 decisão 1), para `choose-vocation`.
   * Ausentes: nada se escolhe, e a recusa é honesta — como munição e itens.
   */
  readonly vocations?: ReadonlyMap<string, Vocation>;
  readonly vocationLevel?: number;
  /**
   * A tabela de progressão (#160), para os tamanhos de container — a bolsa e a linha. Ausente:
   * `move-item` e a arma de vocação usam containers de zero lugares que crescem por um; é o
   * host de teste sem conteúdo.
   */
  readonly progression?: Progression;
  /**
   * O catálogo de monstros (FUN-103), para nome e `outfitId` de quem nasce na hunt.
   *
   * O `sim` não conhece nome nem arte: o evento de nascimento traz só o `monsterId`, e é aqui
   * que ele vira algo desenhável. Ausente: o monstro aparece sem nome e com outfit 0 — a hunt
   * continua, mas a tela mostra um buraco onde deveria ter um rato. Lido do conteúdo fixado na
   * sessão (invariante 7): é um mapa carregado no boot, não uma consulta por criatura.
   */
  readonly monsterCatalog?: ReadonlyMap<string, Monster>;
  /**
   * O catálogo de skills (#340, SV-04), para progresso e magic level em player-stats.
   * Ausente: skills vazias e magic level zerado.
   */
  readonly skillCatalog?: ReadonlyMap<string, Skill>;
  /**
   * O outfit de TODO personagem, enquanto ninguém escolhe o seu (FUN-103, §7.4 pendente).
   *
   * `CharacterRuntime` não tem outfit e o ticket não carrega um. Até isso existir, todo jogador
   * veste o mesmo — e o número vem do conteúdo, não de uma constante aqui, porque é arte e arte
   * não mora em código (invariante 6).
   */
  readonly playerOutfitId?: number;
  /**
   * A tabela de aparências (FUN-109), para o que o combate DESENHA: o sangue do golpe, o
   * projétil e a explosão da magia, o brilho da poção.
   *
   * O `sim` emite "houve um golpe", "saiu a magia X", "usou o supply Y" — nunca um id de
   * arte (invariante 6). É aqui que o `spellId` vira `effect` e `missile`, pela tabela fixada
   * no boot (invariante 7). Ausente, ou magia sem linha nela: o combate chega MUDO — número
   * flutuante e barra continuam, só o efeito não sai. Silêncio, não erro: uma magia nova sem
   * arte ainda é uma magia, e derrubar a apresentação por isso esconderia que ela funcionou.
   */
  readonly appearances?: Appearances;
  /**
   * Onde a Caixa de Loot da Sessão é guardada (FUN-88). Ausente: o que não coube se perde no
   * encerramento, e o log diz. Degradação, não falha.
   */
  readonly lootBoxes?: LootBoxStore;
  /**
   * Ligar o interest management por célula nas sessões compartilhadas (FUN-33). Padrão: sim.
   *
   * Existe desligável por duas razões, e nenhuma é "por precaução": é o GRUPO DE CONTROLE da
   * medição — `pnpm bench:city` roda os dois lados e é assim que "não cresce
   * quadraticamente" vira número —, e é a saída se um dia a AOI esconder quem não devia. Sem
   * ela, a praça volta a mandar tudo para todos: caro, e visivelmente correto.
   */
  readonly areaOfInterest?: boolean;
  /**
   * O catálogo do que existe: hunts (FUN-79) e vocabulário do bot (FUN-89).
   *
   * Função, e não o `Content`: o host não precisa conhecer balanceamento para mandar uma lista,
   * pela mesma razão que ele recebe `acceptBotConfig` em vez do conteúdo inteiro. Calculada uma
   * vez no boot — a versão de conteúdo é fixada e não muda enquanto o processo vive.
   */
  readonly catalogue?: () => S2CProps<'catalogue'>;
}

const EMPTY_ITEMS: ReadonlyMap<string, Item> = new Map();

/**
 * Por que o item não entrou, em português e para o jogador.
 *
 * A recusa do `sim` é tipada justamente para caber num mapa como este: sem ela, o host teria
 * que inventar a mensagem, e "não foi possível" é o que faz alguém abrir um chamado.
 */
const INVENTORY_REFUSAL: Readonly<Record<InventoryRefusal, string>> = {
  'over-capacity': 'Você não aguenta carregar mais isso.',
  'not-carried': 'Você não está com esse item.',
  'not-equippable': 'Esse item não se veste.',
  'hands-full': 'Isso precisa das duas mãos: tire o escudo, ou a arma.',
  'level-too-low': 'Seu level ainda não permite usar esse item.',
  'wrong-vocation': 'Esse item é de outra vocação.',
  'stack-too-large': 'Essa pilha é grande demais.',
  'backpack-not-empty': 'Esvazie a mochila antes de tirá-la.',
  'no-such-place': 'Esse lugar não existe.',
  'empty-place': 'Não há nada nesse lugar.',
};

const VOCATION_REFUSAL: Readonly<Record<VocationRefusal, string>> = {
  'level-too-low': 'Você ainda não chegou ao level da escolha de vocação.',
  'already-chosen': 'Você já escolheu a sua vocação.',
};

/** Agregados zerados: o extrato de estado durável do shard não credita nada (#154). */
const EMPTY_AGGREGATES: Aggregates = {
  durationMs: 0, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0,
  itemsLooted: 0, suppliesUsed: 0, bestBasicHit: 0, bestSpellHit: 0,
  damageDealt: 0, healingDone: 0,
};

/**
 * Os itens que ESTA sessão criou e que estão na mochila (FUN-88).
 *
 * O id determinístico (`sessionId:n`) é o que permite reconhecê-los sem guardar uma lista à
 * parte: item com o prefixo desta sessão nasceu nela. O que veio de sessões anteriores já tem
 * linha no banco e não precisa ser inserido de novo.
 */
function acquiredBy(character: CharacterRuntime, sessionId: string): BoxedItem[] {
  return acquiredByState(character.inventory.getState(), sessionId);
}

/**
 * A mesma pergunta sobre o ESTADO (#154): é o que o snapshot irrestaurável tem em mãos. A arma
 * de vocação nasce EQUIPADA com o prefixo da sessão, então o equipado também conta — sem isto
 * ela nunca viraria linha de `item_instance`.
 */
function acquiredByState(inventory: InventoryState, sessionId: string): BoxedItem[] {
  const prefix = `${sessionId}:`;
  const born = (item: CarriedItem | null | undefined): item is CarriedItem =>
    item !== null && item !== undefined && item.instanceId.startsWith(prefix);
  return [
    ...inventory.backpack.filter(born),
    ...(inventory.satchel ?? []).filter(born),
    ...Object.values(inventory.equipped).filter(born),
  ];
}

/**
 * Onde cada instância está DENTRO dos containers (#160): `instanceId → lugar`. ABSOLUTO como
 * `equipment`; o equipado não aparece — o slot dele já vai em `equipment`.
 */
function layoutOfState(inventory: InventoryState): Record<string, { container: 'backpack' | 'satchel'; index: number }> {
  const layout: Record<string, { container: 'backpack' | 'satchel'; index: number }> = {};
  inventory.backpack.forEach((item, index) => { if (item !== null) layout[item.instanceId] = { container: 'backpack', index }; });
  (inventory.satchel ?? []).forEach((item, index) => { if (item !== null) layout[item.instanceId] = { container: 'satchel', index }; });
  return layout;
}

/** O layout de equipamento como o extrato o leva: `slot → instanceId`. */
function equipmentOf(character: CharacterRuntime): Record<string, string> {
  return equipmentOfState(character.inventory.getState());
}

function equipmentOfState(inventory: InventoryState): Record<string, string> {
  const equipped: Record<string, string> = {};
  for (const [slot, item] of Object.entries(inventory.equipped)) {
    if (item !== undefined) equipped[slot] = item.instanceId;
  }
  return equipped;
}

/** Os vitais do jogador como o HUD os lê. */
type PlayerStats = S2CProps<'player-stats'>;

/**
 * Os vitais do jogador, montados UMA vez para os dois caminhos (FUN-109): o `session-state`
 * da reanexação e o `player-stats` que sai ao vivo quando algo muda. Duas montagens
 * divergiriam na primeira regra nova — e a barra que a reanexação mostra passaria a discordar
 * da que o ciclo atualiza.
 *
 * O gold é o SALDO — `gold + goldDelta` —, porque é o que o jogador tem para gastar agora:
 * `gold` é o que entrou com o ticket e a sessão nunca escreve, `goldDelta` é o que ela
 * movimentou e vira ledger ao encerrar (invariante 10). Mostrar só um dos dois seria mostrar
 * ou o saldo de antes da hunt ou o rendimento sem base.
 *
 * `staminaMs` nulo é personagem que não rastreia stamina (fixture de teste); vai como zero
 * porque o protocolo não tem "não sei", e zero é o único número que não promete tempo de
 * recompensa que não existe.
 */
function skillProgressOf(
  character: CharacterRuntime | undefined, definition: Skill | undefined,
): SkillProgress {
  if (character === undefined || definition === undefined) return { level: 0, percentToNext: 0 };
  return character.skills.progressOf(definition);
}

function playerStatsOf(
  character: CharacterRuntime | undefined,
  skillCatalog?: ReadonlyMap<string, Skill>,
  targetId: number | null = null,
): PlayerStats {
  const skills: Record<string, SkillProgress> = {};
  if (character !== undefined && skillCatalog !== undefined) {
    for (const definition of skillCatalog.values()) {
      skills[definition.id] = character.skills.progressOf(definition);
    }
  }
  return {
    health: character?.health ?? 0,
    maxHealth: character?.maxHealth ?? 0,
    mana: character?.mana ?? 0,
    maxMana: character?.maxMana ?? 0,
    level: character?.level ?? 0,
    xp: character?.xp ?? 0,
    capacity: character?.capacity ?? 0,
    gold: character === undefined ? 0 : character.gold + character.goldDelta,
    staminaMs: character?.staminaMs ?? 0,
    targetId,
    ammo: {
      arrow: character?.ammo.get('arrow') ?? null,
      bolt: character?.ammo.get('bolt') ?? null,
    },
    vocationId: character?.vocationId ?? null,
    speed: character === undefined ? 0 : Math.round(character.speed * character.speedScale),
    skills,
    magicLevel: skillProgressOf(character, skillCatalog?.get('magic')),
  };
}

function sameSkillProgress(a: SkillProgress, b: SkillProgress): boolean {
  return a.level === b.level && a.percentToNext === b.percentToNext;
}

function sameSkills(a: Record<string, SkillProgress>, b: Record<string, SkillProgress>): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    const other = b[key];
    if (other === undefined || !sameSkillProgress(a[key] as SkillProgress, other)) return false;
  }
  return true;
}

/**
 * Campo a campo, e não `JSON.stringify`: roda a 10 Hz por sessão anexada, e serializar dois
 * objetos por ciclo para descobrir que nada mudou é o custo que a comparação existe para
 * evitar. Comparar SÓ a vida seria o defeito silencioso — a mana gasta numa magia nunca
 * chegaria ao HUD, e o teste de mana em `host.test.ts` é quem pega isso.
 *
 * A stamina é comparada no MINUTO, não no milissegundo. O `sim` a queima a cada evento que
 * vence — as regras de saída vencem a cada 250 ms —, então `staminaMs` muda em TODO ciclo
 * anexado, e comparar exato fazia a comparação inteira não valer nada: saía um
 * `player-stats` por ciclo (482 em 120 s medidos em produção, mais que `creature-move`, a
 * 130 B cada). O HUD mostra horas e minutos, e é essa a granularidade que "mudou" tem para
 * quem olha; o valor entregue continua em milissegundos, só o gatilho é que arredonda.
 */
function sameStats(a: PlayerStats, b: PlayerStats): boolean {
  return a.health === b.health
    && a.maxHealth === b.maxHealth
    && a.mana === b.mana
    && a.maxMana === b.maxMana
    && a.level === b.level
    && a.xp === b.xp
    && a.capacity === b.capacity
    && a.gold === b.gold
    && a.targetId === b.targetId
    && a.ammo.arrow === b.ammo.arrow
    && a.ammo.bolt === b.ammo.bolt
    && staminaMinute(a.staminaMs) === staminaMinute(b.staminaMs)
    && a.speed === b.speed
    && sameSkills(a.skills, b.skills)
    && sameSkillProgress(a.magicLevel, b.magicLevel);
}

/**
 * O que o analisador entregou por último (FUN-110): os agregados e QUANTOS eventos notáveis.
 *
 * `durationMs` fica de fora da comparação de propósito, pela mesma razão da stamina em
 * `sameStats`: ele muda em todo ciclo — dez por segundo numa hunt anexada —, e compará-lo
 * faria a mensagem sair a 10 Hz para dizer que cem milissegundos passaram. O tempo anda no
 * relógio local da janela; o que a janela não tem como saber sozinha é abate, loot, gasto,
 * level e morte — e é isso que dispara.
 */
interface SentAnalyzer {
  readonly aggregates: Aggregates;
  readonly eventCount: number;
  /** A seção PARTY do analisador entregue por último (ADR 0033 d.11). `undefined` em solo. */
  readonly party: S2CProps<'analyzer'>['party'];
}

/** O extrato DESTE personagem entre os que a sessão emitiu (#187). `null` enquanto ela vive. */
function receiptOf(hosted: HostedSession, characterId: string): Receipt | null {
  return hosted.session.receipts().find((receipt) => receipt.characterId === characterId) ?? null;
}

function sameAnalyzer(sent: SentAnalyzer, aggregates: Aggregates, eventCount: number): boolean {
  const a = sent.aggregates;
  return sent.eventCount === eventCount
    && a.xpGained === aggregates.xpGained
    && a.goldGained === aggregates.goldGained
    && a.goldSpent === aggregates.goldSpent
    && a.kills === aggregates.kills
    && a.deaths === aggregates.deaths
    && a.itemsLooted === aggregates.itemsLooted
    && a.suppliesUsed === aggregates.suppliesUsed
    && a.bestBasicHit === aggregates.bestBasicHit
    && a.bestSpellHit === aggregates.bestSpellHit
    && a.damageDealt === aggregates.damageDealt
    && a.healingDone === aggregates.healingDone;
}

/** Compara as duas seções PARTY entregues por último, campo a campo — como `sameAnalyzer`. */
function samePartySummary(
  a: S2CProps<'analyzer'>['party'],
  b: S2CProps<'analyzer'>['party'],
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.players === b.players
    && a.uniqueVocations === b.uniqueVocations
    && a.xpPercent === b.xpPercent
    && a.totalXp === b.totalXp
    && a.totalSupplies === b.totalSupplies
    && a.shareCosts === b.shareCosts
    && a.splitLoot === b.splitLoot
    && a.bagValue === b.bagValue
    && a.bagWeight === b.bagWeight
    && a.autoSell.used === b.autoSell.used
    && a.autoSell.limit === b.autoSell.limit;
}

/** Um share de `party-spending` (#354, SV-18): o gasto do membro, e a prévia dele se pedir agora. */
type PartySpendingShare = S2CProps<'party-spending'>['shares'][number];

/**
 * Os shares de `party-spending` (#354, SV-18) — o gasto de CADA participante, sempre (a MESMA
 * leitura de `Aggregates.goldSpent` que `#presentAnalyzer` já usa por personagem), mais a
 * prévia do settlement (`estimatedShare`), só em modo `shared`, reaproveitando
 * `HuntRuleset.partySpendingPreview` — a MESMA conta do `party-settlement` real. `undefined`
 * sem party: D8, nada a mandar.
 */
function partySpendingSharesOf(hosted: HostedSession): PartySpendingShare[] | undefined {
  const ruleset = hosted.session.ruleset as Partial<HuntRuleset>;
  if (ruleset.party === undefined) return undefined;
  const estimated = ruleset.partySpendingPreview?.(hosted.session);
  return hosted.session.participants.map((member) => ({
    characterId: member.id,
    goldSpent: hosted.session.aggregatesOf(member.id).goldSpent,
    ...(estimated?.has(member.id) ? { estimatedShare: estimated.get(member.id) } : {}),
  }));
}

/** Compara os shares ENTREGUES por último com os de agora, campo a campo — como `sameAnalyzer`. */
function sameSpending(a: readonly PartySpendingShare[], b: readonly PartySpendingShare[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined) return false;
    if (x.characterId !== y.characterId || x.goldSpent !== y.goldSpent || x.estimatedShare !== y.estimatedShare) return false;
  }
  return true;
}

/**
 * A seção PARTY do analisador (§32, ADR 0033 d.11), do `partySummary` do `sim` (DT-03: getter
 * puro, sem `emit()`). O host só TRADUZ o que o `sim` calculou — jogadores, vocações únicas,
 * pool de XP, valor/peso da bolsa e limite de venda — e soma XP/supplies por participante dos
 * agregados que a própria sessão já mantém. `undefined` em solo (D8): nada a mandar.
 */
function partySummaryOf(hosted: HostedSession): S2CProps<'analyzer'>['party'] {
  const ruleset = hosted.session.ruleset as Partial<HuntRuleset>;
  const summary = ruleset.partySummary?.(hosted.session);
  if (summary === undefined) return undefined;
  let totalXp = 0;
  let totalSupplies = 0;
  for (const member of summary.members) {
    const aggregates = hosted.session.aggregatesOf(member);
    totalXp += aggregates.xpGained;
    totalSupplies += aggregates.suppliesUsed;
  }
  return {
    players: summary.members.length,
    uniqueVocations: summary.uniqueVocations,
    xpPercent: summary.xpPoolPercent,
    // A penalidade de morte pode deixar um `xpGained` negativo; o protocolo não aceita total
    // negativo, e o piso em zero é a mesma régua do saldo de gold.
    totalXp: Math.max(0, totalXp),
    totalSupplies: Math.max(0, totalSupplies),
    shareCosts: summary.shareCosts,
    splitLoot: summary.splitLoot,
    bagValue: summary.bagValue,
    bagWeight: summary.bagWeight,
    autoSell: { used: summary.autoSell.configured, limit: summary.autoSell.limit },
  };
}

/** A stamina como o HUD a mostra: em minutos inteiros. */
const staminaMinute = (staminaMs: number): number => Math.floor(staminaMs / 60_000);

/**
 * A soma dos abates do Bestiário: o gatilho da mensagem `bestiary` ao vivo (FUN-113).
 *
 * Um número só, e não a comparação monstro a monstro, porque abate nunca desce: a soma muda
 * se, e só se, algum contador mudou. É o `sentItemsLooted` do Bestiário — comparar um inteiro
 * por ciclo custa nada, e serializar o mapa a 10 Hz para dizer que nada mudou custaria a
 * banda que a FUN-13 orça.
 */
function bestiaryTotal(counts: Readonly<Record<string, number>>): number {
  let total = 0;
  for (const kills of Object.values(counts)) total += kills;
  return total;
}

/** Igualdade de lista de ids de item, com `null` = coletar tudo (§6, D2). */
function sameIdList(a: readonly string[] | null, b: readonly string[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function samePartySettings(
  a: S2CProps<'party-state'>['settings'],
  b: S2CProps<'party-state'>['settings'],
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.shareCosts === b.shareCosts && a.splitLoot === b.splitLoot;
}

function samePartyLoot(
  a: S2CProps<'party-state'>['loot'],
  b: S2CProps<'party-state'>['loot'],
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.autoSellLimit === b.autoSellLimit
    && a.leaderPremium === b.leaderPremium
    && sameIdList(a.collect, b.collect)
    && sameIdList(a.autoSell, b.autoSell);
}

function sameParty(a: S2CProps<'party-state'>, b: S2CProps<'party-state'>): boolean {
  if (a.leaderId !== b.leaderId || a.mode !== b.mode
    || a.shareCosts !== b.shareCosts || a.splitLoot !== b.splitLoot
    || a.members.length !== b.members.length
    || !samePartySettings(a.settings, b.settings)
    || !samePartyLoot(a.loot, b.loot)) {
    return false;
  }
  for (let i = 0; i < a.members.length; i++) {
    const x = a.members[i];
    const y = b.members[i];
    if (
      !x || !y
      || x.characterId !== y.characterId || x.name !== y.name || x.alive !== y.alive
      || x.healthPercent !== y.healthPercent || x.vocationId !== y.vocationId
      || x.level !== y.level || x.manaPercent !== y.manaPercent
      || x.joinedAtMs !== y.joinedAtMs || x.connected !== y.connected
      // DPS/HPS (#431): a taxa da janela muda quando a amostra vence ou um golpe entra — é
      // exatamente a variação que precisa reenviar o `party-state` ao vivo.
      || x.dps !== y.dps || x.hps !== y.hps
      || x.damageDealt !== y.damageDealt || x.healingDone !== y.healingDone
    ) return false;
  }
  return true;
}

/** A recusa de `configureParty` em português, para o `system-message` (D12). */
function partyRefusalText(decision: Extract<ConfigurePartyResult, { ok: false }>): string {
  if (decision.reason === 'not-leader') return 'Só o líder pode mudar as configurações da party.';
  if (decision.reason === 'unknown-item') return `Item desconhecido: ${decision.itemId}.`;
  return `Item sem valor de venda: ${decision.itemId}.`;
}

/** A recusa da votação de encerrar em português, para o `system-message` (#432). */
function partyEndVoteRefusalText(decision: Extract<PartyEndVoteResult, { ok: false }>): string {
  if (decision.reason === 'not-leader') return 'Só o líder pode propor encerrar a caçada para todos.';
  if (decision.reason === 'no-proposal') return 'Não há proposta de encerramento em aberto.';
  return 'Você não está nesta party.';
}

type ConditionsSnapshot = ReadonlyMap<ActiveConditionKind, number>;

const ACTIVE_CONDITION_KIND_SET: ReadonlySet<string> = new Set(ACTIVE_CONDITION_KINDS);

/**
 * Só as condições que o contrato conhece (`ACTIVE_CONDITION_KINDS`): desde o CMB-07 a chave da
 * condição é livre no `sim` (DOT de ability, campo), e o que não tem badge no cliente fica de
 * fora aqui — o `z.enum` do protocolo recusaria o frame inteiro, e a barra sumiria com ele.
 */
function conditionsSnapshotOf(character: CharacterRuntime): ConditionsSnapshot {
  const snapshot = new Map<ActiveConditionKind, number>();
  for (const condition of character.conditions.getState()) {
    if (!ACTIVE_CONDITION_KIND_SET.has(condition.key)) continue;
    snapshot.set(condition.key as ActiveConditionKind, condition.expiresAtMs);
  }
  return snapshot;
}

function sameConditions(a: ConditionsSnapshot, b: ConditionsSnapshot): boolean {
  if (a.size !== b.size) return false;
  for (const [key, expiresAtMs] of a) {
    if (b.get(key) !== expiresAtMs) return false;
  }
  return true;
}

function activeConditionsOf(snapshot: ConditionsSnapshot, nowMs: number): S2CProps<'active-conditions'> {
  const conditions: { kind: ActiveConditionKind; remainingMs: number }[] = [];
  for (const [kind, expiresAtMs] of snapshot) {
    conditions.push({
      kind,
      remainingMs: Math.max(0, Math.round(expiresAtMs - nowMs)),
    });
  }
  conditions.sort((a, b) => a.kind.localeCompare(b.kind));
  return { conditions };
}

/** Ver `createBotConfigValidator` em `sessions.ts`. */
export type BotConfigDecision =
  | { readonly ok: true; readonly config: BotConfig }
  | { readonly ok: false; readonly reason: string };

interface HostedSession {
  readonly session: Session;
  readonly viewers: Set<Viewer>;
  /**
   * Quando esta sessão foi avançada pela última vez, no relógio monotônico DESTE processo.
   *
   * O relógio do processo mora aqui desde a FUN-68, e não mais dentro da `Session`: lá dentro
   * o tempo é lógico, começa em zero e é da sessão. É o que aposentou o `rebaseClock` — uma
   * sessão retomada de snapshot nasce com esta marca no agora do processo novo, então o
   * primeiro avanço dela é de milissegundos, e o intervalo em que o nó esteve fora nunca
   * chega a ser oferecido à simulação (ADR 0018).
   */
  lastAdvancedAtMs: number;
  /**
   * De quem o extrato já foi confirmado no Redis (#194: um por membro). A liquidação no
   * Postgres é posterior. A drenagem grava e DEPOIS solta; esta marca evita regravar no release.
   */
  readonly credited: Set<string>;
  /** Tentativa em voo por membro: concorrentes aguardam inclusive a falha, sem soltar antes. */
  readonly receiptSaves: Map<string, Promise<void>>;
  /**
   * Quem saiu por DENTRO do `sim` — morte ou regra de saída numa party (#193) — e ainda não
   * foi gravado nem devolvido à Cidade. `#presentMoves` enfileira; `#settleDepartures` drena
   * fora do ciclo, porque gravar é I/O.
   */
  readonly departures: MemberLeft[];
  /**
   * Personagens de um SHARD com estado durável pendente (#154): vocação, equipamento, munição
   * e arma de vocação mudam na praça e, sem isto, sumiam no logout. Quem entra aqui recebe um
   * extrato de estado durável ao sair (`#saveDurableReceipt`); quem não mexeu em nada, não —
   * um extrato zerado por logout de praça seria uma linha de ledger por pessoa que fecha o jogo.
   */
  readonly dirty: Set<string>;
  /**
   * Quantos itens esta sessão já entregou, na última vez que o inventário foi mandado.
   *
   * É o gatilho barato para reenviar a mochila durante a hunt (FUN-90): comparar um inteiro por
   * ciclo custa nada, e serializar o inventário a 10 Hz para quem está olhando custaria muito.
   */
  sentItemsLooted: number;
  /**
   * Os últimos vitais ENTREGUES a quem olha cada personagem (FUN-109), por `characterId`.
   *
   * É o gatilho do `player-stats` ao vivo, pela mesma lógica de `sentItemsLooted`: comparar
   * nove números por ciclo custa nada, e mandar os nove a 10 Hz para dizer que nada mudou
   * custaria a banda inteira que a FUN-13 orça. Entrada ausente é "ninguém recebeu ainda", e
   * o primeiro ciclo com visualizador manda.
   *
   * "Entregues", e não "calculados": só é escrito quando alguém recebeu — no `session-attach`
   * e no ciclo com visualizador. Sem ninguém olhando não se compara nada, porque a comparação
   * é apresentação; o `sim` muda o que tem de mudar de qualquer jeito (invariante 3).
   */
  readonly sentStats: Map<string, PlayerStats>;
  /**
   * O último analisador ENTREGUE (FUN-110), por sessão — os agregados são da sessão, não do
   * personagem. `null` é "ninguém recebeu ainda", e o primeiro ciclo com visualizador manda;
   * o `session-attach`, que já leva tudo no `session-state`, também o escreve.
   */
  /**
   * Por PERSONAGEM desde o #196: os agregados são de cada participante (#187), e quem olha um
   * membro da party vê os dele — não a soma. Em solo é um só, como antes.
   */
  readonly sentAnalyzer: Map<string, SentAnalyzer>;
  /**
   * A soma dos abates do Bestiário ENTREGUE a quem olha cada personagem (FUN-113), por
   * `characterId` — o mesmo mecanismo de `sentStats`, para uma grandeza que só sobe. Entrada
   * ausente é "ninguém recebeu ainda"; escrita só quando alguém recebeu, no `session-attach`
   * e no ciclo com visualizador, pela razão registrada em `sentStats`.
   */
  readonly sentBestiary: Map<string, number>;
  /** O último `party-state` ENTREGUE aos visualizadores (#339, SV-03). */
  sentParty: S2CProps<'party-state'> | null;
  /**
   * O último `party-bag-changed` do `sim` (#400), guardado mesmo sem visualizador.
   *
   * `getState().partyBag` guarda gold, itens (com elegibilidade), capacidade e OVERWEIGHT, mas
   * o PESO, o VALOR e as RESERVAS só existem no evento — `#rebalanceBag` os calcula e não os
   * persiste. O host NUNCA os recalcula (PRD §34): ele guarda o que o `sim` mandou para o
   * `session-state` de quem reanexa não perder as reservas.
   */
  lastPartyBag: PartyBagChanged | null;
  /**
   * Os shares de `party-spending` ENTREGUES por último (#354, SV-18) — por SESSÃO, como
   * `party-bag`, não por personagem: a mensagem é UMA SÓ, para todos os visualizadores. `null`
   * é "ninguém recebeu ainda" ou "sessão sem party" (D8); o primeiro ciclo com visualizador, ou
   * o `session-attach`, escreve o real.
   */
  sentSpending: readonly PartySpendingShare[] | null;
  /** As últimas condições ENTREGUES a quem olha cada personagem (#341, SV-05). */
  readonly sentConditions: Map<string, ConditionsSnapshot>;
  /**
   * `characterId` (UUID) → id numérico de criatura na instância.
   *
   * O protocolo numera criatura com `number` porque isso vai no caminho quente: um id de 4
   * bytes por `creature-move`, dezenas de vezes por segundo, contra 36 de um UUID. A tradução
   * é do servidor — o `sim` não conhece protocolo, e o cliente não pode inventar número.
   */
  readonly creatureIds: Map<string, number>;
  /**
   * O próximo id numérico a distribuir. MONOTÔNICO, nunca `size + 1` (FUN-103).
   *
   * `size + 1` recicla depois de um `delete`: com {a:1, b:2, c:3}, remover b faz o próximo
   * receber 3 — e c já é 3. Com personagem isso é raro; com monstro morrendo e renascendo
   * é rotina, e o cliente passa a desenhar o morto no lugar do vivo.
   */
  nextCreatureId: number;
  /**
   * Quem enxerga quem, por célula (FUN-33). `null` na sessão privada.
   *
   * Só o SHARD precisa: numa hunt de um personagem, "todos os visualizadores" já são os dele, e
   * manter índice de célula ali seria custo puro no caminho quente das 5.000 instâncias.
   */
  readonly aoi: AreaOfInterest | null;
}

/** `created` diz se ESTA chamada trouxe a sessão à existência — ver `prepare`. */
export interface PrepareResult {
  readonly created: boolean;
  /**
   * Presente só quando a admissão FOI recusada (#402) — `created` fica `false` junto, e o
   * handshake do WebSocket fecha com o status do motivo. Aditivo de propósito (DT-03): os
   * consumidores antigos continuam lendo `created` como booleano direto.
   */
  readonly refused?: 'party-full' | 'content-version' | 'session-not-here';
}

/**
 * Teto de taxa do laço: 10 Hz. Uma sessão pode pedir menos — a política por tipo e por
 * presença de visualizador é do próprio ruleset (ADR 0003) e é lida a cada ciclo.
 */
const CYCLE_MS = 100;
/** Um terço do lease do diretório, pela mesma razão do batimento. */
const RENEW_INTERVAL_MS = 10_000;
/**
 * Cada quanto o total de jogadores online é agregado entre nós e mandado para quem está
 * olhando (SV-07). Fixado em 30 s pelo desenho da issue: mais apertado não muda a sensação de
 * "gente jogando" e custa banda à toa; mais frouxo atrasaria demais um pico real de entrada.
 */
const PLAYER_COUNT_INTERVAL_MS = 30_000;
/**
 * Cada quanto a sessão é gravada.
 *
 * É exatamente o que se perde numa queda: dez segundos de XP. Aceitável para progresso,
 * INACEITÁVEL para transação econômica — por isso o ledger é escrito à parte (invariante 10),
 * e não depende deste intervalo.
 */
const SNAPSHOT_INTERVAL_MS = 10_000;

/**
 * Quanto tempo uma sessão de REPOUSO fica de pé sem ninguém olhando (FUN-52).
 *
 * Cinco minutos é escolhido pelos dois lados do erro. Curto demais e recarregar a página vira
 * sessão nova a cada vez; longo demais e quem fechou o navegador segura um dos dois slots da
 * conta por horas — que era o defeito.
 *
 * Não vale para hunt: uma sessão que rende nunca é recolhida por ausência (ADR 0001).
 */
const RESTING_GRACE_MS = 5 * 60_000;

const DIRECTION_DX = { north: 0, east: 1, south: 0, west: -1 } as const;
const DIRECTION_DY = { north: -1, east: 0, south: 1, west: 0 } as const;

/** Intervalo mínimo entre dois avisos de atraso. Ver `#warnLag`. */
const LAG_WARNING_INTERVAL_MS = 60_000;

export class SessionHost {
  readonly #options: SessionHostOptions;
  readonly #logger: Logger;

  /** Por sessão. O índice por personagem existe porque uma sessão terá vários (guild war). */
  readonly #sessions = new Map<string, HostedSession>();
  readonly #sessionIdByCharacter = new Map<string, string>();
  readonly #accountIdByCharacter = new Map<string, string>();
  /** Nome de exibição, do ticket. Só o chat lê; o `sim` não conhece nome (FUN-58). */
  readonly #nameByCharacter = new Map<string, string>();
  /**
   * As cores do outfit, do ticket (FUN-104). Só `creature-appear` e `session-state` leem; o
   * `sim` não conhece cor, e o snapshot não a carrega — é apresentação, não simulação. Como o
   * nome, entram quando a sessão é preparada e vivem até `release`: uma escolha nova feita no
   * meio da sessão só aparece na próxima entrada, com o ticket que a trouxer. Ausente é o
   * padrão do cliente — personagem que nunca escolheu, ou ticket de um `api` antigo.
   */
  readonly #colorsByCharacter = new Map<string, OutfitColors>();
  /**
   * A configuração do bot vigente, por personagem (FUN-81).
   *
   * Nasce do ticket e é substituída pela mensagem `bot-config`. Vive aqui, e não no
   * `CharacterRuntime`, porque ela ACOMPANHA o personagem entre sessões: ele configura na
   * Cidade e entra na hunt, e é o host que constrói a hunt. Guardá-la no runtime a poria no
   * snapshot duas vezes — o do personagem e o do ruleset.
   */
  readonly #botByCharacter = new Map<string, BotConfig>();
  readonly #preparations = new Map<string, Promise<void>>();
  /** Transições em voo, por personagem. Ver `transition`. */
  readonly #transitions = new Map<string, Promise<void>>();
  #lastLagWarningMs = Number.NEGATIVE_INFINITY;
  /** Quanto tempo a retomada pulou, esperando o primeiro visualizador para ser contado. */
  readonly #resumedGapMs = new Map<string, number>();
  /**
   * `characterId` → desde quando ninguém olha para ELE, no relógio monotônico. `null` = tem
   * visualizador.
   *
   * Por PERSONAGEM, e não por sessão, desde a FUN-71: num shard, o jogador que fecha o
   * navegador não pode recolher a praça em que os outros estão. Numa sessão privada os dois
   * jeitos dão o mesmo número, porque lá o único personagem é o dono de todos os
   * visualizadores.
   *
   * Só importa para sessão de REPOUSO — a orientada a evento. Uma hunt desanexada nunca é
   * recolhida por isto, e é o ADR 0001 em uma linha.
   */
  readonly #restingSince = new Map<string, number | null>();
  /**
   * Até quando cada personagem está DANDO um passo, no relógio deste processo (FUN-122). O
   * teclado do cliente repete o `walk` no ritmo do passo, mas o ritmo é do servidor: um `walk`
   * que chega antes de o passo anterior acabar é recusado em silêncio — senão um cliente que
   * mandasse mil por segundo atravessaria a Cidade em meio segundo, porque a Cidade não tem
   * relógio (`hz` 0) e o `move` do `sim` não sabe que horas são.
   */
  readonly #walkingUntil = new Map<string, number>();

  #cycleTimer: NodeJS.Timeout | null = null;
  #renewTimer: NodeJS.Timeout | null = null;
  #snapshotTimer: NodeJS.Timeout | null = null;
  #playerCountTimer: NodeJS.Timeout | null = null;
  #lastPlayerCount: number | undefined = undefined;

  constructor(options: SessionHostOptions) {
    this.#options = options;
    this.#logger = options.logger;
  }

  get sessionCount(): number {
    return this.#sessions.size;
  }

  get viewerCount(): number {
    let total = 0;
    for (const hosted of this.#sessions.values()) total += hosted.viewers.size;
    return total;
  }

  /**
   * Quantos PERSONAGENS distintos este nó tem conectados agora (SV-07) — não visualizadores:
   * duas abas do mesmo personagem contam UMA vez (invariante 8, `CLAUDE.md` de `server`: "duas
   * abas do mesmo personagem são dois visualizadores da MESMA sessão, nunca duas sessões"). O
   * `Set` nunca precisa decidir entre SESSÕES, só entre ABAS dentro de uma: um personagem não
   * pode estar hospedado em duas sessões deste nó ao mesmo tempo (o mesmo invariante).
   */
  get connectedCharacterCount(): number {
    const characters = new Set<string>();
    for (const hosted of this.#sessions.values()) {
      for (const viewer of hosted.viewers) characters.add(viewer.characterId);
    }
    return characters.size;
  }

  sessionFor(characterId: string): Session | undefined {
    const sessionId = this.#sessionIdByCharacter.get(characterId);
    return sessionId === undefined ? undefined : this.#sessions.get(sessionId)?.session;
  }

  /**
   * Quem enxerga este personagem no campo de visão (FUN-33). Vazio na sessão privada, que não
   * tem AOI — lá "quem enxerga" é a pergunta errada, porque só há um personagem.
   *
   * Existe para MEDIR: `pnpm bench:city` conta vizinhos com isto, e é esse número que decide se
   * a AOI cortou o que veio cortar. Ler daqui é ler a estrutura de verdade, não uma reprodução
   * dela no medidor — que passaria a poder concordar com um defeito.
   */
  interestOf(characterId: string): readonly string[] {
    const hosted = this.#hostedSession(characterId);
    return hosted?.aoi?.visibleTo(characterId) ?? [];
  }

  viewersOf(characterId: string): number {
    const sessionId = this.#sessionIdByCharacter.get(characterId);
    return sessionId === undefined ? 0 : (this.#sessions.get(sessionId)?.viewers.size ?? 0);
  }

  /**
   * Cria e registra a sessão antes de o handshake aceitar o socket. Chamadas simultâneas
   * compartilham a mesma promessa, portanto nunca criam duas sessões locais do personagem.
   */
  async prepare(
    characterId: string,
    initialCharacter?: InitialCharacter,
    accountId?: string,
    party?: PartyTicket,
  ): Promise<PrepareResult> {
    const startedAt = performance.now();
    try {
      return await this.#prepare(characterId, initialCharacter, accountId, party);
    } finally {
      // O que o jogador espera ao reconectar: resolver o diretório, carregar o snapshot e
      // hospedar. É o número que o teste de carga cobra, e ele NÃO inclui o tempo de rede —
      // essa metade é do cliente, e medir as duas juntas aqui esconderia qual delas piorou.
      this.#options.metrics?.observeReattach(performance.now() - startedAt);
    }
  }

  async #prepare(
    characterId: string,
    initialCharacter?: InitialCharacter,
    accountId?: string,
    party?: PartyTicket,
  ): Promise<PrepareResult> {
    const existing = this.sessionFor(characterId);
    if (existing !== undefined) {
      await this.#register(characterId, existing, accountId);
      return { created: false };
    }

    // Ticket de ENTRADA (#402): o personagem NÃO tem sessão local e a party já está em curso.
    // A sessão é achada pelo id dela neste nó; sessão ausente é recusa tipada, não sessão nova.
    if (party?.join === true) {
      return this.#admitLateJoiner(characterId, initialCharacter, accountId, party);
    }

    const pending = this.#preparations.get(characterId);
    if (pending !== undefined) {
      await pending;
      // Quem esperou a preparação de outro NÃO criou nada: soltar seria derrubar a sessão
      // que o outro handshake está prestes a usar.
      return { created: false };
    }

    const preparation = this.#createAndRegister(characterId, initialCharacter, accountId, party);
    this.#preparations.set(characterId, preparation);
    try {
      await preparation;
    } finally {
      if (this.#preparations.get(characterId) === preparation) {
        this.#preparations.delete(characterId);
      }
    }
    return { created: true };
  }

  /**
   * Um personagem NOVO numa hunt que JÁ existe neste nó (#402, ADR 0033 D7, PRD §22).
   *
   * A sessão é achada pelo `sessionId` do ticket — o nó certo foi resolvido pelo `api` a partir
   * do diretório. Aqui dentro, `session.enter` roda na sessão DONA (invariante 9): é o `onEnter`
   * do #397 que aplica o teto de `maxMembers` e recusa acima dele, e é por isso que a lotação
   * otimista do `api` não basta (DT-02).
   */
  async #admitLateJoiner(
    characterId: string,
    initialCharacter: InitialCharacter | undefined,
    accountId: string | undefined,
    party: PartyTicket,
  ): Promise<PrepareResult> {
    const hosted = this.#sessions.get(party.sessionId);
    if (hosted === undefined) return { created: false, refused: 'session-not-here' };
    if (hosted.session.contentVersion !== this.#options.contentVersion) {
      return { created: false, refused: 'content-version' };
    }
    const member = party.members[0];
    const newcomer = member === undefined || this.#options.createParticipant === undefined
      ? undefined
      : this.#options.createParticipant(member.characterId, member.initialCharacter);
    if (newcomer === undefined) return { created: false, refused: 'session-not-here' };
    try {
      hosted.session.enter(newcomer);
    } catch (error) {
      // Teto de `maxMembers` do conteúdo (#397): recusa ESPERADA, não falha de sessão.
      if (error instanceof PartyFullError) return { created: false, refused: 'party-full' };
      throw error;
    }
    // O premium de quem entra DEPOIS do `start` é fato sobre o personagem, não configuração da
    // party (#400): sem ele, a penalidade de morte do recém-chegado usaria o default do líder.
    const ruleset = hosted.session.ruleset as Partial<HuntRuleset>;
    ruleset.setMemberPremium?.(hosted.session, characterId, member?.initialCharacter.premium ?? false);
    // Registro sob lease ANTES do local: registro recusado não pode deixar rastro.
    await this.#register(characterId, hosted.session, accountId);
    // Nome e cores ANTES de `#createLocal`, como no caminho da party nova (FUN-104).
    if (initialCharacter?.name !== undefined) this.#nameByCharacter.set(characterId, initialCharacter.name);
    if (initialCharacter?.outfitColors !== undefined) {
      this.#colorsByCharacter.set(characterId, initialCharacter.outfitColors);
    }
    this.#createLocal(characterId, hosted.session, accountId);
    this.#adoptTicketBotConfig(characterId, hosted.session, initialCharacter);
    return { created: true };
  }

  /** Liga um socket a uma sessão já preparada. */
  attach(socket: ViewerSocket, characterId: string): Viewer {
    let hosted = this.#hostedSession(characterId);
    // Mantém o host sem diretório útil em testes e em consumidores locais. Em produção,
    // `prepare` é obrigatório porque o registro precisa terminar antes do upgrade.
    if (hosted === undefined && this.#options.directory === undefined) {
      this.#createLocal(characterId, this.#options.createSession(characterId));
      hosted = this.#hostedSession(characterId);
    }
    if (hosted === undefined) throw new Error(`session for ${characterId} was not prepared`);
    const metrics = this.#options.metrics;
    const viewer = new Viewer(socket, characterId, {
      ...this.#options.viewer,
      ...(metrics === undefined
        ? {}
        : { onFrame: (messages, bytes) => { metrics.observeFrame(messages, bytes); } }),
    });
    hosted.viewers.add(viewer);
    hosted.session.attach(viewer.id);
    this.#restingSince.set(characterId, null);

    viewer.sendNow({
      type: 'welcome',
      characterId,
      contentVersion: this.#options.contentVersion,
    });

    // O catálogo vem logo depois do `welcome`, e uma vez só: a versão de conteúdo é fixada na
    // sessão (invariante 7), então ele não muda enquanto ela vive. Mensagem própria, e não um
    // campo do `welcome`, porque são assuntos diferentes — quem sou eu, e o que existe para
    // jogar. Vai pela FILA, não por `sendNow`: não é resposta a nada, e furar a fila o poria
    // na frente de deltas que já esperavam.
    const catalogue = this.#options.catalogue;
    if (catalogue !== undefined) viewer.send({ type: 'catalogue', ...catalogue() });

    // E o que ele carrega agora (FUN-90). Sem isto a mochila abre vazia até o primeiro
    // equipar — e uma mochila que mente sobre estar vazia é pior que uma que diz "carregando".
    this.#sendInventory(characterId);

    // O jogador precisa SABER que houve retomada e o que se perdeu. Silenciar aqui é como o
    // modo idle perde a confiança de quem joga: o extrato não fecha e ninguém explica.
    const gapMs = this.#resumedGapMs.get(characterId);
    if (gapMs !== undefined) {
      this.#resumedGapMs.delete(characterId);
      const minutes = Math.round(gapMs / 60_000);
      viewer.send({
        type: 'system-message',
        level: 'warning',
        text: minutes > 0
          ? `Sessão retomada após queda do servidor. Cerca de ${minutes} min de progresso `
            + 'não foram simulados.'
          : 'Sessão retomada após queda do servidor, sem perda perceptível.',
      });
    }
    this.#logger.debug(
      { characterId, sessionId: hosted.session.id, viewers: hosted.viewers.size },
      'Viewer attached',
    );
    return viewer;
  }

  /**
   * Tira o visualizador da lista. NÃO encerra a sessão, não a pausa e não credita nada: a
   * sessão fica exatamente como estava, só que sem ninguém olhando.
   */
  detach(viewer: Viewer): void {
    const sessionId = this.#sessionIdByCharacter.get(viewer.characterId);
    const hosted = sessionId === undefined ? undefined : this.#sessions.get(sessionId);
    if (hosted === undefined) return;

    hosted.viewers.delete(viewer);
    hosted.session.detach(viewer.id);
    // Repouso é do PERSONAGEM: a outra aba dele ainda pode estar olhando, e num shard os
    // outros jogadores da praça certamente estão.
    if (this.#watchers(hosted, viewer.characterId) === 0) {
      this.#restingSince.set(viewer.characterId, this.#now());
    }
    this.#logger.debug(
      { characterId: viewer.characterId, sessionId, viewers: hosted.viewers.size },
      'Viewer detached',
    );
    // A sessão FICA, mesmo sem ninguém olhando — é o ADR 0001, e há teste de integração
    // exigindo que uma reconexão reencontre a MESMA sessão.
    //
    // O que muda com a FUN-52 é só a sessão de REPOUSO: a de cidade, orientada a evento, é
    // recolhida depois de um prazo de carência (ver `#collectResting`). Uma hunt desanexada
    // nunca é — ela é o modo padrão do jogo.
  }

  async #logout(characterId: string): Promise<void> {
    try {
      await this.release(characterId, 1000, 'logout');
    } catch (error) {
      this.#logger.error({ error, characterId }, 'Failed to log the character out');
    }
  }

  /**
   * Tira a sessão deste nó e devolve o slot da conta. Encerra antes de soltar, para o
   * ruleset ter a chance de creditar o que for dele.
   *
   * Fecha TODOS os visualizadores do personagem, não só quem pediu: sair do jogo é do
   * personagem, não da aba. Deixar a outra aba aberta olhando uma sessão que já não existe
   * seria uma tela que não atualiza mais e não diz por quê.
   */
  async release(characterId: string, closeCode?: number, closeReason?: string): Promise<void> {
    const hosted = this.#hostedSession(characterId);
    if (hosted === undefined) return;
    const accountId = this.#accountIdByCharacter.get(characterId);
    const shared = hosted.session.ruleset.shared === true;

    this.#dropViewers(hosted, characterId, closeCode, closeReason);

    if (shared) {
      // Num shard, sair é SAIR — não encerrar (FUN-71, ADR 0023). O jogador que fecha o jogo
      // na praça não pode levar a praça junto, e nada há a creditar: a Cidade não gera
      // progresso (§37). O que ela gera é ESTADO (#154) — e ele sai antes de o participante
      // sair, porque `leave` o tira da lista.
      await this.#saveDurableReceipt(characterId, hosted, 'manual-exit');
      hosted.session.leave(characterId);
      this.#announceDeparture(hosted, characterId);
      // A cópia vazia deixa de ser hospedada. A próxima entrada cria outra, já na versão de
      // conteúdo do momento — ver `CityShard.admit`.
      if (hosted.session.participants.length === 0) this.#sessions.delete(hosted.session.id);
    } else {
      if (hosted.session.ended === null) hosted.session.end('manual-exit');
      // Creditar ANTES de soltar. Sem isto, sair do jogo dentro de uma hunt jogaria fora a XP
      // da sessão inteira: desde a FUN-54 o extrato é o único caminho até o banco, e logo
      // abaixo o snapshot — a outra cópia do progresso — é apagado.
      const receipt = receiptOf(hosted, characterId);
      if (receipt !== null) await this.#saveReceipt(characterId, hosted, receipt);
      // Some daqui quando não sobra ninguém dela (#198): numa party, soltar um membro não pode
      // apagar a sessão que os outros ainda vão creditar — a drenagem passa por eles em seguida.
      const remaining = this.#charactersOf(hosted.session.id).filter((id) => id !== characterId);
      if (remaining.length === 0) this.#sessions.delete(hosted.session.id);
    }

    this.#sessionIdByCharacter.delete(characterId);
    this.#walkingUntil.delete(characterId);
    this.#accountIdByCharacter.delete(characterId);
    this.#nameByCharacter.delete(characterId);
    this.#colorsByCharacter.delete(characterId);
    this.#botByCharacter.delete(characterId);
    this.#restingSince.delete(characterId);

    // A sessão ACABOU: deixar o snapshot faria a próxima conexão ressuscitar uma sessão
    // encerrada, com os agregados de antes.
    await this.#options.snapshots?.remove(characterId).catch(() => undefined);

    const directory = this.#options.directory;
    if (directory === undefined) return;
    try {
      await directory.release(characterId);
      if (accountId !== undefined) await directory.releaseSlot(accountId, characterId);
    } catch (error) {
      // Falhar aqui deixa o slot preso até o lease expirar, que é ruim mas se resolve
      // sozinho. Silenciar seria pior: é a única pista de por que uma conta ficou sem slot.
      this.#logger.error({ error, characterId }, 'Failed to release session from the directory');
    }
    this.#logger.info({ characterId, sessionId: hosted.session.id }, 'Session released');
  }

  /** Ações do jogador são tratadas NA CHEGADA, não enfileiradas para o tick (ver AGENTS.md). */
  handle(viewer: Viewer, message: C2SMessage): void {
    switch (message.type) {
      case 'ping':
        // Fora da fila: `pong` que espera o ciclo mede a fila, não a rede.
        viewer.sendNow({ type: 'pong', t: message.t });
        return;
      case 'session-attach': {
        const hosted = this.#hostedSession(viewer.characterId);
        if (hosted === undefined) return;
        // ENFILEIRADO, nunca `sendNow`. A troca de "estado completo" para "só deltas" precisa
        // ser atômica: mandar o estado na frente da fila o colocaria DEPOIS de deltas que já
        // estavam esperando, e o cliente aplicaria um passo antigo por cima do estado atual.
        // A própria fila é a atomicidade — basta não furá-la.
        this.#sendState(hosted, viewer);
        return;
      }
      case 'enter-hunt':
        // INTENÇÃO, nunca resultado (invariante 4): o cliente diz qual hunt e qual
        // dificuldade, e quem decide se cabe, cria a instância e credita é o servidor.
        void this.#requestTransition(viewer, {
          to: 'hunt', huntId: message.huntId, difficulty: message.difficulty,
          // A hunt nasce compilada com a configuração que o servidor aceitou — do ticket ou
          // da última `bot-config` desta conexão.
          ...(this.#botByCharacter.has(viewer.characterId)
            ? { botConfig: this.#botByCharacter.get(viewer.characterId) as BotConfig }
            : {}),
        });
        return;
      case 'leave-hunt':
        // Sair é voltar para a cidade, não ficar sem sessão: todo personagem está em
        // exatamente uma (invariante 8).
        void this.#requestTransition(viewer, { to: 'city' });
        return;
      case 'logout':
        // Sair do jogo ENCERRA a sessão e devolve o slot; fechar o socket não.
        //
        // A distinção é a que o ADR 0001 faz: desconectar não é sair. Uma hunt precisa
        // sobreviver ao navegador fechado, e é por isso que o `detach` não encerra nada. Mas
        // um `logout` explícito é o jogador dizendo que terminou — e enquanto ele não
        // encerrava nada, o slot de personagem ativo não tinha NENHUMA forma de voltar
        // (FUN-52): dois personagens que já tivessem conectado esgotavam o teto até o
        // processo reiniciar, e nem apagar o personagem funcionava.
        void this.#logout(viewer.characterId);
        return;
      case 'walk':
        // INTENÇÃO: direção, nunca posição resolvida (invariante 4). Processada NA CHEGADA,
        // não enfileirada para o próximo evento — enfileirar põe até 100 ms de jitter em cima
        // do ping, irrelevante na hunt e inaceitável no PvP manual da F5.
        this.#requestWalk(viewer, message.direction);
        return;
      case 'walk-to':
        this.#requestWalk(viewer, message.destination);
        return;
      case 'equip':
        // INTENÇÃO (invariante 4): o cliente diz QUAL item, e quem decide se ele cabe, se o
        // level basta e em que slot vai é o servidor.
        this.#requestEquip(viewer, message.instanceId);
        return;
      case 'select-ammo':
        this.#requestAmmo(viewer, message.ammoId);
        return;
      case 'choose-vocation':
        // INTENÇÃO (invariante 4): o cliente diz QUAL vocação; level, arma e slot são daqui.
        this.#requestVocation(viewer, message.vocationId);
        return;
      case 'move-item':
        // INTENÇÃO (invariante 4): dois lugares; empilhar, vestir e recusar são do servidor.
        this.#requestMove(viewer, message.from, message.to);
        return;
      case 'unequip':
        this.#requestUnequip(viewer, message.slot);
        return;
      case 'bot-config':
        // INTENÇÃO (invariante 4): o jogador manda as REGRAS, e quem decide se elas valem —
        // vocabulário, slots, catálogo e gate de level — é o servidor.
        void this.#configureBot(viewer, message.config);
        return;
      case 'party-settings':
        // INTENÇÃO (invariante 4): os campos já vêm tipados pelo protocolo (#393); quem
        // confere liderança e catálogo é `configureParty`, dentro da sessão dona (invariante 9).
        this.#configureParty(viewer, message);
        return;
      case 'party-end-vote':
        // INTENÇÃO (invariante 4): o líder propõe e os membros respondem; quem confere quem
        // pode propor e se todos já aprovaram é o `sim`, dentro da sessão dona (invariante 9).
        this.#partyEndVote(viewer, message);
        return;
      case 'say':
        // Chat NÃO passa pelo `sim`: ele não muda resultado de simulação nenhuma, e pôr
        // texto de jogador dentro do motor puro só criaria estado para snapshotar sem
        // motivo. O host roteia direto para os visualizadores da sessão (FUN-58).
        this.#say(viewer, message.channel, message.text);
        return;
      case 'authenticate':
      case 'client-ready':
        // Vestigiais, e ignoradas de propósito. A autenticação é do handshake (FUN-12);
        // aceitar credencial pelo socket seria um SEGUNDO caminho de autenticação, que é
        // pior que nenhum. `client-ready` não tem consumidor: `welcome` sai no handshake e
        // `session-state` sai no `session-attach`.
        return;
    }
  }

  /**
   * `say` (FUN-58): o único canal é `local`, e o alcance é a SESSÃO inteira — quem está na
   * mesma instância recebe, o autor inclusive, e ninguém de fora. Raio em tiles é interest
   * management (FUN-33), e inventar um aqui seria decidir duas vezes.
   *
   * Toda recusa é silenciosa: um cliente com bug mandando em laço não pode gerar tráfego de
   * volta. Canal desconhecido é recusado no servidor, e não no schema — um canal que aceita
   * qualquer nome vira dez canais fantasma no primeiro cliente com bug.
   */
  #say(from: Viewer, channel: string, text: string): void {
    if (channel !== 'local') return;
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    // Controle de caracteres fora, como no nome de personagem (FUN-11). `\p{C}` pega
    // zero-width e bidi override, que é como se falsifica nome de autor na tela.
    if (/\p{C}/u.test(trimmed)) return;

    const hosted = this.#hostedSession(from.characterId);
    if (hosted === undefined) return;
    const author = this.#nameByCharacter.get(from.characterId) ?? from.characterId;
    const message = {
      type: 'chat-message', channel: 'local', author, text: trimmed,
    } as const;
    // ENFILEIRADO, no lote do ciclo — não `sendNow`. Chat não é `pong`: 100 ms de atraso é
    // invisível, e furar a fila põe a mensagem na frente de deltas que já esperavam.
    //
    // O alcance é o CAMPO DE VISÃO (FUN-33), e é o que `local` sempre quis dizer. Até aqui era
    // a sessão inteira, com o `docs/product/chat.md` registrando que o raio era desta issue —
    // e numa praça de duzentos "local" alcançando duzentos é o canal global com outro nome.
    if (hosted.aoi === null) {
      for (const viewer of hosted.viewers) viewer.send(message);
      return;
    }
    this.#sendToViewersOf(hosted, from.characterId, message);
    for (const other of hosted.aoi.visibleTo(from.characterId)) {
      this.#sendToViewersOf(hosted, other, message);
    }
  }

  /**
   * Um passo pedido pelo jogador (FUN-69): direção ou destino, resolvidos aqui em um tile e
   * entregues ao MESMO sistema de movimento que o bot e o monstro usam.
   *
   * Recusa é silenciosa de propósito: `walk` sai dezenas de vezes por segundo de um cliente
   * segurando a tecla, e responder cada recusa geraria tráfego de volta a partir de tráfego
   * de entrada. Morto não anda, e é decidido antes de chegar ao sistema.
   */
  #requestWalk(viewer: Viewer, target: 'north' | 'east' | 'south' | 'west' | GridPoint): void {
    const hosted = this.#hostedSession(viewer.characterId);
    if (hosted === undefined) return;
    const session = hosted.session;
    const ruleset = session.ruleset;
    if (ruleset.requestMove === undefined) return;
    const character = session.participants.find((p) => p.id === viewer.characterId);
    if (character === undefined || !character.alive) return;
    // Um passo por vez (FUN-122): o anterior ainda está em curso, e este chegou cedo demais —
    // a rajada de uma tecla presa, ou um cliente que manda mais rápido do que anda.
    const now = this.#now();
    if (now < (this.#walkingUntil.get(viewer.characterId) ?? 0)) return;

    const from = character.position;
    const to = typeof target === 'string'
      ? { x: from.x + DIRECTION_DX[target], y: from.y + DIRECTION_DY[target] }
      : { x: target.x, y: target.y };

    const result = ruleset.requestMove(session, viewer.characterId, to);
    if (!result.ok) return;
    this.#walkingUntil.set(viewer.characterId, now + result.durationMs);
    // A Cidade não tem ciclo (`hz` 0): o evento precisa virar pacote agora, senão ele fica
    // no buffer da sessão até alguém drenar — e ninguém drena o que não tica.
    this.#presentMoves(hosted);
  }

  /**
   * Executa a transição pedida pelo jogador e conta o que aconteceu.
   *
   * A recusa vira MENSAGEM, e é o produto: "você não pode fazer isso" é o texto que faz
   * alguém achar que o jogo travou. Cada recusa diz o que fazer em seguida.
   */
  /**
   * Vestir um item (§21.4, FUN-82). Processado NA CHEGADA, como o passo — o jogador clicou.
   *
   * Quem valida é o `sim`: level, vocação, slot e capacidade são regra de jogo, e regra de jogo
   * não mora no host. O host traduz a recusa em mensagem, e é só isso que ele faz.
   */
  #requestEquip(viewer: Viewer, instanceId: string): void {
    const character = this.#ownerOf(viewer.characterId);
    if (character === undefined) return;
    const result = character.inventory.equip(instanceId, character, this.#options.itemCatalog ?? EMPTY_ITEMS);
    if (result.ok) this.#markDirty(viewer.characterId);
    this.#answerInventory(viewer, result);
  }

  /** O personagem mudou estado durável num shard (#154): o logout precisa gravar. */
  #markDirty(characterId: string): void {
    this.#hostedSession(characterId)?.dirty.add(characterId);
  }

  #requestUnequip(viewer: Viewer, slot: string): void {
    const character = this.#ownerOf(viewer.characterId);
    if (character === undefined) return;
    // O slot chega como string do cliente e é conferido pelo CONTEÚDO, como a dificuldade de
    // hunt: repetir a lista no protocolo criaria um segundo lugar para ela divergir.
    if (!(ITEM_SLOTS as readonly string[]).includes(slot)) {
      viewer.send({ type: 'system-message', level: 'warning', text: 'Esse lugar não existe.' });
      return;
    }
    const result = character.inventory.unequip(slot as ItemSlot, this.#containerRules(character));
    if (result.ok) this.#markDirty(viewer.characterId);
    this.#answerInventory(viewer, result);
  }

  /**
   * Mover um item (#160, ADR 0026 decisão 6). Processado NA CHEGADA, como equipar. O `sim`
   * decide — troca, pilha, veste, desveste, recusa — numa transação; o host confere só o que
   * o protocolo deixou aberto (o slot é string) e traduz a recusa.
   */
  #requestMove(viewer: Viewer, from: Place | { readonly slot: string }, to: Place | { readonly slot: string }): void {
    const character = this.#ownerOf(viewer.characterId);
    if (character === undefined) return;
    // O slot chega como string e é conferido pelo CONTEÚDO, como em `#requestUnequip`.
    for (const end of [from, to]) {
      if ('slot' in end && !(ITEM_SLOTS as readonly string[]).includes(end.slot)) {
        viewer.send({ type: 'system-message', level: 'warning', text: 'Esse lugar não existe.' });
        return;
      }
    }
    const result = character.inventory.move(
      from as Place, to as Place, this.#options.itemCatalog ?? EMPTY_ITEMS, character, this.#containerRules(character),
    );
    if (result.ok) this.#markDirty(viewer.characterId);
    this.#answerInventory(viewer, result);
  }

  /** Os tamanhos de container deste personagem (#160): a mochila que ele veste, e a tabela. */
  #containerRules(character: CharacterRuntime): ContainerRules {
    const progression = this.#options.progression;
    if (progression === undefined) {
      return { backpackSlots: 0, satchelSlots: 0, row: 1 };
    }
    return containerRulesFor(character.inventory, this.#options.itemCatalog ?? EMPTY_ITEMS, progression);
  }

  /**
   * Escolher a munição (#152, ADR 0026 decisão 3). Processado NA CHEGADA, como equipar. Quem
   * confere o level é o `sim`; o host traduz a recusa e, no sucesso, manda os vitais com a
   * escolha nova — na Cidade não há ciclo que os compare, e o seletor precisa ver a resposta.
   */
  #requestAmmo(viewer: Viewer, ammoId: string): void {
    const hosted = this.#hostedSession(viewer.characterId);
    const character = this.#ownerOf(viewer.characterId);
    if (hosted === undefined || character === undefined) return;
    const ammo = this.#options.ammunition?.get(ammoId);
    if (ammo === undefined) {
      viewer.send({ type: 'system-message', level: 'warning', text: 'Essa munição não existe.' });
      return;
    }
    const result = character.selectAmmo(ammo);
    if (!result.ok) {
      viewer.send({ type: 'system-message', level: 'warning', text: 'Seu level não basta para essa munição.' });
      return;
    }
    hosted.dirty.add(character.id);
    const stats = playerStatsOf(character, this.#options.skillCatalog, this.#targetIdOf(hosted, character));
    hosted.sentStats.set(character.id, stats);
    this.#sendToViewersOf(hosted, character.id, { type: 'player-stats', ...stats });
  }

  /**
   * Escolher a vocação (#154, ADR 0026 decisão 1). Processada NA CHEGADA, como equipar. Quem
   * decide é o `sim`; o host resolve vocação e arma no conteúdo fixado na sessão (invariante
   * 7), traduz a recusa, e no sucesso manda vitais e inventário — na Cidade não há ciclo que
   * os compare.
   */
  #requestVocation(viewer: Viewer, vocationId: string): void {
    const hosted = this.#hostedSession(viewer.characterId);
    const character = this.#ownerOf(viewer.characterId);
    if (hosted === undefined || character === undefined) return;
    const vocations = this.#options.vocations;
    const vocationLevel = this.#options.vocationLevel;
    if (vocations === undefined || vocationLevel === undefined) {
      viewer.send({ type: 'system-message', level: 'warning', text: 'Este servidor não tem vocações.' });
      return;
    }
    const vocation = vocations.get(vocationId);
    if (vocation === undefined) {
      viewer.send({ type: 'system-message', level: 'warning', text: 'Essa vocação não existe.' });
      return;
    }
    const weapon = vocation.startingWeaponItemId === undefined
      ? null
      : this.#options.itemCatalog?.get(vocation.startingWeaponItemId) ?? null;
    if (vocation.startingWeaponItemId !== undefined && weapon === null) {
      viewer.send({ type: 'system-message', level: 'warning', text: 'A arma dessa vocação não existe.' });
      return;
    }
    const result = character.chooseVocation(vocation, weapon, {
      catalog: this.#options.itemCatalog ?? EMPTY_ITEMS,
      vocationLevel,
      // Uma por personagem, e com o id DELE no meio: numa cópia da Cidade dois personagens
      // compartilham `session.id`, e `${session.id}:${lootSeq}` colidiria na chave primária
      // de `item_instance`. O prefixo da sessão é o que `acquiredBy` filtra.
      instanceId: `${hosted.session.id}:${character.id}:vocation`,
      rules: this.#containerRules(character),
    });
    if (!result.ok) {
      viewer.send({ type: 'system-message', level: 'warning', text: VOCATION_REFUSAL[result.reason] });
      return;
    }
    if (result.weapon === 'in-loot-box') {
      viewer.send({
        type: 'system-message', level: 'info',
        text: 'A arma da sua vocação não coube na mochila e foi para a Caixa de Loot.',
      });
    }
    hosted.dirty.add(character.id);
    const stats = playerStatsOf(character, this.#options.skillCatalog, this.#targetIdOf(hosted, character));
    hosted.sentStats.set(character.id, stats);
    this.#sendToViewersOf(hosted, character.id, { type: 'player-stats', ...stats });
    this.#sendInventory(character.id);
  }

  #ownerOf(characterId: string): CharacterRuntime | undefined {
    const hosted = this.#hostedSession(characterId);
    return hosted === undefined ? undefined : this.#participantOf(hosted, characterId);
  }

  /**
   * Traduz a recusa do `sim` em algo que o jogador entenda, ou manda o inventário novo.
   *
   * O sucesso NÃO vira mensagem de sistema — vira o estado. "Equipado com sucesso" é ruído; o
   * item mudando de lugar na tela é a confirmação.
   */
  #answerInventory(viewer: Viewer, result: InventoryResult): void {
    if (!result.ok) {
      viewer.send({
        type: 'system-message', level: 'warning',
        text: INVENTORY_REFUSAL[result.reason] as string,
      });
      return;
    }
    this.#sendInventory(viewer.characterId);
  }

  /**
   * O que o personagem carrega e veste, para quem estiver olhando ELE (FUN-90).
   *
   * **O peso é calculado aqui**, e não no cliente: quem sabe o que cabe é quem recusa, e a
   * mesma conta em dois lugares diverge no primeiro item com peso fracionário.
   *
   * **O equipado vai INTEIRO** — `instanceId`, `itemId` e `quantity`, como uma entrada da
   * mochila (FUN-108). O `sim` MOVE o item para o corpo ao equipar, não o copia, então um
   * `slot → instanceId` não deixava o cliente chegar à definição: o slot vestido ficava sem
   * nome e sem sprite. O que vai ao extrato (`equipmentOf`) continua `slot → instanceId`,
   * porque o banco só precisa de onde cada linha está.
   */
  #sendInventory(characterId: string): void {
    const hosted = this.#hostedSession(characterId);
    const character = this.#ownerOf(characterId);
    if (hosted === undefined || character === undefined) return;

    const catalog = this.#options.itemCatalog ?? EMPTY_ITEMS;
    const state = character.inventory.getState();
    const carried = (item: CarriedItem): NonNullable<S2CProps<'inventory'>['backpack'][number]> => ({
      instanceId: item.instanceId, itemId: item.itemId, quantity: item.quantity,
    });
    const place = (item: CarriedItem | null) => (item === null ? null : carried(item));
    const equipped: S2CProps<'inventory'>['equipped'] = {};
    for (const [slot, item] of Object.entries(state.equipped)) {
      if (item !== undefined) equipped[slot] = carried(item);
    }

    this.#sendToViewersOf(hosted, characterId, {
      type: 'inventory',
      // Posicional (#160): `null` é lugar vazio, e o comprimento é o tamanho do container.
      backpack: state.backpack.map(place),
      satchel: (state.satchel ?? []).map(place),
      equipped,
      capacity: { used: character.inventory.weight(catalog), total: character.capacity },
    });
  }

  /**
   * O jogador salvou uma configuração de bot (FUN-81, §13).
   *
   * A ordem importa e é: aceitar → aplicar → registrar → confirmar (ADR 0028). Aplicar antes
   * de registrar é deliberado — a hunt em curso passa a usar a regra nova na hora, e uma falha
   * de persistência não pode fazer o jogador ficar sem a cura que acabou de configurar. Já a
   * confirmação espera o registro: `ok: true` significa que a preferência está no Redis, de
   * onde `jobs`/`api` a levam ao Postgres, e `ok: false` diz ao jogador que a regra vale
   * agora mas precisa ser salva de novo.
   */
  async #configureBot(viewer: Viewer, raw: unknown): Promise<void> {
    const accept = this.#options.acceptBotConfig;
    if (accept === undefined) {
      viewer.send({
        type: 'bot-config-result', ok: false,
        reason: 'Este servidor não aceita configuração de bot.',
      });
      return;
    }

    const hosted = this.#hostedSession(viewer.characterId);
    const character = hosted?.session.participants
      .find((p) => p.id === viewer.characterId);
    if (hosted === undefined || character === undefined) return;

    const decision = accept(raw, character.level);
    if (!decision.ok) {
      viewer.send({ type: 'bot-config-result', ok: false, reason: decision.reason });
      return;
    }

    this.#botByCharacter.set(viewer.characterId, decision.config);
    this.#applyBotConfig(hosted, decision.config, viewer.characterId);
    // Aplicar continua imediato; confirmar espera o Redis aceitar a pendência.
    // Falha não desfaz a regra em uso, mas permite ao jogador tentar salvar novamente.
    try {
      if (this.#options.saveBotConfig === undefined) throw new Error('Bot persistence is unavailable');
      await this.#options.saveBotConfig(viewer.characterId, decision.config);
      viewer.send({ type: 'bot-config-result', ok: true });
    } catch (error) {
      this.#logger.error(
        { error, characterId: viewer.characterId }, 'Failed to persist bot configuration',
      );
      viewer.send({
        type: 'bot-config-result', ok: false,
        reason: 'A configuração vale nesta sessão, mas não pôde ser salva. Tente salvar de novo.',
      });
    }
  }

  /**
   * `party-settings` (ADR 0033 D1/D2). Ao contrário de `#configureBot`, não há vocabulário para
   * validar aqui — os campos já vêm tipados pelo protocolo (#393) — e não há persistência
   * própria: o estado é do ruleset, e viaja no MESMO snapshot da sessão (D1, sem bump).
   *
   * A recusa é `system-message` (D12); não existe `party-settings-result`. O sucesso não manda
   * ack: o próximo `#presentPartyLive` vê a mudança e broadcasta o `party-state` novo, o mesmo
   * caminho que a saída de um membro usa.
   */
  #configureParty(
    viewer: Viewer,
    message: Extract<C2SMessage, { type: 'party-settings' }>,
  ): void {
    const hosted = this.#hostedSession(viewer.characterId);
    const ruleset = hosted?.session.ruleset as Partial<HuntRuleset> | undefined;
    if (hosted === undefined || ruleset?.configureParty === undefined) return;
    // As chaves ausentes ficam AUSENTES, nunca `undefined` explícito: `PartySettingsPatch` sob
    // `exactOptionalPropertyTypes` distingue as duas, e o `sim` usa `??` para não mexer no eixo.
    const patch: PartySettingsPatch = {
      ...(message.shareCosts === undefined ? {} : { shareCosts: message.shareCosts }),
      ...(message.splitLoot === undefined ? {} : { splitLoot: message.splitLoot }),
      ...(message.collect === undefined ? {} : { collect: message.collect }),
      ...(message.autoSell === undefined ? {} : { autoSell: message.autoSell }),
    };
    const decision = ruleset.configureParty(hosted.session, patch, viewer.characterId);
    if (!decision.ok) {
      viewer.send({ type: 'system-message', level: 'warning', text: partyRefusalText(decision) });
      return;
    }
  }

  /**
   * `party-end-vote` (#432, ADR 0032 d.14): encerrar a hunt para todos é uma votação do líder,
   * e não um `end`. A MESMA mensagem serve para propor e aprovar — `approve: true` é proposta
   * quando quem manda é o líder e aprovação quando é membro —, e `approve: false` é recusa.
   *
   * O host não decide nada disso: liderança, presença e "todos aprovaram" são regra de jogo, e
   * moram no `sim` (invariante 9). O broadcast do estado sai pelo evento `party-end-vote` do
   * ruleset; a recusa vira `system-message`, como em `party-settings`.
   */
  #partyEndVote(
    viewer: Viewer,
    message: Extract<C2SMessage, { type: 'party-end-vote' }>,
  ): void {
    const hosted = this.#hostedSession(viewer.characterId);
    const ruleset = hosted?.session.ruleset as Partial<HuntRuleset> | undefined;
    if (hosted === undefined || ruleset?.proposeEnd === undefined || ruleset.approveEnd === undefined) {
      return;
    }
    let decision: PartyEndVoteResult;
    if (!message.approve) {
      decision = ruleset.cancelEnd?.(hosted.session, viewer.characterId)
        ?? { ok: false, reason: 'no-proposal' };
    } else if (ruleset.party === undefined || ruleset.party.leaderId === viewer.characterId) {
      // O líder propõe (e a proposta já carrega o sim dele); solo não tem líder, e cai aqui
      // para receber `not-leader` em vez de `no-proposal`. Re-propor reinicia a janela.
      decision = ruleset.proposeEnd(hosted.session, viewer.characterId);
    } else {
      decision = ruleset.approveEnd(hosted.session, viewer.characterId);
    }
    if (!decision.ok) {
      viewer.send({
        type: 'system-message', level: 'warning', text: partyEndVoteRefusalText(decision),
      });
      return;
    }
    // O último sim encerra a sessão AQUI, fora do ciclo — e o ciclo pula sessão já encerrada
    // (`cycle`), então a sucessão precisa ser disparada daqui: extrato, `session-ended` e
    // Cidade, na mesma ordem de quando a morte encerra por dentro (FUN-38).
    if (hosted.session.ended !== null) void this.#succeed(hosted);
  }

  /**
   * A configuração que veio no ticket (FUN-81). Recusada é IGNORADA, nunca fatal.
   *
   * O caso real é conteúdo mudando debaixo de uma configuração salva: uma magia renomeada, um
   * vocabulário novo. Derrubar a conexão por isso trancaria o personagem fora do jogo por um
   * arquivo de balanceamento — entrar sem bot e avisar é a degradação certa.
   */
  #adoptTicketBotConfig(
    characterId: string, session: Session, initial: InitialCharacter | undefined,
  ): void {
    const raw = initial?.botConfig;
    const accept = this.#options.acceptBotConfig;
    if (raw === undefined || accept === undefined) return;

    const level = session.participants.find((p) => p.id === characterId)?.level
      ?? initial?.level ?? 1;
    const decision = accept(raw, level);
    if (!decision.ok) {
      this.#logger.warn(
        { characterId, reason: decision.reason }, 'Stored bot configuration refused',
      );
      return;
    }
    this.#botByCharacter.set(characterId, decision.config);
  }

  /**
   * Troca a configuração da hunt em curso. Ruleset que não tem bot ignora, e é o normal.
   *
   * **O `characterId` é obrigatório na party (#203/#407):** sem ele, `configureBot` cai no
   * PRIMEIRO participante e a configuração de quem falou sobrescreve a do líder. O bot é por
   * personagem — `#botByCharacter` já é — e o `sim` aceita o id de propósito.
   */
  #applyBotConfig(hosted: HostedSession, config: BotConfig, characterId: string): void {
    const ruleset = hosted.session.ruleset as Partial<HuntRuleset>;
    // A sessão dona é quem escreve (invariante 9), e é ela que está aqui: `configureBot`
    // recompila dentro do ruleset, não de fora.
    ruleset.configureBot?.(hosted.session, config, characterId);
  }

  async #requestTransition(viewer: Viewer, request: TransitionRequest): Promise<void> {
    try {
      await this.transition(viewer.characterId, request);
    } catch (error) {
      if (error instanceof TransitionError) {
        viewer.send({
          type: 'system-message', level: 'warning', text: REFUSAL_TEXT[error.refusal],
        });
        return;
      }
      // Falha inesperada: o personagem continua onde estava, que é o estado seguro.
      this.#logger.error(
        { error, characterId: viewer.characterId, to: request.to },
        'Transition failed',
      );
      viewer.send({
        type: 'system-message', level: 'error', text: 'Não foi possível mudar de atividade.',
      });
    }
  }

  /**
   * Um ciclo: avança quem tem tick a dever e manda um frame por visualizador.
   *
   * A taxa é perguntada ao ruleset A CADA ciclo porque ela muda com a presença de
   * visualizador — anexar acelera, desanexar desacelera, e nada disso altera o resultado
   * (invariante 2).
   */
  cycle(nowMs: number = this.#now()): void {
    for (const hosted of [...this.#sessions.values()]) {
      const hz = hosted.session.currentHz();
      // `0` é orientada a evento: cidade e treino não têm laço nenhum.
      if (hz <= 0) {
        this.#collectResting(hosted, nowMs);
        continue;
      }
      if (hosted.session.ended !== null) continue;
      const periodMs = 1000 / hz;
      // Contra a marca DESTE processo, e não contra o relógio da sessão: desde a FUN-68 o
      // tempo lá dentro é lógico, começa em zero, e comparar os dois compararia grandezas
      // diferentes — uma hunt com dez minutos de relógio lógico pareceria dez minutos
      // atrasada no primeiro ciclo depois de retomada.
      const overdueMs = nowMs - hosted.lastAdvancedAtMs;
      if (overdueMs < periodMs) continue;
      hosted.lastAdvancedAtMs = nowMs;
      const startedAt = this.#options.metrics === undefined ? 0 : performance.now();
      try {
        hosted.session.advanceBy(overdueMs);
      } catch (error) {
        // Uma sessão que explode não pode derrubar as outras do nó.
        this.#logger.error({ error, sessionId: hosted.session.id }, 'Session tick failed');
      }
      // O ATRASO é quanto o tick passou do período que ele mesmo pediu, não o intervalo. Um
      // tick de 1 Hz que roda a cada 1000 ms está no prazo; o mesmo intervalo num tick de
      // 10 Hz é 900 ms de atraso, e é essa diferença que diz que o nó saturou.
      const lagMs = Math.max(0, overdueMs - periodMs);
      this.#options.metrics?.observeTick(
        hosted.session.ruleset.type,
        (performance.now() - startedAt) * 1000,
        lagMs,
      );
      // O alerta que a issue pede, no único lugar onde este nó consegue falar hoje. Um pico
      // isolado não acorda ninguém — só o primeiro de uma rajada, para o log não virar a
      // própria causa do atraso quando o nó satura de verdade.
      if (lagMs > TICK_LAG_BUDGET_MS) this.#warnLag(hosted.session.ruleset.type, lagMs, nowMs);
      // A sessão pode ter acabado DENTRO do tick — a morte é o caso (§26.1), e ela acontece
      // com o jogador ausente na maior parte das vezes. Se a sucessão dependesse de alguém
      // estar olhando, o invariante 3 estaria quebrado.
      // O mundo que aconteceu neste avanço vira pacote AQUI, e não dentro do `sim` — que não
      // conhece socket nem numeração de criatura do fio (invariante 1, §12).
      this.#presentMoves(hosted);
      // E os vitais do jogador, se mudaram (FUN-109). DEPOIS dos eventos: o `creature-hit` e o
      // `creature-health` explicam a mudança, e o HUD que recebe o número novo antes do golpe
      // que o causou mostra o dano duas vezes — uma no HUD, outra no número flutuante.
      this.#presentStats(hosted);
      this.#presentConditions(hosted);
      // E o analisador, se um abate, um loot, um gasto ou um evento entrou (FUN-110): sem
      // isto a janela ficava em zero a hunt inteira, até o jogador reconectar.
      this.#presentAnalyzer(hosted);
      this.#presentSpending(hosted);
      // E o Bestiário, se um abate contou (FUN-113): é progressão permanente, e a tela precisa
      // ver o marco chegar sem reconectar.
      this.#presentBestiary(hosted);
      this.#presentPartyLive(hosted);
      // Caiu loot desde o último ciclo: a mochila mudou, e quem está olhando precisa ver.
      // Comparar um inteiro é o que evita serializar o inventário dez vezes por segundo.
      if (hosted.session.aggregates.itemsLooted !== hosted.sentItemsLooted) {
        hosted.sentItemsLooted = hosted.session.aggregates.itemsLooted;
        for (const characterId of this.#charactersOf(hosted.session.id)) {
          this.#sendInventory(characterId);
        }
      }
      if (hosted.departures.length > 0) void this.#settleDepartures(hosted);
      if (hosted.session.ended !== null) void this.#succeed(hosted);
    }
    this.flush();
    this.#observeSessions();
  }

  /**
   * Traduz os eventos de domínio do avanço em `creature-move` para quem está olhando.
   *
   * É o `PresentationAdapter` do §12: o `sim` produz `CreatureMoved` haja ou não visualizador,
   * e é aqui que se decide se aquilo vira bytes. A hunt desanexada — o modo padrão do jogo —
   * produz exatamente os mesmos eventos e não serializa nenhum.
   *
   * **Drena SEMPRE**, inclusive sem visualizador. O buffer é da sessão, e uma hunt que ninguém
   * olha não pode acumular apresentação por horas; a `Session` tem teto próprio, mas depender
   * dele seria deixar o descarte acontecer no lugar errado.
   */
  #presentMoves(hosted: HostedSession): void {
    const events = hosted.session.drainEvents();
    if (events.length === 0) return;
    // Sem ninguém olhando nada é apresentado — mas a saída de um membro (#194) não é
    // apresentação: é extrato e Cidade, e acontece haja ou não visualizador (invariante 3).
    if (hosted.viewers.size === 0) {
      for (const event of events) {
        if (event.kind === 'member-left') hosted.departures.push(event);
        // A bolsa é ESTADO, não apresentação (#400): sem ninguém olhando, o último
        // `party-bag-changed` ainda é guardado para o `session-state` de quem reanexar levar
        // as reservas — `getState()` não as carrega.
        else if (event.kind === 'party-bag-changed') hosted.lastPartyBag = event;
      }
      return;
    }

    for (const event of events) {
      // Discriminar por `kind` ANTES de tocar em qualquer campo: a união cresceu na FUN-103 e
      // de novo na FUN-109, e um cast em vez de um switch aqui leria um nascimento — ou um
      // golpe — como se fosse um passo. Cada família tem o seu tradutor; o que sobra do
      // switch é o passo, que segue abaixo.
      switch (event.kind) {
        case 'creature-appeared':
        case 'creature-vanished':
        case 'creature-health-changed':
        case 'ground-item-appeared':
        case 'ground-item-vanished':
          this.#presentPresence(hosted, event);
          continue;
        case 'creature-hit':
        case 'creature-healed':
        case 'spell-cast':
        case 'supply-used':
        case 'shot':
        case 'monster-ability-cast':
          this.#presentCombat(hosted, event);
          continue;
        case 'party-bag-changed':
        case 'party-settlement':
        case 'party-state':
        case 'party-end-vote':
          this.#presentParty(hosted, event);
          continue;
        case 'follow-state':
          // POR PERSONAGEM (#401) — ao contrário dos casos de party acima, que são da SESSÃO
          // inteira (todo membro vê a bolsa e a composição), Follow é configuração de bot de
          // UM personagem: vazar para quem olha outro membro exporia a estratégia de bot de
          // alguém para os companheiros sem que ele tenha pedido isso — o mesmo motivo de
          // `player-stats` (FUN-109) e `active-conditions` serem por personagem.
          this.#presentFollow(hosted, event);
          continue;
        case 'member-left':
          // Alguém saiu por dentro do `sim` (#193): extrato e volta à Cidade são I/O, e o
          // ciclo é síncrono — fica na fila e sai logo depois dele (#194).
          hosted.departures.push(event);
          continue;
        case 'creature-moved':
          break;
      }
      // O protocolo exige duração positiva: um passo é enviado UMA vez, com origem, destino e
      // duração, e o cliente interpola o intervalo inteiro (ADR 0001). Duração zero é
      // colocação, não passo — aparecer no mundo é `creature-appear`.
      if (event.durationMs <= 0) continue;
      const subject = String(event.creatureId);
      const message = {
        type: 'creature-move',
        id: this.#creatureId(hosted, subject),
        from: event.from,
        to: event.to,
        durationMs: event.durationMs,
      } as const;

      const aoi = hosted.aoi;
      if (aoi === null) {
        // Sessão privada: os visualizadores já são todos do mesmo personagem.
        for (const viewer of hosted.viewers) viewer.send(message);
        continue;
      }

      // No shard, o passo vai para quem TEM ele no campo (FUN-33) — não para a praça. É esta
      // linha que troca O(N²) por O(vizinhos), e vizinhos não crescem com a população: o mapa
      // é o mesmo, e tile é exclusivo.
      const change = aoi.move(subject, event.to);
      this.#applyVisibility(hosted, subject, change);
      this.#sendToViewersOf(hosted, subject, message);
      for (const other of aoi.visibleTo(subject)) {
        // Quem ACABOU de vê-lo já recebeu `creature-appear`, com a posição de chegada. Mandar
        // o passo também faria o cliente animar uma caminhada a partir de um tile em que a
        // criatura nunca esteve, para ele.
        if (change.appeared.includes(other)) continue;
        this.#sendToViewersOf(hosted, other, message);
      }
    }
  }

  /**
   * Nascimento, sumiço e vida de MONSTRO viram `creature-appear`, `creature-disappear` e
   * `creature-health` (FUN-103).
   *
   * Vai para TODOS os visualizadores da sessão, e não pelo campo de visão: monstro só existe em
   * hunt, e hunt é privada — `hosted.aoi` é `null` ali, e "todos" já é a resposta certa. Se um
   * dia um monstro viver num shard, é `#applyVisibility` que precisa aprender a lidar com
   * criatura sem visualizador, e não este método que precisa de um `if`.
   *
   * O `sim` manda só o `monsterId`; nome e `outfitId` saem do catálogo fixado na sessão. Sem
   * catálogo o monstro ainda aparece — sem nome, outfit 0 —, porque sumir com ele esconderia
   * de quem olha que a simulação está de pé.
   *
   * A vida do PERSONAGEM chega pelo mesmo `creature-health-changed` desde a FUN-109, e sai
   * pelo mesmo caminho: a chave é o `characterId`, que `#sessionState` já mapeou no
   * `session-attach`. Sem id é porque ninguém pediu o estado ainda — e quem não tem o mundo
   * não tem barra para atualizar; o `session-state` que vier traz a vida certa.
   */
  #presentPresence(hosted: HostedSession, event: PresenceEvent): void {
    // O cadáver (FUN-123): o `sim` disse qual monstro e onde; a arte é da tabela. Monstro sem
    // linha em `appearances.corpses` não deixa nada — e ninguém fica sabendo, de propósito.
    if (event.kind === 'ground-item-appeared') {
      const appearanceId = this.#options.monsterCatalog?.get(event.monsterId)?.corpseAppearanceId;
      if (appearanceId === undefined) return;
      const appeared: S2CMessage = { type: 'ground-item-appear', id: event.itemId, position: event.position, appearanceId };
      for (const viewer of hosted.viewers) viewer.send(appeared);
      return;
    }
    if (event.kind === 'ground-item-vanished') {
      const vanished: S2CMessage = { type: 'ground-item-disappear', id: event.itemId };
      for (const viewer of hosted.viewers) viewer.send(vanished);
      return;
    }
    const key = String(event.creatureId);
    let message: S2CMessage;
    if (event.kind === 'creature-appeared') {
      const definition = this.#options.monsterCatalog?.get(event.monsterId);
      message = {
        type: 'creature-appear',
        id: this.#creatureId(hosted, key),
        position: event.position,
        appearanceId: definition?.outfitId ?? 0,
        name: definition?.name ?? event.monsterId,
        health: event.health,
        maxHealth: event.maxHealth,
      };
    } else if (event.kind === 'creature-vanished') {
      const id = hosted.creatureIds.get(key);
      // Nunca anunciado — morreu antes de alguém olhar. Não há o que retirar da tela.
      if (id === undefined) return;
      message = { type: 'creature-disappear', id };
      // O número NÃO é reaproveitado (ver `nextCreatureId`); só a chave sai do mapa, senão
      // ele cresce um item por respawn até o fim da hunt.
      hosted.creatureIds.delete(key);
    } else {
      const id = hosted.creatureIds.get(key);
      if (id === undefined) return;
      message = { type: 'creature-health', id, health: event.health, maxHealth: event.maxHealth };
    }
    for (const viewer of hosted.viewers) viewer.send(message);
  }

  /**
   * Golpe, cura, magia e supply viram `creature-hit`, `effect` e `missile` (FUN-109).
   *
   * Para TODOS os visualizadores da sessão, pela MESMA decisão de `#presentPresence`: combate
   * só existe em hunt, hunt é privada, e "todos" já é a resposta certa. No dia em que houver
   * golpe num shard, é o campo de visão que decide — e é `#applyVisibility` que aprende, não
   * este método que ganha um `if`.
   *
   * O `sim` diz O QUE aconteceu; a tabela de aparências diz o que DESENHAR (invariante 6):
   *
   *   creature-hit     → o número, e o sangue do corpo a corpo (`hits.melee`) — só quando
   *                      saiu vida: golpe absorvido inteiro mostra "0", como no Tibia, mas não
   *                      sangra, porque sangue é o que a armadura acabou de impedir;
   *   creature-healed  → o número em verde. O efeito da cura NÃO sai daqui: ele é do
   *                      lançamento (`spell-cast`) ou do uso (`supply-used`), que vêm antes —
   *                      senão uma cura que repôs zero não teria efeito e uma que repôs teria,
   *                      e a magia pareceria falhar quando o jogador estava cheio;
   *   spell-cast       → o projétil do conjurador ao PRIMEIRO alvo (é um projétil, não uma
   *                      rajada), e o efeito em CADA alvo — ou no próprio conjurador quando
   *                      não há alvo, que é a cura;
   *   supply-used      → o efeito no tile de quem usou.
   *
   * Magia ou supply SEM linha na tabela é mudo, e é silêncio, não erro: `buildContent` só
   * exige que toda linha aponte para algo que existe, não o contrário. Uma magia nova sem
   * arte ainda bate — o número e a barra provam —, e derrubar a apresentação por isso
   * esconderia justamente que ela funcionou.
   *
   * Sem id numérico para a criatura ninguém a viu ainda (o herói antes do `session-attach`,
   * o monstro nascido antes do primeiro visualizador): número e efeito são descartados
   * juntos. O efeito num tile de um mundo que o cliente ainda não montou é ruído.
   */
  #presentCombat(hosted: HostedSession, event: CombatEvent): void {
    const appearances = this.#options.appearances;
    const messages: S2CMessage[] = [];
    switch (event.kind) {
      case 'creature-hit': {
        const id = hosted.creatureIds.get(String(event.creatureId));
        if (id === undefined) return;
        messages.push({ type: 'creature-hit', id, amount: event.amount, kind: event.source });
        const blood = appearances?.hits.melee;
        if (event.source === 'melee' && event.amount > 0 && blood !== undefined) {
          messages.push({ type: 'effect', position: event.position, effectId: blood });
        }
        break;
      }
      case 'creature-healed': {
        const id = hosted.creatureIds.get(String(event.creatureId));
        if (id === undefined) return;
        messages.push({ type: 'creature-hit', id, amount: event.amount, kind: 'heal' });
        break;
      }
      case 'spell-cast': {
        const look = appearances?.spells[event.spellId];
        if (look === undefined) return;
        const first = event.targets[0];
        if (look.missile !== undefined && first !== undefined) {
          messages.push({
            type: 'missile', from: event.casterPosition, to: first.position,
            missileId: look.missile,
          });
        }
        if (look.effect !== undefined) {
          const effectId = look.effect;
          if (event.targets.length === 0 && event.tiles.length === 0) {
            messages.push({ type: 'effect', position: event.casterPosition, effectId });
          }
          for (const target of event.targets) {
            messages.push({ type: 'effect', position: target.position, effectId });
          }
          // A forma inteira (#155): a onda aparece onde não há monstro, como no Tibia. O tile
          // com alvo já teve o seu efeito acima.
          const hit = new Set(event.targets.map((t) => `${String(t.position.x)},${String(t.position.y)},${String(t.position.z)}`));
          for (const tile of event.tiles) {
            if (hit.has(`${String(tile.x)},${String(tile.y)},${String(tile.z)}`)) continue;
            messages.push({ type: 'effect', position: tile, effectId });
          }
        }
        break;
      }
      case 'supply-used': {
        const effectId = appearances?.supplies[event.supplyId]?.effect;
        if (effectId === undefined) return;
        // Poção: o efeito no usuário. Runa (#165): um por alvo e um por tile da forma — o
        // mesmo desenho da magia em área.
        if (event.targets.length === 0 && event.tiles.length === 0) {
          messages.push({ type: 'effect', position: event.position, effectId });
          break;
        }
        const hit = new Set(event.targets.map((t) => `${String(t.position.x)},${String(t.position.y)},${String(t.position.z)}`));
        for (const target of event.targets) messages.push({ type: 'effect', position: target.position, effectId });
        for (const tile of event.tiles) {
          if (hit.has(`${String(tile.x)},${String(tile.y)},${String(tile.z)}`)) continue;
          messages.push({ type: 'effect', position: tile, effectId });
        }
        break;
      }
      case 'shot': {
        // O projétil é da MUNIÇÃO (flecha) ou da ARMA (wand e rod) — o `sim` só diz qual
        // (invariante 6). Sem linha na tabela o tiro é mudo, como a magia sem arte.
        const missileId = event.ammoId === undefined
          ? appearances?.weapons[event.weaponItemId]?.missile
          : appearances?.ammunition[event.ammoId]?.missile;
        if (missileId === undefined) return;
        messages.push({ type: 'missile', from: event.from, to: event.to, missileId });
        break;
      }
      case 'monster-ability-cast': {
        // A ability do monstro (CMB-06): as CHAVES SEMÂNTICAS do conteúdo viram ids de arte
        // AQUI, pela tabela fixada na sessão (invariante 6). Chave sem linha é MUDA, nunca
        // erro: a mecânica (dano, morte, atribuição) já aconteceu no `sim`, e derrubar a
        // apresentação por falta de arte esconderia que ela funcionou.
        const missileId = event.missileKey === undefined
          ? undefined
          : appearances?.abilities[event.missileKey]?.missile;
        const effectId = event.impactKey === undefined
          ? undefined
          : appearances?.abilities[event.impactKey]?.effect;
        // Projétil do lançador ao PRIMEIRO alvo — é um projétil, não uma rajada, como o
        // `spell-cast`.
        const first = event.targets[0];
        if (missileId !== undefined && first !== undefined) {
          messages.push({
            type: 'missile', from: event.casterPosition, to: first.position, missileId,
          });
        }
        if (effectId === undefined) break;
        // O impacto em CADA alvo, e nos tiles da forma que não têm criatura — como a magia em
        // área. Sem alvo e sem forma (não acontece numa ability que disparou), nada a desenhar.
        for (const target of event.targets) {
          messages.push({ type: 'effect', position: target.position, effectId });
        }
        const hit = new Set(event.targets.map(
          (t) => `${String(t.position.x)},${String(t.position.y)},${String(t.position.z)}`,
        ));
        for (const tile of event.tiles) {
          if (hit.has(`${String(tile.x)},${String(tile.y)},${String(tile.z)}`)) continue;
          messages.push({ type: 'effect', position: tile, effectId });
        }
        break;
      }
    }
    for (const viewer of hosted.viewers) {
      for (const message of messages) viewer.send(message);
    }
  }

  /**
   * Os vitais do jogador, para quem olha ELE, quando algum mudou (FUN-109).
   *
   * Até aqui `player-stats` existia no protocolo sem emissor: HP, mana, XP e gold do jogador só
   * chegavam no `session-state` da reanexação, e o HUD ficava parado a hunt inteira enquanto
   * a barra do monstro andava. A vida já chega por `creature-health`; o resto — mana gasta
   * numa magia, XP e gold de um abate, level — não tem evento próprio, e não precisa ter:
   * comparar nove números por ciclo custa menos que um evento por grandeza, e o que o HUD
   * quer é o valor, não a história.
   *
   * SEM visualizador não se compara nada. A comparação é apresentação, e o `sim` já mudou o
   * que tinha de mudar (invariante 3); quem anexar depois recebe o estado inteiro no
   * `session-attach`, e é ali que `sentStats` volta a valer.
   */
  #presentStats(hosted: HostedSession): void {
    if (hosted.viewers.size === 0) return;
    for (const character of hosted.session.participants) {
      // Por PERSONAGEM, como o inventário e o `session-state`: numa sessão compartilhada os
      // vitais de um não interessam ao outro, e num shard ninguém chega aqui — a Cidade não
      // tem ciclo. Quem não tem visualizador próprio fica de fora pela mesma razão do `if`
      // acima: `sentStats` guarda o que foi ENTREGUE, e a ninguém não se entrega nada.
      if (this.#watchers(hosted, character.id) === 0) continue;
      const stats = playerStatsOf(character, this.#options.skillCatalog, this.#targetIdOf(hosted, character));
      const last = hosted.sentStats.get(character.id);
      if (last !== undefined && sameStats(last, stats)) continue;
      hosted.sentStats.set(character.id, stats);
      this.#sendToViewersOf(hosted, character.id, { type: 'player-stats', ...stats });
    }
  }

  #presentConditions(hosted: HostedSession): void {
    if (hosted.viewers.size === 0) return;
    for (const character of hosted.session.participants) {
      if (this.#watchers(hosted, character.id) === 0) continue;
      const snapshot = conditionsSnapshotOf(character);
      const last = hosted.sentConditions.get(character.id);
      if (last !== undefined && sameConditions(last, snapshot)) continue;
      hosted.sentConditions.set(character.id, snapshot);
      this.#sendToViewersOf(hosted, character.id, {
        type: 'active-conditions',
        ...activeConditionsOf(snapshot, hosted.session.nowMs),
      });
    }
  }

  /**
   * O analisador ao vivo (FUN-110): os agregados e os eventos notáveis para TODOS os
   * visualizadores da sessão, quando mudaram desde a última entrega. Por sessão, e não por
   * personagem, porque os agregados são da sessão — e numa hunt há um jogador só.
   */
  #presentAnalyzer(hosted: HostedSession): void {
    if (hosted.viewers.size === 0) return;
    const { notableEvents } = hosted.session;
    const party = partySummaryOf(hosted);
    for (const character of hosted.session.participants) {
      if (this.#watchers(hosted, character.id) === 0) continue;
      const aggregates = hosted.session.aggregatesOf(character.id);
      const sent = hosted.sentAnalyzer.get(character.id);
      if (sent !== undefined
        && sameAnalyzer(sent, aggregates, notableEvents.length)
        && samePartySummary(sent.party, party)) continue;
      // Só os eventos NOVOS desde a última entrega: a lista é acumulativa e sem teto, e
      // mandá-la inteira a cada abate custava 13 MB numa hunt de oito horas — quase tudo
      // repetição. Sem entrega anterior (ninguém recebeu nada ainda) vai tudo.
      const since = sent?.eventCount ?? 0;
      hosted.sentAnalyzer.set(character.id, {
        aggregates: { ...aggregates }, eventCount: notableEvents.length, party,
      });
      const message: S2CMessage = {
        type: 'analyzer',
        aggregates: { ...aggregates },
        notableEvents: notableEvents.slice(since).map((event) => ({ ...event })),
        ...(party === undefined ? {} : { party }),
      };
      for (const viewer of hosted.viewers) {
        if (viewer.characterId === character.id) viewer.send(message);
      }
    }
  }

  /**
   * O Bestiário ao vivo (FUN-113): os abates por monstro, para quem olha CADA personagem,
   * quando a soma mudou desde a última entrega. Por personagem, como `#presentStats`, porque
   * o Bestiário é do personagem — e pela mesma regra: sem visualizador não se compara nada,
   * o `sim` conta o abate de qualquer jeito (invariante 3).
   */
  #presentBestiary(hosted: HostedSession): void {
    if (hosted.viewers.size === 0) return;
    for (const character of hosted.session.participants) {
      if (this.#watchers(hosted, character.id) === 0) continue;
      const counts = character.bestiary.getState();
      const total = bestiaryTotal(counts);
      if (hosted.sentBestiary.get(character.id) === total) continue;
      hosted.sentBestiary.set(character.id, total);
      this.#sendToViewersOf(hosted, character.id, { type: 'bestiary', counts });
    }
  }

  /**
   * O estado COMPLETO para um visualizador: o mundo (`session-state`) e os vitais
   * (`player-stats`), nessa ordem e pela fila.
   *
   * Os dois, porque `session-state.self` leva vida, mana, level e XP, mas gold, capacidade e
   * stamina só viajam em `player-stats` — e sem esta segunda mensagem quem reconecta vê o gold
   * do HUD em zero até o próximo loot, e na Cidade, que não tem ciclo, para sempre.
   *
   * `sentStats` é atualizado aqui porque o que acabou de sair É o último entregue: o ciclo
   * seguinte não precisa mandar de novo o que o `session-attach` acabou de dizer.
   */
  #sendState(hosted: HostedSession, viewer: Viewer): void {
    const { characterId } = viewer;
    // Qual cena, ANTES do estado (FUN-120). `instance-enter` é a troca de cena — o cliente
    // limpa o que tinha e busca o mapa —, e o `session-state` é o que povoa a cena nova. Na
    // ordem inversa o estado chegaria e seria apagado pela troca. Sai no attach e em toda
    // transição, porque os dois passam por aqui; a instância é a própria sessão.
    const { mapId, ambience, huntId, difficulty } = hosted.session.ruleset;
    if (mapId !== undefined) {
      viewer.send({
        type: 'instance-enter', instanceId: hosted.session.id, map: mapId,
        ...(huntId === undefined ? {} : { huntId }),
        ...(difficulty === undefined ? {} : { difficulty }),
        ...(ambience === undefined ? {} : { ambience }),
      });
    }
    const state = this.#sessionState(hosted, characterId);
    // `state.type`, e não `'party' in state`: desde o #393 `analyzer.party` também existe, e o
    // `in` deixaria de estreitar só para `session-state`. Aqui o `party` é o roster (#196).
    if (state.type === 'session-state' && state.party !== undefined) hosted.sentParty = state.party;
    viewer.send(state);
    hosted.sentSpending = partySpendingSharesOf(hosted) ?? null;
    const participant = this.#participantOf(hosted, characterId);
    const stats = playerStatsOf(participant, this.#options.skillCatalog, this.#targetIdOf(hosted, participant));
    hosted.sentStats.set(characterId, stats);
    viewer.send({ type: 'player-stats', ...stats });
    const snapshot = participant === undefined ? new Map() : conditionsSnapshotOf(participant);
    hosted.sentConditions.set(characterId, snapshot);
    viewer.send({
      type: 'active-conditions',
      ...activeConditionsOf(snapshot, hosted.session.nowMs),
    });
    // E o Bestiário (FUN-113), pela mesma razão dos vitais: é progressão que só viaja em
    // mensagem própria, e sem ela quem reconecta veria a contagem em zero até o próximo abate
    // — na Cidade, que não tem ciclo, para sempre. `sentBestiary` é escrito aqui porque o que
    // acabou de sair É o último entregue.
    const counts = participant?.bestiary.getState() ?? {};
    hosted.sentBestiary.set(characterId, bestiaryTotal(counts));
    viewer.send({ type: 'bestiary', counts });
    // O `session-state` acabou de levar os agregados DELE: o ciclo seguinte não precisa repetir.
    hosted.sentAnalyzer.set(characterId, {
      aggregates: { ...hosted.session.aggregatesOf(characterId) },
      eventCount: hosted.session.notableEvents.length,
      party: partySummaryOf(hosted),
    });
    // O Follow interrompido sobrevive à desconexão (#401): `#presentMoves` DESCARTA o evento
    // `follow-state` quando ninguém olha — a apresentação é o que se perde, nunca o resultado da
    // simulação (invariante 3). Sem isto, quem reconecta depois de o alvo morrer veria o Follow
    // como se ainda estivesse ativo até o PRÓXIMO evento — que pode nunca vir, porque "voltou a
    // ficar inválido" não é uma transição que se repete sozinha.
    //
    // Só quando INTERROMPIDO: quando o Follow está ativo, o cliente já sabe — foi ele que
    // configurou — e reenviar toda vez seria tráfego sem informação nova no attach mais comum
    // (o de sempre, hunt correndo, nada de errado).
    const follow = (hosted.session.ruleset as Partial<HuntRuleset>).followStateOf?.(characterId);
    if (follow !== undefined && !follow.active) {
      viewer.send({
        type: 'follow-state',
        active: false,
        targetId: follow.targetId,
        ...(follow.reason === undefined ? {} : { reason: follow.reason }),
      });
    }
    // A votação de encerrar em curso (#432) sobrevive à desconexão, como o Follow: quem
    // reconecta no meio da janela de 60 s precisa ver a proposta e poder aprovar. Só quando há
    // votação — `endVoteState()` devolve `active: false` fora de proposta, e reenviar isso em
    // todo attach seria tráfego sem informação nova.
    const endVote = (hosted.session.ruleset as Partial<HuntRuleset>).endVoteState?.();
    if (endVote !== undefined && endVote.active) {
      viewer.send({
        type: 'party-end-vote',
        active: endVote.active,
        proposedAtMs: endVote.proposedAtMs,
        approved: [...endVote.approved],
      });
    }
  }

  /**
   * O Follow do bot no fio, por PERSONAGEM (#401): quem configurou o Follow é quem precisa saber
   * que o alvo sumiu — nunca os outros visualizadores da sessão. `#presentParty`, ao lado, manda
   * para `hosted.viewers` inteiro porque bolsa e composição SÃO da sessão; Follow não é.
   *
   * Sem comparação com "o último entregue" (ao contrário de `#presentStats`/`#presentAnalyzer`,
   * que reamostram todo ciclo): o `sim` já emite este evento UMA VEZ por transição — interrompeu,
   * ou retomou (#398, §D10) —, então não há nada aqui para deduplicar. Duplicar a dedução no
   * host criaria uma segunda fonte de verdade sobre "o que já foi entregue" que o `sim` já
   * resolveu sozinho.
   */
  #presentFollow(hosted: HostedSession, event: FollowState): void {
    this.#sendToViewersOf(hosted, event.characterId, {
      type: 'follow-state',
      active: event.active,
      targetId: event.targetId,
      ...(event.reason === undefined ? {} : { reason: event.reason }),
    });
  }

  /**
   * A party no fio (#196): os eventos do `sim` viram as mensagens, para TODOS os visualizadores
   * da sessão — a party é privada como a hunt, e todo membro vê a bolsa, o settlement e a
   * votação de encerrar. O HP dos companheiros vai só no `party-state` (attach e mudança de
   * composição); no meio o cliente já recebe `creature-health` de cada um.
   */
  #presentParty(hosted: HostedSession, event: PartyEvent): void {
    let message: S2CMessage;
    switch (event.kind) {
      case 'party-state': {
        const block = this.#partyBlock(hosted);
        if (block.party === undefined) return;
        hosted.sentParty = block.party;
        message = { type: 'party-state', ...block.party };
        break;
      }
      case 'party-bag-changed': {
        hosted.lastPartyBag = event;
        // A bolsa v2 vem do MESMO `#partyBlock` do `session-state`: elegibilidade por item e
        // reservas só existem ali (`getState()` + último evento), e as duas mensagens não podem
        // divergir sobre o que há na bolsa.
        const bag = this.#partyBlock(hosted).partyBag;
        if (bag === undefined) return;
        message = { type: 'party-bag', ...bag };
        break;
      }
      case 'party-settlement':
        message = {
          type: 'party-settlement', total: event.total, shares: event.shares.map((share) => ({ ...share })),
          reason: event.reason,
          ...(event.itemId === undefined ? {} : { itemId: event.itemId }),
        };
        break;
      case 'party-end-vote':
        // O estado da votação (#432) é da SESSÃO: todo membro precisa ver quem já aprovou. O
        // evento já carrega tudo — não há segundo estado para recompor.
        message = {
          type: 'party-end-vote',
          active: event.active,
          proposedAtMs: event.proposedAtMs,
          approved: [...event.approved],
        };
        break;
      case 'member-left':
        return;
      case 'follow-state':
        // POR PERSONAGEM (#401): `#presentMoves` o intercepta antes e chama `#presentFollow` —
        // nunca este broadcast. O caso existe só para a união `PartyEvent` ficar fechada.
        return;
    }
    for (const viewer of hosted.viewers) viewer.send(message);
  }

  #presentPartyLive(hosted: HostedSession): void {
    if (hosted.viewers.size === 0) return;
    const party = this.#partyBlock(hosted).party;
    if (party === undefined) return;
    if (hosted.sentParty !== null && sameParty(hosted.sentParty, party)) return;
    hosted.sentParty = party;
    for (const viewer of hosted.viewers) viewer.send({ type: 'party-state', ...party });
  }

  /**
   * O gasto de cada membro e a prévia de rateio, a TODOS os visualizadores da sessão (#354,
   * SV-18) — broadcast, como `#presentParty`, e não por personagem: o AVISO 4 do Mapa de
   * Capacidade (docs/reviews/kit-fidelity-audit-2026-09-16.md) registra que `analyzer`, que TEM
   * `goldSpent` por participante, só vai a quem olha aquele personagem — "gasto de todos visível
   * a todos" não é ligar um campo, é agregar e distribuir, o modelo que `party-bag` já segue.
   *
   * Gateado por comparação (`sameSpending`), como `sameStats`/`sameAnalyzer` — mas por SESSÃO
   * (`hosted.sentSpending`), não por personagem: a mensagem é uma só para todo mundo.
   */
  #presentSpending(hosted: HostedSession): void {
    if (hosted.viewers.size === 0) return;
    const shares = partySpendingSharesOf(hosted);
    if (shares === undefined) return; // sem party (D8): nada a mandar
    if (hosted.sentSpending !== null && sameSpending(hosted.sentSpending, shares)) return;
    hosted.sentSpending = shares;
    const message: S2CMessage = { type: 'party-spending', shares: shares.map((s) => ({ ...s })) };
    for (const viewer of hosted.viewers) viewer.send(message);
  }

  /**
   * O bloco `party`/`partyBag` do `session-state` (#196; v2 no #400), montado do estado do
   * ruleset. Vazio em solo.
   *
   * Nada é somado aqui (PRD §34): peso, valor, OVERWEIGHT e reservas vêm do `sim` — peso/valor
   * do `partySummary`, OVERWEIGHT/capacidade do `getState().partyBag` e as reservas do último
   * `party-bag-changed`, que é onde `#rebalanceBag` as calcula. O `joinedAtMs` é opcional: um
   * `sim` sem o acessor o omite (D12), e o campo é opcional no protocolo.
   */
  #partyBlock(hosted: HostedSession): { party?: S2CProps<'party-state'>; partyBag?: S2CProps<'party-bag'> } {
    const ruleset = hosted.session.ruleset as Partial<HuntRuleset>;
    const party = ruleset.party;
    if (party === undefined) return {};
    const state = ruleset.getState?.();
    const summary = ruleset.partySummary?.(hosted.session);
    const leaderId = hosted.session.participants.some((p) => p.id === party.leaderId)
      ? party.leaderId
      : hosted.session.participants[0]?.id ?? party.leaderId;
    const joinTimes = hosted.session as Session & {
      joinedAtMsOf?: (characterId: string) => number | undefined;
    };
    const block: { party?: S2CProps<'party-state'>; partyBag?: S2CProps<'party-bag'> } = {
      party: {
        leaderId,
        // Derivado (D1) — tolerância de um deploy para o cliente antigo.
        mode: party.shareCosts && party.splitLoot ? 'shared' : 'split',
        // Os campos achatados do #359 continuam no topo pelo mesmo deploy de rolagem.
        shareCosts: party.shareCosts,
        splitLoot: party.splitLoot,
        settings: { shareCosts: party.shareCosts, splitLoot: party.splitLoot },
        loot: {
          collect: party.collect === null ? null : [...party.collect],
          autoSell: [...party.autoSell],
          autoSellLimit: summary?.autoSell.limit ?? 0,
          leaderPremium: party.premiumByCharacter[leaderId] ?? false,
        },
        members: hosted.session.participants.map((member) => {
          const joinedAtMs = joinTimes.joinedAtMsOf?.(member.id);
          const totals = hosted.session.aggregatesOf(member.id);
          return {
            characterId: member.id,
            name: this.#nameByCharacter.get(member.id) ?? member.id,
            alive: member.alive,
            healthPercent: member.maxHealth > 0
              ? Math.max(0, Math.min(100, Math.round((member.health / member.maxHealth) * 100)))
              : 0,
            vocationId: member.vocationId,
            level: member.level,
            manaPercent: member.maxMana > 0
              ? Math.max(0, Math.min(100, Math.round((member.mana / member.maxMana) * 100)))
              : 0,
            ...(joinedAtMs === undefined ? {} : { joinedAtMs }),
            connected: this.#watchers(hosted, member.id) > 0,
            // DPS/HPS (#431): a janela é lida AGORA, no instante do ciclo — o `sim` não mantém
            // taxa nenhuma, só amostras carimbadas, e a taxa sai da divisão de 60 s.
            dps: hosted.session.dpsOf(member.id, hosted.session.nowMs),
            hps: hosted.session.hpsOf(member.id, hosted.session.nowMs),
            damageDealt: totals.damageDealt,
            healingDone: totals.healingDone,
          };
        }),
      },
    };
    const bag = state?.partyBag;
    if (bag !== undefined) {
      block.partyBag = {
        // O `gold` da entrada é a soma dos lançamentos; a bolsa v2 (`#395`) guarda entradas com
        // elegibilidade, e é ela que vai no fio agora.
        gold: bag.gold.reduce((sum, entry) => sum + entry.amount, 0),
        weight: summary?.bagWeight ?? 0,
        capacity: bag.capacity,
        value: summary?.bagValue ?? 0,
        overweight: bag.overweight,
        reservations: (hosted.lastPartyBag?.reservations ?? []).map((reservation) => ({ ...reservation })),
        items: bag.items.map((entry) => ({
          instanceId: entry.item.instanceId, itemId: entry.item.itemId, quantity: entry.item.quantity,
          eligible: [...entry.eligible],
        })),
      };
    }
    return block;
  }

  #participantOf(hosted: HostedSession, characterId: string): CharacterRuntime | undefined {
    return hosted.session.participants.find((participant) => participant.id === characterId);
  }

  /** Esta sessão tem campo de visão por célula? Só shard, e só com a opção ligada (FUN-33). */
  #interestManaged(session: Session): boolean {
    return session.ruleset.shared === true && this.#options.areaOfInterest !== false;
  }

  /** Manda para todos os visualizadores de UM personagem. Abas contam separado. */
  #sendToViewersOf(hosted: HostedSession, characterId: string, message: S2CMessage): void {
    for (const viewer of hosted.viewers) {
      if (viewer.characterId === characterId) viewer.send(message);
    }
  }

  /**
   * Traduz uma mudança de campo de visão em `creature-appear` e `creature-disappear` (FUN-33).
   *
   * **Os dois lados**, porque a visibilidade é simétrica: quem apareceu para mim é exatamente
   * quem eu passei a enxergar. Mandar só um lado deixa um dos dois com um fantasma na tela —
   * um boneco parado que não corresponde a ninguém — ou com um vizinho invisível.
   */
  #applyVisibility(
    hosted: HostedSession,
    subject: string,
    change: { readonly appeared: readonly string[]; readonly vanished: readonly string[] },
  ): void {
    for (const other of change.appeared) {
      this.#sendToViewersOf(hosted, other, this.#appearance(hosted, subject));
      this.#sendToViewersOf(hosted, subject, this.#appearance(hosted, other));
    }
    for (const other of change.vanished) {
      // O id numérico NÃO é reciclado aqui: sumir de vista não é sair da sessão, e um id novo
      // no reaparecimento deixaria o sprite antigo parado para sempre na tela do cliente.
      const gone = hosted.creatureIds.get(subject);
      const theirs = hosted.creatureIds.get(other);
      if (gone !== undefined) {
        this.#sendToViewersOf(hosted, other, { type: 'creature-disappear', id: gone });
      }
      if (theirs !== undefined) {
        this.#sendToViewersOf(hosted, subject, { type: 'creature-disappear', id: theirs });
      }
    }
  }

  /** O `creature-appear` de um personagem, como quem está por perto precisa vê-lo. */
  #appearance(hosted: HostedSession, characterId: string): S2CMessage {
    const character = hosted.session.participants.find((p) => p.id === characterId);
    return {
      type: 'creature-appear',
      id: this.#creatureId(hosted, characterId),
      position: character?.position ?? { x: 0, y: 0, z: 0 },
      appearanceId: this.#options.playerOutfitId ?? 0,
      name: this.#nameByCharacter.get(characterId) ?? characterId,
      health: character?.health ?? 0,
      maxHealth: character?.maxHealth ?? 0,
      ...this.#colorsOf(characterId),
    };
  }

  /**
   * As cores de um PERSONAGEM para o fio, ou nada (FUN-104). Espalhado, e não `colors:
   * undefined`: a chave ausente é o que o cliente lê como "pinte o padrão", e uma chave com
   * `undefined` não sobrevive ao JSON de qualquer jeito — o codec a apagaria em silêncio, e o
   * tipo passaria a mentir sobre o que foi mandado. Monstro nunca passa por aqui: é uma camada
   * só, e a tabela é indexada por `characterId`.
   */
  #colorsOf(characterId: string): { colors?: OutfitColors } {
    const colors = this.#colorsByCharacter.get(characterId);
    return colors === undefined ? {} : { colors };
  }

  /**
   * Um aviso por minuto, no máximo. Um nó saturado atrasa TODAS as sessões ao mesmo tempo, e
   * uma linha de log por sessão por ciclo transformaria o sintoma em causa.
   */
  #warnLag(type: SessionType, lagMs: number, nowMs: number): void {
    if (nowMs - this.#lastLagWarningMs < LAG_WARNING_INTERVAL_MS) return;
    this.#lastLagWarningMs = nowMs;
    this.#logger.warn(
      { type, lagMs: Math.round(lagMs), budgetMs: TICK_LAG_BUDGET_MS },
      'Tick ran past its budget; the node is saturating',
    );
  }

  /**
   * Recontagem por ciclo, não por sessão: um contador incremental espalhado por `attach`,
   * `detach`, `release` e `#replace` erra na primeira aresta que alguém esquecer, e erra
   * DEVAGAR — o painel vai ficando errado sem nada quebrar.
   */
  #observeSessions(): void {
    const metrics = this.#options.metrics;
    if (metrics === undefined) return;

    const counts = new Map<string, number>();
    for (const hosted of this.#sessions.values()) {
      const key = `${hosted.session.ruleset.type}|${hosted.viewers.size > 0}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    metrics.observeSessions(counts);

    const perAccount = new Map<string, number>();
    for (const accountId of this.#accountIdByCharacter.values()) {
      perAccount.set(accountId, (perAccount.get(accountId) ?? 0) + 1);
    }
    metrics.observeSlots(perAccount.size === 0 ? 0 : Math.max(...perAccount.values()));
  }

  /**
   * A sessão acabou sozinha: credita, avisa, e põe o personagem na próxima (FUN-38).
   *
   * A ORDEM é o assunto todo, e cada troca tem uma consequência:
   *
   *   1. o extrato é gravado ANTES de qualquer aviso — morrer e o processo cair em seguida
   *      deixa o crédito no Redis esperando o `jobs`, que é a metade certa de perder;
   *   2. o `session-ended` sai antes do estado novo, senão o jogador vê a Cidade aparecer e
   *      só depois descobre que morreu;
   *   3. a sessão nova é registrada no diretório ANTES de substituir a local — registrar
   *      depois deixaria o personagem apontando para uma sessão que este nó já esqueceu;
   *   4. a cura vem com a Cidade, e a Cidade vem DEPOIS do encerramento. Restaurar HP antes
   *      de encerrar gravaria no extrato uma sessão que "terminou com vida cheia", o que
   *      estraga a tela de retorno e o analisador.
   */
  async #succeed(hosted: HostedSession): Promise<void> {
    // Um extrato por participante (#187, #194): cada um credita, avisa os SEUS visualizadores
    // e volta à Cidade, na ordem de entrada. Quem já saiu antes (`member-left`) não está aqui.
    for (const receipt of hosted.session.receipts()) {
      if (!this.#charactersOf(hosted.session.id).includes(receipt.characterId)) continue;
      await this.#settleOne(hosted, receipt.characterId, receipt);
    }
  }

  /** As saídas enfileiradas por `member-left` (#194), fora do ciclo. */
  async #settleDepartures(hosted: HostedSession): Promise<void> {
    while (hosted.departures.length > 0) {
      const left = hosted.departures.shift() as MemberLeft;
      await this.#settleOne(hosted, left.characterId, left.departure.receipt, left.departure.character);
    }
  }

  async #settleOne(
    hosted: HostedSession, characterId: string, receipt: Receipt, departed?: CharacterRuntime,
  ): Promise<void> {
    try {
      await this.#saveReceipt(characterId, hosted, receipt, departed);
      for (const viewer of hosted.viewers) {
        if (viewer.characterId !== characterId) continue;
        viewer.send({
          type: 'session-ended',
          reason: receipt.reason,
          aggregates: receipt.aggregates,
          notableEvents: receipt.notableEvents.map((event) => ({ ...event })),
        });
      }

      // Toda sessão que acaba sozinha devolve o personagem à Cidade (§6): "a hunt acabou"
      // nunca pode significar "ficou sem sessão" (invariante 8).
      const next = this.#options.buildSession?.({ to: 'city' }, hosted.session, characterId)
        ?? null;
      if (next === null) {
        await this.release(characterId, 1000, receipt.reason);
        return;
      }
      await this.#replace(characterId, hosted, next);
    } catch (error) {
      // Falhar aqui deixa o personagem numa sessão encerrada, que o ciclo ignora — ruim, e
      // recuperável na próxima conexão. Soltar no meio de uma falha seria pior: sem saber em
      // que ponto parou, soltar pode significar perder o crédito que talvez tenha gravado.
      this.#logger.error(
        { error, characterId, sessionId: hosted.session.id },
        'Failed to move the character to the next session',
      );
    }
  }

  /**
   * Muda o personagem de atividade (FUN-30, §6).
   *
   * Lança `TransitionError` quando a transição não é válida — e a recusa é o produto, não um
   * detalhe: "você não pode fazer isso" é a mensagem que faz alguém achar que o jogo travou.
   *
   * A ORDEM é a que falha seguro. A troca no diretório é ATÔMICA (`succeed`), então não
   * existe o instante em que o personagem está em duas sessões nem o instante em que ele não
   * está em nenhuma — que é o requisito difícil desta issue, e a razão de não haver aqui um
   * "reservar depois liberar" em dois passos.
   */
  async transition(characterId: string, request: TransitionRequest): Promise<void> {
    const hosted = this.#hostedSession(characterId);
    if (hosted === undefined) throw new Error(`character ${characterId} has no session here`);

    const refusal = refuseTransition(hosted.session.ruleset.type, request.to);
    if (refusal !== null) throw refusal;

    // Duas transições disputadas: exatamente UMA vence, e a outra sabe que perdeu.
    //
    // Sem esta trava as duas leriam a mesma sessão de origem, e a segunda tentaria trocar um
    // registro de diretório que a primeira já trocou — a CAS recusaria, e o caminho de recusa
    // SOLTA o personagem. Perder a corrida derrubaria o jogador do jogo.
    if (this.#transitions.has(characterId)) {
      throw new TransitionError(
        'already-transitioning', `uma transição de ${characterId} já está em andamento`,
      );
    }

    const running = this.#runTransition(characterId, hosted, request);
    this.#transitions.set(characterId, running);
    try {
      await running;
    } finally {
      if (this.#transitions.get(characterId) === running) this.#transitions.delete(characterId);
    }
  }

  async #runTransition(
    characterId: string,
    hosted: HostedSession,
    request: TransitionRequest,
  ): Promise<void> {
    // Construir ANTES de encerrar: se o destino não existe — hunt que saiu do conteúdo,
    // dificuldade que a hunt não define — o personagem fica exatamente onde estava, em vez de
    // ficar sem sessão porque a antiga já tinha sido fechada.
    const next = this.#options.buildSession?.(request, hosted.session, characterId) ?? null;
    if (next === null) {
      throw new TransitionError(
        'unknown-destination', `este servidor não constrói uma sessão de "${request.to}"`,
      );
    }

    // Sair de um SHARD não encerra nada e não credita nada (FUN-71, ADR 0023): a praça fica
    // de pé com quem ficou, e a Cidade não gera progresso (§37). Encerrar aqui mandaria um
    // extrato de Cidade — zerado — para todo mundo que estivesse lá dentro.
    if (hosted.session.ruleset.shared !== true) {
      // Party (#194, ADR 0027): com mais de um dono, sair é SAIR — o extrato é o dele, a hunt
      // continua para os outros, e a cascata do §13.9 roda no próximo evento do `sim`.
      let receipt: Receipt | null;
      let departed: CharacterRuntime | undefined;
      if (hosted.session.ended === null && hosted.session.participants.length > 1) {
        const departure = hosted.session.leave(characterId, 'manual-exit');
        receipt = departure?.receipt ?? null;
        departed = departure?.character;
        this.#announceDeparture(hosted, characterId);
      } else {
        if (hosted.session.ended === null) hosted.session.end('manual-exit');
        receipt = receiptOf(hosted, characterId);
      }
      if (receipt !== null) {
        await this.#saveReceipt(characterId, hosted, receipt, departed);
        for (const viewer of hosted.viewers) {
          if (viewer.characterId !== characterId) continue;
          viewer.send({
            type: 'session-ended',
            reason: receipt.reason,
            aggregates: receipt.aggregates,
            notableEvents: receipt.notableEvents.map((event) => ({ ...event })),
          });
        }
      }
    }
    await this.#replace(characterId, hosted, next);
  }

  /** Troca a sessão do personagem por outra, no diretório e aqui dentro. */
  async #replace(characterId: string, hosted: HostedSession, next: Session): Promise<void> {
    const accountId = this.#accountIdByCharacter.get(characterId);
    const directory = this.#options.directory;
    if (directory !== undefined && accountId !== undefined) {
      const moved = await directory.succeed(
        characterId,
        accountId,
        { sessionId: hosted.session.id, nodeId: this.#options.nodeId,
          type: hosted.session.ruleset.type },
        { sessionId: next.id, nodeId: this.#options.nodeId, type: next.ruleset.type },
      );
      // O registro não é mais nosso: outro nó assumiu, ou o lease expirou. Insistir seria
      // escrever por cima de um dono que já não somos.
      if (!moved) {
        this.#logger.warn({ characterId }, 'Directory entry changed hands; releasing instead');
        await this.release(characterId, 1000, 'session-moved');
        return;
      }
    }

    // Os visualizadores acompanham o PERSONAGEM, não a sessão. Fechar o socket porque a hunt
    // acabou faria quem estava assistindo levar uma desconexão em vez de ver a volta à cidade.
    //
    // Só os DELE: num shard os outros continuam na sessão anterior, e levá-los junto seria
    // arrastar a praça inteira para dentro da hunt de um jogador.
    const following = [...hosted.viewers].filter((v) => v.characterId === characterId);
    for (const viewer of following) {
      hosted.viewers.delete(viewer);
      hosted.session.detach(viewer.id);
    }

    // Sai da anterior. Num shard isso é `leave`; numa sessão privada ela já foi encerrada por
    // quem chamou, e some daqui inteira.
    if (hosted.session.ruleset.shared === true) {
      hosted.session.leave(characterId);
      this.#announceDeparture(hosted, characterId);
    }
    // Some daqui quando não sobra ninguém dela — nem no shard nem na party (#194): os outros
    // membros continuam na hunt, e apagar a sessão levaria a deles junto.
    const remaining = this.#charactersOf(hosted.session.id).filter((id) => id !== characterId);
    if (remaining.length === 0) this.#sessions.delete(hosted.session.id);

    // A próxima pode JÁ estar hospedada — voltar da hunt é chegar na praça em que os outros
    // estão (FUN-71). Montar um `HostedSession` novo aqui jogaria fora os visualizadores e os
    // ids de criatura de quem já estava lá.
    const existing = this.#sessions.get(next.id);
    const successor: HostedSession = existing ?? {
      session: next, viewers: new Set(), creatureIds: new Map(), nextCreatureId: 1,
      aoi: this.#interestManaged(next) ? new AreaOfInterest() : null,
      lastAdvancedAtMs: this.#now(),
      credited: new Set(),
      receiptSaves: new Map(),
      departures: [],
      dirty: new Set(),
      sentItemsLooted: next.aggregates.itemsLooted,
      sentStats: new Map(),
      sentAnalyzer: new Map(),
      sentBestiary: new Map(),
      sentParty: null,
      lastPartyBag: null,
      sentConditions: new Map(),
      sentSpending: null,
    };
    this.#sessions.set(next.id, successor);
    this.#sessionIdByCharacter.set(characterId, next.id);
    // ANTES de os visualizadores dele entrarem em `successor.viewers`, de propósito: o que o
    // anúncio manda é o `creature-appear` de quem chega para quem JÁ estava na praça. O que
    // ele mandaria ao recém-chegado — os vizinhos que ele passa a ver — ninguém recebe, e
    // não faz falta: o `#sendState` logo abaixo leva a cena inteira (`instance-enter` e
    // `session-state`, que substitui tudo), e um `appear` antes dela seria apagado pela troca.
    this.#announceArrival(successor, characterId);

    for (const viewer of following) {
      successor.viewers.add(viewer);
      next.attach(viewer.id);
      this.#sendState(successor, viewer);
    }
    this.#restingSince.set(characterId, following.length > 0 ? null : this.#now());

    // A morte é MARCO de snapshot (FUN-27). Perder a transição por estar entre dois
    // intervalos é o pior caso: o jogador volta vivo, na hunt, e a penalidade aparece do nada
    // um pouco depois.
    //
    // Shard não tem snapshot (ADR 0023): não há progresso a guardar, e o que ele guardaria
    // seria a praça inteira, uma cópia por participante. Mas o snapshot da sessão ANTERIOR
    // precisa sumir — ele é apagado, não simplesmente não reescrito.
    //
    // Não fazer as duas coisas é o defeito silencioso: quem morre volta para a praça, o
    // snapshot da hunt encerrada fica em pé no Redis, e a próxima conexão RETOMA a hunt que
    // já foi creditada. Antes desta issue o `save` da Cidade cobria essa linha por acidente.
    const snapshots = this.#options.snapshots;
    if (snapshots !== undefined && accountId !== undefined) {
      await (next.ruleset.shared === true
        ? snapshots.remove(characterId)
        : snapshots.save(characterId, accountId, this.#options.nodeId, next.snapshot()));
    }
    this.#logger.info(
      { characterId, from: hosted.session.id, to: next.id, type: next.ruleset.type },
      'Character moved to the next session',
    );
  }

  /** Quem está nesta sessão. Busca linear num mapa pequeno, e só quando uma sessão acaba. */
  #charactersOf(sessionId: string): string[] {
    const found: string[] = [];
    for (const [characterId, id] of this.#sessionIdByCharacter) {
      if (id === sessionId) found.push(characterId);
    }
    return found;
  }

  /**
   * Recolhe a sessão de REPOUSO que ninguém está olhando há tempo demais (FUN-52).
   *
   * O problema que isto resolve: quem fecha o navegador e não volta deixava a sessão de
   * cidade hospedada e renovada para sempre, segurando um dos dois slots da conta. O sintoma
   * aparecia longe da causa — o terceiro personagem não conectava, e o primeiro não podia ser
   * apagado. Reiniciar o nó "resolvia", o que escondia o problema em desenvolvimento e o
   * deixava aparecer só em produção, onde o processo fica de pé por dias.
   *
   * **Só a sessão orientada a evento é recolhida.** Uma hunt desanexada roda a 1 Hz e nunca
   * passa por aqui — desconectar não pode encerrar nada, ou a hunt AFK deixa de existir
   * (ADR 0001). É essa linha que separa "repouso" de "progresso sem ninguém olhando".
   *
   * E o invariante 8 continua de pé na leitura que importa: a Cidade é o estado de REPOUSO, e
   * repouso não precisa de nó. Sem sessão hospedada o personagem continua na cidade, pela
   * coluna `characters.state` — o que a API já reporta assim (FUN-30).
   *
   * A carência existe para reconexão não virar rotatividade: recarregar a página, trocar de
   * rede ou perder o Wi-Fi por um instante não pode custar uma sessão nova.
   */
  #collectResting(hosted: HostedSession, nowMs: number): void {
    // Um por um, e não a sessão inteira (FUN-71): num shard, cada personagem tem o próprio
    // relógio de repouso, e recolher pelo estado da sessão tiraria da praça quem está ali
    // jogando junto de quem fechou o navegador.
    for (const characterId of this.#charactersOf(hosted.session.id)) {
      const since = this.#restingSince.get(characterId);
      if (since === undefined || since === null) continue;
      if (this.#watchers(hosted, characterId) > 0) continue;
      if (nowMs - since < RESTING_GRACE_MS) continue;

      // Marca antes de soltar: `release` é assíncrono, e o ciclo seguinte não pode tentar de
      // novo enquanto o primeiro ainda está no meio do caminho.
      this.#restingSince.set(characterId, null);
      this.#logger.info(
        { characterId, sessionId: hosted.session.id },
        'Collecting a resting character nobody is watching',
      );
      void this.release(characterId).catch((error: unknown) => {
        this.#logger.error({ error, characterId }, 'Failed to collect a resting character');
      });
    }
  }

  /**
   * Tira da sessão os visualizadores DESTE personagem, fechando-os se houver código.
   *
   * Só os dele: num shard os outros continuam olhando a mesma sessão, e limpar a lista
   * inteira desconectaria a praça porque um jogador saiu. Fecha TODAS as abas dele, porém —
   * sair do jogo é do personagem, não da aba.
   */
  #dropViewers(
    hosted: HostedSession,
    characterId: string,
    closeCode?: number,
    closeReason?: string,
  ): void {
    for (const viewer of [...hosted.viewers]) {
      if (viewer.characterId !== characterId) continue;
      if (closeCode !== undefined) viewer.close(closeCode, closeReason ?? '');
      hosted.viewers.delete(viewer);
      hosted.session.detach(viewer.id);
    }
  }

  /** Quantos visualizadores estão olhando ESTE personagem. Abas contam separado. */
  #watchers(hosted: HostedSession, characterId: string): number {
    let count = 0;
    for (const viewer of hosted.viewers) if (viewer.characterId === characterId) count += 1;
    return count;
  }

  /** Manda o acumulado e derruba quem não está drenando. */
  flush(): void {
    for (const hosted of this.#sessions.values()) {
      for (const viewer of hosted.viewers) {
        viewer.flush();
        if (!viewer.dead) continue;
        this.#logger.warn(
          { characterId: viewer.characterId },
          'Dropping viewer that stopped draining',
        );
        viewer.close(1013, 'backpressure');
        this.detach(viewer);
      }
    }
  }

  start(): void {
    this.#cycleTimer = setInterval(() => this.cycle(), CYCLE_MS);
    this.#renewTimer = setInterval(() => void this.#renewLeases(), RENEW_INTERVAL_MS);
    this.#snapshotTimer = setInterval(() => void this.saveAll(), SNAPSHOT_INTERVAL_MS);
    this.#playerCountTimer = setInterval(() => void this.#publishPlayerCount(), PLAYER_COUNT_INTERVAL_MS);
  }

  stop(): void {
    if (this.#cycleTimer) clearInterval(this.#cycleTimer);
    if (this.#renewTimer) clearInterval(this.#renewTimer);
    if (this.#snapshotTimer) clearInterval(this.#snapshotTimer);
    if (this.#playerCountTimer) clearInterval(this.#playerCountTimer);
    this.#cycleTimer = null;
    this.#renewTimer = null;
    this.#snapshotTimer = null;
    this.#playerCountTimer = null;
  }

  /**
   * Encerra TODAS as sessões creditando o progresso, e avisa quem estiver olhando (FUN-29).
   *
   * É o que um deploy faz: encerrar creditando, e não migrar ao vivo (ADR 0010). Sem isto,
   * um deploy com milhares de sessões desanexadas em voo destrói progresso de gente que nem
   * está lá para reagir — e o §38.4 é explícito que hunt AFK não pode sumir em silêncio.
   *
   * A ORDEM importa. O extrato é gravado ANTES de o visualizador ser avisado: se o processo
   * morrer no meio, o jogador ficou sem a mensagem mas o crédito está no Redis esperando o
   * `jobs`. O contrário — avisar e morrer antes de gravar — mostraria um extrato que nunca
   * vai existir, que é a pior das duas metades.
   */
  async drainAll(reason: EndReason = 'drain'): Promise<number> {
    let ended = 0;
    for (const [characterId, sessionId] of [...this.#sessionIdByCharacter]) {
      const hosted = this.#sessions.get(sessionId);
      if (hosted === undefined) continue;
      try {
        // Shard não credita e não encerra por personagem (FUN-71, ADR 0023): a praça não gera
        // progresso (§37), e chamar `end` uma vez por participante mandaria o mesmo extrato
        // zerado para duzentas pessoas. Sair basta, e `release` faz isso logo abaixo.
        if (hosted.session.ruleset.shared === true) {
          await this.#saveDurableReceipt(characterId, hosted, reason);
        } else {
          hosted.session.end(reason);
          const receipt = receiptOf(hosted, characterId);
          if (receipt === null) throw new Error(`no receipt for ${characterId} in ${sessionId}`);
          await this.#saveReceipt(characterId, hosted, receipt);
          for (const viewer of hosted.viewers) {
            if (viewer.characterId !== characterId) continue;
            viewer.sendNow({
              type: 'session-ended',
              reason: receipt.reason,
              aggregates: receipt.aggregates,
              notableEvents: receipt.notableEvents.map((event) => ({ ...event })),
            });
          }
        }
        // Creditada: o snapshot e o registro no diretório TÊM que sumir.
        //
        // Deixar o snapshot criaria um caminho de crédito DOBRADO — a próxima conexão
        // retomaria (FUN-28) o estado de antes do encerramento, e uma segunda drenagem
        // creditaria os mesmos agregados de novo, com um `seq` novo que a chave única do
        // ledger não consegue recusar. E deixar o registro no diretório apontando para um nó
        // que já saiu é a definição de sessão órfã.
        await this.release(characterId, 1001, 'drain');
        ended += 1;
      } catch (error) {
        // Uma sessão que falha não pode impedir as outras de creditar: drenagem que para no
        // meio é pior que drenagem nenhuma, porque metade credita e metade some.
        //
        // A que falhou FICA com snapshot e registro: é o caminho da FUN-28, e voltar
        // retomável é melhor que sumir sem crédito.
        this.#logger.error({ error, characterId, sessionId }, 'Failed to drain a session');
      }
    }
    return ended;
  }

  async #saveReceipt(
    characterId: string,
    hosted: HostedSession,
    receipt: Receipt,
    /** Quem saiu por `leave` já não está em `participants` (#194): quem chama o entrega. */
    departed?: CharacterRuntime,
  ): Promise<void> {
    const receipts = this.#options.receipts;
    const accountId = this.#accountIdByCharacter.get(characterId);
    if (receipts === undefined || accountId === undefined) return;
    if (hosted.credited.has(characterId)) return;
    const pending = hosted.receiptSaves.get(characterId);
    if (pending !== undefined) return pending;

    const saving = this.#persistReceipt(characterId, hosted, receipt, receipts, accountId, departed);
    hosted.receiptSaves.set(characterId, saving);
    try {
      await saving;
      // Só a confirmação permite esquecer sessão/snapshot. Marcar antes do await faria um
      // retry após falha pular a gravação e perder o progresso (#267).
      hosted.credited.add(characterId);
    } finally {
      // Resposta perdida também é falha: repetir o mesmo seq é seguro pelo ledger.
      hosted.receiptSaves.delete(characterId);
    }
  }

  async #persistReceipt(
    characterId: string,
    hosted: HostedSession,
    receipt: Receipt,
    receipts: ReceiptStore,
    accountId: string,
    departed?: CharacterRuntime,
  ): Promise<void> {
    // O `seq` vem do `sim` (#187): é alocado quando o extrato é emitido, um por participante —
    // metade da chave de idempotência do ledger (invariante 10), e o que impede uma drenagem
    // repetida por retry de creditar duas vezes.
    // A stamina do dono da sessão vai junto (FUN-54): sem ela, o tempo de hunt gasto nunca
    // chegaria ao banco, e reconectar devolveria a stamina de antes da hunt.
    const owner = departed ?? hosted.session.participants.find((p) => p.id === characterId);
    await receipts.save({
      sessionId: receipt.sessionId,
      characterId,
      accountId,
      reason: receipt.reason,
      seq: receipt.seq,
      aggregates: receipt.aggregates,
      notableEvents: receipt.notableEvents,
      ...(owner?.staminaMs === undefined || owner.staminaMs === null
        ? {}
        : { staminaMs: owner.staminaMs, staminaUpdatedAtMs: owner.staminaUpdatedAtMs }),
      // As skills do dono também (FUN-75). Sem elas, o que ele praticou na hunt nunca chegaria
      // ao banco — e a hunt seguinte começaria do zero de novo, sem nada explicando.
      ...(owner === undefined ? {} : { skills: owner.skills.getState() }),
      // E o Bestiário (FUN-113), pela mesma razão: abate que não chega ao banco é abate que
      // some no próximo logout, e o marco 10 000 nunca chegaria.
      ...(owner === undefined ? {} : { bestiary: owner.bestiary.getState() }),
      // E a munição escolhida (#152): preferência do jogador, que voltaria à grátis a cada
      // login se ficasse só na sessão.
      ...(owner === undefined || owner.ammo.size === 0 ? {} : { ammo: Object.fromEntries(owner.ammo) }),
      // E a vocação (#154): escrita UMA vez pelo `jobs`, nunca daqui (ADR 0026 decisão 1).
      ...(owner?.vocationId === undefined || owner.vocationId === null ? {} : { vocation: owner.vocationId }),
      // E o que ele está vestindo (FUN-82). Item não muda de dono dentro da hunt; o que muda é
      // onde ele está, e é só isso que precisa atravessar.
      ...(owner === undefined ? {} : { equipment: equipmentOf(owner) }),
      // E onde cada item está dentro dos containers (#160).
      ...(owner === undefined ? {} : { layout: layoutOfState(owner.inventory.getState()) }),
      // O que caiu nesta sessão (FUN-88): o que coube vira linha de `item_instance`, o que não
      // coube vira Caixa de Loot da Sessão.
      ...(owner === undefined ? {} : { acquired: acquiredBy(owner, receipt.sessionId) }),
      ...(owner === undefined || owner.lootBox.length === 0
        ? {}
        : { lootBox: owner.lootBox }),
    });

    // O extrato agora é durável no Redis e será a fonte que o ledger aplica no Postgres.
    // Enquanto ele está pendente, a Cidade continua com o MESMO `CharacterRuntime` da hunt;
    // deixar o delta nele faz o ticket que acabou de liquidar o ledger reencontrar uma base
    // antiga mais uma variação que já entrou no banco. Incorporar o delta à base aqui conserva o
    // saldo disponível e deixa a próxima sessão começar do mesmo número que a linha durável.
    if (owner !== undefined && owner.goldDelta !== 0) {
      owner.settleGoldDelta();
    }

    // A caixa é escrita AQUI, e não na liquidação: o relógio de 30 minutos começa no
    // encerramento (§21.6), e quem sabe que a sessão encerrou é quem a encerrou. Deixar para o
    // `jobs` faria o prazo começar até dez segundos depois, e por acaso.
    await this.#saveLootBox(characterId, receipt.sessionId, owner);
  }

  async #saveLootBox(characterId: string, sessionId: string, owner: CharacterRuntime | undefined): Promise<void> {
    if (owner === undefined || owner.lootBox.length === 0) return;
    await this.#options.lootBoxes?.save(sessionId, owner.lootBox)
      .catch((error: unknown) => {
        this.#logger.error({ error, characterId, sessionId }, 'Failed to save the session loot box');
      });
  }

  /**
   * O extrato de ESTADO DURÁVEL de um shard (#154).
   *
   * O shard não credita progresso (ADR 0023) — mas guarda estado: vocação, equipamento, arma
   * de vocação e munição mudam na praça e, sem isto, sumiam no logout (o `equip` da FUN-82 e
   * o `select-ammo` do #152 já caíam nesse buraco). Só para quem mexeu em algo (`dirty`).
   * Agregados zerados: a linha de ledger que o `jobs` insere é a chave de idempotência
   * (`UNIQUE (session_id, seq)`), não um crédito. `seq` avança na cópia compartilhada, e
   * cada extrato tem o seu.
   */
  async #saveDurableReceipt(characterId: string, hosted: HostedSession, reason: EndReason): Promise<void> {
    const receipts = this.#options.receipts;
    const accountId = this.#accountIdByCharacter.get(characterId);
    const owner = hosted.session.participants.find((p) => p.id === characterId);
    if (receipts === undefined || accountId === undefined || owner === undefined) return;
    if (!hosted.dirty.has(characterId)) return;
    hosted.session.ledgerSeq += 1;
    await receipts.save({
      sessionId: hosted.session.id,
      characterId,
      accountId,
      reason,
      seq: hosted.session.ledgerSeq,
      aggregates: EMPTY_AGGREGATES,
      notableEvents: [],
      ...(owner.vocationId === null ? {} : { vocation: owner.vocationId }),
      ...(owner.ammo.size === 0 ? {} : { ammo: Object.fromEntries(owner.ammo) }),
      equipment: equipmentOf(owner),
      layout: layoutOfState(owner.inventory.getState()),
      acquired: acquiredBy(owner, hosted.session.id),
      ...(owner.lootBox.length === 0 ? {} : { lootBox: owner.lootBox }),
    });
    hosted.dirty.delete(characterId);
    await this.#saveLootBox(characterId, hosted.session.id, owner);
  }

  /** Grava todas as sessões hospedadas. Chamado pelo timer e pela drenagem. */
  async saveAll(): Promise<void> {
    const snapshots = this.#options.snapshots;
    if (snapshots === undefined) return;
    for (const [characterId, sessionId] of this.#sessionIdByCharacter) {
      const hosted = this.#sessions.get(sessionId);
      const accountId = this.#accountIdByCharacter.get(characterId);
      if (hosted === undefined || accountId === undefined) continue;
      // Shard não tem snapshot (FUN-71, ADR 0023). Não há progresso a guardar na praça, e o
      // que seria guardado é a praça INTEIRA — uma cópia por participante, duzentas vezes o
      // mesmo estado a cada dez segundos.
      if (hosted.session.ruleset.shared === true) continue;
      try {
        await snapshots.save(
          characterId, accountId, this.#options.nodeId, hosted.session.snapshot(),
        );
      } catch (error) {
        // Falhar aqui é perder o próximo intervalo, não a sessão. Silenciar seria perder a
        // única pista de por que uma retomada voltou mais atrasada do que devia.
        this.#logger.error({ error, characterId }, 'Failed to save session snapshot');
      }
    }
  }

  /**
   * Id numérico da criatura, criado na primeira vez que alguém precisa dele.
   *
   * A chave é o `characterId` do personagem ou o `subject` do monstro (`m:<n>`): os dois
   * moram no mesmo mapa porque o cliente numera criatura num espaço só. Ver `nextCreatureId`
   * para por que o contador nunca volta.
   */
  #creatureId(hosted: HostedSession, key: string): number {
    const existing = hosted.creatureIds.get(key);
    if (existing !== undefined) return existing;
    const assigned = hosted.nextCreatureId;
    hosted.nextCreatureId += 1;
    hosted.creatureIds.set(key, assigned);
    return assigned;
  }

  #targetIdOf(hosted: HostedSession, character: CharacterRuntime | undefined): number | null {
    if (character === undefined) return null;
    const ruleset = hosted.session.ruleset as Partial<HuntRuleset>;
    const target = ruleset.attackTargetOf?.(character) ?? null;
    return target === null ? null : (hosted.creatureIds.get(target.subject) ?? null);
  }

  /**
   * O estado ATUAL, montado do zero a cada pedido.
   *
   * Não existe fila de eventos guardada para reproduzir depois, e isso é decisão, não
   * economia: guardar seis horas de eventos para reproduzir na volta é o erro que o §16.2
   * nomeia. O que a sessão guarda é onde tudo está agora, os agregados e a lista curta de
   * eventos notáveis.
   */
  #sessionState(hosted: HostedSession, characterId: string): S2CMessage {
    const { session } = hosted;
    // A MESMA montagem do `player-stats` ao vivo (FUN-109): o que a reanexação mostra e o que
    // o ciclo atualiza precisam concordar, e duas montagens divergem na primeira regra nova.
    const self = playerStatsOf(
      this.#participantOf(hosted, characterId),
      this.#options.skillCatalog,
      this.#targetIdOf(hosted, this.#participantOf(hosted, characterId)),
    );

    // Quem está no CAMPO DE VISÃO, e não a sessão inteira (FUN-33). Numa praça de duzentos, o
    // `session-state` completo seria o pior pacote do jogo — e mandaria para a tela gente que
    // ela não tem como desenhar, porque está fora da câmera.
    //
    // Sessão privada não tem AOI: ali "todos os participantes" já é a resposta certa.
    const visible = hosted.aoi === null
      ? session.participants
      : session.participants.filter((participant) => participant.id === characterId
        || hosted.aoi?.visibleTo(characterId).includes(participant.id) === true);

    const creatures = visible.map((participant) => ({
      id: this.#creatureId(hosted, participant.id),
      position: participant.position,
      appearanceId: this.#options.playerOutfitId ?? 0,
      name: this.#nameByCharacter.get(participant.id) ?? participant.id,
      health: participant.health,
      maxHealth: participant.maxHealth,
      // As cores do ticket (FUN-104), pelo MESMO espalhamento do `creature-appear`: o cliente
      // aplica os dois pelo mesmo caminho, e o reanexado precisa ver o vizinho pintado igual.
      ...this.#colorsOf(participant.id),
    }));

    // Os monstros VIVOS da hunt entram na mesma lista (FUN-103): quem reanexa no meio precisa
    // ver o que já está lá, e não só o que nascer depois. O getter vem do ruleset pelo mesmo
    // cast que `#applyBotConfig` usa — sessão sem monstro devolve `undefined`, e é o normal.
    const ruleset = session.ruleset as Partial<HuntRuleset>;
    for (const monster of ruleset.monsters ?? []) {
      if (!monster.alive) continue;
      const definition = this.#options.monsterCatalog?.get(monster.monsterId);
      creatures.push({
        id: this.#creatureId(hosted, monster.subject),
        position: { ...monster.position, z: ruleset.floor ?? 0 },
        appearanceId: definition?.outfitId ?? 0,
        name: definition?.name ?? monster.monsterId,
        health: monster.health,
        maxHealth: definition?.health ?? monster.health,
      });
    }

    const spendingShares = partySpendingSharesOf(hosted);
    // A seção PARTY do analisador (§32, ADR 0033 d.11) — o MESMO bloco do `analyzer.party`,
    // porque `session-state` já tem `party` como o roster (#196). Ausente em solo (D8).
    const partySummary = partySummaryOf(hosted);
    return {
      type: 'session-state',
      sessionType: session.ruleset.type,
      elapsedMs: session.aggregates.durationMs,
      ...(session.ruleset.huntId === undefined ? {} : { huntId: session.ruleset.huntId }),
      ...(session.ruleset.difficulty === undefined ? {} : { difficulty: session.ruleset.difficulty }),
      self: {
        creatureId: this.#creatureId(hosted, characterId),
        characterId,
        health: self.health,
        maxHealth: self.maxHealth,
        mana: self.mana,
        maxMana: self.maxMana,
        level: self.level,
        xp: self.xp,
        vocationId: self.vocationId,
        speed: self.speed,
        skills: self.skills,
        magicLevel: self.magicLevel,
      },
      world: {
        // O mapa da sessão (FUN-120): o cliente busca a geometria e a pilha por este id.
        mapId: session.ruleset.mapId ?? null,
        creatures,
        // Os cadáveres no chão (FUN-123), com a arte da tabela; sem linha, sem cadáver.
        groundItems: (ruleset.groundItems ?? []).flatMap((corpse) => {
          const appearanceId = this.#options.monsterCatalog?.get(corpse.monsterId)?.corpseAppearanceId;
          return appearanceId === undefined ? [] : [{ id: corpse.id, position: corpse.position, appearanceId }];
        }),
      },
      // Os agregados DESTE personagem (#187, #196): numa party, o que ele rendeu — não a soma.
      aggregates: { ...session.aggregatesOf(characterId) },
      notableEvents: session.notableEvents.map((event) => ({ ...event })),
      // A party (#196): quem está nela e a bolsa, do estado do ruleset. Ausente em solo.
      ...this.#partyBlock(hosted),
      ...(partySummary === undefined ? {} : { partySummary }),
      ...(spendingShares === undefined ? {} : { partySpending: { shares: spendingShares } }),
      // A configuração de bot EM VIGOR (FUN-111): a do ticket ou a última `bot-config` aceita.
      // É o que a tela mostra ao abrir; sem isto ela nascia vazia a cada carregamento, e um
      // "Salvar" dali apagava as regras que a hunt estava executando.
      ...(this.#botByCharacter.has(characterId)
        ? { botConfig: this.#botByCharacter.get(characterId) }
        : {}),
      ...(this.#lastPlayerCount === undefined ? {} : { onlinePlayers: this.#lastPlayerCount }),
    };
  }

  #hostedSession(characterId: string): HostedSession | undefined {
    const sessionId = this.#sessionIdByCharacter.get(characterId);
    return sessionId === undefined ? undefined : this.#sessions.get(sessionId);
  }

  async #createAndRegister(
    characterId: string,
    initialCharacter: InitialCharacter | undefined,
    accountId: string | undefined,
    party?: PartyTicket,
  ): Promise<void> {
    // A party (#195): a sessão pode JÁ estar hospedada — outro membro chegou primeiro — e aí
    // este só entra nela. Senão, ou é retomada de snapshot (que já traz os N), ou o primeiro
    // ticket cria a hunt com todos.
    const hostedParty = party === undefined ? undefined : this.#sessions.get(party.sessionId);
    const resumed = hostedParty === undefined ? await this.#resume(characterId, accountId) : null;
    const session = hostedParty?.session
      ?? resumed?.session
      ?? this.#options.createSession(characterId, initialCharacter, party);
    await this.#register(characterId, session, accountId);
    // Uma sessão retomada com MAIS de um dono (#194, ADR 0027) traz os outros membros da party
    // dentro: eles precisam do lease e do mapa deste nó antes de qualquer coisa local existir,
    // senão o lease deles expira, o login seguinte resolve para outro nó, e a cópia do
    // snapshot que ele guardou revive a MESMA sessão duas vezes. A conta de cada um vem do
    // snapshot dele; recusa de lease derruba a retomada inteira — nada local foi criado ainda.
    const others = resumed === null && (party === undefined || hostedParty !== undefined)
      ? []
      : session.participants.filter((p) => p.id !== characterId);
    for (const other of others) {
      // Da party recém-criada a conta vem do ticket; da retomada, do snapshot de cada um.
      const fromTicket = party?.members.find((m) => m.characterId === other.id)?.accountId;
      const otherAccount = fromTicket ?? (await this.#options.snapshots?.load(other.id))?.accountId;
      if (otherAccount === undefined) {
        this.#logger.warn({ characterId: other.id, sessionId: session.id }, 'Party member has no snapshot of their own; hosting without a lease');
        continue;
      }
      await this.#register(other.id, session, otherAccount);
      this.#accountIdByCharacter.set(other.id, otherAccount);
    }
    // Nome e cores ANTES de hospedar: `#createLocal` anuncia a chegada a quem já está na praça
    // (FUN-71), e o `creature-appear` desse anúncio lê as duas tabelas. Depois, quem já
    // estava veria o recém-chegado com o id no lugar do nome e sem cores — e só o próximo
    // `session-state` corrigiria. Passou despercebido enquanto o único leitor era o chat, que
    // só fala depois. Depois do `#register`, porém: registro recusado não pode deixar rastro.
    if (initialCharacter?.name !== undefined) this.#nameByCharacter.set(characterId, initialCharacter.name);
    if (initialCharacter?.outfitColors !== undefined) {
      this.#colorsByCharacter.set(characterId, initialCharacter.outfitColors);
    }
    this.#createLocal(characterId, session, accountId);
    for (const other of others) {
      this.#sessionIdByCharacter.set(other.id, session.id);
      this.#restingSince.set(other.id, this.#now());
      // Nome, cores e bot dos outros membros vêm do bloco da party (#195): quem os vê no
      // mundo precisa do nome, e a tela deles do bot — mesmo que nunca conectem.
      const member = party?.members.find((m) => m.characterId === other.id);
      if (member?.initialCharacter.name !== undefined) this.#nameByCharacter.set(other.id, member.initialCharacter.name);
      if (member?.initialCharacter.outfitColors !== undefined) this.#colorsByCharacter.set(other.id, member.initialCharacter.outfitColors);
      if (member !== undefined) this.#adoptTicketBotConfig(other.id, session, member.initialCharacter);
    }
    this.#adoptTicketBotConfig(characterId, session, initialCharacter);
    if (resumed !== null) {
      this.#resumedGapMs.set(characterId, resumed.gapMs);
      this.#logger.info(
        { characterId, sessionId: session.id, gapMs: resumed.gapMs },
        'Session resumed from snapshot',
      );
    }
  }

  /**
   * Retoma do snapshot, se houver um e se ele for reconstruível.
   *
   * A exclusão mútua de verdade NÃO está aqui: está no `register`, que é atômico e recusa
   * registrar um `sessionId` diferente enquanto o lease de outro vive. Duas retomadas
   * simultâneas produzem duas sessões locais, mas só uma consegue se registrar — e a outra
   * levanta antes de existir para alguém. É por isso que a trava do `jobs` é contra trabalho
   * duplicado, e não contra duas cópias rodando.
   */
  async #resume(
    characterId: string,
    accountId: string | undefined,
  ): Promise<{ session: Session; gapMs: number } | null> {
    const snapshots = this.#options.snapshots;
    const restore = this.#options.restoreSession;
    if (snapshots === undefined || restore === undefined) return null;

    let stored;
    try {
      stored = await snapshots.load(characterId);
    } catch (error) {
      this.#logger.error({ error, characterId }, 'Failed to load session snapshot');
      return null;
    }
    if (stored === null) return null;

    const session = restore(stored.snapshot);
    if (session === null) {
      // Não dá para reconstruir: formato antigo, ruleset desconhecido, ou versão de conteúdo
      // diferente da deste nó (invariante 7).
      //
      // CREDITAR ANTES DE APAGAR. Descartar em silêncio é o oposto do que o ADR 0010 decide
      // para o mesmo problema — encerrar creditando, não jogar fora — e o §38.4 é explícito
      // que hunt AFK não pode sumir sem explicação. O snapshot carrega agregados, eventos
      // notáveis e `ledgerSeq`, que é tudo o que o extrato precisa.
      await this.#creditUnrestorable(characterId, accountId, stored.snapshot);
      this.#logger.warn(
        { characterId, sessionId: stored.snapshot.id, type: stored.snapshot.type },
        'Snapshot could not be restored; credited its progress and discarded it',
      );
      await snapshots.remove(characterId).catch(() => undefined);
      return null;
    }
    return { session, gapMs: Math.max(0, Date.now() - stored.savedAtMs) };
  }

  /**
   * Extrato de uma sessão que não volta mais, montado a partir do snapshot.
   *
   * O `seq` sai de `ledgerSeq + 1`, que é a MESMA regra do caminho normal — e é ela que torna
   * isto idempotente: se aquela sessão já tinha creditado esse `seq`, a chave única do ledger
   * recusa o segundo, e o jogador não recebe duas vezes. Sem essa aritmética, um snapshot que
   * sobreviveu a uma drenagem parcial creditaria o mesmo progresso de novo.
   */
  async #creditUnrestorable(
    characterId: string,
    accountId: string | undefined,
    snapshot: SessionSnapshot,
  ): Promise<void> {
    const receipts = this.#options.receipts;
    if (receipts === undefined || accountId === undefined) return;
    const owner = snapshot.participants.find((participant) => participant.id === characterId);
    try {
      await receipts.save({
        sessionId: snapshot.id,
        characterId,
        accountId,
        // `drain` porque foi o servidor que encerrou, não o jogador: é a mesma família de
        // "sua sessão foi encerrada por manutenção", que é o que de fato aconteceu.
        reason: 'drain',
        seq: snapshot.ledgerSeq + 1,
        // Os agregados DELE (#187); snapshot anterior só tem a soma, que era dele.
        aggregates: snapshot.aggregatesByCharacter?.[characterId] ?? snapshot.aggregates,
        notableEvents: snapshot.notableEvents,
        ...(owner?.staminaMs === undefined || owner.staminaMs === null
          ? {}
          : {
            staminaMs: owner.staminaMs,
            staminaUpdatedAtMs: owner.staminaUpdatedAtMs ?? 0,
          }),
        // As skills e o Bestiário estão no `CharacterState` do snapshot, e sem eles aqui a
        // progressão da sessão inteira sumia: a XP era creditada e o abate 9 999 voltava a
        // ser o 5 000 (achado da revisão da FUN-113 — as skills sofriam o mesmo). Ambos são
        // absolutos e monotônicos, e o ledger funde pelo maior: um snapshot velho não rebaixa.
        ...(owner?.skills === undefined ? {} : { skills: owner.skills }),
        ...(owner?.bestiary === undefined ? {} : { bestiary: owner.bestiary }),
        ...(owner?.ammo === undefined ? {} : { ammo: owner.ammo }),
        // E a vocação, o equipamento e o que a sessão criou (#154): era o buraco desta função
        // — um item equipado numa sessão irrestaurável se perdia, e a arma de vocação com ele.
        ...(owner?.vocationId === undefined || owner.vocationId === null ? {} : { vocation: owner.vocationId }),
        ...(owner?.inventory === undefined ? {} : {
          equipment: equipmentOfState(owner.inventory),
          layout: layoutOfState(owner.inventory),
          acquired: acquiredByState(owner.inventory, snapshot.id),
        }),
        ...(owner?.lootBox === undefined || owner.lootBox.length === 0 ? {} : { lootBox: owner.lootBox }),
      });
    } catch (error) {
      // Falhar aqui perde o crédito, e é por isso que o snapshot NÃO é apagado em seguida
      // quando isto lança: a próxima conexão tenta de novo.
      this.#logger.error(
        { error, characterId, sessionId: snapshot.id },
        'Failed to credit an unrestorable snapshot',
      );
      throw error;
    }
  }

  #createLocal(characterId: string, session: Session, accountId?: string): void {
    // A sessão pode JÁ estar hospedada: num shard (FUN-71), o segundo personagem a entrar
    // recebe a mesma `Session` que o primeiro. Criar um `HostedSession` novo aqui jogaria fora
    // os visualizadores e os ids de criatura de quem já estava lá — e o sintoma seria o
    // primeiro jogador parar de receber tudo no instante em que o segundo entrasse.
    const existing = this.#sessions.get(session.id);
    const hosted: HostedSession = existing ?? {
      session,
      viewers: new Set(),
      creatureIds: new Map(),
      nextCreatureId: 1,
      // Só o shard tem AOI (FUN-33): numa hunt de um personagem ela seria índice para nada.
      aoi: this.#interestManaged(session) ? new AreaOfInterest() : null,
      // Vale tanto para a sessão nova quanto para a retomada de snapshot: as duas começam a
      // ser cobradas a partir de agora, e não de um relógio que não é deste processo.
      lastAdvancedAtMs: this.#now(),
      credited: new Set(),
      receiptSaves: new Map(),
      departures: [],
      dirty: new Set(),
      sentItemsLooted: session.aggregates.itemsLooted,
      sentStats: new Map(),
      sentAnalyzer: new Map(),
      sentBestiary: new Map(),
      sentParty: null,
      lastPartyBag: null,
      sentConditions: new Map(),
      sentSpending: null,
    };
    this.#sessions.set(session.id, hosted);
    this.#sessionIdByCharacter.set(characterId, session.id);
    if (accountId !== undefined) this.#accountIdByCharacter.set(characterId, accountId);
    // Nasce em repouso: um ticket emitido e nunca usado deixaria a sessão de pé para sempre,
    // segurando um slot que ninguém está usando. O repouso é por PERSONAGEM desde a FUN-71 —
    // num shard, um jogador fechando o navegador não pode recolher a praça dos outros.
    this.#restingSince.set(characterId, this.#now());

    // Quem já estava na praça precisa VER quem chegou. Sem isto, o novo só apareceria no
    // primeiro passo que ele desse — e ficaria invisível enquanto estivesse parado.
    //
    // Vale também para o PRIMEIRO a chegar, que não avisa ninguém: é ele entrando no índice de
    // células, e sem isso quem chegasse depois não teria como encontrá-lo.
    this.#announceArrival(hosted, characterId);

    this.#logger.info(
      { characterId, sessionId: session.id, type: session.ruleset.type },
      existing === undefined ? 'Session created' : 'Character joined a shared session',
    );
  }

  /**
   * Alguém chegou na sessão (FUN-71), e quem está POR PERTO precisa saber (FUN-33).
   *
   * "Por perto" e não "todo mundo": numa praça de duzentos, avisar a praça inteira de cada
   * entrada é o mesmo O(N²) que a AOI existe para cortar, só que no evento mais barulhento do
   * dia — todo login passa por aqui.
   */
  #announceArrival(hosted: HostedSession, characterId: string): void {
    const arrival = hosted.session.participants.find((p) => p.id === characterId);
    if (arrival === undefined) return;
    const aoi = hosted.aoi;
    if (aoi === null) return;
    this.#applyVisibility(hosted, characterId, aoi.enter(characterId, arrival.position));
  }

  /** Alguém saiu da sessão (FUN-71). Some da tela de quem o enxergava, e só dela. */
  #announceDeparture(hosted: HostedSession, characterId: string): void {
    const aoi = hosted.aoi;
    if (aoi !== null) {
      this.#applyVisibility(hosted, characterId, aoi.leave(characterId));
    }
    // O id numérico é liberado AQUI, e só aqui: sumir de vista é reversível, sair da sessão
    // não. Reciclar no primeiro caso deixaria o sprite antigo parado para sempre na tela.
    hosted.creatureIds.delete(characterId);
  }

  async #register(
    characterId: string,
    session: Session,
    accountId: string | undefined,
  ): Promise<void> {
    const directory = this.#options.directory;
    if (directory === undefined) return;
    if (accountId === undefined) throw new Error('account is required to register a session');
    const registered = await directory.register(characterId, {
      sessionId: session.id,
      nodeId: this.#options.nodeId,
      type: session.ruleset.type satisfies SessionType,
    }, accountId);
    if (!registered) throw new Error('active reservation expired before session registration');
  }

  async #renewLeases(): Promise<void> {
    const directory = this.#options.directory;
    if (directory === undefined || this.#sessionIdByCharacter.size === 0) return;
    try {
      await directory.renew([...this.#accountIdByCharacter].map(([characterId, accountId]) => ({
        characterId,
        accountId,
      })));
    } catch (error) {
      // Lease não renovado vira sessão órfã para a FUN-28. Registrar alto: é o sintoma que
      // antecede uma sessão sendo retomada em outro nó sem necessidade.
      this.#logger.error({ error }, 'Failed to renew session leases');
    }
  }

  /**
   * Agrega o total de jogadores online entre todos os nós vivos do diretório e manda para
   * todo visualizador conectado neste nó (SV-07, RF-03).
   *
   * Roda fora do caminho quente do tick (`setInterval` próprio de 30 s). Não filtra por estado
   * aqui — a barra do topo aparece na Cidade e na hunt, e uma sessão sem visualizador
   * simplesmente não tem para quem mandar (o `for` interno não itera nada).
   *
   * Sem `directory` (nó solo, ou teste), o total é só a contagem local — não há outro nó para
   * somar.
   *
   * Falha do Redis NÃO publica um número errado. A alternativa óbvia — cair para
   * `connectedCharacterCount` deste nó sozinho quando `aliveNodes()` falha — pareceria, para
   * quem está vendo, uma queda repentina de milhares de jogadores para os poucos deste
   * processo: "o Redis está lento" não pode virar "o servidor esvaziou" na tela de ninguém. O
   * último total conhecido fica onde está, e o próximo ciclo de 30 s tenta de novo.
   */
  async #publishPlayerCount(): Promise<void> {
    const directory = this.#options.directory;
    let total = this.connectedCharacterCount;
    if (directory !== undefined) {
      try {
        const nodes = await directory.aliveNodes();
        total = nodes.reduce((sum, node) => sum + (node.players ?? 0), 0);
      } catch (error) {
        this.#logger.error({ error }, 'Failed to aggregate online player count');
        return;
      }
    }
    this.#lastPlayerCount = total;
    const message: S2CMessage = { type: 'player-count', count: total };
    for (const hosted of this.#sessions.values()) {
      for (const viewer of hosted.viewers) viewer.send(message);
    }
  }

  #now(): number {
    return this.#options.now?.() ?? performance.now();
  }
}
