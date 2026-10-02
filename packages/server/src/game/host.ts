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

import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type {
  Aggregates, CombatEvent, EndReason, FindResult, FollowState, GridPoint, ManualActionResult, MemberLeft,
  PartyEvent, PresenceEvent, Receipt, Session, SessionSnapshot, SessionType, WorldPoint,
} from '@draconya/sim';
import { ACTIVE_CONDITION_KINDS } from '@draconya/protocol';
import type {
  ActiveConditionKind, C2SMessage, MonsterRace, OutfitColors, S2CMessage, S2CProps,
} from '@draconya/protocol';
import { DEFAULT_MONSTER_RACE, ITEM_SLOTS, isBotConfigV2 } from '@draconya/content';
import type {
  Ammunition, Appearances, Blessing, BotConfigV2, Charm, Hazard, Item, ItemSlot, Monster, OutfitLook,
  RemovedBotSlot, Skill, Spell, Training, Vocation,
} from '@draconya/content';
import {
  blessingCost, buyItem, containerRulesFor, DEFAULT_FIGHT_MODE, hasBlessing, holdStamina, isEmptyFamiliarState,
  PartyFullError, shareCostsOf, skillFactorFor, splitLootOf, withBlessing,
} from '@draconya/sim';
import type {
  AmmoRefusal, BuyRefusal, CarriedItem, CharacterRuntime, CharmAssignRefusal, CharmBestiaryEntry,
  CharmRemoveRefusal, CharmUnlockRefusal, ConfigurePartyResult, ContainerRules, ExitStatus, FightMode,
  HazardSelectRefusal, HuntRuleset, TrainingRuleset,
  InventoryRefusal, InventoryResult, InventoryState, ItemRef, PartyBagChanged, PartyEndVoteResult,
  LearnSpellRefusal, PartySettingsPatch, Place, PromoteRefusal, SlotRefusal, SlotState, TakeLootRefusal,
  TileAppearanceChange, UseItemRefusal, UseOnMapRejection, UseSlotTarget, VocationRefusal,
} from '@draconya/sim';
import type { Progression } from '@draconya/content';
import type { SessionDirectory, SessionLocation } from '../directory.js';
import { overlaysOfState, settleSnapshotAsReceipt } from '../snapshot-settlement.js';
import type { SnapshotStore } from '../snapshots.js';
import type { ReceiptStore } from '../receipts.js';
import type { BoxedItem } from '../loot-box.js';
import type { Logger } from '../log.js';
import type { InitialCharacter, PartyTicket } from '../tickets.js';
import { AreaOfInterest } from './aoi.js';
import { EncodeCache, Viewer, type EncodeStats, type ViewerOptions, type ViewerSocket } from './viewer.js';
import { ViewerSet } from './viewer-set.js';
import { findPersonText } from './find-text.js';
import { hitEffectOf, isPhysicalHit, monsterLookOf, monsterOutfitOf, monsterPresentationOf } from './monster-look.js';
import { REFUSAL_TEXT, TransitionError, refuseTransition } from './transitions.js';
import {
  creditsAggregates, keepsSnapshot, leavesOnExit, offersCityServices, usesAreaOfInterest,
} from './ruleset-traits.js';
import { TICK_LAG_BUDGET_MS, type GameMetrics } from './metrics.js';

/** Cria a sessão de um personagem que ainda não tem uma. */
export type SessionFactory = (
  characterId: string, initialCharacter?: InitialCharacter, party?: PartyTicket,
) => Session;

/** Reconstrói uma sessão a partir de um snapshot. `null` = não dá para retomar (FUN-28). */
export type SessionRestorer = (snapshot: SessionSnapshot) => Session | null;

/**
 * Para onde o personagem quer ir. `huntId` e `difficulty` só valem para `to: 'hunt'`;
 * `itemInstanceId` (a exercise weapon) só para `to: 'training'` (#631).
 */
export interface TransitionRequest {
  readonly to: SessionType;
  readonly huntId?: string;
  readonly difficulty?: string;
  readonly itemInstanceId?: string;
  /**
   * A configuração do bot deste personagem, JÁ VALIDADA (FUN-81). Preenchida pelo host, nunca
   * pelo cliente — o cliente manda a configuração numa mensagem própria, e o que chega aqui é
   * o que o servidor aceitou.
   */
  readonly botConfig?: BotConfigV2;
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
  /**
   * O personagem que JÁ saiu de `from` (#802): quem sai da party por dentro do `sim` — morte,
   * regra de saída, o `leave-hunt` que o ruleset conclui — não está mais em `from.participants`,
   * e o extrato dele (`Receipt`) só carrega números. O MESMO objeto que `Session.leave` devolveu
   * atravessa para a sessão de destino, como o que atravessa pela lista sempre fez.
   */
  departed?: CharacterRuntime,
) => Session | null;

export interface SessionHostOptions {
  readonly nodeId: string;
  readonly contentVersion: string;
  readonly createSession: SessionFactory;
  /**
   * Constrói UM personagem para entrar numa sessão que JÁ existe (#402, ADR 0035 D7). É a
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
   * Relógio de PAREDE (epoch, ms) — o mesmo que o construtor de sessões recebe (`nowMs` do `main`)
   * e que `characters.stamina_updated_at` e os carimbos do ADR 0052 d.6 usam. É OUTRO relógio que
   * `now`: aquele é o monotônico do processo (`performance.now`) e não serve para gravar um instante
   * que sobrevive ao restart. Só o que o host grava no extrato com data (o marco da stamina do
   * Treino) lê daqui. Ausente: `Date.now`.
   */
  readonly wallNow?: () => number;
  /**
   * Aceita ou recusa uma configuração de bot (FUN-81). Ausente: `bot-config` é ignorada e o
   * jogador recebe um aviso — um host montado sem conteúdo não tem como julgar vocabulário.
   */
  readonly acceptBotConfig?: (raw: unknown, level: number) => BotConfigDecision;
  /**
   * Carrega uma configuração de bot JÁ PERSISTIDA — a que chega no TICKET, não a que o jogador
   * acabou de editar (FUN-81, ADR 0014). Diferente de `acceptBotConfig`: nunca recusa a
   * configuração inteira por causa de conteúdo removido/renomeado (uma magia que saiu do
   * catálogo, #596) — o slot torto vira vazio, e o resto sobrevive. Ausente: `bot-config` do
   * ticket é ignorada, como sem `acceptBotConfig`.
   */
  readonly loadBotConfig?: (raw: unknown, level: number) => BotConfigLoadResult;
  /**
   * Registra a preferência no Redis para jobs/api gravarem no Postgres (ADR 0028).
   * Ausente ou falhando: aplica na sessão, mas devolve falha de salvamento ao jogador.
   */
  readonly saveBotConfig?: (characterId: string, config: BotConfigV2) => Promise<void>;
  /**
   * O catálogo de itens (FUN-76), para as regras de equipar. Ausente: nada se veste, e a
   * recusa é honesta — um host sem conteúdo não sabe o que é uma espada.
   */
  readonly itemCatalog?: ReadonlyMap<string, Item>;
  /**
   * O catálogo de munição abstrata (ADR 0026 d.3), para o `select-ammo`. Ausente: a escolha é
   * recusada, e a recusa é honesta — um host sem conteúdo não sabe o que é uma flecha.
   */
  readonly ammunitionCatalog?: ReadonlyMap<string, Ammunition>;
  /**
   * O catálogo dos 25 Charms (M39-02, #602, ADR 0053 d.3), para `charm-unlock`/`charm-assign`.
   * Ausente: nada se desbloqueia, e a recusa é honesta — como os itens.
   */
  readonly charmCatalog?: ReadonlyMap<string, Charm>;
  /**
   * A ficha de Bestiário de cada monstro — só `toKill`/`charmsPoints` (ADR 0053 d.1) —, para
   * `Charms.unlock`/`assign` derivarem pontos ganhos e a completude do alvo. Ausente: nenhum
   * ponto de Charm é ganho, e nenhum major é atribuível (a mesma degradação honesta de acima).
   */
  readonly charmBestiaryEntries?: ReadonlyMap<string, CharmBestiaryEntry>;
  /**
   * O Hazard (M44-14, #632, ADR 0052 d.5): os multiplicadores e as zonas, para `set-hazard-level`
   * conferir a zona e a faixa. Ausente: a escolha é recusada, e a recusa é honesta — um host sem
   * conteúdo não sabe o que é uma zona de hazard.
   */
  readonly hazard?: Hazard;
  /**
   * As sete bênçãos PvE (#570, ADR 0052), para `buy-blessing`. Ausente: a compra é recusada,
   * e a recusa é honesta — um host sem conteúdo não sabe o que é uma bênção.
   */
  readonly blessingCatalog?: ReadonlyMap<string, Blessing>;
  /**
   * O catálogo de magias (#624, ADR 0058 d.2), para `learn-spell`: vocação, level e preço
   * (`learnPrice`) de cada uma. Ausente: nada se aprende, e a recusa é honesta — um host sem
   * conteúdo não sabe o que é uma magia.
   */
  readonly spellCatalog?: ReadonlyMap<string, Spell>;
  /**
   * O Treino (#631, ADR 0059): as regras que `set-offline-training-skill` confere — as skills do
   * livro — e que decidem se o servidor tem Treino. Ausente: nenhuma escolha é aceita e
   * `enter-training` é recusado, com a recusa honesta de um host sem conteúdo.
   */
  readonly training?: Training;
  /**
   * As vocações e o level da escolha (#154, ADR 0026 decisão 1), para `choose-vocation`.
   * Ausentes: nada se escolhe, e a recusa é honesta — como os itens.
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
   * Ligar o interest management por célula nas sessões compartilhadas (FUN-33). Padrão: sim.
   *
   * Existe desligável por duas razões, e nenhuma é "por precaução": é o GRUPO DE CONTROLE da
   * medição — `pnpm bench:city` roda os dois lados e é assim que "não cresce
   * quadraticamente" vira número —, e é a saída se um dia a AOI esconder quem não devia. Sem
   * ela, a praça volta a mandar tudo para todos: caro, e visivelmente correto.
   */
  readonly areaOfInterest?: boolean;
  /**
   * Serializar uma vez por ciclo a mesma mensagem entregue a vários visualizadores (OW-22). Padrão:
   * sim. Desligado, cada visualizador codifica a sua cópia no flush, como antes.
   *
   * Existe desligável pela mesma razão de `areaOfInterest`: é o GRUPO DE CONTROLE da medição —
   * `pnpm bench:city` com `ENCODE=each` mede a CPU sem o cache no mesmo processo e na mesma hora —
   * e é o que prova, em teste, que o fio é o mesmo byte a byte com e sem ele.
   */
  readonly encodeOnce?: boolean;
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
const EMPTY_CHARMS: ReadonlyMap<string, Charm> = new Map();
const EMPTY_CHARM_ENTRIES: ReadonlyMap<string, CharmBestiaryEntry> = new Map();
const EMPTY_SPELLS: ReadonlyMap<string, Spell> = new Map();

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
  'not-for-sale': 'Ninguém compra isto.',
};

const VOCATION_REFUSAL: Readonly<Record<VocationRefusal, string>> = {
  'level-too-low': 'Você ainda não chegou ao level da escolha de vocação.',
  'already-chosen': 'Você já escolheu a sua vocação.',
};

/** A recusa de `promote-vocation` (#566, ADR 0042 decisão 1), em palavras. */
const PROMOTE_REFUSAL: Readonly<Record<PromoteRefusal, string>> = {
  'no-vocation': 'Escolha uma vocação antes de se promover.',
  'already-promoted': 'Você já foi promovido.',
  'level-too-low': 'Você ainda não chegou ao level da promoção.',
  'insufficient-gold': 'Você não tem gold suficiente para se promover.',
  'not-promotable': 'Sua vocação não tem promoção.',
};

/** A recusa da seleção de munição (#152, ADR 0026 d.3), em palavras. */
const AMMO_REFUSAL: Readonly<Record<AmmoRefusal, string>> = {
  'level-too-low': 'Você ainda não tem o level dessa munição.',
};

/** A recusa de `learn-spell` (#624, ADR 0058 d.2), em palavras. */
const LEARN_SPELL_REFUSAL: Readonly<Record<LearnSpellRefusal, string>> = {
  'unknown-spell': 'Essa magia não existe.',
  'not-for-sale': 'Ninguém ensina essa magia.',
  'already-learned': 'Você já aprendeu essa magia.',
  'wrong-vocation': 'Essa magia não é da sua vocação.',
  'level-too-low': 'Você ainda não tem o level dessa magia.',
  'insufficient-gold': 'Você não tem gold suficiente para aprender essa magia.',
};

/** A recusa de `charm-unlock` (M39-02, #602, ADR 0053 d.3), em palavras. */
const CHARM_UNLOCK_REFUSAL: Readonly<Record<CharmUnlockRefusal, string>> = {
  'unknown-charm': 'Esse Charm não existe.',
  'already-max-tier': 'Esse Charm já está no tier máximo.',
  'not-enough-points': 'Você não tem pontos de Charm suficientes.',
  'not-enough-echoes': 'Você não tem Minor Charm Echoes suficientes.',
};

/** A recusa de `charm-assign` (ADR 0053 d.4), em palavras. */
const CHARM_ASSIGN_REFUSAL: Readonly<Record<CharmAssignRefusal, string>> = {
  'unknown-charm': 'Esse Charm não existe.',
  'not-unlocked': 'Você precisa desbloquear esse Charm antes de atribuí-lo.',
  'no-slots': 'Você não tem mais slots de Charm disponíveis.',
  'monster-not-complete': 'Você ainda não completou a ficha desse monstro no Bestiário.',
  'category-taken': 'Essa criatura já tem um Charm dessa categoria atribuído.',
};

/** A recusa de `charm-remove` (ADR 0053 d.4), em palavras. */
const CHARM_REMOVE_REFUSAL: Readonly<Record<CharmRemoveRefusal, string>> = {
  'unknown-charm': 'Esse Charm não existe.',
  'not-assigned': 'Esse Charm não está atribuído a nenhuma criatura.',
};

/** A recusa de `buy-item` (#631, ADR 0059 d.2), em palavras. */
const BUY_REFUSAL: Readonly<Record<BuyRefusal, string>> = {
  'not-for-sale': 'Esse item não está à venda.',
  'not-enough-gold': 'Você não tem gold suficiente.',
  'over-capacity': 'Você não tem capacidade para carregar isso.',
  'stack-too-large': 'Você não pode carregar tantos.',
};

/**
 * O fluxo de extratos da escolha de hazard (#632): o sufixo do `sessionId` com que o extrato só de
 * hazard é gravado, para NUNCA dividir a chave `(sessionId, characterId)` do `ReceiptStore` com o
 * extrato do personagem na Cidade — ver `#saveHazardChoice`. O `session_id` do ledger é texto, e
 * `(session_id, seq)` segue único porque o `seq` é o contador da própria sessão.
 */
const HAZARD_RECEIPT_STREAM = ':hazard';

/** A recusa de `set-hazard-level` (M44-14, #632, ADR 0052 d.5), em palavras. */
const HAZARD_REFUSAL: Readonly<Record<HazardSelectRefusal, string>> = {
  'unknown-zone': 'Essa zona não tem nível de hazard.',
  'below-minimum': 'Esse nível de hazard é menor que o mínimo da zona.',
  'above-maximum': 'Você ainda não desbloqueou esse nível de hazard.',
  'invalid-level': 'Esse nível de hazard não é válido.',
};

/** A recusa de `open-corpse`/`take-loot` (#722, ADR 0048 d.4), em palavras — FUN-73. */
const CORPSE_REFUSAL: Readonly<Record<TakeLootRefusal, string>> = {
  'not-found': 'Esse cadáver já não está mais lá.',
  'not-yours': 'Isto não é seu.',
  'too-far-away': 'Você está longe demais.',
  'not-enough-capacity': INVENTORY_REFUSAL['over-capacity'],
};

/**
 * A recusa do slot em palavras (AB-09, FUN-73): o `sim` devolve o código tipado, e é AQUI que
 * ele vira o motivo que o tooltip do slot mostra (AB-10). Traduzir no cliente espalharia a
 * mesma explicação por dois lugares.
 */
const SLOT_REFUSAL: Readonly<Record<SlotRefusal, string>> = {
  'empty-slot': 'Este slot está vazio.',
  'wrong-set': 'Este conjunto não é o ativo — a barra mudou.',
  'disabled': 'Este slot está desligado.',
  'not-in-catalog': 'Essa ação não pode ser usada agora.',
  // A recusa específica do requisito de magic level (RF-02): a runa não roda por ML, e o
  // jogador precisa ler isso, não "ação indisponível".
  'magic-level-too-low': 'Magic level insuficiente.',
  'not-enough-mana': 'Mana insuficiente.',
  // Alma (#593): a mesma régua da mana. Só magia de conjuração declara custo hoje (#594).
  'not-enough-soul': 'Alma insuficiente.',
  'not-enough-gold': 'Gold insuficiente.',
  // Reservado ao consumível FÍSICO (a carga de bênção da M22): supply e magia debitam gold no
  // uso, e o que falta ali é gold, não item.
  'not-enough-item': 'Você não tem o item.',
  'no-target': 'Nenhum alvo ao alcance.',
  'out-of-range': 'O alvo está fora de alcance.',
  'on-cooldown': 'Ainda em cooldown.',
  'group-cooldown': 'O grupo ainda está em cooldown.',
  // Pacificação (#554, M30-07 → M44-04, #622): trocou de andar, foi teleportado ou está sob
  // `pacified` — a mesma frase que o Canary usa (`RETURNVALUE_YOUAREEXHAUSTED`).
  'attack-locked': 'Você está exausto.',
  // Medo (M44-04, #622): nenhuma magia nem runa sai — o "You are feared." do Canary.
  'feared': 'Você está com medo.',
  // Magia agressiva disparada na Cidade (#792, ADR 0044 d.2): protect zone não aceita combate.
  'protection-zone': 'Você está em uma zona de proteção.',
  // A invocação (#598, M38-01, ADR 0057 decisão 3): monstro fora do catálogo, não invocável, ou
  // teto de 2 invocações vivas já atingido — as três causas caem na mesma frase, como
  // `not-in-catalog` já faz para magia/supply/level/vocação.
  'not-summonable': 'Você não pode invocar essa criatura agora.',
  // A ilusão (#621, M44-03): monstro que não existe ou não é ilusionável, ou item nenhum apontado
  // — o `RETURNVALUE_NOTPOSSIBLE` ("Sorry, not possible.") de `creature_illusion.lua`/`chameleon.lua`.
  'not-illusionable': 'Não é possível.',
  // A magia do slot ainda não foi aprendida (#624, ADR 0058 d.1): a tela oferece a compra.
  'not-learned': 'Você ainda não aprendeu essa magia.',
  // `not-possible` tem duas fontes. As runas de invocação restantes (#600, M38-03): o
  // `RETURNVALUE_NOTPOSSIBLE` ("Sorry, not possible.") do Canary para alvo/cadáver que não servem.
  // As utilitárias (#623): Levitate e Magic Rope caem nele por qualquer causa do destino, como o
  // Canary.
  'not-possible': 'Isso não é possível.',
  // O teto de 2 invocações (#600): o "You cannot control more creatures." do Canary.
  'too-many-summons': 'Você não pode controlar mais criaturas.',
  // O familiar (#599, M38-02): as duas frases do `CreateFamiliarSpell` do Canary — "You can't have
  // other summons." e `RETURNVALUE_NOTENOUGHROOM` (a mesma do Magic Rope sem onde pousar, #623).
  'has-summons': 'Você não pode ter outras invocações.',
  'not-enough-room': 'Não há espaço suficiente.',
  // As outras duas do `RETURNVALUE_*` que o `find` dá (#623).
  'person-not-found': 'Nenhum personagem com esse nome está aqui.',
  'no-creatures-around': 'Nenhuma criatura por perto.',
};

/**
 * A recusa de `use-item`/`use-item-on` em palavras (#726, ADR 0049 decisão 3/7): as mesmas do
 * slot, mais as três que só o item da mochila/estoque pode devolver.
 */
const USE_ITEM_REFUSAL: Readonly<Record<UseItemRefusal, string>> = {
  ...SLOT_REFUSAL,
  'not-carried': 'Você não está com esse item.',
  'not-usable': 'Esse item não pode ser usado assim.',
  'you-are-full': 'Você está satisfeito.',
};

/**
 * A recusa de `use-on-map` em palavras (#729, ADR 0050 d.7; `level-too-low` desde #732, ADR 0050
 * d.6 T2; `quest-incomplete`/`already-looted`/`no-capacity`/`unknown-item` desde #733, T2
 * completo). `not-usable` cobre tanto "nada usável ali" quanto um `kind` sem comportamento
 * configurado (`sign` sem `text`, `chest` sem `reward`…) — a mesma decisão de
 * `UseOnMapRejection`, para não inventar um texto de requisito que o conteúdo não pede.
 * `missing-tool` também cobre a porta de chave sem a chave certa — o Draconya não distingue "sem
 * chave nenhuma" de "chave errada" (DT, spec da #732): as duas soam a mesma frase do Canary ("The
 * key does not match." é só para quem já tem ALGUMA chave na mão, e aqui a mochila decide
 * sozinha, sem gesto de arrastar item). `already-looted`/`no-capacity`/`unknown-item` são do baú
 * de quest (`HuntRuleset#useChest`, #733) — a mochila cheia não marca o storage, e o baú
 * continua de pé para a próxima tentativa. O idioma segue a convenção já em vigor aqui (DT-02 da
 * #729/#758): português, como o resto de `USE_ON_MAP_REFUSAL` — o ADR cita o Tibia como
 * MECANISMO, não como padrão de string.
 */
const USE_ON_MAP_REFUSAL: Readonly<Record<UseOnMapRejection, string>> = {
  'out-of-range': 'Está longe demais.',
  'nothing-there': 'Não há nada para usar aqui.',
  'not-usable': 'Isso não pode ser usado assim.',
  'missing-tool': 'Você precisa da ferramenta certa para isso.',
  'level-too-low': 'Você não tem nível suficiente para isso.',
  'quest-incomplete': 'Você ainda não cumpre o que essa porta exige.',
  'already-looted': 'Este baú já está vazio para você.',
  'no-capacity': 'Sua mochila está cheia demais para isso.',
  'unknown-item': 'O baú não tem nada para te dar.',
};

/** A assinatura de `(state, reason)` de um `slot-state` — o gatilho de envio (DT-06). */
function slotStateSignature(states: readonly SlotState[]): string {
  let signature = '';
  for (const state of states) {
    signature += `${state.set}:${state.slot}:${state.state}:${state.reason ?? ''}|`;
  }
  return signature;
}

/** O `slot-state` no fio, montado do estado puro do ruleset. */
function slotStateMessage(states: readonly SlotState[]): S2CMessage {
  return {
    type: 'slot-state',
    slots: states.map((state) => ({
      set: state.set,
      slot: state.slot,
      state: state.state,
      remainingMs: state.remainingMs,
      // O motivo vai em PALAVRAS, como o do `slot-result` (FUN-73): o `sim` devolve o código
      // tipado e é aqui que ele vira a explicação que o tooltip mostra. Mandar o slug cru
      // contradizia o contrato do protocolo e deixava o cliente sem como explicar a recusa.
      ...(state.reason === undefined ? {} : { reason: SLOT_REFUSAL[state.reason] }),
    })),
  };
}

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
/** O progresso de UMA skill como o HUD o lê: nível, percentual e, com Loyalty (#628), o nível efetivo. */
type SkillProgress = PlayerStats['skills'][string];

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
  vocation: Vocation | null, progression: Progression | undefined,
): SkillProgress {
  if (character === undefined || definition === undefined) return { level: 0, percentToNext: 0 };
  const factor = progression === undefined ? undefined : skillFactorFor(definition, vocation, progression);
  const progress = character.skills.progressOf(definition, factor);
  // O nível COM Loyalty (#628) só viaja quando o bônus muda o nível — o caso comum (conta sem
  // degrau, ou tries de bônus que ainda não fecham um nível) manda a mesma forma de antes, e o
  // HUD lê a ausência como "igual ao base". O percentual continua o do nível BASE, como no Canary.
  const loyaltyLevel = character.loyaltyLevelOf(definition, factor);
  return loyaltyLevel > progress.level ? { ...progress, loyaltyLevel } : progress;
}

function playerStatsOf(
  character: CharacterRuntime | undefined,
  skillCatalog?: ReadonlyMap<string, Skill>,
  vocation: Vocation | null = null,
  progression?: Progression,
): PlayerStats {
  const skills: Record<string, SkillProgress> = {};
  if (character !== undefined && skillCatalog !== undefined) {
    for (const definition of skillCatalog.values()) {
      skills[definition.id] = skillProgressOf(character, definition, vocation, progression);
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
    vocationId: character?.vocationId ?? null,
    // Promovido (#566, ADR 0042 decisão 1): o HUD troca o nome exibido pelo `promotion.name`
    // da vocação quando `true` — a resolução do nome é do cliente, que já tem o catálogo.
    promoted: character?.promoted ?? false,
    // A postura de luta (#550, M30-03): o HUD marca o modo em vigor. `FIGHTMODE_ATTACK` — o do
    // Canary — para quem ainda não tem personagem (o extrato de uma sessão sem dono).
    fightMode: character?.fightMode ?? DEFAULT_FIGHT_MODE,
    // A munição escolhida por família (#152, ADR 0026 d.3). `null` é "a básica da família".
    ammo: {
      arrow: character?.ammo.get('arrow') ?? null,
      bolt: character?.ammo.get('bolt') ?? null,
    },
    speed: character === undefined ? 0 : Math.round(character.speed * character.speedScale),
    skills,
    magicLevel: skillProgressOf(character, skillCatalog?.get('magic'), vocation, progression),
    // O bônus de Loyalty da conta (#628): fixado no ticket, constante pela sessão. Ausente quando
    // é zero — o `player-stats` do caso comum continua idêntico ao de antes.
    ...(character === undefined || character.loyaltyBonusPercent === 0
      ? {} : { loyaltyBonusPercent: character.loyaltyBonusPercent }),
    // Alma (#593): `soulMax` é da VOCAÇÃO — zero sem uma escolhida, o "sem teto" do HUD. A
    // vocação PROMOVIDA (#566) reescreve o teto quando o conteúdo declara `promotion.soulMax`.
    soul: character?.soul ?? 0,
    soulMax: (character?.promoted === true ? vocation?.promotion?.soulMax : undefined) ?? vocation?.soulMax ?? 0,
  };
}

function sameSkillProgress(a: SkillProgress, b: SkillProgress): boolean {
  return a.level === b.level && a.percentToNext === b.percentToNext && a.loyaltyLevel === b.loyaltyLevel;
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
    && a.ammo.arrow === b.ammo.arrow
    && a.ammo.bolt === b.ammo.bolt
    && a.fightMode === b.fightMode
    && staminaMinute(a.staminaMs) === staminaMinute(b.staminaMs)
    && a.speed === b.speed
    && sameSkills(a.skills, b.skills)
    && sameSkillProgress(a.magicLevel, b.magicLevel)
    && a.loyaltyBonusPercent === b.loyaltyBonusPercent
    && a.soul === b.soul
    && a.soulMax === b.soulMax;
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
  /** A seção PARTY do analisador entregue por último (ADR 0035 d.11). `undefined` em solo. */
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
 * A seção PARTY do analisador (§32, ADR 0035 d.11), do `partySummary` do `sim` (DT-03: getter
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

/**
 * A soma dos abates de boss do Bosstiary (#629): o gatilho da mensagem `bosstiary` ao vivo. Um
 * número só, pela razão de `bestiaryTotal`: abate nunca desce, então a soma muda se, e só se,
 * algum contador mudou (e os pontos só mudam com um abate).
 */
function bosstiaryTotal(kills: Readonly<Record<string, number>>): number {
  let total = 0;
  for (const count of Object.values(kills)) total += count;
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

/**
 * Uma condição ativa como o host a guarda entre ciclos: o fim (instante LÓGICO) e, na luz
 * (#623), o que o cliente precisa para desenhá-la. Comparada campo a campo — só o instante de fim
 * não basta, uma luz nova de mesmo fim e outro raio precisa ser reenviada.
 */
interface ActiveConditionEntry {
  readonly expiresAtMs: number;
  readonly light?: { readonly level: number; readonly color: number; readonly durationMs: number };
}

type ConditionsSnapshot = ReadonlyMap<ActiveConditionKind, ActiveConditionEntry>;

const ACTIVE_CONDITION_KIND_SET: ReadonlySet<string> = new Set(ACTIVE_CONDITION_KINDS);

/**
 * Só as condições que o contrato conhece (`ACTIVE_CONDITION_KINDS`): desde o CMB-07 a chave da
 * condição é livre no `sim` (DOT de ability, campo), e o que não tem badge no cliente fica de
 * fora aqui — o `z.enum` do protocolo recusaria o frame inteiro, e a barra sumiria com ele.
 */
function conditionsSnapshotOf(character: CharacterRuntime): ConditionsSnapshot {
  const snapshot = new Map<ActiveConditionKind, ActiveConditionEntry>();
  for (const condition of character.conditions.getState()) {
    if (!ACTIVE_CONDITION_KIND_SET.has(condition.key)) continue;
    // A luz sem os dados que o cliente desenha (um snapshot que não os carrega) não vira badge.
    if (condition.key === 'light' && condition.light === undefined) continue;
    snapshot.set(condition.key as ActiveConditionKind, {
      expiresAtMs: condition.expiresAtMs,
      ...(condition.light === undefined ? {} : { light: condition.light }),
    });
  }
  return snapshot;
}

function sameConditions(a: ConditionsSnapshot, b: ConditionsSnapshot): boolean {
  if (a.size !== b.size) return false;
  for (const [key, entry] of a) {
    const other = b.get(key);
    if (other === undefined || other.expiresAtMs !== entry.expiresAtMs) return false;
    if (entry.light?.level !== other.light?.level || entry.light?.color !== other.light?.color
      || entry.light?.durationMs !== other.light?.durationMs) return false;
  }
  return true;
}

function activeConditionsOf(snapshot: ConditionsSnapshot, nowMs: number): S2CProps<'active-conditions'> {
  const conditions: {
    kind: ActiveConditionKind; remainingMs: number;
    light?: { level: number; color: number; durationMs: number };
  }[] = [];
  for (const [kind, entry] of snapshot) {
    conditions.push({
      kind,
      remainingMs: Math.max(0, Math.round(entry.expiresAtMs - nowMs)),
      ...(entry.light === undefined ? {} : { light: { ...entry.light } }),
    });
  }
  conditions.sort((a, b) => a.kind.localeCompare(b.kind));
  return { conditions };
}

/**
 * A assinatura de uma saída pendente (#802) — o gatilho de envio do `exit-pending`. Leva o
 * `untilMs` (instante lógico), e NÃO o `remainingMs`: este encolhe a cada ciclo, e compará-lo
 * mandaria a banda inteira a 10 Hz para dizer que o tempo passou.
 */
function exitSignature(status: ExitStatus): string {
  return `${status.reason}|${status.phase}|${String(status.untilMs)}`;
}

/** O `exit-pending` no fio; `null` é o fim da espera (`active: false`, sem os outros campos). */
function exitPendingMessage(status: ExitStatus | null, nowMs: number): S2CMessage {
  if (status === null) return { type: 'exit-pending', active: false };
  return {
    type: 'exit-pending',
    active: true,
    reason: status.reason,
    phase: status.phase,
    remainingMs: Math.max(0, Math.round(status.untilMs - nowMs)),
  };
}

/** Ver `createBotConfigValidator` em `sessions.ts`. */
export type BotConfigDecision =
  | { readonly ok: true; readonly config: BotConfigV2 }
  | { readonly ok: false; readonly reason: string };

/** Ver `createBotConfigLoader` em `sessions.ts` — a CARGA de uma config já persistida (ADR 0014). */
export type BotConfigLoadResult =
  | { readonly ok: true; readonly config: BotConfigV2; readonly removed: readonly RemovedBotSlot[] }
  | { readonly ok: false; readonly reason: string };

interface HostedSession {
  readonly session: Session;
  /**
   * Os visualizadores, com o índice por personagem (OW-22): `viewers.of(id)` e `viewers.countOf(id)`
   * no lugar de varrer a sessão inteira filtrando por `characterId`.
   */
  readonly viewers: ViewerSet;
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
   * Extratos de SAÍDA em voo, por personagem — o `receiptSaves` de quem sai por personagem
   * (`leavesOnExit`), que não cabe na vaga única dele: o mesmo personagem sai da mesma sessão
   * mais de uma vez, e cada saída tem o extrato (e o `seq`) próprio. Quem acha o personagem já
   * fora (`leave` devolve `null`) espera estes antes de soltar o que é dele (`#awaitExitSaves`).
   */
  readonly exitSaves: Map<string, Set<Promise<void>>>;
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
   * O último alvo ENTREGUE a quem olha cada personagem (#470), por `characterId`, como id
   * numérico de criatura ou `null`. É o gatilho do `target-changed` no ciclo: comparar um
   * número por personagem custa nada, e mandar o alvo a 10 Hz custaria a banda que o
   * `player-stats` deixou de gastar. Entrada AUSENTE é "ninguém recebeu ainda" — o
   * `session-attach` e o primeiro ciclo com visualizador escrevem.
   */
  readonly sentTarget: Map<string, number | null>;
  /**
   * O último `seq` de `select-target` processado, por `characterId` (#470). Um `seq` anterior
   * é mensagem atrasada e é ignorado em silêncio, como o `walk` fora do ritmo: processar
   * fora de ordem faria o alvo oscilar entre duas seleções do mesmo cliente.
   */
  readonly lastTargetSeq: Map<string, number>;
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
  /**
   * A soma dos abates do Bosstiary ENTREGUE a quem olha cada personagem (#629), por `characterId`
   * — o mesmo mecanismo de `sentBestiary`, para outra grandeza que só sobe.
   */
  readonly sentBosstiary: Map<string, number>;
  /**
   * O último BITMASK de bênçãos ENTREGUE a quem olha cada personagem (#570, ADR 0052), por
   * `characterId` — o mesmo mecanismo de `sentBestiary`: compra (sobe) e morte (zera) são as
   * únicas mudanças, e as duas precisam chegar a quem está olhando.
   */
  readonly sentBlessings: Map<string, number>;
  /**
   * A assinatura do último `training-state` ENTREGUE a quem olha cada personagem (#631), por
   * `characterId` — o mesmo mecanismo de `sentExit`. O banco só muda no fim da sessão, mas as
   * cargas da exercise weapon mudam a cada golpe do Treino, e compará-las é o que evita mandar de
   * novo o que já foi. Entrada ausente é "ninguém recebeu ainda".
   */
  readonly sentTraining: Map<string, string>;
  /**
   * A última REVISÃO do registro de Hazard ENTREGUE a quem olha cada personagem (#632), por
   * `characterId` — `HazardProgress.revision`, um inteiro, para o ciclo não serializar o registro.
   * A escolha (Cidade) já manda a mensagem na hora; isto cobre a SUBIDA de nível que a sessão da
   * hunt faz sozinha quando o chefe da zona morre.
   */
  readonly sentHazard: Map<string, number>;
  /**
   * O último ESTADO de cada interativo ENTREGUE aos viewers da sessão (#734, ADR 0050 d.6 T3),
   * por `interactableId`. Cenário é COMPARTILHADO (DT-01 do #729) — uma entrada por sessão, não
   * por personagem, como `sentParty`. É o gatilho de `#presentTileOverrides`: fecha a lacuna que
   * `useOnMap` sozinho não cobria — o walker abrindo porta/capim sozinho (#728), a placa de
   * pressão reagindo a pisar (#734) e o `TILE_REVERT` (capim, stone pile, teleporte gated por
   * alavanca) nunca tinham `tile-update` nenhum além do clique explícito. Entrada AUSENTE é
   * "nunca entregue" — o `session-attach` já leva o overlay inteiro em `session-state.world.
   * tileUpdates` (`#sessionState`), e é isso que evita mandar de novo o que já foi.
   */
  readonly sentTileOverrides: Map<string, string>;
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
   * A assinatura da saída pendente ENTREGUE a quem olha cada personagem (#802). Entrada ausente
   * é "nada pendente entregue" — o caso de quase toda hunt, que assim não paga nada por ciclo
   * além de uma consulta ao ruleset.
   */
  readonly sentExit: Map<string, string>;
  /**
   * A assinatura `(state, reason)` dos slots ENTREGUE a quem olha cada personagem (AB-09),
   * por `characterId`. É o gatilho do `slot-state`: o `remainingMs` decresce sempre, e compará-lo
   * mandaria a banda inteira a 10 Hz. Entrada ausente é "ninguém recebeu ainda".
   */
  readonly sentSlotState: Map<string, string>;
  /**
   * O instante do último cálculo de `slotStates` desta sessão (AB-09). O gatilho por assinatura
   * já evita o envio, mas o CÁLCULO — 24 slots e uma varredura de alvos por slot de dano — roda
   * a cada ciclo; sem esta marca, uma party de dois faria 200 varreduras/s para descartar tudo.
   */
  slotStateAtMs: number;
  /**
   * `characterId` (UUID) → id numérico de criatura na instância.
   *
   * O protocolo numera criatura com `number` porque isso vai no caminho quente: um id de 4
   * bytes por `creature-move`, dezenas de vezes por segundo, contra 36 de um UUID. A tradução
   * é do servidor — o `sim` não conhece protocolo, e o cliente não pode inventar número.
   */
  readonly creatureIds: Map<string, number>;
  /**
   * A raça (#620) de cada MONSTRO que não é `blood`, pela mesma chave de `creatureIds` (o
   * `subject`). Só a apresentação lê — a cor e o efeito do golpe físico que o atinge. Guardada
   * aqui, e não consultada no ruleset na hora do golpe, porque o abate REMOVE o monstro do
   * ruleset antes de o golpe que o matou ser apresentado, e é justamente o golpe mais comum de
   * uma hunt. Só entra quem difere do default: o monstro comum e o jogador não pagam entrada, e
   * a ausência é `blood`. Sai junto de `creatureIds`, no `creature-disappear`.
   */
  readonly raceBySubject: Map<string, MonsterRace>;
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
 * Cada quanto o estado dos slots é recalculado no ciclo (AB-09, #420).
 *
 * A assinatura já evita o ENVIO quando nada muda, mas o cálculo de 24 `SlotState` — com uma
 * varredura de alvos por slot de dano — rodava a 10 Hz por personagem observado. A 2 Hz o
 * cliente continua animando o prazo localmente e a transição de cooldown chega em até 500 ms,
 * que é o mesmo atraso que ele já tolera entre a entrega e o vencimento.
 */
const SLOT_STATE_INTERVAL_MS = 500;

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
  /** O cache de codificação do flush (OW-22): um por nó, esvaziado a cada sessão. */
  readonly #encodeCache = new EncodeCache();
  /** O controle (`encodeOnce: false`): codifica por visualizador, mas conta como o cache. */
  readonly #encodeEach = new EncodeCache({ memoize: false });
  readonly #sessionIdByCharacter = new Map<string, string>();
  readonly #accountIdByCharacter = new Map<string, string>();
  /** Nome de exibição, do ticket. Só o chat lê; o `sim` não conhece nome (FUN-58). */
  readonly #nameByCharacter = new Map<string, string>();
  /**
   * O Premium do ticket (ADR 0035 D3), para os slots de Charm (2 Free/6 Premium, ADR 0053 d.4)
   * — a hunt já tem o dela (`premiumByCharacter` do ruleset), mas a Cidade não tinha NENHUM
   * lugar para isso, e Charms se gerem de qualquer sessão (ADR 0052 d.4). Vive como nome/cores:
   * entra quando a sessão é preparada, vive até `release`; ausente é Free, o lado seguro.
   */
  readonly #premiumByCharacter = new Map<string, boolean>();
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
  readonly #botByCharacter = new Map<string, BotConfigV2>();
  readonly #preparations = new Map<string, Promise<void>>();
  /** Transições em voo, por personagem. Ver `transition`. */
  readonly #transitions = new Map<string, Promise<void>>();
  /**
   * Personagens cuja sucessão — extrato e Cidade, `#settleOne` — está EM VOO (#802). É o que o
   * `leave-hunt` consulta quando a sessão já acabou: em voo, o segundo clique não tem o que fazer
   * (e seguir a transição o poria em corrida com a sucessão que já corre); parada, é porque
   * FALHOU — e o segundo clique é o retry manual que sempre existiu. Só o processo dono da
   * sessão escreve aqui, e o marcador sai no `finally`, com sucesso ou falha.
   */
  readonly #settling = new Set<string>();
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

  /**
   * O que o flush já codificou e reaproveitou, desde que o nó subiu (OW-22): contadores que só
   * sobem. Existe para MEDIR — o `bench:city` lê antes e depois da janela e subtrai —, e é o que
   * separa "bytes entregues" de "bytes serializados" na conta do leque de saída.
   */
  get encodeStats(): EncodeStats {
    const once = this.#encodeCache.stats;
    const each = this.#encodeEach.stats;
    return {
      encoded: once.encoded + each.encoded,
      reused: once.reused + each.reused,
      encodedBytes: once.encodedBytes + each.encodedBytes,
    };
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
      for (const characterId of hosted.viewers.characterIds()) characters.add(characterId);
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
      // O ticket é de PARTY e pede uma sessão diferente da que o personagem já ocupa aqui
      // (#527, invariante 8): o líder clica "Iniciar com o time" DA Cidade, e o socket antigo
      // pode nem ter fechado ainda quando o novo ticket chega. Sem isto, `#prepare` reanexava
      // à Cidade e o ticket da party era descartado em silêncio — a hunt nunca nascia, e quem
      // mandasse `session-attach` continuava recebendo `sessionType: "city"` para sempre.
      if (party !== undefined && existing.id !== party.sessionId) {
        // O tipo do destino é o da sessão já hospedada (#402, quem chega depois do primeiro
        // ticket) quando ela existe; senão é o que `createSession` vai produzir para um
        // `PartyTicket` — sempre `'hunt'` (`sessions.ts`, `partyHuntFor`), nunca outra coisa.
        const targetType = this.#sessions.get(party.sessionId)?.session.ruleset.type ?? 'hunt';
        await this.#leaveForParty(characterId, existing, {
          sessionId: party.sessionId, nodeId: this.#options.nodeId, type: targetType,
        });
      } else {
        await this.#register(characterId, existing, accountId);
        return { created: false };
      }
    }

    // Ticket de ENTRADA (#402): o personagem NÃO tem sessão local e a party já está em curso —
    // ou acabou de sair da Cidade pelo ramo acima. A sessão é achada pelo id dela neste nó;
    // sessão ausente é recusa tipada, não sessão nova.
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
   * Tira o personagem da sessão que ele ocupa NESTE nó antes de a party assumir (#527,
   * invariante 8: nunca duas sessões ao mesmo tempo) — E move o registro do diretório pela
   * MESMA operação que a transição hunt↔Cidade da morte usa (`directory.succeed`, FUN-38, o
   * `#replace` abaixo), nunca por `#register`/`#takeOver`: `#takeOver` existe para RETOMAR
   * depois de nó morto — `TAKE_OVER_SESSION` recusa quando o batimento do nó ainda existe
   * (`directory.ts`) — e o nó aqui está bem vivo, é ele mesmo quem está pedindo a troca. Sem
   * isto, o `#register` que `#createAndRegister` chama logo depois via o `sessionKey` ainda
   * apontando para a Cidade, caía no `#takeOver`, e ele recusava SEMPRE — "active reservation
   * expired before session registration" em todo handshake, porque o nó nunca estava morto.
   *
   * Espelha o ramo de `release` para a sessão que SAI POR PERSONAGEM (`leavesOnExit`) — a Cidade
   * não credita e não encerra por personagem (ADR 0023), mas guarda o que mudou
   * (`#saveDurableReceipt`, #154); o mundo credita por extrato de delta (`#departFromSharedSession`).
   *
   * A sessão de origem só deveria ser um shard: a API só emite ticket de party para quem o
   * diretório via na Cidade (ou em repouso) no instante da emissão — `/start` e o `/join` em
   * curso conferem isso antes de reservar qualquer coisa. O ramo `else` é rede de segurança
   * para essa suposição falhar — credita como uma saída normal em vez de arriscar apagar
   * progresso em silêncio.
   */
  async #leaveForParty(characterId: string, existing: Session, target: SessionLocation): Promise<void> {
    const hosted = this.#sessions.get(existing.id);
    if (hosted === undefined) {
      this.#sessionIdByCharacter.delete(characterId);
    } else {
      this.#dropViewers(hosted, characterId);
      if (leavesOnExit(existing.ruleset)) {
        await this.#departFromSharedSession(characterId, hosted, 'manual-exit');
        this.#announceDeparture(hosted, characterId);
      } else {
        let receipt: Receipt | null;
        if (hosted.session.ended === null && hosted.session.participants.length > 1) {
          const departure = hosted.session.leave(characterId, 'manual-exit');
          receipt = departure?.receipt ?? null;
        } else {
          if (hosted.session.ended === null) hosted.session.end('manual-exit');
          receipt = receiptOf(hosted, characterId);
        }
        if (receipt !== null) await this.#saveReceipt(characterId, hosted, receipt);
      }
      const remaining = this.#charactersOf(existing.id).filter((id) => id !== characterId);
      if (remaining.length === 0) this.#sessions.delete(existing.id);
      this.#sessionIdByCharacter.delete(characterId);
      this.#restingSince.delete(characterId);
    }

    // O registro do diretório troca AQUI, não em `#register` — ver o comentário acima. A
    // conta é a que a Cidade já registrou (`#createLocal` a gravou quando o personagem
    // entrou lá); sem diretório (host de teste sem essa dependência), não há o que mover.
    const directory = this.#options.directory;
    const accountId = this.#accountIdByCharacter.get(characterId);
    if (directory === undefined || accountId === undefined) return;
    const moved = await directory.succeed(
      characterId, accountId,
      { sessionId: existing.id, nodeId: this.#options.nodeId, type: existing.ruleset.type satisfies SessionType },
      target,
    );
    if (!moved) {
      // Outro nó assumiu o registro, ou o lease/reserva expirou, entre a leitura da sessão
      // atual e agora — a mesma corrida rara que `#replace` cobre soltando o personagem. Aqui
      // não há `hosted` para soltar (o estado local já saiu acima); falhar alto é o que faz o
      // handshake responder 503 em vez de hospedar uma sessão sem registro válido nenhum
      // (invariante 9).
      throw new Error(
        `directory entry for ${characterId} changed hands while leaving a session for a party ticket`,
      );
    }
  }

  /**
   * Um personagem NOVO numa hunt que JÁ existe neste nó (#402, ADR 0035 D7, PRD §22).
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
    this.#premiumByCharacter.set(characterId, member?.initialCharacter.premium ?? false);
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
      this.#logger.error({ err: error, characterId }, 'Failed to log the character out');
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
    const leaves = leavesOnExit(hosted.session.ruleset);

    this.#dropViewers(hosted, characterId, closeCode, closeReason);

    if (leaves) {
      // Num shard, sair é SAIR — não encerrar (FUN-71, ADR 0023). O jogador que fecha o jogo
      // na praça não pode levar a praça junto, e nada há a creditar: a Cidade não gera
      // progresso (§37). O que ela gera é ESTADO (#154) — e ele sai antes de o participante
      // sair, porque `leave` o tira da lista. O mundo, que credita, sai por extrato de delta.
      await this.#departFromSharedSession(characterId, hosted, 'manual-exit');
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
    this.#premiumByCharacter.delete(characterId);
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
      this.#logger.error({ err: error, characterId }, 'Failed to release session from the directory');
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
        // INTENÇÃO, nunca resultado (invariante 4): o cliente diz qual hunt, e quem decide se
        // cabe, cria a instância e credita é o servidor. `difficulty` é aceito e IGNORADO
        // desde o #584 (ADR 0039) — mantido no protocolo só por compatibilidade (ADR 0014).
        void this.#requestTransition(viewer, {
          to: 'hunt', huntId: message.huntId,
          ...(message.difficulty === undefined ? {} : { difficulty: message.difficulty }),
          // A hunt nasce compilada com a configuração que o servidor aceitou — do ticket ou
          // da última `bot-config` desta conexão.
          ...(this.#botByCharacter.has(viewer.characterId)
            ? { botConfig: this.#botByCharacter.get(viewer.characterId) as BotConfigV2 }
            : {}),
        });
        return;
      case 'leave-hunt':
        // INTENÇÃO (invariante 4): o jogador PEDE a saída, e quem decide quando ela conclui é o
        // ruleset (#802) — depois do `exitDelayMs` e fora da janela de combate. Sair é voltar
        // para a cidade, não ficar sem sessão: todo personagem está em exatamente uma
        // (invariante 8), e é a sucessão de sempre que o leva para lá quando a hora chega.
        this.#requestLeaveHunt(viewer);
        return;
      case 'cancel-exit':
        // INTENÇÃO (invariante 4): desistir do pedido acima. Só a saída MANUAL se desfaz, e quem
        // sabe se há o que desfazer é o ruleset.
        this.#requestCancelExit(viewer);
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
      case 'choose-vocation':
        // INTENÇÃO (invariante 4): o cliente diz QUAL vocação; level, arma e slot são daqui.
        this.#requestVocation(viewer, message.vocationId);
        return;
      case 'select-ammo':
        // INTENÇÃO (invariante 4): o cliente diz QUAL munição; o level e o catálogo são daqui.
        this.#requestSelectAmmo(viewer, message.ammoId);
        return;
      case 'set-fight-mode':
        // INTENÇÃO (invariante 4): o cliente diz QUAL postura; os fatores de ataque, defesa e
        // mitigação que ela liga são do `sim`, na sessão dona (invariante 9) — Cidade e hunt, como
        // `select-ammo` (#550, M30-03).
        this.#requestSetFightMode(viewer, message.mode);
        return;
      case 'set-hazard-level':
        // INTENÇÃO (invariante 4): o cliente diz QUAL zona e QUAL nível; a faixa e o teto
        // desbloqueado são daqui — serviço de Cidade, dentro da sessão dona (#632, ADR 0052 d.5).
        this.#requestSetHazardLevel(viewer, message.zoneId, message.level);
        return;
      case 'buy-blessing':
        // INTENÇÃO (invariante 4): o cliente diz QUAL bênção; preço por level, saldo e "já tem
        // esta bênção" são daqui — serviço de Cidade, dentro da sessão dona (#570, ADR 0052).
        this.#requestBuyBlessing(viewer, message.blessingId);
        return;
      case 'move-item':
        // INTENÇÃO (invariante 4): dois lugares; empilhar, vestir e recusar são do servidor.
        this.#requestMove(viewer, message.from, message.to);
        return;
      case 'use-slot':
        // INTENÇÃO (invariante 4): o cliente diz QUAL slot e QUEM/ONDE mirou; elegibilidade,
        // estoque, mana, alcance e cooldown são do servidor (AB-09, ADR 0032 d.3; ADR 0049 d.2).
        this.#requestUseSlot(viewer, message.set, message.slot, message.target);
        return;
      case 'select-target':
        // INTENÇÃO (invariante 4): o cliente diz QUAL criatura (ou `0`, cancelar); quem valida
        // o alvo e confirma/recusa é o servidor (#470).
        this.#requestSelectTarget(viewer, message.creatureId, message.seq);
        return;
      case 'use-item':
        // INTENÇÃO (invariante 4): o cliente diz QUAL item/suprimento e QUEM/ONDE mirou (mesma
        // mira do `use-slot`); catálogo, exaustão, estoque e efeito são do servidor (#726, ADR
        // 0049 decisão 3).
        this.#requestUseItem(viewer, message.ref, message.seq, message.target, false);
        return;
      case 'use-item-on':
        this.#requestUseItem(viewer, message.ref, message.seq, message.target, true);
        return;
      case 'use-on-map':
        // INTENÇÃO (invariante 4): o cliente diz QUAL posição; alcance, estado, requisito e
        // ferramenta são do servidor (#729, ADR 0050 d.7).
        this.#requestUseOnMap(viewer, message.position);
        return;
      case 'look':
        // INTENÇÃO (invariante 4): o cliente diz QUAL posição; o texto vem do conteúdo, nunca
        // do cliente (#729, ADR 0050 d.7).
        this.#requestLook(viewer, message.position);
        return;
      case 'buy-item':
        // INTENÇÃO (invariante 4): o cliente diz QUAL item; `purchasable`, preço, saldo e capacidade
        // são do servidor — serviço de Cidade, dentro da sessão dona (#631, ADR 0059 d.2).
        this.#requestBuyItem(viewer, message.itemId);
        return;
      case 'set-offline-training-skill':
        // INTENÇÃO (invariante 4): o cliente diz QUAL skill do livro (ou `null`); quais existem é do
        // conteúdo, e o gasto do banco é da `api` na próxima emissão de ticket (#631, ADR 0059 d.3).
        this.#requestSetOfflineSkill(viewer, message.skillId);
        return;
      case 'enter-training':
        // INTENÇÃO (invariante 4): o cliente diz QUAL instância da mochila; que ela é uma exercise
        // weapon com cargas e que o personagem está na Cidade é do servidor (#631, ADR 0059 d.1).
        this.#requestEnterTraining(viewer, message.itemInstanceId);
        return;
      case 'promote-vocation':
        // INTENÇÃO (invariante 4): sem payload. Vocação, level, gold e "já promovido" são do
        // servidor. Só na Cidade (#566, ADR 0042 decisão 1 — serviço de Cidade).
        this.#requestPromoteVocation(viewer);
        return;
      case 'learn-spell':
        // INTENÇÃO (invariante 4): o cliente diz QUAL magia; vocação, level, "já aprendida",
        // preço e saldo são do servidor. Aceita na Cidade E na hunt, sem rolagem (ADR 0058 d.2,
        // ADR 0052 d.4) — como `charm-unlock`, processada na chegada, sem passar pelo ruleset.
        this.#requestLearnSpell(viewer, message.spellId);
        return;
      case 'charm-unlock':
        // INTENÇÃO (invariante 4): o cliente diz QUAL charm; o custo (derivado do Bestiário) e
        // o tier são do servidor. Aceita na Cidade E na hunt, sem rolagem (ADR 0052 d.2/d.4) —
        // como `equip`/`select-ammo`, processada na chegada, sem passar pelo ruleset.
        this.#requestCharmUnlock(viewer, message.charmId);
        return;
      case 'charm-assign':
        // INTENÇÃO (invariante 4): o cliente diz QUAL charm e QUAL monstro do bestiário; slot,
        // categoria e a ficha completa do alvo (major) são do servidor (ADR 0053 d.4).
        this.#requestCharmAssign(viewer, message.charmId, message.monsterId);
        return;
      case 'charm-remove':
        // INTENÇÃO (invariante 4): o cliente diz QUAL charm; o custo em gold (`level × 100`)
        // é calculado e debitado pelo servidor, pelo ledger (invariante 10).
        this.#requestCharmRemove(viewer, message.charmId);
        return;
      case 'unequip':
        this.#requestUnequip(viewer, message.slot);
        return;
      case 'sell-items':
        // INTENÇÃO (invariante 4): o cliente diz QUAIS instâncias; existir, estar carregada e
        // ter `value` do catálogo maior que zero é conferido pelo servidor (#724, ADR 0048 d.8).
        this.#requestSellItems(viewer, message.instanceIds);
        return;
      case 'discard-item':
        // INTENÇÃO (invariante 4): o cliente diz QUAL instância; a confirmação já foi dada por
        // ele mesmo antes de mandar (#724, ADR 0048 d.8).
        this.#requestDiscardItem(viewer, message.instanceId);
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
      case 'open-corpse':
        // INTENÇÃO (invariante 4): o cliente diz QUAL item do chão; dono, elegibilidade e
        // distância são conferidos no `sim` (#722, ADR 0048 d.4).
        this.#requestOpenCorpse(viewer, message.groundItemId);
        return;
      case 'take-loot':
        // INTENÇÃO (invariante 4): `instanceId: null` é o clique (filtro do personagem); um id
        // é arrastar ESTE item, ignorando o filtro. Dono, distância e capacidade são do `sim`.
        this.#requestTakeLoot(viewer, message.groundItemId, message.instanceId);
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
   * Vende N itens da mochila/bolsa ao `value` do catálogo (#724, ADR 0048 d.8 — a
   * generalização do "Despachar loot" do ADR 0032 d.12). Processado NA CHEGADA, como equipar.
   *
   * O gold entra do MESMO jeito que o loot credita (`hunt.ts`): `character.goldDelta` E o
   * agregado da sessão, quando ela credita por agregado (`creditsAggregates` — a hunt, e o
   * mundo) — o extrato já soma `aggregatesOf`. Numa Cidade (shard que não credita), o agregado
   * da sessão é CUMULATIVO entre vários extratos de estado (#154) e nunca é zerado por flush;
   * somar ali faria o segundo logout re-creditar a venda do primeiro. Lá o gold vai só por
   * `goldDelta`, que `#saveDurableReceipt` drena e liquida a cada extrato — a mesma disciplina
   * de `settleGoldDelta`. A escolha é de `#mirrorGold`, o canal único (ADR 0060 d.10c).
   */
  #requestSellItems(viewer: Viewer, instanceIds: readonly string[]): void {
    const character = this.#ownerOf(viewer.characterId);
    const hosted = this.#hostedSession(viewer.characterId);
    if (character === undefined || hosted === undefined) return;
    const result = character.inventory.sellItems(instanceIds, this.#options.itemCatalog ?? EMPTY_ITEMS);
    if (result.ok) {
      character.goldDelta += result.gold;
      this.#mirrorGold(hosted, viewer.characterId, result.gold);
      character.removedInstances.push(...result.removed.map((item) => item.instanceId));
      this.#markDirty(viewer.characterId);
    }
    this.#answerInventory(viewer, result);
  }

  /**
   * Descarta um item da mochila/bolsa: destrói, sem gold (#724, ADR 0048 d.8). A confirmação
   * ("tem certeza?") já foi dada pelo cliente antes de mandar a intenção.
   */
  #requestDiscardItem(viewer: Viewer, instanceId: string): void {
    const character = this.#ownerOf(viewer.characterId);
    if (character === undefined) return;
    const result = character.inventory.discardItem(instanceId);
    if (result.ok) {
      character.removedInstances.push(result.removed.instanceId);
      this.#markDirty(viewer.characterId);
    }
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

  /**
   * O disparo manual de um slot (AB-09, ADR 0032 d.3). Processado NA CHEGADA, como equipar.
   *
   * Fora de hunt é RECUSA com motivo, nunca silêncio: a barra é montada na Cidade e a tecla
   * existe lá — "não estou numa caçada" é a resposta, não esconder o botão (ADR 0032 d.3).
   *
   * `target` é a mira (ADR 0049 decisão 2), ainda no vocabulário do FIO (`creatureId` numérico
   * ou `position`); `#resolveUseSlotTarget` a traduz para o domínio que o `sim` entende ANTES de
   * chamar `useSlot` — o `sim` nunca vê o id numérico (invariante 1: ele não conhece o
   * hospedeiro que atribui esses ids).
   */
  #requestUseSlot(
    viewer: Viewer, set: number, slot: number,
    target?: Extract<C2SMessage, { type: 'use-slot' }>['target'],
  ): void {
    const hosted = this.#hostedSession(viewer.characterId);
    const ruleset = hosted?.session.ruleset as Partial<HuntRuleset> | undefined;
    const resolvedTarget = hosted === undefined || target === undefined
      ? undefined
      : this.#resolveUseSlotTarget(hosted, target);
    const outcome = hosted === undefined || ruleset?.useSlot === undefined
      ? undefined
      : ruleset.useSlot(hosted.session, viewer.characterId, set, slot, resolvedTarget);
    if (outcome === undefined) {
      viewer.send({ type: 'slot-result', set, slot, ok: false, reason: 'Você não está numa caçada.' });
      return;
    }
    viewer.send({
      type: 'slot-result', set, slot, ok: outcome.ok,
      ...(outcome.ok ? {} : { reason: SLOT_REFUSAL[outcome.reason] }),
    });
    if (!outcome.ok || hosted === undefined) return;
    // Conjurar na Cidade muda estado durável (#792, ADR 0044 d.2) — estoque, mana e gold —, e
    // o shard só grava no logout quem está em `dirty` (#154, a mesma marca de `equip`/
    // `choose-vocation`). Sem isto, a carga conjurada na praça sumia ao sair.
    if (hosted.session.ruleset.type === 'city') hosted.dirty.add(viewer.characterId);
    // A ação do jogador muda o estado do slot na hora: destrava o throttle para o próximo ciclo
    // entregar o cooldown novo, sem esperar a janela de `SLOT_STATE_INTERVAL_MS`.
    hosted.slotStateAtMs = 0;
    // Supply e magia não tocam o inventário (o modelo abstrato debita gold no uso): o que muda
    // é mana, vida e gold, e isso sai no `player-stats` abaixo. Mudança de corpo tem o
    // `equipment-changed` como caminho próprio.
    const character = this.#participantOf(hosted, viewer.characterId);
    const stats = this.#statsOf(character);
    hosted.sentStats.set(viewer.characterId, stats);
    this.#sendToViewersOf(hosted, viewer.characterId, { type: 'player-stats', ...stats });
  }

  /**
   * `use-item`/`use-item-on` (#726, ADR 0049 decisão 3). Processado NA CHEGADA, como
   * `use-slot`, e pela MESMA razão fora de hunt: "não estou numa caçada" é a resposta, nunca
   * silêncio — o menu de contexto da mochila existe na Cidade também.
   *
   * `target` é a mesma mira do `use-slot`, ainda no vocabulário do FIO — `#resolveUseSlotTarget`
   * a traduz ANTES de chamar `useItem`/`useItemOn`. `mandatory` distingue as duas mensagens:
   * `use-item-on` sempre manda `target`; `use-item` só quando o clique carregava um.
   */
  #requestUseItem(
    viewer: Viewer, ref: Extract<C2SMessage, { type: 'use-item' }>['ref'], seq: number,
    target: Extract<C2SMessage, { type: 'use-slot' }>['target'] | undefined, mandatory: boolean,
  ): void {
    const hosted = this.#hostedSession(viewer.characterId);
    const ruleset = hosted?.session.ruleset as Partial<HuntRuleset> | undefined;
    const resolvedTarget = hosted === undefined || target === undefined
      ? undefined
      : this.#resolveUseSlotTarget(hosted, target);
    const outcome = hosted === undefined
      ? undefined
      : mandatory
        ? (resolvedTarget === undefined
          ? undefined
          : ruleset?.useItemOn?.(hosted.session, viewer.characterId, ref, seq, resolvedTarget))
        : ruleset?.useItem?.(hosted.session, viewer.characterId, ref, seq, resolvedTarget);
    if (outcome === undefined) {
      viewer.send({ type: 'use-result', seq, ok: false, reason: 'Você não está numa caçada.' });
      return;
    }
    viewer.send({
      type: 'use-result', seq, ok: outcome.ok,
      ...(outcome.ok ? {} : { reason: USE_ITEM_REFUSAL[outcome.reason] }),
    });
    // Sucesso não vira mensagem própria (decisão 7): supply muda mana/vida/gold — o
    // `player-stats` abaixo —, e comida/bênção mudam o `inventory` pelo `equipment-changed`
    // que o `sim` já emite (drenado no próximo ciclo de `#presentMoves`, como sempre).
    if (!outcome.ok || hosted === undefined) return;
    const character = this.#participantOf(hosted, viewer.characterId);
    const stats = this.#statsOf(character);
    hosted.sentStats.set(viewer.characterId, stats);
    this.#sendToViewersOf(hosted, viewer.characterId, { type: 'player-stats', ...stats });
  }

  /**
   * O jogador escolheu (ou cancelou) um alvo clicando (#470, AB-09, ADR 0032 d.5).
   *
   * `creatureId: 0` é CANCELAMENTO explícito (RF-01), como o `creatureId == 0` do Canary:
   * limpa o alvo de ataque e confirma com `target-changed { creatureId: null }`. Criatura
   * desconhecida ou morta é RECUSA, com `target-cancel` — nada muda, e o cliente sabe que a
   * tentativa falhou em vez de achar que o alvo sumiu. Criatura válida vira `target-changed`
   * com o id confirmado (RF-04).
   *
   * `seq` é monotônico por cliente e volta no ack. Um `seq` anterior a um já processado é
   * mensagem atrasada e é ignorado em silêncio — processar fora de ordem faria o alvo oscilar
   * entre duas seleções do mesmo cliente (edge case de ack obsoleto).
   */
  #requestSelectTarget(viewer: Viewer, creatureId: number, seq: number | undefined): void {
    const hosted = this.#hostedSession(viewer.characterId);
    if (hosted === undefined) return;
    const ruleset = hosted.session.ruleset as Partial<HuntRuleset>;
    if (ruleset.setAttackTarget === undefined || ruleset.monsterBySubject === undefined) return;
    const character = this.#participantOf(hosted, viewer.characterId);
    if (character === undefined) return;

    if (seq !== undefined) {
      const last = hosted.lastTargetSeq.get(viewer.characterId);
      if (last !== undefined && seq < last) return;
      hosted.lastTargetSeq.set(viewer.characterId, seq);
    }

    if (creatureId === 0) {
      ruleset.setAttackTarget(character, null);
      this.#sendTargetChanged(hosted, viewer.characterId, null, seq);
      return;
    }

    const subject = this.#subjectOfCreature(hosted, creatureId);
    const monster = subject === null ? null : ruleset.monsterBySubject(subject);
    // Monstro invisível não é alvo (#559): o jogador não o enxerga (`Player::canSeeCreature`) e o
    // cliente do Canary nem recebe a criatura para clicar nela. O do Draconya ainda a desenha, então
    // o `sim` recusa em `setAttackTarget` como substituto dessa apresentação — confirmar aqui com
    // `target-changed` mentiria ao cliente.
    if (monster === null || monster.invisible) {
      viewer.send({ type: 'target-cancel', ...(seq === undefined ? {} : { seq }) });
      return;
    }
    ruleset.setAttackTarget(character, monster);
    this.#sendTargetChanged(hosted, viewer.characterId, creatureId, seq);
  }

  /**
   * Abrir a janela do cadáver (#722, ADR 0048 d.4). Processado NA CHEGADA, como equipar: dono,
   * elegibilidade e distância são conferidos no `sim` (`openCorpse`), dentro da sessão dona
   * (invariante 9). Sucesso é `corpse-contents`; recusa é `system-message` (FUN-73).
   */
  #requestOpenCorpse(viewer: Viewer, groundItemId: number): void {
    const hosted = this.#hostedSession(viewer.characterId);
    if (hosted === undefined) return;
    const ruleset = hosted.session.ruleset as Partial<HuntRuleset>;
    if (ruleset.openCorpse === undefined) return;
    const result = ruleset.openCorpse(hosted.session, viewer.characterId, groundItemId);
    if (!result.ok) {
      viewer.send({ type: 'system-message', level: 'warning', text: CORPSE_REFUSAL[result.reason] });
      return;
    }
    viewer.send({
      type: 'corpse-contents', groundItemId,
      gold: result.corpse.gold ?? 0,
      items: (result.corpse.items ?? []).map((item) => ({ ...item })),
    });
  }

  /**
   * Pegar do cadáver o que sobrou do Quick Loot automático do abate (#722, ADR 0048 d.4).
   * `instanceId: null` reaplica o filtro do PRÓPRIO personagem; um id arrasta ESTE item,
   * ignorando o filtro. Sucesso reenvia `corpse-contents` (o que sobrou) e `inventory` (o que
   * entrou); recusa é `system-message`, como o resto do inventário.
   */
  #requestTakeLoot(viewer: Viewer, groundItemId: number, instanceId: string | null): void {
    const hosted = this.#hostedSession(viewer.characterId);
    if (hosted === undefined) return;
    const ruleset = hosted.session.ruleset as Partial<HuntRuleset>;
    if (ruleset.takeLoot === undefined) return;
    const result = ruleset.takeLoot(hosted.session, viewer.characterId, groundItemId, instanceId);
    if (!result.ok) {
      viewer.send({ type: 'system-message', level: 'warning', text: CORPSE_REFUSAL[result.reason] });
      return;
    }
    this.#markDirty(viewer.characterId);
    this.#sendInventory(viewer.characterId);
    // O cadáver pode ter deixado de existir (decaiu no MESMO instante — improvável, mas
    // `#corpseById` já teria recusado `not-found` antes; aqui ele sobrevive à coleta) — a
    // leitura é feita de novo, pelo mesmo `Partial<HuntRuleset>` do início do método.
    const corpse = ruleset.groundItems?.find((item) => item.id === groundItemId);
    if (corpse === undefined) return;
    viewer.send({
      type: 'corpse-contents', groundItemId,
      gold: corpse.gold ?? 0,
      items: (corpse.items ?? []).map((item) => ({ ...item })),
    });
  }

  /**
   * O alvo autoritativo para quem olha o personagem (#470): a confirmação imediata de um
   * `select-target`, ou a troca que o auto-target (#444) fez sozinho. Escreve `sentTarget` —
   * o que acabou de sair É o último entregue.
   */
  #sendTargetChanged(
    hosted: HostedSession, characterId: string, creatureId: number | null, seq: number | undefined,
  ): void {
    hosted.sentTarget.set(characterId, creatureId);
    this.#sendToViewersOf(hosted, characterId, {
      type: 'target-changed', creatureId, ...(seq === undefined ? {} : { seq }),
    });
  }

  /** O subject do `sim` por trás do id numérico que o cliente clicou. `null` é desconhecido. */
  #subjectOfCreature(hosted: HostedSession, creatureId: number): string | null {
    for (const [subject, id] of hosted.creatureIds) {
      if (id === creatureId) return subject;
    }
    return null;
  }

  /**
   * Traduz `use-slot.target` (ADR 0049 decisão 2), ainda no vocabulário NUMÉRICO do fio, para o
   * `UseSlotTarget` de domínio que o `sim` entende. `creatureId` sem dono vira `{ kind:
   * 'invalid' }` — NÃO `undefined` — porque o jogador mirou algo; cair em "sem mira" executaria
   * contra um alvo que ele não escolheu (o default do bot), em vez de recusar `no-target`.
   *
   * O prefixo `m:` é o de `monsterSubject` (`packages/sim/src/monster/monster.ts`): um subject
   * de monstro sempre começa assim, e o de personagem é o próprio `characterId` — nenhum
   * `characterId` deste jogo é escrito nesse formato (UUID), então a distinção nunca colide.
   */
  #resolveUseSlotTarget(
    hosted: HostedSession, target: NonNullable<Extract<C2SMessage, { type: 'use-slot' }>['target']>,
  ): UseSlotTarget {
    if ('position' in target) {
      const { x, y, z } = target.position;
      // `exactOptionalPropertyTypes`: `FloorPoint.z` é opcional SEM `undefined` explícito — só
      // entra a chave quando o cliente de fato mandou o andar.
      return { kind: 'position', position: z === undefined ? { x, y } : { x, y, z } };
    }
    // Um item que o personagem carrega (#621, Chameleon Rune): só a instância — quem confere que
    // ela existe e é dele é o `sim` (`useSupply` recusa `not-illusionable` se não for).
    if ('instanceId' in target) return { kind: 'item', instanceId: target.instanceId };
    const subject = this.#subjectOfCreature(hosted, target.creatureId);
    if (subject === null) return { kind: 'invalid' };
    return subject.startsWith('m:')
      ? { kind: 'monster', subject }
      : { kind: 'character', characterId: subject };
  }

  /**
   * Usar o que está no tile (#729, ADR 0050 d.7): porta, alavanca, capim, stone pile. Sucesso é
   * `tile-update` BROADCAST para todos os viewers da sessão (DT-01: cenário é compartilhado,
   * quem mais está olhando o mesmo tile precisa ver a porta abrir também); recusa é
   * `system-message`, só para quem pediu.
   */
  #requestUseOnMap(viewer: Viewer, position: WorldPoint): void {
    const hosted = this.#hostedSession(viewer.characterId);
    if (hosted === undefined) return;
    const ruleset = hosted.session.ruleset as Partial<HuntRuleset>;
    if (ruleset.useOnMap === undefined) return;
    const result = ruleset.useOnMap(hosted.session, viewer.characterId, position);
    if (!result.ok) {
      viewer.send({ type: 'system-message', level: 'warning', text: USE_ON_MAP_REFUSAL[result.reason] });
      return;
    }
    for (const update of this.#tileUpdatesFor(result.changes)) {
      const message: S2CMessage = { type: 'tile-update', ...update };
      for (const other of hosted.viewers) other.send(message);
    }
  }

  /**
   * Olhar uma posição (#729, ADR 0050 d.7): o texto — placa ou descrição padrão — vem do `sim`,
   * que já o resolveu do conteúdo. Só para quem pediu, nunca broadcast.
   */
  #requestLook(viewer: Viewer, position: WorldPoint): void {
    const hosted = this.#hostedSession(viewer.characterId);
    if (hosted === undefined) return;
    const ruleset = hosted.session.ruleset as Partial<HuntRuleset>;
    if (ruleset.look === undefined) return;
    viewer.send({ type: 'look-result', text: ruleset.look(position).text });
  }

  /**
   * O cenário que mudou de estado PASSIVAMENTE desde a última entrega (#734, ADR 0050 d.6 T3):
   * o walker abrindo porta/capim sozinho no caminho da rota (#728), uma placa de pressão
   * reagindo a step-in/step-out, ou um `TILE_REVERT` (capim, stone pile, teleporte gated por
   * alavanca que fechou sozinho). `#requestUseOnMap` já broadcasta o SEU PRÓPRIO resultado na
   * hora — isto NÃO duplica aquele caminho, porque `sentTileOverrides` já guarda o que foi
   * mandado dali também (o mesmo mapa, escrito nos dois lugares).
   *
   * Compara o `state` de CADA interativo contra o último ENTREGUE (`hosted.sentTileOverrides`,
   * o mesmo mecanismo de `sentBestiary`/`sentStats`) — nunca contra o `initialState` do
   * conteúdo: é o que faz um interativo VOLTAR ao estado inicial (capim que recresceu, placa
   * que soltou) também virar `tile-update`, ao contrário de `tileAppearanceChanges` (que só
   * serve o resync de anexação, e por isso pode ficar cego para "voltou ao normal").
   */
  #presentTileOverrides(hosted: HostedSession): void {
    if (hosted.viewers.size === 0) return;
    const ruleset = hosted.session.ruleset as Partial<HuntRuleset>;
    if (ruleset.tileOverrideAppearances === undefined) return;
    const scenery = this.#options.appearances?.scenery;
    if (scenery === undefined) return;
    for (const entry of ruleset.tileOverrideAppearances) {
      const lastState = hosted.sentTileOverrides.get(entry.interactableId);
      if (lastState === entry.state) continue;
      const table = scenery[entry.appearanceKey];
      const from = lastState === undefined ? undefined : table?.[lastState];
      const to = table?.[entry.state];
      hosted.sentTileOverrides.set(entry.interactableId, entry.state);
      // Sem os dois lados resolvidos — pacote trocado no meio de uma sessão fixada numa versão
      // anterior (invariante 7) —, nunca inventa substituição: registra o novo `state` como
      // ENTREGUE (para não tentar de novo todo ciclo) e segue sem mandar nada.
      if (from === undefined || to === undefined) continue;
      const message: S2CMessage = { type: 'tile-update', position: entry.position, replace: [{ from, to }] };
      for (const viewer of hosted.viewers) viewer.send(message);
    }
  }

  /**
   * Resolve cada mudança de aparência do `sim` (posição + `appearanceKey` + par de estados) em
   * `tile-update` (S2C), pela tabela `appearances.scenery` — a MESMA indireção de
   * `ground-item-appear` resolvendo `corpses` (invariante 6: quem sabe a arte é o hospedeiro,
   * nunca o `content`). Uma mudança cujo `appearanceKey` não está na tabela — pacote de assets
   * trocado no meio de uma sessão fixada numa versão anterior (invariante 7) — não gera
   * mensagem: nunca inventa substituição sem os dois lados (`from`/`to`) resolvidos.
   */
  #tileUpdatesFor(
    changes: readonly TileAppearanceChange[],
  ): Array<{ position: WorldPoint; replace: Array<{ from: number; to: number }> }> {
    const scenery = this.#options.appearances?.scenery;
    if (scenery === undefined) return [];
    const updates: Array<{ position: WorldPoint; replace: Array<{ from: number; to: number }> }> = [];
    for (const change of changes) {
      const table = scenery[change.appearanceKey];
      const from = table?.[change.fromState];
      const to = table?.[change.toState];
      if (from === undefined || to === undefined) continue;
      updates.push({ position: change.position, replace: [{ from, to }] });
    }
    return updates;
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
   * Escolher a vocação (#154, ADR 0026 decisão 1). Processada NA CHEGADA, como equipar. Quem
   * decide é o `sim`; o host resolve vocação, kit e arma no conteúdo fixado na sessão
   * (invariante 7), traduz a recusa, e no sucesso manda vitais e inventário — na Cidade não há
   * ciclo que os compare.
   *
   * O kit completo (#496) é o caminho novo: cada peça de `startingKit` resolvida no catálogo,
   * na ordem do conteúdo — a ordem é contrato, e é ela que veste a arma ANTES do escudo, para o
   * bow de duas mãos deixar o escudo na mochila e não o contrário. `startingWeaponItemId` é o
   * fallback legado para a vocação que não declara kit.
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
    const catalog = this.#options.itemCatalog ?? EMPTY_ITEMS;
    const weapon = vocation.startingWeaponItemId === undefined
      ? null
      : this.#options.itemCatalog?.get(vocation.startingWeaponItemId) ?? null;
    if (vocation.startingWeaponItemId !== undefined && weapon === null) {
      viewer.send({ type: 'system-message', level: 'warning', text: 'A arma dessa vocação não existe.' });
      return;
    }
    let kitItems: { item: Item }[] = [];
    if (vocation.startingKit.length > 0) {
      kitItems = [];
      for (const piece of vocation.startingKit) {
        const item = this.#options.itemCatalog?.get(piece.itemId) ?? null;
        if (item === null) {
          viewer.send({
            type: 'system-message', level: 'warning',
            text: `Uma peça do kit dessa vocação ("${piece.itemId}") não existe.`,
          });
          return;
        }
        kitItems.push({ item });
      }
    }
    const result = character.chooseVocation(vocation, kitItems.length > 0 ? null : weapon, {
      catalog,
      vocationLevel,
      // Uma por personagem, e com o id DELE no meio: numa cópia da Cidade dois personagens
      // compartilham `session.id`, e `${session.id}:${lootSeq}` colidiria na chave primária
      // de `item_instance`. O prefixo da sessão é o que `acquiredBy` filtra. Cada peça do kit
      // recebe o id do item no fim, porque são N identidades, não uma.
      instanceId: `${hosted.session.id}:${character.id}:vocation`,
      rules: this.#containerRules(character),
      ...(kitItems.length > 0 ? { kitItems } : {}),
    });
    if (!result.ok) {
      viewer.send({ type: 'system-message', level: 'warning', text: VOCATION_REFUSAL[result.reason] });
      return;
    }
    // Peso nunca recusa o grant de vocação/kit (ADR 0048 decisão 7, `Inventory.forceAdd`): não
    // há mais status "não coube" para avisar aqui — o que sobra é só vestir ou ficar na mochila.
    hosted.dirty.add(character.id);
    const stats = this.#statsOf(character);
    hosted.sentStats.set(character.id, stats);
    this.#sendToViewersOf(hosted, character.id, { type: 'player-stats', ...stats });
    this.#sendInventory(character.id);
  }

  /**
   * Promove a vocação escolhida (#566, ADR 0042 decisão 1). Serviço de Cidade: só a sessão de
   * Cidade aceita — o mesmo padrão do ADR 0042 (decisão 1, tela de serviço) e do "obtida na
   * Cidade" do plano de conteúdo. O preço sai por `goldDelta`, liquidado pelo MESMO
   * `#saveDurableReceipt` que já debita `sell-items` na praça (invariante 10).
   */
  #requestPromoteVocation(viewer: Viewer): void {
    const hosted = this.#hostedSession(viewer.characterId);
    const character = this.#ownerOf(viewer.characterId);
    if (hosted === undefined || character === undefined) return;
    if (hosted.session.ruleset.type !== 'city') {
      viewer.send({
        type: 'system-message', level: 'warning', text: 'Você precisa estar na Cidade para se promover.',
      });
      return;
    }
    const vocation = character.vocationId === null
      ? undefined
      : this.#options.vocations?.get(character.vocationId);
    if (vocation === undefined) {
      viewer.send({ type: 'system-message', level: 'warning', text: PROMOTE_REFUSAL['no-vocation'] });
      return;
    }
    const result = character.promote(vocation, character.gold + character.goldDelta);
    if (!result.ok) {
      viewer.send({ type: 'system-message', level: 'warning', text: PROMOTE_REFUSAL[result.reason] });
      return;
    }
    // `promote` já debitou o preço em `goldDelta`; `ok` garante o bloco de promoção.
    this.#mirrorGold(hosted, character.id, -(vocation.promotion?.price ?? 0));
    this.#markDirty(character.id);
    const stats = this.#statsOf(character);
    hosted.sentStats.set(character.id, stats);
    this.#sendToViewersOf(hosted, character.id, { type: 'player-stats', ...stats });
  }

  #ownerOf(characterId: string): CharacterRuntime | undefined {
    const hosted = this.#hostedSession(characterId);
    return hosted === undefined ? undefined : this.#participantOf(hosted, characterId);
  }

  /**
   * `playerStatsOf` com a vocação DESTE personagem já resolvida (#521, ADR 0037): o `%` de
   * skill/ML no HUD precisa do fator da vocação dele, não do genérico do conteúdo — e todo
   * chamador tinha o mesmo par `character`/`this.#options.skillCatalog` repetido.
   */
  #statsOf(character: CharacterRuntime | undefined): PlayerStats {
    const vocation = character?.vocationId == null
      ? null
      : this.#options.vocations?.get(character.vocationId) ?? null;
    return playerStatsOf(character, this.#options.skillCatalog, vocation, this.#options.progression);
  }

  /**
   * O jogador escolheu a postura de luta (#550, M30-03, ADR 0040) — o `Player::setFightMode` do
   * Canary. INTENÇÃO: o cliente diz QUAL modo (o protocolo já fechou o vocabulário nos três do
   * Canary); o efeito — o fator de ataque do dano de arma, o de defesa e o da mitigação — é do
   * `sim`, lido pela sessão dona no golpe seguinte (invariante 9), nunca daqui. Aceita na
   * Cidade e na hunt, na chegada, como `select-ammo`: não passa pelo ruleset, e a hunt
   * desanexada continua com o modo que o jogador deixou.
   *
   * Escolher o modo em que já está não escreve nada e não reenvia nada — mas o cliente que mandou
   * esperava a confirmação de sempre, então o `player-stats` sai igual (quem nunca a recebeu não
   * tem como saber que o pedido chegou).
   */
  #requestSetFightMode(viewer: Viewer, mode: FightMode): void {
    const hosted = this.#hostedSession(viewer.characterId);
    const character = this.#ownerOf(viewer.characterId);
    if (hosted === undefined || character === undefined) return;
    if (character.setFightMode(mode)) this.#markDirty(character.id);
    const stats = this.#statsOf(character);
    hosted.sentStats.set(character.id, stats);
    this.#sendToViewersOf(hosted, character.id, { type: 'player-stats', ...stats });
  }

  /**
   * O jogador escolheu a munição da família (#152, ADR 0026 d.3). INTENÇÃO: o cliente diz o id;
   * o catálogo e o gate de level são do servidor, e a escolha é aplicada na sessão dona. Recusa
   * vira `system-message`, como a de equipar; o sucesso sai no `player-stats.ammo`.
   */
  #requestSelectAmmo(viewer: Viewer, ammoId: string): void {
    const hosted = this.#hostedSession(viewer.characterId);
    const character = this.#ownerOf(viewer.characterId);
    if (hosted === undefined || character === undefined) return;
    const ammunition = this.#options.ammunitionCatalog;
    const ammo = ammunition?.get(ammoId);
    if (ammo === undefined) {
      viewer.send({ type: 'system-message', level: 'warning', text: 'Essa munição não existe.' });
      return;
    }
    const result = character.selectAmmo(ammo);
    if (!result.ok) {
      viewer.send({ type: 'system-message', level: 'warning', text: AMMO_REFUSAL[result.reason] });
      return;
    }
    hosted.dirty.add(character.id);
    const stats = this.#statsOf(character);
    hosted.sentStats.set(character.id, stats);
    this.#sendToViewersOf(hosted, character.id, { type: 'player-stats', ...stats });
  }

  /** O registro cru de magias aprendidas (#624), na forma que `learned-spells` (S2C) manda. */
  #learnedSpellsMessageFor(character: CharacterRuntime): S2CMessage {
    return { type: 'learned-spells', spellIds: [...character.learnedSpells.getState().spellIds] };
  }

  /**
   * Aprender UMA magia por gold (#624, ADR 0058 d.2). INTENÇÃO: o cliente diz QUAL magia; a
   * vocação, o level, "já aprendida", o preço (`learnPrice`) e o saldo são do servidor, e a
   * decisão inteira é do `sim` (`CharacterRuntime.learnSpell`) — este método só traduz a recusa e
   * cuida do gold. Aceita em QUALQUER sessão, Cidade e hunt: não há rolagem (ADR 0052 d.4), e o
   * Tibia também não exige protect zone para o NPC ensinar.
   *
   * O gold sai do MESMO jeito que `charm-remove`: `goldDelta` (o `sim` já debitou), e o agregado
   * `goldSpent` só quando a sessão credita por agregado (`creditsAggregates` — a hunt, e o mundo)
   * — o extrato soma `aggregatesOf`. Na Cidade (shard que não credita) o agregado é cumulativo
   * entre extratos e nunca zerado por flush, então somar ali re-creditaria a compra no próximo
   * logout; lá o gold vai só por `goldDelta`, que `#saveDurableReceipt` drena e liquida
   * (invariante 10). A escolha é de `#mirrorGold`. Aprender de novo é recusado ANTES de qualquer
   * débito, então repetir a intenção nunca cobra duas vezes.
   */
  #requestLearnSpell(viewer: Viewer, spellId: string): void {
    const hosted = this.#hostedSession(viewer.characterId);
    const character = this.#ownerOf(viewer.characterId);
    if (hosted === undefined || character === undefined) return;
    const spell = (this.#options.spellCatalog ?? EMPTY_SPELLS).get(spellId);
    const result = character.learnSpell(spell);
    if (!result.ok) {
      viewer.send({ type: 'system-message', level: 'warning', text: LEARN_SPELL_REFUSAL[result.reason] });
      return;
    }
    this.#mirrorGold(hosted, viewer.characterId, -result.price);
    this.#markDirty(character.id);
    // No meio de uma hunt, a magia recém-aprendida destrava a regra do bot que vinha sendo
    // pulada (`spell-not-learned` não tem prazo): sem acordá-lo, ela só voltaria a valer no
    // próximo dano recebido. Um evento na fila (ADR 0058 emenda 5), nada por tick; a Cidade não
    // tem bot, e o ruleset dela não tem o método.
    (hosted.session.ruleset as Partial<HuntRuleset>).rearmBot?.(hosted.session, character.id);
    // O gold gasto muda o `player-stats` (saldo) de quem olha — a mesma razão da compra de bênção.
    const stats = this.#statsOf(character);
    hosted.sentStats.set(character.id, stats);
    this.#sendToViewersOf(hosted, character.id, { type: 'player-stats', ...stats });
    this.#sendToViewersOf(hosted, character.id, this.#learnedSpellsMessageFor(character));
  }

  /** O registro cru de Charms (M39-02, #602), na forma que `charms` (S2C) manda. */
  #charmsMessageFor(character: CharacterRuntime): S2CMessage {
    return { type: 'charms', ...character.charms.getState() };
  }

  /**
   * Desbloquear o próximo tier de um Charm (M39-02, #602, ADR 0053 d.3). INTENÇÃO: o cliente
   * diz QUAL charm; o custo (pontos de Charm derivados do Bestiário, ou echoes derivados dos
   * tiers major já desbloqueados) é do servidor. Aceita em QUALQUER sessão — Cidade e hunt —,
   * porque não há rolagem (ADR 0052 d.2/d.4): processada na chegada, como `equip`, sem passar
   * pelo ruleset.
   */
  #requestCharmUnlock(viewer: Viewer, charmId: string): void {
    const hosted = this.#hostedSession(viewer.characterId);
    const character = this.#ownerOf(viewer.characterId);
    if (hosted === undefined || character === undefined) return;
    const catalogue = this.#options.charmCatalog ?? EMPTY_CHARMS;
    const entries = this.#options.charmBestiaryEntries ?? EMPTY_CHARM_ENTRIES;
    const result = character.charms.unlock(charmId, catalogue, character.bestiary, entries);
    if (!result.ok) {
      viewer.send({ type: 'system-message', level: 'warning', text: CHARM_UNLOCK_REFUSAL[result.reason] });
      return;
    }
    this.#markDirty(character.id);
    this.#sendToViewersOf(hosted, character.id, this.#charmsMessageFor(character));
  }

  /**
   * Atribuir um Charm desbloqueado a um monstro do bestiário (ADR 0053 d.4). `monsterId` é o
   * id de CONTEÚDO (`catalogue.monsters[].id`), nunca uma criatura viva — Charms atacam por
   * RAÇA. O Premium (2 Free/6 slots) vem do ticket (`#premiumByCharacter`), como em qualquer
   * outra sessão (ADR 0035 D3).
   */
  #requestCharmAssign(viewer: Viewer, charmId: string, monsterId: string): void {
    const hosted = this.#hostedSession(viewer.characterId);
    const character = this.#ownerOf(viewer.characterId);
    if (hosted === undefined || character === undefined) return;
    const catalogue = this.#options.charmCatalog ?? EMPTY_CHARMS;
    const entries = this.#options.charmBestiaryEntries ?? EMPTY_CHARM_ENTRIES;
    const premium = this.#premiumByCharacter.get(character.id) ?? false;
    const result = character.charms.assign(
      charmId, monsterId, catalogue, character.bestiary, entries, { premium },
    );
    if (!result.ok) {
      viewer.send({ type: 'system-message', level: 'warning', text: CHARM_ASSIGN_REFUSAL[result.reason] });
      return;
    }
    this.#markDirty(character.id);
    this.#sendToViewersOf(hosted, character.id, this.#charmsMessageFor(character));
  }

  /**
   * Remover a atribuição de um Charm (ADR 0053 d.4): custa `level × 100` gold pelo ledger
   * (invariante 10) — o mesmo caminho de `#requestSellItems` para o gold entrar/sair pela
   * sessão certa (`#mirrorGold`: agregado só quando a sessão credita por agregado; na Cidade só
   * `goldDelta`, drenado no extrato de estado durável). O gold é conferido ANTES de mexer no
   * `sim`: sem saldo, nada muda.
   */
  #requestCharmRemove(viewer: Viewer, charmId: string): void {
    const hosted = this.#hostedSession(viewer.characterId);
    const character = this.#ownerOf(viewer.characterId);
    if (hosted === undefined || character === undefined) return;
    if (character.charms.assignmentOf(charmId) === undefined) {
      viewer.send({ type: 'system-message', level: 'warning', text: CHARM_REMOVE_REFUSAL['not-assigned'] });
      return;
    }
    const fee = character.level * 100;
    const balance = character.gold + character.goldDelta;
    if (balance < fee) {
      viewer.send({ type: 'system-message', level: 'warning', text: 'Você não tem gold suficiente para remover esse Charm.' });
      return;
    }
    const result = character.charms.remove(charmId);
    if (!result.ok) {
      viewer.send({ type: 'system-message', level: 'warning', text: CHARM_REMOVE_REFUSAL[result.reason] });
      return;
    }
    character.goldDelta -= fee;
    this.#mirrorGold(hosted, viewer.characterId, -fee);
    this.#markDirty(character.id);
    this.#sendToViewersOf(hosted, character.id, this.#charmsMessageFor(character));
  }

  /**
   * O registro de Hazard (M44-14, #632), na forma que `hazard` (S2C) manda — o teto e o nível
   * escolhido de cada zona, crus, como `charms` manda o registro dos Charms.
   */
  #hazardMessageFor(character: CharacterRuntime): S2CMessage {
    const { maxLevel, currentLevel } = character.hazard.getState();
    return { type: 'hazard', maxLevel, currentLevel };
  }

  /**
   * Escolher o nível de Hazard de uma zona (M44-14, #632, ADR 0052 d.2/d.5). INTENÇÃO: o cliente
   * diz QUAL zona e QUAL nível; a zona, o piso e o teto que o personagem desbloqueou são do
   * servidor (invariante 4), dentro da sessão dona (invariante 9). **Só na Cidade**: o nível de
   * uma hunt em curso é FIXO desde a entrada — como a versão de conteúdo (invariante 7) —, e
   * aceitá-lo lá mudaria o dano do monstro no meio da sessão. No Canary quem muda o nível é o NPC
   * Gnomadness (`gnomadness.lua`), que fica DENTRO dos jardins, e a troca vale na hora
   * (`player:updateHazard()`); o Draconya a leva para a Cidade porque a sessão é instanciada e o
   * nível é fixado na entrada (ADR 0052 d.5), sem rolagem (d.4). O sucesso é `hazard` reenviado;
   * a recusa, `system-message`.
   */
  #requestSetHazardLevel(viewer: Viewer, zoneId: string, level: number): void {
    const hosted = this.#hostedSession(viewer.characterId);
    const character = this.#ownerOf(viewer.characterId);
    if (hosted === undefined || character === undefined) return;
    if (hosted.session.ruleset.shared !== true) {
      viewer.send({
        type: 'system-message', level: 'warning',
        text: 'O nível de hazard só muda na Cidade, antes de entrar na hunt.',
      });
      return;
    }
    // A zona sai por PROPRIEDADE PRÓPRIA: `zones` é um objeto comum, e `zones['constructor']` ou
    // `zones['__proto__']` seriam uma "zona" para um `zoneId` que o cliente escolhe (invariante 4).
    const zones = this.#options.hazard?.zones;
    const zone = zones !== undefined && Object.hasOwn(zones, zoneId) ? zones[zoneId] : undefined;
    const revision = character.hazard.revision;
    const result = character.hazard.select(zoneId, zone, level);
    if (!result.ok) {
      viewer.send({ type: 'system-message', level: 'warning', text: HAZARD_REFUSAL[result.reason] });
      return;
    }
    hosted.sentHazard.set(character.id, character.hazard.revision);
    this.#sendToViewersOf(hosted, character.id, this.#hazardMessageFor(character));
    // Escolher o nível em que já estava não muda nada: nenhum extrato a gravar.
    if (character.hazard.revision === revision) return;
    // DURÁVEL JÁ, e não só no `release`: o ticket de uma party (#195) é emitido pela `api` a partir
    // da LINHA do banco, e o nível que o membro acabou de escolher na praça só chega lá pelo extrato
    // — que a `api` liquida antes de emitir (ADR 0028 d.5). Sem este envio o membro entraria na
    // hunt de hazard com o nível de ANTES, e o "menor da party" seria o de uma escolha que o
    // jogador já tinha trocado. O extrato é só do hazard (`#saveHazardChoice`), e nunca o de estado
    // inteiro: aquele leva o gold e as instâncias vendidas ainda não liquidados, e gravá-lo a cada
    // escolha os perderia (ver lá).
    void this.#saveHazardChoice(character.id, hosted).catch((error: unknown) => {
      this.#logger.error({ err: error, characterId: character.id }, 'Failed to save the hazard choice');
    });
  }

  /**
   * O extrato da ESCOLHA de hazard (#632): um extrato SÓ de estado, com o registro de hazard e mais
   * nada — agregados zerados, sem `goldDelta`, sem `removedInstances`, sem equipamento, bênçãos
   * nem o resto do estado durável da Cidade. Não é o `#saveDurableReceipt`, de propósito, por duas
   * razões que o review do #897 encontrou:
   *
   * - **O `ReceiptStore` guarda UM extrato por `(sessionId, characterId)`** (a chave não leva o
   *   `seq`; o #823 corrige isso). A Cidade é uma sessão compartilhada, então todo extrato de um
   *   personagem nela divide a chave — e o de estado inteiro carrega valor (o gold de uma bênção
   *   comprada, a venda e as instâncias apagadas) que só sai UMA vez, porque `settleGoldDelta` e
   *   `drainRemovedInstances` o zeram. Um segundo extrato na mesma chave antes da varredura do
   *   `jobs` (até 10 s) sobrescreveria o primeiro e o valor sumiria: bênção de graça, venda
   *   revertida. O extrato de hazard é ABSOLUTO e última-escrita-vence, então sobrescrever outro
   *   DELE é inofensivo — e vai num fluxo próprio (`HAZARD_RECEIPT_STREAM`) para nunca encostar no
   *   extrato do personagem.
   * - **Nada é liquidado aqui**, então um pedido que chega durante o `await` do Redis não tem o
   *   delta absorvido nem a marca de "sujo" apagada sem ter saído.
   *
   * O `seq` é o mesmo contador da sessão (`ledgerSeq`), tomado de forma síncrona antes do `await`:
   * `(session_id, seq)` do ledger continua único. O registro é montado AGORA, e a gravação sai na
   * ordem das chamadas (uma conexão só), então a última escolha é a última a chegar ao Redis.
   *
   * Se o Redis falhar, o personagem fica marcado como sujo: o extrato de estado do `release` leva o
   * registro, como levava antes desta função existir.
   */
  async #saveHazardChoice(characterId: string, hosted: HostedSession): Promise<void> {
    const receipts = this.#options.receipts;
    const accountId = this.#accountIdByCharacter.get(characterId);
    const owner = hosted.session.participants.find((p) => p.id === characterId);
    if (receipts === undefined || accountId === undefined || owner === undefined) {
      this.#markDirty(characterId);
      return;
    }
    hosted.session.ledgerSeq += 1;
    try {
      await receipts.save({
        sessionId: `${hosted.session.id}${HAZARD_RECEIPT_STREAM}`,
        characterId,
        accountId,
        reason: 'manual-exit',
        seq: hosted.session.ledgerSeq,
        aggregates: EMPTY_AGGREGATES,
        notableEvents: [],
        hazard: owner.hazard.getState(),
      });
    } catch (error) {
      this.#markDirty(characterId);
      throw error;
    }
  }

  /**
   * Comprar UMA bênção (#570, ADR 0052 decisão 2). Serviço de CIDADE, nunca hunt — não existe
   * onde comprar bênção fora do shard, e a `blessing.lua` do Canary trava o santuário em PZ
   * pela mesma razão. INTENÇÃO: o cliente diz QUAL bênção; preço por level
   * (`blessingCost`/`progression.blessingPricing`), saldo e "já tem esta bênção"
   * (`hasBlessing`) são do servidor. Gold sai por `goldDelta` — o MESMO caminho de
   * `sell-items` na Cidade (ADR 0048 d.8): a sessão de shard que não credita não zera o agregado
   * a cada extrato, então somar ali re-creditaria a compra no próximo logout;
   * `#saveDurableReceipt` drena e liquida `goldDelta` a cada extrato (`#mirrorGold` decide, e
   * numa sessão que credita por agregado soma os dois). O bit fica em `character.blessings`
   * (bitmask), e o sucesso sai como `blessings` — não `player-stats.blessings`, porque bênção
   * não é vital nem item.
   */
  #requestBuyBlessing(viewer: Viewer, blessingId: string): void {
    const hosted = this.#hostedSession(viewer.characterId);
    const character = this.#ownerOf(viewer.characterId);
    if (hosted === undefined || character === undefined) return;
    if (!offersCityServices(hosted.session.ruleset)) {
      viewer.send({
        type: 'system-message', level: 'warning', text: 'Bênçãos só se compram na Cidade.',
      });
      return;
    }
    const blessing = this.#options.blessingCatalog?.get(blessingId);
    const pricing = this.#options.progression?.blessingPricing;
    if (blessing === undefined || pricing === undefined) {
      viewer.send({
        type: 'system-message', level: 'warning', text: 'Esse serviço não está disponível.',
      });
      return;
    }
    if (hasBlessing(character.blessings, blessing.order)) {
      viewer.send({ type: 'system-message', level: 'warning', text: 'Você já tem essa bênção.' });
      return;
    }
    const cost = blessingCost(character.level, blessing.enhanced, pricing);
    if (character.gold + character.goldDelta < cost) {
      viewer.send({ type: 'system-message', level: 'warning', text: 'Você não tem gold suficiente.' });
      return;
    }
    character.goldDelta -= cost;
    this.#mirrorGold(hosted, character.id, -cost);
    character.blessings = withBlessing(character.blessings, blessing.order);
    this.#markDirty(viewer.characterId);
    const stats = this.#statsOf(character);
    hosted.sentStats.set(character.id, stats);
    this.#sendToViewersOf(hosted, character.id, { type: 'player-stats', ...stats });
    hosted.sentBlessings.set(character.id, character.blessings);
    viewer.send({ type: 'blessings', mask: character.blessings });
  }

  /**
   * O `training-state` do personagem, na forma que o fio manda (#631): o banco e a skill do livro,
   * as exercise weapons que ele carrega com as cargas RESTANTES — o overlay da instância não viaja
   * em `inventory` — e a instância que o Treino em curso gasta. Só quando o host TEM Treino
   * (`options.training`): sem ele, nenhuma mensagem sai e o cliente não desenha a tela.
   */
  #trainingMessageFor(hosted: HostedSession, character: CharacterRuntime): S2CMessage {
    const catalog = this.#options.itemCatalog ?? EMPTY_ITEMS;
    const state = character.inventory.getState();
    const carried: CarriedItem[] = [
      ...state.backpack, ...(state.satchel ?? []), ...Object.values(state.equipped),
    ].filter((item): item is CarriedItem => item !== null && item !== undefined);
    const weapons = carried.flatMap((item) => {
      const definition = catalog.get(item.itemId);
      if (definition?.exercise === undefined || definition.charges === undefined) return [];
      const charges = item.overlay?.charges ?? definition.charges;
      return charges > 0 ? [{ instanceId: item.instanceId, itemId: item.itemId, charges }] : [];
    });
    const ruleset = hosted.session.ruleset as Partial<TrainingRuleset>;
    return {
      type: 'training-state',
      offlineBankMs: character.training.bankMs,
      offlineSkill: character.training.skill,
      weapons,
      activeInstanceId: hosted.session.ruleset.type === 'training' ? ruleset.itemInstanceId ?? null : null,
    };
  }

  /**
   * Manda o `training-state` a quem olha o personagem — só quando mudou desde o último entregue
   * (`force` o manda sempre: é o `session-attach` e a chegada de uma sessão nova, em que a tela
   * ainda não tem nada). Host sem Treino não manda nada.
   */
  #syncTraining(hosted: HostedSession, characterId: string, force = false): void {
    if (this.#options.training === undefined) return;
    const character = this.#participantOf(hosted, characterId);
    if (character === undefined) return;
    const message = this.#trainingMessageFor(hosted, character);
    const signature = JSON.stringify(message);
    if (!force && hosted.sentTraining.get(characterId) === signature) return;
    hosted.sentTraining.set(characterId, signature);
    this.#sendToViewersOf(hosted, characterId, message);
  }

  /**
   * As cargas do Treino em curso, ao ritmo dos golpes (#631): cada golpe muda o overlay da arma, e
   * a tela mostra o que resta. Só a sessão de Treino, e só com visualizador (a apresentação é o
   * que se perde quando ninguém olha — nunca o resultado, invariante 3).
   */
  #presentTraining(hosted: HostedSession): void {
    if (hosted.session.ruleset.type !== 'training' || hosted.viewers.size === 0) return;
    for (const character of hosted.session.participants) this.#syncTraining(hosted, character.id);
  }

  /**
   * Comprar UM item por gold na Cidade (#631, ADR 0059 d.2) — o mínimo que a exercise weapon
   * precisa enquanto a loja geral (E5) não existe. Serviço de Cidade: só a sessão de Cidade aceita
   * (ADR 0052 d.2), e o gold sai por `goldDelta`, liquidado pelo `#saveDurableReceipt` que já debita
   * `sell-items` e `buy-blessing` na praça (invariante 10). O item nasce como instância NOVA de
   * origem `purchase`, e o mesmo extrato a leva por `acquired` — o id carrega o do PERSONAGEM e um
   * UUID por compra, porque a mesma cópia da Cidade é reaberta em outro dia e um `lootSeq` que
   * recomeça em zero colidiria na chave primária de `item_instance`.
   */
  #requestBuyItem(viewer: Viewer, itemId: string): void {
    const hosted = this.#hostedSession(viewer.characterId);
    const character = this.#ownerOf(viewer.characterId);
    if (hosted === undefined || character === undefined) return;
    if (hosted.session.ruleset.type !== 'city') {
      viewer.send({ type: 'system-message', level: 'warning', text: 'Só se compra na Cidade.' });
      return;
    }
    const catalog = this.#options.itemCatalog ?? EMPTY_ITEMS;
    const result = buyItem(character, catalog.get(itemId), {
      catalog,
      rules: this.#containerRules(character),
      instanceId: `${hosted.session.id}:${character.id}:buy:${randomUUID()}`,
    });
    if (!result.ok) {
      viewer.send({ type: 'system-message', level: 'warning', text: BUY_REFUSAL[result.reason] });
      return;
    }
    // `buyItem` já debitou o preço em `goldDelta`.
    this.#mirrorGold(hosted, character.id, -result.price);
    this.#markDirty(character.id);
    const stats = this.#statsOf(character);
    hosted.sentStats.set(character.id, stats);
    this.#sendToViewersOf(hosted, character.id, { type: 'player-stats', ...stats });
    // O inventário leva junto o `training-state` (`#sendInventory`): a arma comprada já aparece na
    // tela de Treino, com as cargas cheias.
    this.#sendInventory(character.id);
  }

  /**
   * O livro do offline training (#631, ADR 0059 d.3, ADR 0052 d.2): a skill que a `api` vai treinar
   * quando o personagem voltar. Serviço de Cidade, sem rolagem — o gasto do banco NÃO acontece
   * aqui: é da `api`, na emissão do próximo ticket, com o personagem em repouso. `skillId: null`
   * desmarca. Só as skills que o conteúdo oferece são aceitas (invariante 4).
   */
  #requestSetOfflineSkill(viewer: Viewer, skillId: string | null): void {
    const hosted = this.#hostedSession(viewer.characterId);
    const character = this.#ownerOf(viewer.characterId);
    if (hosted === undefined || character === undefined) return;
    const training = this.#options.training;
    if (training === undefined) {
      viewer.send({ type: 'system-message', level: 'warning', text: 'Este servidor não tem Treino.' });
      return;
    }
    if (hosted.session.ruleset.type !== 'city') {
      viewer.send({
        type: 'system-message', level: 'warning', text: 'O livro do offline training só se lê na Cidade.',
      });
      return;
    }
    const result = character.training.choose(skillId, training);
    if (!result.ok) {
      viewer.send({ type: 'system-message', level: 'warning', text: 'Essa skill não está no livro.' });
      return;
    }
    this.#markDirty(character.id);
    this.#syncTraining(hosted, character.id);
  }

  /**
   * Entrar na sessão de Treino com uma exercise weapon da mochila (#631, ADR 0059 d.1). O host
   * confere e responde em palavras o que o jogador precisa ler — sem Treino, fora da Cidade,
   * instância que ele não carrega ou que não é exercise weapon —, e a transição em si é a de
   * sempre (`#requestTransition`): o construtor de sessões a recusa de novo se algo não bater.
   */
  #requestEnterTraining(viewer: Viewer, itemInstanceId: string): void {
    const hosted = this.#hostedSession(viewer.characterId);
    const character = this.#ownerOf(viewer.characterId);
    if (hosted === undefined || character === undefined) return;
    const training = this.#options.training;
    if (training === undefined) {
      viewer.send({ type: 'system-message', level: 'warning', text: 'Este servidor não tem Treino.' });
      return;
    }
    if (hosted.session.ruleset.type !== 'city') {
      viewer.send({
        type: 'system-message', level: 'warning', text: 'Você precisa estar na Cidade para treinar.',
      });
      return;
    }
    const carried = character.inventory.carried(itemInstanceId);
    const definition = carried === null ? undefined : this.#options.itemCatalog?.get(carried.itemId);
    if (carried === null || definition?.exercise === undefined || definition.charges === undefined) {
      viewer.send({
        type: 'system-message', level: 'warning', text: 'Você não tem essa exercise weapon.',
      });
      return;
    }
    // O `training-exhaustion` do Canary (`exercise_training_weapons.lua`, `exhaustionTime = 10`): um
    // novo início só passados 10 s do anterior. O mesmo cooldown de parede que o construtor de
    // sessões confere de novo e CARIMBA ao construir (`trainingFor`); aqui só se responde em palavras.
    if (character.training.exerciseCooldownLeftMs(this.#wallNow(), training.startCooldownMs) > 0) {
      viewer.send({
        type: 'system-message', level: 'warning',
        text: `O boneco de treino só pode ser usado depois de ${String(training.startCooldownMs / 1000)} segundos de espera.`,
      });
      return;
    }
    void this.#requestTransition(viewer, { to: 'training', itemInstanceId });
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
      // O estoque abstrato (#520, ADR 0049 decisão 4): agora VISÍVEL — o jogador vê o que o
      // loot lhe deu antes de gastar gold pela mesma runa/poção/munição.
      supplies: [...character.supplyStock].map(([id, quantity]) => ({ id, quantity })),
      ammunition: [...character.ammunitionStock].map(([id, quantity]) => ({ id, quantity })),
    });
    // As exercise weapons e as cargas dela vivem no overlay, que o `inventory` não leva (#631): o
    // `training-state` acompanha toda mudança de mochila — só quando a assinatura mudou.
    this.#syncTraining(hosted, characterId);
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
   * `party-settings` (ADR 0035 D1/D2). Ao contrário de `#configureBot`, não há vocabulário para
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
   * A configuração que veio no ticket (FUN-81). Recusada é IGNORADA, nunca fatal — e desde o
   * #596/ADR 0014, "recusada" aqui é só o formato genuinamente irreconhecível (versão
   * desconhecida, vocabulário que nem migra): um SLOT cuja magia/supply saiu do catálogo (uma
   * magia renomeada ou removida) não derruba a configuração inteira — `loadBotConfig`
   * (`createBotConfigLoader`) esvazia só aquele slot e devolve o resto intacto. Derrubar tudo
   * por um arquivo de balanceamento trancaria o personagem fora dos próprios automatismos —
   * entrar com a config sanitizada (ou sem bot nenhum, no caso raro de corrupção de verdade) é
   * a degradação certa.
   */
  #adoptTicketBotConfig(
    characterId: string, session: Session, initial: InitialCharacter | undefined,
  ): void {
    const raw = initial?.botConfig;
    const load = this.#options.loadBotConfig;
    if (raw === undefined || load === undefined) return;

    const level = session.participants.find((p) => p.id === characterId)?.level
      ?? initial?.level ?? 1;
    const decision = load(raw, level);
    if (!decision.ok) {
      this.#logger.warn(
        { characterId, reason: decision.reason }, 'Stored bot configuration refused',
      );
      return;
    }
    if (decision.removed.length > 0) {
      this.#logger.warn(
        { characterId, removed: decision.removed },
        'Stored bot configuration had stale references — affected slots were cleared',
      );
    }
    this.#botByCharacter.set(characterId, decision.config);
    // Semeia o ruleset também (#792): quem chega direto na Cidade (o caminho comum de login,
    // invariante 8) precisa da barra de ações carregada ali para `use-slot` conjurar — sem
    // isto, `CityRuleset#useSlot` nunca vê a config até o jogador salvar uma nova em `bot-
    // config` (que já passava por `#applyBotConfig`). Ruleset sem `configureBot` ignora
    // (hunt já a recebe pelo `botConfig` da própria criação — recompilar de novo aqui é
    // idempotente, a mesma configuração).
    (session.ruleset as Partial<HuntRuleset>).configureBot?.(session, decision.config, characterId);
    // A v1 migrada, e a config com slot sanitizado, são DADO NOVO: persiste pelo caminho
    // write-behind (ADR 0028, DT-07) — senão toda entrada repetiria a migração/sanitização e a
    // coluna seguiria com a referência morta. `saveBotConfig` só existe quando o papel aceita
    // persistir; falha não é fatal — a config vale nesta sessão.
    if (!isBotConfigV2(raw) || decision.removed.length > 0) {
      void this.#options.saveBotConfig?.(characterId, decision.config).catch(() => undefined);
    }
  }

/**
   * Troca a configuração da hunt em curso. Ruleset que não tem bot ignora, e é o normal.
   *
   * **O `characterId` é obrigatório na party (#203/#407):** sem ele, `configureBot` cai no
   * PRIMEIRO participante e a configuração de quem falou sobrescreve a do líder. O bot é por
   * personagem — `#botByCharacter` já é — e o `sim` aceita o id de propósito.
   */
  #applyBotConfig(hosted: HostedSession, config: BotConfigV2, characterId: string): void {
    const ruleset = hosted.session.ruleset as Partial<HuntRuleset>;
    // A sessão dona é quem escreve (invariante 9), e é ela que está aqui: `configureBot`
    // recompila dentro do ruleset, não de fora.
    ruleset.configureBot?.(hosted.session, config, characterId);
  }

  /**
   * O `leave-hunt` do jogador (#802): PEDE a saída ao ruleset (`requestExit`), que a conclui
   * quando o `exitDelayMs` vence e o personagem está fora de combate (#625: a janela de 60 s do
   * `CONDITION_INFIGHT` do Canary, medida por dano aplicado — ver `combat/in-fight.ts`). Nada
   * aqui encerra a sessão por conta própria.
   *
   * **Idle-first (invariante 3).** A espera é um evento da fila do `sim`, então ela vence com ou
   * sem visualizador — o jogador que pede a saída e fecha a aba sai do mesmo jeito, no mesmo
   * instante. O que o host faz é só a metade de I/O: quando o `sim` conclui, a sucessão de
   * sempre grava o extrato e leva o personagem à Cidade (`#succeed` para a sessão que acabou,
   * `#settleDepartures` para o membro da party que saiu — o `leave` com mais de um dono).
   *
   * Sem `requestExit` no ruleset — a Cidade, ou um ruleset que não sabe pedir —, ou com uma
   * transição em andamento, é o caminho de antes: `transition({ to: 'city' })`, que também é
   * quem devolve a recusa certa ("você já está aqui"). Morte, `party-member-lost` e a drenagem
   * NÃO passam por aqui e continuam encerrando direto: nenhuma delas carrega a intenção do
   * jogador de sair.
   */
  #requestLeaveHunt(viewer: Viewer): void {
    const { characterId } = viewer;
    const hosted = this.#hostedSession(characterId);
    const ruleset = hosted?.session.ruleset as Partial<HuntRuleset> | undefined;
    if (hosted === undefined || ruleset?.requestExit === undefined || this.#transitions.has(characterId)) {
      void this.#requestTransition(viewer, { to: 'city' });
      return;
    }
    // A sessão JÁ acabou. Ou a sucessão dela (extrato, Cidade) está em andamento — o segundo
    // clique de uma saída que concluiu na hora —, e não há o que pedir: seguir para a transição
    // aqui a poria em corrida com o `#succeed` que já corre (o `#transitions` não o conhece), a
    // CAS do diretório recusaria a segunda, e o caminho de recusa SOLTA o personagem. Ou a
    // sucessão FALHOU e o personagem ficou numa sessão encerrada que o ciclo ignora ("Failed to
    // move the character to the next session"): aí o clique é o retry manual que existia antes
    // do #802, pela transição de sempre — o extrato é idempotente (`credited`) e o `#replace`
    // conclui o que faltou.
    if (hosted.session.ended !== null) {
      if (!this.#settling.has(characterId)) void this.#requestTransition(viewer, { to: 'city' });
      return;
    }
    ruleset.requestExit(hosted.session, characterId);
    // Sem `exitDelayMs` e fora de combate a saída conclui NA HORA, aqui, fora do ciclo — e o
    // ciclo pula a sessão já encerrada. A ORDEM é a do `cycle`: os `member-left` PRIMEIRO, a
    // sucessão da sessão depois. Quem sai na hora deixa o próprio `member-left` na fila do `sim`
    // (`#depart`), e a mesma chamada pode ENCERRAR a sessão — o voto de encerrar que a saída dele
    // completa, a cascata `party-member-lost` que esvazia a party. `Session.end` só monta o
    // extrato de quem ainda está presente e `#succeed` só o liquida: sem drenar antes, o extrato
    // de quem saiu (XP, gold, ledger) ficaria para sempre na fila de uma sessão que o ciclo não
    // visita mais, e o personagem preso nela.
    this.#presentMoves(hosted);
    if (hosted.departures.length > 0) void this.#settleDepartures(hosted);
    // Quem encerra fora do ciclo dispara a sucessão (mesma regra do `#partyEndVote`).
    if (hosted.session.ended !== null) {
      void this.#succeed(hosted);
      return;
    }
    // A espera pendente chega ao cliente já, e não só no ciclo seguinte.
    this.#presentExit(hosted);
  }

  /** O `cancel-exit` (#802): o ruleset desfaz a saída manual pendente, se houver. */
  #requestCancelExit(viewer: Viewer): void {
    const hosted = this.#hostedSession(viewer.characterId);
    const ruleset = hosted?.session.ruleset as Partial<HuntRuleset> | undefined;
    if (hosted === undefined || ruleset?.cancelExit === undefined || hosted.session.ended !== null) return;
    if (!ruleset.cancelExit(hosted.session, viewer.characterId)) return;
    this.#presentExit(hosted);
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
        this.#logger.error({ err: error, sessionId: hosted.session.id }, 'Session tick failed');
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
      // E o alvo, se mudou (#470): o auto-target troca sozinho, e o `player-stats` deixou de
      // levá-lo. DEPOIS dos eventos pelo mesmo motivo dos vitais.
      this.#presentTarget(hosted);
      this.#presentConditions(hosted);
      this.#presentExit(hosted);
      // E o analisador, se um abate, um loot, um gasto ou um evento entrou (FUN-110): sem
      // isto a janela ficava em zero a hunt inteira, até o jogador reconectar.
      this.#presentAnalyzer(hosted);
      this.#presentSpending(hosted);
      // E o Bestiário, se um abate contou (FUN-113): é progressão permanente, e a tela precisa
      // ver o marco chegar sem reconectar.
      this.#presentBestiary(hosted);
      // E o Bosstiary (#629), pela mesma razão: o nível de um boss fecha no abate, e a tela precisa
      // ver o número chegar sem reconectar.
      this.#presentBosstiary(hosted);
      this.#presentBlessings(hosted);
      this.#presentHazard(hosted);
      // E as cargas da exercise weapon, se o Treino gastou uma (#631).
      this.#presentTraining(hosted);
      // E o cenário, se algo mudou de estado PASSIVAMENTE (#734, ADR 0050 d.6 T3) — o walker
      // abrindo uma porta sozinho, uma placa de pressão, um `TILE_REVERT`. `useOnMap` já manda
      // o próprio `tile-update` na hora (`#requestUseOnMap`); isto cobre o resto.
      this.#presentTileOverrides(hosted);
      this.#presentSlotState(hosted, nowMs);
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
        case 'creature-look-changed':
        case 'ground-item-appeared':
        case 'ground-item-vanished':
        case 'field-appeared':
        case 'field-vanished':
        case 'field-stage-changed':
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
        case 'manual-action-result':
          // POR PERSONAGEM, pela mesma razão do Follow acima: só quem mandou o `use-item`/
          // `use-item-on` adiado precisa saber que ele, afinal, não coube (#726, ADR 0049 d.6).
          this.#presentManualActionResult(hosted, event);
          continue;
        case 'find-result':
          // POR PERSONAGEM, como o Follow: só quem lançou o Find lê a resposta (#623).
          this.#presentFindResult(hosted, event);
          continue;
        case 'member-left':
          // Alguém saiu por dentro do `sim` (#193): extrato e volta à Cidade são I/O, e o
          // ciclo é síncrono — fica na fila e sai logo depois dele (#194).
          hosted.departures.push(event);
          continue;
        case 'equipment-changed':
          // O `sim` mudou o corpo sozinho (o colar esgotou, o anel venceu): o cliente só sabe
          // pelo `inventory`, e a mensagem é a MESMA de sempre (opcode 16, sem campo novo).
          this.#sendInventory(event.characterId);
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
      // O destaque de loot (#722, ADR 0048 d.4): lido AGORA, depois que o Quick Loot automático
      // do abate já rodou (`#collectFromCorpse` corre ANTES deste evento, no mesmo instante da
      // morte) — é o que sobrou de fato, não uma previsão.
      const ruleset = hosted.session.ruleset as Partial<HuntRuleset>;
      const corpse = ruleset.groundItems?.find((item) => item.id === event.itemId);
      const lootable = corpse === undefined
        ? undefined
        : (corpse.items?.length ?? 0) > 0 || (corpse.gold ?? 0) > 0;
      const appeared: S2CMessage = {
        type: 'ground-item-appear', id: event.itemId, position: event.position, appearanceId,
        ...(lootable === undefined ? {} : { lootable }),
      };
      for (const viewer of hosted.viewers) viewer.send(appeared);
      return;
    }
    if (event.kind === 'ground-item-vanished') {
      const vanished: S2CMessage = { type: 'ground-item-disappear', id: event.itemId };
      for (const viewer of hosted.viewers) viewer.send(vanished);
      return;
    }
    // O campo de tile (#561, M31-06): o `sim` disse qual id de conteúdo e quais tiles; a arte
    // é da tabela — a MESMA indireção de `ground-item-appear` resolvendo `corpses`. Campo sem
    // linha em `appearances.fields` não aparece, e ninguém fica sabendo, de propósito.
    if (event.kind === 'field-appeared') {
      const appearanceId = this.#options.appearances?.fields[event.fieldId];
      if (appearanceId === undefined) return;
      const appeared: S2CMessage = {
        type: 'field-appear', id: event.fieldId, tiles: [...event.tiles], appearanceId,
      };
      for (const viewer of hosted.viewers) viewer.send(appeared);
      return;
    }
    if (event.kind === 'field-vanished') {
      // MUDO como o aparecimento (invariante 6): sem linha na tabela, o cliente nunca recebeu
      // um `field-appear` para este id, e mandar o sumiço seria apagar algo que nunca chegou.
      if (this.#options.appearances?.fields[event.fieldId] === undefined) return;
      const vanished: S2CMessage = { type: 'field-disappear', id: event.fieldId };
      for (const viewer of hosted.viewers) viewer.send(vanished);
      return;
    }
    // O campo trocou de estágio (#560): `stageIndex` é 1, 2, … — o índice 0 é o nascimento, já
    // resolvido por `appearances.fields`. Sem entrada aqui (cadeia sem arte declarada, ou campo
    // que nunca teve `field-appear` sabido — mesma defesa de `field-vanished`), MUDO.
    if (event.kind === 'field-stage-changed') {
      if (this.#options.appearances?.fields[event.fieldId] === undefined) return;
      const appearanceId = this.#options.appearances?.fieldStages[event.fieldId]?.[event.stageIndex - 1];
      if (appearanceId === undefined) return;
      const changed: S2CMessage = { type: 'field-stage-change', id: event.fieldId, appearanceId };
      for (const viewer of hosted.viewers) viewer.send(changed);
      return;
    }
    const key = String(event.creatureId);
    let message: S2CMessage;
    if (event.kind === 'creature-appeared') {
      const definition = this.#options.monsterCatalog?.get(event.monsterId);
      this.#rememberRace(hosted, key, definition);
      message = {
        type: 'creature-appear',
        id: this.#creatureId(hosted, key),
        position: event.position,
        appearanceId: definition?.outfitId ?? 0,
        name: definition?.name ?? event.monsterId,
        health: event.health,
        maxHealth: event.maxHealth,
        // A apresentação (#620): cores e addons, raça, luz e falas — só o que o cliente desenha, e
        // nada que o `sim` leia.
        ...monsterLookOf(definition),
        // A invocação do JOGADOR (#598, M38-01, ADR 0057 decisão 4): o cliente marca "sua
        // invocação". Ausente para todo o resto, inclusive invocação de MONSTRO (#546).
        ...(event.masterId === undefined ? {} : { masterId: event.masterId }),
      };
    } else if (event.kind === 'creature-look-changed') {
      // A aparência emprestada (#621): quem nunca foi anunciado não tem o que atualizar — o
      // `creature-appear`/`session-state` que vier já a carrega (`#lookFor`).
      const id = hosted.creatureIds.get(key);
      if (id === undefined) return;
      // Uma aparência SEM linha na tabela é MUDA (invariante 6): a condição vale no `sim`, e a
      // criatura continua desenhada como estava — a mesma regra de `field-appear` sem arte.
      if (event.look !== null && this.#resolveLook(event.look) === null) return;
      message = { type: 'creature-update', id, ...this.#lookFor(hosted, key) };
    } else if (event.kind === 'creature-vanished') {
      const id = hosted.creatureIds.get(key);
      // Nunca anunciado — morreu antes de alguém olhar. Não há o que retirar da tela.
      if (id === undefined) return;
      message = { type: 'creature-disappear', id };
      // O número NÃO é reaproveitado (ver `nextCreatureId`); só a chave sai do mapa, senão
      // ele cresce um item por respawn até o fim da hunt.
      hosted.creatureIds.delete(key);
      hosted.raceBySubject.delete(key);
    } else {
      const id = hosted.creatureIds.get(key);
      if (id === undefined) return;
      message = { type: 'creature-health', id, health: event.health, maxHealth: event.maxHealth };
    }
    for (const viewer of hosted.viewers) viewer.send(message);
  }

  /**
   * Guarda a raça do monstro `key` (#620) quando ela difere de `blood` — ver `raceBySubject`. Chamado
   * nos dois lugares em que o host aprende que um monstro existe: o `creature-appeared` e o
   * `session-state` de quem reanexa (uma hunt retomada de snapshot nunca emitiu o primeiro).
   */
  #rememberRace(hosted: HostedSession, key: string, definition: Monster | undefined): void {
    const race = definition?.race;
    if (race === undefined || race === DEFAULT_MONSTER_RACE) hosted.raceBySubject.delete(key);
    else hosted.raceBySubject.set(key, race);
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
   *   creature-hit     → o número, e o efeito do golpe FÍSICO (`hits.byRace` pela raça do alvo,
   *                      `hits.melee` sem ela; #620) — de corpo a corpo OU de magia, e só quando
   *                      saiu vida: golpe absorvido inteiro mostra "0", como no Tibia, mas não
   *                      sangra, porque sangue é o que a armadura acabou de impedir;
   *   creature-healed  → o número em verde. O efeito da cura NÃO sai daqui: ele é do
   *                      lançamento (`spell-cast`) ou do uso (`supply-used`), que vêm antes —
   *                      senão uma cura que repôs zero não teria efeito e uma que repôs teria,
   *                      e a magia pareceria falhar quando o jogador estava cheio. A EXCEÇÃO é
   *                      `source: 'monster'` (#518, a defesa de cura própria): não há
   *                      lançamento prévio, e o `sim` só emite o evento quando REPÔS — como
   *                      `spell-cast`/`supply-used` sempre emitem, o efeito aqui é seguro do
   *                      mesmo jeito;
   *   spell-cast       → o projétil do conjurador ao PRIMEIRO alvo (é um projétil, não uma
   *                      rajada), e o efeito em CADA alvo — ou no próprio conjurador quando
   *                      não há alvo, que é a cura;
   *   supply-used      → o projétil do conjurador ao PRIMEIRO alvo (runa de ataque, #478), e o
   *                      efeito no tile de cada alvo/tile da forma — ou no usuário, na poção.
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
        // O elemento (#479) vai junto quando o `sim` o resolveu: é ele que colore o número no
        // cliente. Ausente, o cliente o lê do `kind` — a mesma degradação de sempre.
        messages.push({
          type: 'creature-hit', id, amount: event.amount, kind: event.source,
          ...(event.damageType === undefined ? {} : { damageType: event.damageType }),
        });
        // O efeito do golpe físico segue a RAÇA de quem o levou (#620, `combatGetTypeInfo` do
        // Canary): sangue, gota de veneno, "hit area" cinza… Só a apresentação lê a raça.
        // O gatilho é o ELEMENTO do golpe, e não a origem: `Game::sendEffects` roda em todo dano
        // com valor, de corpo a corpo, de magia ou de runa, e só `COMBAT_PHYSICALDAMAGE` cai no
        // `switch` da raça — o mesmo critério que colore o número no cliente (`isPhysicalHit`).
        const blood = appearances === undefined || event.amount <= 0
          || !isPhysicalHit(event.source, event.damageType)
          ? undefined
          : hitEffectOf(appearances.hits, hosted.raceBySubject.get(String(event.creatureId)));
        if (blood !== undefined) {
          messages.push({ type: 'effect', position: event.position, effectId: blood });
        }
        break;
      }
      case 'creature-healed': {
        const id = hosted.creatureIds.get(String(event.creatureId));
        if (id === undefined) return;
        messages.push({ type: 'creature-hit', id, amount: event.amount, kind: 'heal' });
        // A defesa de cura própria (#518) não tem lançamento prévio — o efeito sai AQUI, só
        // quando o evento existe (o `sim` já suprime a cura que repôs zero).
        const impactId = event.impactKey === undefined
          ? undefined
          : appearances?.abilities[event.impactKey]?.effect;
        if (impactId !== undefined) {
          messages.push({ type: 'effect', position: event.position, effectId: impactId });
        }
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
        const look = appearances?.supplies[event.supplyId];
        if (look === undefined) return;
        // Runa de ataque (#478): o projétil sai do conjurador ao PRIMEIRO alvo antes de a área
        // estourar — o mesmo desenho do `spell-cast`, e a ordem é contrato. Uma runa sem alvo
        // não chega aqui (o `sim` a recusa em `no-target`), e a poção não tem `missile`.
        const first = event.targets[0];
        if (look.missile !== undefined && first !== undefined) {
          messages.push({
            type: 'missile', from: event.position, to: first.position, missileId: look.missile,
          });
        }
        const effectId = look.effect;
        if (effectId === undefined) break;
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
      const stats = this.#statsOf(character);
      const last = hosted.sentStats.get(character.id);
      if (last !== undefined && sameStats(last, stats)) continue;
      hosted.sentStats.set(character.id, stats);
      this.#sendToViewersOf(hosted, character.id, { type: 'player-stats', ...stats });
    }
  }

  /**
   * O alvo selecionado, para quem olha CADA personagem, quando mudou (#470, RF-04).
   *
   * Substitui o `player-stats.targetId`: o alvo tem mensagem própria, e o gatilho é a
   * comparação do id ENTREGUE — como `sentStats`. Sem visualizador não se compara nada
   * (invariante 3); o `sim` muda o alvo de qualquer jeito, e quem anexa depois recebe o
   * estado no `session-attach`.
   *
   * É por aqui que a tela vê o auto-target (#444) trocar sozinho: o `sim` escolhe o próximo
   * monstro e o ciclo entrega a mudança, sem depender de um `select-target` do cliente.
   */
  #presentTarget(hosted: HostedSession): void {
    if (hosted.viewers.size === 0) return;
    for (const character of hosted.session.participants) {
      if (this.#watchers(hosted, character.id) === 0) continue;
      const targetId = this.#selectedTargetIdOf(hosted, character);
      const last = hosted.sentTarget.get(character.id);
      if (last !== undefined && last === targetId) continue;
      hosted.sentTarget.set(character.id, targetId);
      this.#sendToViewersOf(hosted, character.id, { type: 'target-changed', creatureId: targetId });
    }
  }

  /**
   * A saída pendente de cada personagem, para quem olha (#802): manda `exit-pending` quando a
   * assinatura (motivo, fase, prazo) muda, e `active: false` quando ela some — cancelada, ou
   * concluída sem que a sessão inteira acabe. Quando a sessão acaba o `session-ended` é o aviso,
   * e o cliente zera a espera com ele.
   *
   * SEM visualizador não se compara nada (invariante 3): a espera corre no `sim` de qualquer
   * jeito, e quem anexar depois recebe o estado no `session-attach`.
   */
  #presentExit(hosted: HostedSession): void {
    if (hosted.viewers.size === 0) return;
    const ruleset = hosted.session.ruleset as Partial<HuntRuleset>;
    if (ruleset.exitStatus === undefined) return;
    for (const character of hosted.session.participants) {
      if (this.#watchers(hosted, character.id) === 0) continue;
      const status = ruleset.exitStatus(hosted.session, character.id);
      const signature = status === null ? undefined : exitSignature(status);
      if (hosted.sentExit.get(character.id) === signature) continue;
      if (signature === undefined) hosted.sentExit.delete(character.id);
      else hosted.sentExit.set(character.id, signature);
      this.#sendToViewersOf(hosted, character.id, exitPendingMessage(status, hosted.session.nowMs));
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
        // Do que o PERSONAGEM pode ver (OW-13): no mundo cada evento de personagem tem dono, e o
        // analisador de um estranho não leva o que aconteceu a outro. Na instância é a fatia toda.
        notableEvents: hosted.session.notableEventsFor(character.id, since).map((event) => ({ ...event })),
        ...(party === undefined ? {} : { party }),
      };
      this.#sendToViewersOf(hosted, character.id, message);
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
   * O Bosstiary ao vivo (#629): os abates de boss e os pontos, para quem olha CADA personagem,
   * quando a soma dos abates mudou desde a última entrega — a MESMA regra de `#presentBestiary`
   * (por personagem, só com visualizador; sem ele o `sim` conta do mesmo jeito, invariante 3).
   */
  #presentBosstiary(hosted: HostedSession): void {
    if (hosted.viewers.size === 0) return;
    for (const character of hosted.session.participants) {
      if (this.#watchers(hosted, character.id) === 0) continue;
      const { kills, points } = character.bosstiary.getState();
      const total = bosstiaryTotal(kills);
      if (hosted.sentBosstiary.get(character.id) === total) continue;
      hosted.sentBosstiary.set(character.id, total);
      this.#sendToViewersOf(hosted, character.id, { type: 'bosstiary', kills, points });
    }
  }

  /**
   * As bênçãos ao vivo (#570, ADR 0052), pela MESMA regra do Bestiário: só quem está olhando,
   * só quando o bitmask mudou desde a última entrega. A compra (`#requestBuyBlessing`) já manda
   * direto a quem comprou; isto cobre quem só está OLHANDO — e o consumo na morte, que a hunt
   * decide sozinha sem chamar `#requestBuyBlessing`.
   */
  #presentBlessings(hosted: HostedSession): void {
    if (hosted.viewers.size === 0) return;
    for (const character of hosted.session.participants) {
      if (this.#watchers(hosted, character.id) === 0) continue;
      if (hosted.sentBlessings.get(character.id) === character.blessings) continue;
      hosted.sentBlessings.set(character.id, character.blessings);
      this.#sendToViewersOf(hosted, character.id, { type: 'blessings', mask: character.blessings });
    }
  }

  /**
   * O Hazard do personagem, se a hunt o mudou (#632): o teto sobe quando o chefe da zona morre no
   * nível máximo, e a tela precisa ver sem reconectar. Só a hunt muda o registro por conta própria
   * — a escolha da Cidade manda a mensagem na hora —, e a comparação é um inteiro (`revision`),
   * nunca o registro serializado. Sem visualizador não se compara nada (invariante 3).
   */
  #presentHazard(hosted: HostedSession): void {
    if (hosted.viewers.size === 0 || hosted.session.ruleset.type !== 'hunt') return;
    for (const character of hosted.session.participants) {
      if (this.#watchers(hosted, character.id) === 0) continue;
      const revision = character.hazard.revision;
      if (hosted.sentHazard.get(character.id) === revision) continue;
      hosted.sentHazard.set(character.id, revision);
      this.#sendToViewersOf(hosted, character.id, this.#hazardMessageFor(character));
    }
  }

  /**
   * O estado dos slots do conjunto ativo, para quem olha CADA personagem (AB-09, DT-06).
   *
   * O gatilho é o par `(state, reason)`, nunca o `remainingMs`: ele decresce sempre, e compará-lo
   * mandaria um `slot-state` por ciclo a 10 Hz — a banda inteira para dizer que um cooldown
   * andou. O cliente anima o prazo a partir do instante da entrega. Sem visualizador não se
   * compara nada (invariante 3); o `sim` já resolveu o estado de qualquer jeito.
   *
   * O cálculo é throttled a `SLOT_STATE_INTERVAL_MS` (#420): a assinatura evita o envio, mas
   * não a varredura de alvos que produz o estado.
   */
  #presentSlotState(hosted: HostedSession, nowMs: number): void {
    if (hosted.viewers.size === 0) return;
    if (nowMs - hosted.slotStateAtMs < SLOT_STATE_INTERVAL_MS) return;
    hosted.slotStateAtMs = nowMs;
    const ruleset = hosted.session.ruleset as Partial<HuntRuleset>;
    if (ruleset.slotStates === undefined) return;
    for (const character of hosted.session.participants) {
      if (this.#watchers(hosted, character.id) === 0) continue;
      const states = ruleset.slotStates(hosted.session, character);
      const signature = slotStateSignature(states);
      if (hosted.sentSlotState.get(character.id) === signature) continue;
      hosted.sentSlotState.set(character.id, signature);
      this.#sendToViewersOf(hosted, character.id, slotStateMessage(states));
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
    const stats = this.#statsOf(participant);
    hosted.sentStats.set(characterId, stats);
    viewer.send({ type: 'player-stats', ...stats });
    // E o alvo selecionado (#470): tem mensagem própria, e sem ela quem reanexa com um alvo
    // vivo o perderia até o próximo ciclo — na Cidade, que não tem ciclo, para sempre.
    const targetId = this.#selectedTargetIdOf(hosted, participant);
    hosted.sentTarget.set(characterId, targetId);
    viewer.send({ type: 'target-changed', creatureId: targetId });
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
    // E o Bosstiary (#629), pela mesma razão do Bestiário: sem isto, quem reconecta veria os
    // abates de boss zerados até o próximo — na Cidade, que não tem ciclo, para sempre.
    const bosstiary = participant?.bosstiary.getState() ?? { kills: {}, points: 0 };
    hosted.sentBosstiary.set(characterId, bosstiaryTotal(bosstiary.kills));
    viewer.send({ type: 'bosstiary', kills: bosstiary.kills, points: bosstiary.points });
    // E as bênçãos (#570, ADR 0052), pela mesma razão: quem reconecta precisa ver o que já
    // comprou, sem esperar a próxima compra/morte para descobrir.
    hosted.sentBlessings.set(characterId, participant?.blessings ?? 0);
    viewer.send({ type: 'blessings', mask: participant?.blessings ?? 0 });
    // E a economia de Charms (M39-02, #602), pela mesma razão do Bestiário: sem isto, quem
    // reconecta veria os Charms zerados até a próxima intenção aceita.
    if (participant !== undefined) viewer.send(this.#charmsMessageFor(participant));
    // E as magias aprendidas (#624, ADR 0058), pela mesma razão: sem isto, quem reconecta veria
    // toda a barra marcada como "não aprendida" até a próxima compra.
    if (participant !== undefined) viewer.send(this.#learnedSpellsMessageFor(participant));
    // E o Treino (#631, ADR 0059): o banco, a skill do livro e as exercise weapons com as cargas.
    // Sempre (`force`): quem reanexa PERDEU a tela, e comparar com o último entregue a deixaria
    // vazia. Host sem Treino não manda nada.
    if (participant !== undefined) this.#syncTraining(hosted, characterId, true);
    // E o Hazard (M44-14, #632), pela mesma razão: o seletor de nível da Cidade precisa do teto
    // que o personagem já desbloqueou, e quem reconecta não espera a próxima escolha para vê-lo.
    if (participant !== undefined) {
      hosted.sentHazard.set(characterId, participant.hazard.revision);
      viewer.send(this.#hazardMessageFor(participant));
    }
    // E o estado dos slots (AB-09): a barra do conjunto ativo precisa dele ao montar, e a
    // Cidade não tem ciclo para o mandar depois. Ruleset sem slots (a Cidade) não manda nada.
    const slotStates = participant === undefined
      ? undefined
      : (hosted.session.ruleset as Partial<HuntRuleset>).slotStates?.(hosted.session, participant);
    if (slotStates !== undefined) {
      hosted.sentSlotState.set(characterId, slotStateSignature(slotStates));
      viewer.send(slotStateMessage(slotStates));
    }
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
    // A saída pendente (#802) sobrevive à desconexão, como o Follow: quem reconecta no meio da
    // espera precisa vê-la e poder desistir. Só quando há uma — o attach comum não paga nada.
    const exit = (hosted.session.ruleset as Partial<HuntRuleset>).exitStatus?.(hosted.session, characterId);
    if (exit === undefined || exit === null) {
      hosted.sentExit.delete(characterId);
    } else {
      hosted.sentExit.set(characterId, exitSignature(exit));
      viewer.send(exitPendingMessage(exit, hosted.session.nowMs));
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
   * O resultado de um Find Person (#623) como `system-message` só para quem lançou. A frase é
   * daqui — o `sim` entrega dado (`FindRelation`) —, com o nome que o `sim` não guarda. Sem o
   * nome (o personagem saiu entre o lançamento e o ciclo), diz "Alguém": a mensagem continua
   * verdadeira sobre a direção.
   */
  #presentFindResult(hosted: HostedSession, event: FindResult): void {
    const name = event.subjectId === undefined
      ? 'Alguém' : this.#nameByCharacter.get(event.subjectId) ?? 'Alguém';
    this.#sendToViewersOf(hosted, event.characterId, {
      type: 'system-message', level: 'info', text: findPersonText(name, event.relation),
    });
  }

  /**
   * O `use-item`/`use-item-on` adiado (#726, ADR 0049 decisão 6) terminou de executar e não
   * coube — a SEGUNDA resposta, depois do `ok: true` que aceitou o clique. `reason` chega em
   * palavras (FUN-73), como toda recusa tipada do `sim`.
   */
  #presentManualActionResult(hosted: HostedSession, event: ManualActionResult): void {
    this.#sendToViewersOf(hosted, event.characterId, {
      type: 'use-result', seq: event.seq, ok: false,
      reason: USE_ITEM_REFUSAL[event.reason as UseItemRefusal] ?? event.reason,
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
      case 'manual-action-result':
        // POR PERSONAGEM (#726), pela mesma razão do `follow-state` acima: `#presentMoves` já
        // chamou `#presentManualActionResult` antes de chegar aqui.
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
    // Um objeto só para a sessão inteira: o cache de codificação do flush o serializa uma vez.
    const message: S2CMessage = { type: 'party-state', ...party };
    for (const viewer of hosted.viewers) viewer.send(message);
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

  /**
   * Esta sessão tem campo de visão por célula? Só a que `usesAreaOfInterest` (o shard), e só com
   * a opção ligada (FUN-33).
   */
  #interestManaged(session: Session): boolean {
    return usesAreaOfInterest(session.ruleset) && this.#options.areaOfInterest !== false;
  }

  /** Manda para todos os visualizadores de UM personagem. Abas contam separado. */
  #sendToViewersOf(hosted: HostedSession, characterId: string, message: S2CMessage): void {
    // Pelo índice (OW-22): o custo é o número de abas DELE, e não o de visualizadores da sessão —
    // numa praça de trezentos, o passo de um jogador era `vizinhos × visualizadores` comparações.
    for (const viewer of hosted.viewers.of(characterId)) viewer.send(message);
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
    // O `creature-appear` de quem se moveu é UM objeto para todos que passaram a vê-lo: o cache de
    // codificação do flush o serializa uma vez (OW-22), e na hora do login numa praça cheia é o
    // anúncio que mais se repete. Montado ANTES do laço e só se alguém o vê, o que mantém a ordem
    // em que os ids de criatura são atribuídos (`#creatureId`): o dele primeiro, e depois o de
    // cada um que apareceu, como quando era montado a cada volta.
    if (change.appeared.length > 0) {
      const own = this.#appearance(hosted, subject);
      for (const other of change.appeared) {
        this.#sendToViewersOf(hosted, other, own);
        this.#sendToViewersOf(hosted, subject, this.#appearance(hosted, other));
      }
    }
    // Idem para o sumiço de quem se moveu: um objeto só para todos que deixaram de vê-lo (OW-22),
    // e quem sai da praça cheia é o `leave`, que devolve a vizinhança inteira em `vanished`.
    const gone = hosted.creatureIds.get(subject);
    const goneMessage: S2CMessage | undefined = gone === undefined
      ? undefined
      : { type: 'creature-disappear', id: gone };
    for (const other of change.vanished) {
      // O id numérico NÃO é reciclado aqui: sumir de vista não é sair da sessão, e um id novo
      // no reaparecimento deixaria o sprite antigo parado para sempre na tela do cliente.
      const theirs = hosted.creatureIds.get(other);
      if (goneMessage !== undefined) this.#sendToViewersOf(hosted, other, goneMessage);
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
      name: this.#nameByCharacter.get(characterId) ?? characterId,
      health: character?.health ?? 0,
      maxHealth: character?.maxHealth ?? 0,
      // A aparência de AGORA (#621): quem entra na tela no meio de uma ilusão a vê já vestida.
      ...this.#lookFor(hosted, characterId),
    };
  }

  /**
   * A aparência de uma aparência emprestada (#621, M44-03) em id de pacote — a MESMA indireção de
   * `creature-appear` (invariante 6): o `sim` diz QUEM (monstro, item, chave de objeto), e a tabela
   * diz o id. `object` separa o registro (`lookTypeEx`: a criatura virou uma coisa). `null` é
   * aparência sem linha na tabela — MUDA, como o campo sem arte.
   */
  #resolveLook(look: OutfitLook): {
    readonly appearanceId: number;
    readonly object: boolean;
    readonly colors?: OutfitColors;
    readonly addons?: number;
  } | null {
    if ('monsterId' in look) {
      const definition = this.#options.monsterCatalog?.get(look.monsterId);
      // O outfit de monstro leva as cores e os addons dele (#620): são parte do `Outfit_t` que a
      // condição troca por inteiro, e sem eles o cliente pintaria o outfit emprestado com as cores
      // do dono — ou com as de personagem novo.
      return definition === undefined
        ? null
        : { appearanceId: definition.outfitId, object: false, ...monsterOutfitOf(definition) };
    }
    const objectId = 'itemId' in look
      ? this.#options.itemCatalog?.get(look.itemId)?.appearanceId
      : this.#options.appearances?.looks[look.objectKey];
    return objectId === undefined ? null : { appearanceId: objectId, object: true };
  }

  /**
   * A aparência que a criatura `key` (o `subject` do `sim`) mostra AGORA, nos campos do fio
   * (`appearanceId`, `object`, `colors`, `addons`): a emprestada, se há uma e ela tem arte; senão a
   * PRÓPRIA — o outfit do monstro, com as cores e os addons dele, ou o do personagem com as cores
   * do ticket. É o que `creature-appear`,
   * `session-state` e `creature-update` compartilham, para o reanexado ver o mesmo que quem nunca
   * saiu (invariante 3: o estado mora na condição do `sim`, nunca num campo daqui).
   */
  #lookFor(
    hosted: HostedSession, key: string,
  ): { appearanceId: number; object?: true; colors?: OutfitColors; addons?: number } {
    const ruleset = hosted.session.ruleset as Partial<HuntRuleset>;
    const worn = ruleset.lookOf?.(hosted.session, key) ?? null;
    const borrowed = worn === null ? null : this.#resolveLook(worn);
    if (borrowed !== null) {
      if (borrowed.object) return { appearanceId: borrowed.appearanceId, object: true };
      return {
        appearanceId: borrowed.appearanceId,
        ...(borrowed.colors === undefined ? {} : { colors: borrowed.colors }),
        ...(borrowed.addons === undefined ? {} : { addons: borrowed.addons }),
      };
    }
    if (key.startsWith('m:')) {
      const monster = ruleset.monsters?.find((candidate) => candidate.subject === key);
      const definition = monster === undefined ? undefined : this.#options.monsterCatalog?.get(monster.monsterId);
      // O outfit PRÓPRIO do monstro — com as cores e os addons (#620): quando a condição acaba, o
      // `creature-update` os devolve junto do `appearanceId`, e o cliente nunca guarda os "originais".
      return { appearanceId: definition?.outfitId ?? 0, ...monsterOutfitOf(definition) };
    }
    return { appearanceId: this.#options.playerOutfitId ?? 0, ...this.#colorsOf(key) };
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
    const receipts = hosted.session.receipts();
    // Todos marcados ANTES do primeiro `await`: o segundo participante só entra em `#settleOne`
    // depois de o primeiro terminar, e o clique dele nesse intervalo não pode passar por
    // "parada" (#802, `#settling`).
    for (const receipt of receipts) this.#settling.add(receipt.characterId);
    for (const receipt of receipts) {
      if (!this.#charactersOf(hosted.session.id).includes(receipt.characterId)) {
        this.#settling.delete(receipt.characterId);
        continue;
      }
      await this.#settleOne(hosted, receipt.characterId, receipt);
    }
  }

  /** As saídas enfileiradas por `member-left` (#194), fora do ciclo. */
  async #settleDepartures(hosted: HostedSession): Promise<void> {
    // A fila inteira é marcada de uma vez, pelo mesmo motivo do `#succeed`.
    for (const left of hosted.departures) this.#settling.add(left.characterId);
    while (hosted.departures.length > 0) {
      const left = hosted.departures.shift() as MemberLeft;
      // Quem saiu não faz mais parte da sessão: o id numérico dele é liberado aqui, como o
      // `leave-hunt` fazia antes de passar pelo ruleset (#802) — nenhum evento posterior o cita.
      this.#announceDeparture(hosted, left.characterId);
      await this.#settleOne(hosted, left.characterId, left.departure.receipt, left.departure.character);
    }
  }

  async #settleOne(
    hosted: HostedSession, characterId: string, receipt: Receipt, departed?: CharacterRuntime,
  ): Promise<void> {
    this.#settling.add(characterId);
    try {
      await this.#saveReceipt(characterId, hosted, receipt, departed);
      for (const viewer of hosted.viewers.of(characterId)) {
        viewer.send({
          type: 'session-ended',
          reason: receipt.reason,
          aggregates: receipt.aggregates,
          notableEvents: receipt.notableEvents.map((event) => ({ ...event })),
        });
      }

      // Toda sessão que acaba sozinha devolve o personagem à Cidade (§6): "a hunt acabou"
      // nunca pode significar "ficou sem sessão" (invariante 8).
      const next = this.#options.buildSession?.({ to: 'city' }, hosted.session, characterId, departed)
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
    } finally {
      this.#settling.delete(characterId);
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

    // Sair de um SHARD não encerra nada (FUN-71, ADR 0023): a praça fica de pé com quem ficou.
    // Encerrar aqui mandaria um extrato de Cidade — zerado — para todo mundo que estivesse lá
    // dentro. E a Cidade não credita nada (§37): o que ela gera é ESTADO.
    //
    // O que a praça MUDOU, porém, é gravado antes de o personagem sair para uma sessão privada
    // (#631): `#leaveForParty` já fazia o mesmo para a party, e sem isto a exercise weapon comprada
    // aqui — uma instância NOVA, com o prefixo da sessão da praça — nunca chegaria ao banco, porque
    // o extrato do Treino só leva o `acquired` que nasceu NELE; e o gold gasto sumiria junto, já que
    // o `goldDelta` da praça não entra nos agregados da sessão de destino.
    //
    // O shard que credita (o mundo) sai pelo `leave` que EMITE o extrato de delta, e o grava aqui,
    // antes de o diretório trocar — como a sessão privada logo abaixo. O `leave` do `#replace`
    // fica sem o que fazer: quem já saiu não é participante.
    if (leavesOnExit(hosted.session.ruleset)) {
      if (creditsAggregates(hosted.session.ruleset)) {
        await this.#leaveWithReceipt(characterId, hosted, 'manual-exit');
      } else if (hosted.dirty.has(characterId)) {
        await this.#saveDurableReceipt(characterId, hosted, 'manual-exit');
      }
    } else {
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
        for (const viewer of hosted.viewers.of(characterId)) {
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
    const following = [...hosted.viewers.of(characterId)];
    for (const viewer of following) {
      hosted.viewers.delete(viewer);
      hosted.session.detach(viewer.id);
    }

    // Sai da anterior. Num shard isso é `leave` — o extrato que ele emite é descartado: a Cidade
    // não credita (o estado já saiu em `#runTransition`) e o mundo já gravou o dele lá, e quem já
    // saiu não é participante (`leave` devolve `null`). Numa sessão privada ela já foi encerrada
    // por quem chamou, e some daqui inteira.
    if (leavesOnExit(hosted.session.ruleset)) {
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
      session: next, viewers: new ViewerSet(), creatureIds: new Map(), raceBySubject: new Map(), nextCreatureId: 1,
      aoi: this.#interestManaged(next) ? new AreaOfInterest() : null,
      lastAdvancedAtMs: this.#now(),
      credited: new Set(),
      receiptSaves: new Map(),
      exitSaves: new Map(),
      departures: [],
      dirty: new Set(),
      sentItemsLooted: next.aggregates.itemsLooted,
      sentStats: new Map(),
      sentTarget: new Map(),
      lastTargetSeq: new Map(),
      sentAnalyzer: new Map(),
      sentBestiary: new Map(),
      sentBosstiary: new Map(),
      sentBlessings: new Map(),
      sentTraining: new Map(),
      sentHazard: new Map(),
      sentTileOverrides: new Map(),
      sentParty: null,
      lastPartyBag: null,
      sentConditions: new Map(),
      sentExit: new Map(),
      sentSlotState: new Map(),
      slotStateAtMs: 0,
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
    // Shard não tem snapshot (`keepsSnapshot`, ADR 0023): não há progresso a guardar, e o que ele
    // guardaria seria a praça inteira, uma cópia por participante. Mas o snapshot da sessão
    // ANTERIOR precisa sumir — ele é apagado, não simplesmente não reescrito.
    //
    // Não fazer as duas coisas é o defeito silencioso: quem morre volta para a praça, o
    // snapshot da hunt encerrada fica em pé no Redis, e a próxima conexão RETOMA a hunt que
    // já foi creditada. Antes desta issue o `save` da Cidade cobria essa linha por acidente.
    const snapshots = this.#options.snapshots;
    if (snapshots !== undefined && accountId !== undefined) {
      await (keepsSnapshot(next.ruleset)
        ? snapshots.save(characterId, accountId, this.#options.nodeId, next.snapshot())
        : snapshots.remove(characterId));
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
        this.#logger.error({ err: error, characterId }, 'Failed to collect a resting character');
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
    for (const viewer of [...hosted.viewers.of(characterId)]) {
      if (closeCode !== undefined) viewer.close(closeCode, closeReason ?? '');
      hosted.viewers.delete(viewer);
      hosted.session.detach(viewer.id);
    }
  }

  /** Quantos visualizadores estão olhando ESTE personagem. Abas contam separado. */
  #watchers(hosted: HostedSession, characterId: string): number {
    return hosted.viewers.countOf(characterId);
  }

  /**
   * Manda o acumulado e derruba quem não está drenando.
   *
   * **Serializar uma vez** (OW-22): a mesma mensagem entregue a vários visualizadores é codificada
   * uma vez por ciclo, pelo `EncodeCache`. Só onde há mais de um visualizador — a hunt de um dono e
   * uma aba só (as 5.000 instâncias frias) não tem com quem dividir o frame, e pagaria uma
   * inserção no mapa por mensagem para nada. O cache é esvaziado a cada sessão: mensagem é objeto
   * da sessão, e nenhum frame sobrevive ao flush que o produziu.
   */
  flush(): void {
    for (const hosted of this.#sessions.values()) {
      const cache = this.#options.encodeOnce === false
        ? this.#encodeEach
        : hosted.viewers.size > 1 ? this.#encodeCache : undefined;
      try {
        for (const viewer of hosted.viewers) {
          viewer.flush(cache);
          if (!viewer.dead) continue;
          this.#logger.warn(
            { characterId: viewer.characterId },
            'Dropping viewer that stopped draining',
          );
          viewer.close(1013, 'backpressure');
          this.detach(viewer);
        }
      } finally {
        // Mesmo que um `send` lance (socket que o uWS já fechou): um frame velho no cache seria
        // mandado no ciclo seguinte no lugar do conteúdo de então.
        cache?.clear();
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
        // Shard não encerra por personagem (FUN-71, ADR 0023): chamar `end` uma vez por
        // participante mandaria o mesmo extrato zerado para duzentas pessoas. Sair basta, e
        // `release` faz isso logo abaixo. A Cidade não credita (§37) e só grava o estado; o
        // mundo, que credita, sai por extrato de delta aqui mesmo, e o `release` acha o
        // personagem já fora.
        if (leavesOnExit(hosted.session.ruleset)) {
          if (creditsAggregates(hosted.session.ruleset)) {
            await this.#leaveWithReceipt(characterId, hosted, reason);
          } else {
            await this.#saveDurableReceipt(characterId, hosted, reason);
          }
        } else {
          hosted.session.end(reason);
          const receipt = receiptOf(hosted, characterId);
          if (receipt === null) throw new Error(`no receipt for ${characterId} in ${sessionId}`);
          await this.#saveReceipt(characterId, hosted, receipt);
          for (const viewer of hosted.viewers.of(characterId)) {
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
        this.#logger.error({ err: error, characterId, sessionId }, 'Failed to drain a session');
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
    // A sessão que SAI POR PERSONAGEM e credita (o mundo) emite um extrato por saída, e o
    // personagem pode voltar à mesma sessão e sair de novo: nenhum extrato dela é "o" extrato do
    // personagem, e por isso nem `credited` (uma marca por sessão e personagem) nem o voo
    // pendente (que devolveria o de OUTRO extrato) servem aqui. Cada um leva o `seq` que o `sim`
    // lhe deu, e o ledger recusa só o MESMO `(session_id, seq)` — retry continua seguro.
    //
    // O voo fica registrado em `exitSaves`: quem sair do mesmo personagem enquanto este extrato
    // ainda não pousou acha o personagem fora e não tem extrato próprio a gravar, e tem de esperar
    // este antes de soltar o que é dele — a drenagem não pode contar uma saída que ainda não gravou.
    if (leavesOnExit(hosted.session.ruleset)) {
      const saving = this.#persistReceipt(characterId, hosted, receipt, receipts, accountId, departed);
      const inFlight = hosted.exitSaves.get(characterId) ?? new Set<Promise<void>>();
      inFlight.add(saving);
      hosted.exitSaves.set(characterId, inFlight);
      try {
        await saving;
      } finally {
        // Também na falha: quem espera recebe o mesmo desfecho, e a vaga não pode vazar.
        inFlight.delete(saving);
        if (inFlight.size === 0 && hosted.exitSaves.get(characterId) === inFlight) {
          hosted.exitSaves.delete(characterId);
        }
      }
      return;
    }
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
    // A stamina não anda no Treino (ADR 0060 d.14c): o marco que o extrato leva tem de estar no
    // instante em que o Treino ACABOU, e não no da entrada — senão o tempo treinado volta como
    // recuperação no próximo ticket. É AQUI, e não só na fronteira do construtor (`holdStamina` em
    // `game/sessions.ts`), porque o extrato é lido ANTES de o construtor rodar quando a sessão acaba
    // sozinha (arma esgotada, `#settleOne`), e porque o logout, a drenagem e o crash nunca passam por
    // ele. Idempotente: o marco só anda para a frente.
    if (owner !== undefined && hosted.session.ruleset.type === 'training') {
      holdStamina(owner, this.#wallNow());
    }
    await receipts.save({
      sessionId: receipt.sessionId,
      characterId,
      accountId,
      reason: receipt.reason,
      seq: receipt.seq,
      aggregates: receipt.aggregates,
      notableEvents: receipt.notableEvents,
      // As instâncias vendidas/descartadas nesta hunt (#724, ADR 0048 d.8): o `jobs` as apaga
      // na MESMA transação da linha de ledger. Drenado por `#receiptFor` (invariante 9/10).
      ...(receipt.removedInstances.length === 0 ? {} : { removedInstances: receipt.removedInstances }),
      ...(owner?.staminaMs === undefined || owner.staminaMs === null
        ? {}
        : { staminaMs: owner.staminaMs, staminaUpdatedAtMs: owner.staminaUpdatedAtMs }),
      // As skills do dono também (FUN-75). Sem elas, o que ele praticou na hunt nunca chegaria
      // ao banco — e a hunt seguinte começaria do zero de novo, sem nada explicando.
      ...(owner === undefined ? {} : { skills: owner.skills.getState() }),
      // E o Bestiário (FUN-113), pela mesma razão: abate que não chega ao banco é abate que
      // some no próximo logout, e o marco 10 000 nunca chegaria.
      ...(owner === undefined ? {} : { bestiary: owner.bestiary.getState() }),
      // E o Bosstiary (#629, ADR 0052 d.1), pela mesma razão: abate de boss que não chega ao
      // banco é abate que some no próximo logout, e o nível 3 nunca fecharia.
      ...(owner === undefined ? {} : { bosstiary: owner.bosstiary.getState() }),
      // E a economia de Charms (M39-02, #602, ADR 0052 d.1): ABSOLUTA como `ammo` — sem ela
      // aqui, um `charm-unlock`/`charm-assign` aceito na Cidade sumiria a cada logout.
      ...(owner === undefined ? {} : { charms: owner.charms.getState() }),
      // E as magias aprendidas (#624, ADR 0058 d.1, ADR 0052 d.1): ABSOLUTAS como `charms`, e a
      // hunt também as leva porque `learn-spell` é aceito nela — sem o campo aqui, uma magia
      // comprada no meio da hunt sumiria no fim dela, e o gold gasto não. SÓ quando o registro é
      // a verdade do personagem (`recorded`): uma sessão retomada de um snapshot anterior à issue
      // não sabe o que ele aprendeu, e gravar o vazio apagaria a concessão da migração 0024.
      ...(owner === undefined || !owner.learnedSpells.recorded
        ? {} : { learnedSpells: owner.learnedSpells.getState() }),
      // O familiar (M38-02, #599, ADR 0057 d.3): ABSOLUTO como `charms`, e omitido quando vazio —
      // o personagem que nunca invocou não escreve a coluna. Sem isto o cooldown de 30 min não
      // sobreviveria à saída da hunt: o ticket seguinte o leria como nunca lançado.
      ...(owner === undefined || isEmptyFamiliarState(owner.familiar) ? {} : { familiar: owner.familiar }),
      // E o registro do Treino (#631, ADR 0059 d.3): ABSOLUTO como `charms` — o banco que a sessão
      // acabou de encher (`onEnd` de hunt e de treino) e a skill do livro.
      ...(owner === undefined ? {} : { training: owner.training.getState() }),
      // E o Hazard (M44-14, #632, ADR 0052 d.1): o nível escolhido e o teto, ABSOLUTOS como os
      // Charms. Só quando há o que guardar — quem nunca tocou no hazard não escreve a coluna.
      ...(owner === undefined || owner.hazard.isEmpty ? {} : { hazard: owner.hazard.getState() }),
      // E a munição escolhida (#152): preferência do jogador, que voltaria à grátis a cada
      // login se ficasse só na sessão.
      ...(owner === undefined || owner.ammo.size === 0 ? {} : { ammo: Object.fromEntries(owner.ammo) }),
      // E o estoque de supply/munição do loot (#520): sem isto, uma Strong Health Potion caída
      // do Dragon sumiria a cada logout, mesmo sem ser gasta. Ao contrário de `ammo`/`skills`/
      // `bestiary` (só crescem), este estoque É consumido dentro da sessão — drenar as 3 últimas
      // poções até zero é um resultado real, não "nunca teve estoque". Por isso NÃO se olha
      // `.size === 0` aqui: gatear por tamanho omitiria a chave do extrato quando a sessão zera o
      // Map, o `ledger` interpretaria a ausência como "não mexe na coluna", e as 3 poções do
      // Postgres ressuscitariam no próximo login (achado [blocker] da revisão da #536) — inclui
      // sempre que o personagem participou, e um `{}` vazio É o valor correto para "drenado".
      ...(owner === undefined ? {} : { supplyStock: Object.fromEntries(owner.supplyStock) }),
      ...(owner === undefined ? {} : { ammunitionStock: Object.fromEntries(owner.ammunitionStock) }),
      // E os storages (#731, ADR 0050 d.6 T2): a semente do motor de quest. Pela MESMA razão do
      // supplyStock — não é monotônico como Bestiário/skills (um script de quest pode voltar um
      // storage a -1) —, NÃO se olha `.size === 0`: um storage apagado NESTA sessão é resultado
      // real, e omitir a chave deixaria o valor antigo do Postgres ressuscitar no próximo login.
      ...(owner === undefined ? {} : { storages: Object.fromEntries(owner.storages) }),
      // Comida ativa (#726, ADR 0049 decisão 5): mesma regra do estoque acima — DRENA dentro da
      // sessão, e `fedMs` zerado é um resultado real, não "nunca comeu"; sempre incluído quando
      // o personagem participou.
      ...(owner === undefined ? {} : { fedMs: owner.fedMs }),
      // As bênçãos (#570, ADR 0052): mesma regra do `fedMs` acima — sempre incluído quando o
      // personagem participou, nunca gatead por `=== 0` (a morte zera dentro da MESMA sessão,
      // e omitir a chave faria a bênção antiga do Postgres ressuscitar no próximo login).
      ...(owner === undefined ? {} : { blessings: owner.blessings }),
      // E a postura de luta (#550, M30-03): ABSOLUTA e última-escrita-vence, sempre incluída quando
      // o personagem participou — nunca gateada pelo default: voltar à ofensiva NESTA sessão é uma
      // escolha real, e omitir a chave deixaria a postura antiga do Postgres ressuscitar no login.
      ...(owner === undefined ? {} : { fightMode: owner.fightMode }),
      // E a vocação (#154): escrita UMA vez pelo `jobs`, nunca daqui (ADR 0026 decisão 1).
      ...(owner?.vocationId === undefined || owner.vocationId === null ? {} : { vocation: owner.vocationId }),
      // E os pontos de alma (#593): ABSOLUTO, última-escrita-vence — nunca fundido por máximo,
      // porque alma DESCE (gasta na conjuração). Sempre que a sessão teve dono, mesmo sem
      // vocação: `0` é o valor de verdade de quem não escolheu, não "sem informação".
      ...(owner === undefined ? {} : { soul: owner.soul }),
      // E a promoção (#566, ADR 0042 decisão 1): só pode ter sido obtida na Cidade, antes desta
      // hunt começar — repetir `true` aqui é redundante com o que já está no banco, mas mantém
      // o mesmo caminho que qualquer outro campo absoluto do extrato usa.
      ...(owner?.promoted ? { promoted: true } : {}),
      // E o que ele está vestindo (FUN-82). Item não muda de dono dentro da hunt; o que muda é
      // onde ele está, e é só isso que precisa atravessar.
      ...(owner === undefined ? {} : { equipment: equipmentOf(owner) }),
      // E onde cada item está dentro dos containers (#160).
      ...(owner === undefined ? {} : { layout: layoutOfState(owner.inventory.getState()) }),
      // E o estado por instância (#604, ADR 0046): o imbuement aplicado ou vencido na sessão.
      ...(owner === undefined ? {} : { overlays: overlaysOfState(owner.inventory.getState()) }),
      // O que caiu nesta sessão (FUN-88): o que coube vira linha de `item_instance`. O que não
      // coube por capacidade fica no cadáver do monstro (ADR 0048) — a Caixa de Loot saiu, e com
      // ela o campo `lootBox` do extrato: o grant de vocação/kit e a liquidação de bolsa
      // (`chooseVocation`, `#grantKitPiece`, `#settle`, em `sim`) usam `forceAdd` e o item
      // sempre entra na mochila — não sobra nada para carregar aqui.
      ...(owner === undefined ? {} : { acquired: acquiredBy(owner, receipt.sessionId) }),
    });

    // O extrato agora é durável no Redis e será a fonte que o ledger aplica no Postgres.
    // Enquanto ele está pendente, a Cidade continua com o MESMO `CharacterRuntime` da hunt;
    // deixar o delta nele faz o ticket que acabou de liquidar o ledger reencontrar uma base
    // antiga mais uma variação que já entrou no banco. Incorporar o delta à base aqui conserva o
    // saldo disponível e deixa a próxima sessão começar do mesmo número que a linha durável.
    if (owner !== undefined && owner.goldDelta !== 0) {
      owner.settleGoldDelta();
    }
  }

  /**
   * Tira `characterId` de uma sessão que SAI POR PERSONAGEM (`leavesOnExit`) e grava o que ele
   * rendeu, pelo canal de gold que a sessão tem (ADR 0060 d.10c). Quem chama anuncia a saída.
   *
   * - **sem `creditsAggregates`** (a Cidade): o extrato de ESTADO sai ANTES do `leave` — ele lê o
   *   dono em `participants` —, com o `goldDelta` como agregado. O extrato de agregados que o
   *   `leave` emite é descartado: está zerado, e o agregado da Cidade é cumulativo.
   * - **com ele** (o mundo): `leave` emite o extrato de DELTA — só o que o personagem rendeu
   *   desde o último checkpoint —, e o hospedeiro o grava (`#leaveWithReceipt`).
   */
  async #departFromSharedSession(characterId: string, hosted: HostedSession, reason: EndReason): Promise<void> {
    if (creditsAggregates(hosted.session.ruleset)) {
      await this.#leaveWithReceipt(characterId, hosted, reason);
      return;
    }
    await this.#saveDurableReceipt(characterId, hosted, reason);
    hosted.session.leave(characterId);
  }

  /**
   * `leave` + o extrato de delta que ele emite, gravado (ADR 0060 d.10c) — o ramo da sessão que
   * sai por personagem E credita por agregado. Quem já saiu não é participante: `leave` devolve
   * `null` e não há extrato a gravar, o que torna a saída idempotente (a drenagem sai por aqui
   * e o `release` que vem logo depois encontra o personagem já fora). Idempotente, mas não
   * apressada: se a saída que tirou o personagem ainda está gravando o extrato, esta espera por ele
   * (`#awaitExitSaves`) — senão a drenagem contaria, e o `release` soltaria, o que ainda não pousou.
   *
   * Grava o dono que `leave` devolveu (`departed`): ele já não está em `participants`, como o
   * membro de uma party que sai por dentro do `sim` (#194). O `goldDelta` dele é liquidado por
   * `#persistReceipt` depois de gravar — o canal único de gold.
   */
  async #leaveWithReceipt(characterId: string, hosted: HostedSession, reason: EndReason): Promise<void> {
    const departure = hosted.session.leave(characterId, reason);
    if (departure === null) {
      await this.#awaitExitSaves(hosted, characterId);
      return;
    }
    // O que estava pendente de estado vai INTEIRO neste extrato (`#persistReceipt` leva todos os
    // campos absolutos): não sobra marca de `dirty` para um extrato de estado que ninguém grava.
    hosted.dirty.delete(characterId);
    await this.#saveReceipt(characterId, hosted, departure.receipt, departure.character);
  }

  /**
   * Espera os extratos de saída de `characterId` que ainda estão gravando (`exitSaves`) — o que o
   * `#saveReceipt` da sessão privada faz devolvendo o voo de `receiptSaves`. A falha também chega
   * a quem espera: soltar o personagem (diretório, slot, snapshot) depois de um extrato que não
   * pousou perderia o que ele rendeu, e é o mesmo contrato do `release` concorrente (#267).
   */
  async #awaitExitSaves(hosted: HostedSession, characterId: string): Promise<void> {
    const inFlight = hosted.exitSaves.get(characterId);
    if (inFlight === undefined) return;
    await Promise.all([...inFlight]);
  }

  /**
   * O canal ÚNICO de gold da sessão (ADR 0060 d.10c, OW-04). Todo gold que um serviço move fora
   * do loot — vender, aprender magia, remover Charm, bênção, promoção, compra — JÁ passou por
   * `goldDelta`; aqui ele passa, ou não, pelo AGREGADO:
   *
   * - sessão que `creditsAggregates` (a hunt, o mundo): o agregado se move junto — `goldGained`
   *   no ganho, `goldSpent` no gasto — e o extrato o leva. O `goldDelta` é liquidado depois de
   *   gravar (`#persistReceipt`, `settleGoldDelta`);
   * - sessão que não credita (a Cidade): nada aqui. O `goldDelta` vai como agregado do extrato de
   *   estado (`#saveDurableReceipt`).
   *
   * **Nunca as duas coisas.** Um valor que andasse pelo agregado E fosse lido do `goldDelta` como
   * agregado seria creditado duas vezes — e retry não impediria, porque cada extrato tem o seu
   * `seq` (`#saveDurableReceipt` recusa a sessão que credita por isso).
   *
   * `delta` tem o sinal do `goldDelta`: positivo ganha, negativo gasta; zero não faz nada.
   */
  #mirrorGold(hosted: HostedSession, characterId: string, delta: number): void {
    if (delta === 0 || !creditsAggregates(hosted.session.ruleset)) return;
    hosted.session.credit(characterId, delta > 0 ? 'goldGained' : 'goldSpent', Math.abs(delta));
  }

  /**
   * O extrato de ESTADO DURÁVEL de um shard que NÃO credita (#154) — a Cidade.
   *
   * O shard não credita progresso (ADR 0023) — mas guarda estado: vocação, equipamento, arma
   * de vocação e munição equipada mudam na praça e, sem isto, sumiam no logout (o `equip` da
   * FUN-82 e o `move-item` da AB-05 já caíam nesse buraco). Só para quem mexeu em algo (`dirty`).
   * Agregados zerados: a linha de ledger que o `jobs` insere é a chave de idempotência
   * (`UNIQUE (session_id, seq)`), não um crédito. `seq` avança na cópia compartilhada, e
   * cada extrato tem o seu.
   *
   * É o canal "sem agregado" do gold (`#mirrorGold`): o `goldDelta` entra aqui como agregado. Por
   * isso uma sessão que `creditsAggregates` NUNCA passa por aqui — o mesmo gold já estaria no
   * agregado dela, e seria creditado duas vezes. É erro de programação, e falha em voz alta.
   */
  async #saveDurableReceipt(characterId: string, hosted: HostedSession, reason: EndReason): Promise<void> {
    if (creditsAggregates(hosted.session.ruleset)) {
      throw new Error(
        `session ${hosted.session.id} credits by aggregate: its gold must not also leave as goldDelta`,
      );
    }
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
      // A Cidade não credita progresso (ADR 0023) — mas #724/ADR 0048 d.8 abriu a primeira
      // exceção: vender na praça move gold pelo MESMO ledger que a hunt usa. `goldDelta` é o
      // delta AINDA NÃO liquidado (zero em todo extrato que só mexeu em vocação/equipamento,
      // como sempre) — nunca `session.aggregatesOf`, que é cumulativo entre vários extratos
      // deste shard e re-creditaria a mesma venda no próximo logout.
      aggregates: owner.goldDelta === 0 ? EMPTY_AGGREGATES : {
        ...EMPTY_AGGREGATES,
        goldGained: Math.max(owner.goldDelta, 0),
        goldSpent: Math.max(-owner.goldDelta, 0),
      },
      notableEvents: [],
      ...(owner.vocationId === null ? {} : { vocation: owner.vocationId }),
      // A promoção (#566, ADR 0042 decisão 1): AUSENTE/`false` nunca é gravado — `promoted` só
      // sobe no ledger (`characters.promoted OR receipt.promoted`), nunca desce.
      ...(owner.promoted ? { promoted: true } : {}),
      ...(owner.ammo.size === 0 ? {} : { ammo: Object.fromEntries(owner.ammo) }),
      // A economia de Charms (M39-02, #602, ADR 0052 d.1): a Cidade marca `dirty` como o
      // equipamento — sem isto, um `charm-unlock`/`charm-assign`/`charm-remove` feito na praça
      // sumiria no logout, porque a Cidade não gera `Receipt` de progresso (ADR 0023).
      charms: owner.charms.getState(),
      // As magias aprendidas (#624, ADR 0058): a Cidade marca `dirty` na compra, e sem este campo
      // ela sumiria no logout — com o gold já debitado no mesmo extrato. ABSOLUTO, como `charms`,
      // e só quando `recorded` (ver `#receiptFor`): quem só mexeu na postura não reescreve o vazio.
      ...(owner.learnedSpells.recorded ? { learnedSpells: owner.learnedSpells.getState() } : {}),
      // O familiar (M38-02, #599): o mesmo da hunt — o extrato de estado da Cidade o leva, para um
      // logout depois de uma morte não perder o carimbo que a hunt acabou de gravar.
      ...(isEmptyFamiliarState(owner.familiar) ? {} : { familiar: owner.familiar }),
      // O registro do Treino (#631, ADR 0059 d.3): escolher a skill do livro na praça marca
      // `dirty`, e sem este campo a escolha sumiria no logout. ABSOLUTO, como `charms`.
      training: owner.training.getState(),
      // O Hazard (#632): a escolha do nível acontece na Cidade, e a Cidade não gera `Receipt` de
      // progresso — sem isto ela sumiria no logout, como a de um Charm.
      ...(owner.hazard.isEmpty ? {} : { hazard: owner.hazard.getState() }),
      // O estoque de supply/munição (#792, ADR 0044 d.2): conjurar na Cidade credita
      // `supplyStock`/`ammunitionStock` do mesmo jeito que o loot da hunt credita — ABSOLUTO,
      // como `ammo` (`receipts.ts`). Sem isto, a carga conjurada na praça sumia no logout: o
      // shard nunca grava as duas fora deste extrato de estado durável.
      ...(owner.supplyStock.size === 0 ? {} : { supplyStock: Object.fromEntries(owner.supplyStock) }),
      ...(owner.ammunitionStock.size === 0
        ? {} : { ammunitionStock: Object.fromEntries(owner.ammunitionStock) }),
      // Alma (#593): escolher a vocação na praça enche a alma pela primeira vez
      // (`CharacterRuntime.chooseVocation`), e sem este campo o shard perderia esse enchimento
      // no logout — o mesmo buraco que a vocação e o equipamento já tapavam antes do #154.
      soul: owner.soul,
      // As bênçãos (#570, ADR 0052): comprar na Cidade marca `dirty`, e sem este campo a compra
      // sumiria no logout como vocação/equipamento sumiam antes do #154. ABSOLUTO, como acima.
      blessings: owner.blessings,
      // A postura de luta (#550): escolher na praça marca `dirty`, e sem este campo a escolha sumiria
      // no logout. ABSOLUTA, como acima.
      fightMode: owner.fightMode,
      equipment: equipmentOf(owner),
      layout: layoutOfState(owner.inventory.getState()),
      overlays: overlaysOfState(owner.inventory.getState()),
      acquired: acquiredBy(owner, hosted.session.id),
      // As instâncias vendidas/descartadas na praça (#724, ADR 0048 d.8) — mesmo mecanismo do
      // extrato de hunt, drenado aqui em vez de `#receiptFor` porque o shard nunca passa pelo
      // `Receipt` do `sim` (ADR 0023: a Cidade não gera extrato de progresso).
      ...(owner.removedInstances.length === 0 ? {} : { removedInstances: owner.drainRemovedInstances() }),
    });
    hosted.dirty.delete(characterId);
    // Como `#persistReceipt`: incorpora o delta à base ANTES do próximo extrato reencontrar uma
    // base antiga mais uma variação já liquidada no ledger.
    if (owner.goldDelta !== 0) owner.settleGoldDelta();
  }

  /** Grava todas as sessões hospedadas. Chamado pelo timer e pela drenagem. */
  async saveAll(): Promise<void> {
    const snapshots = this.#options.snapshots;
    if (snapshots === undefined) return;
    for (const [characterId, sessionId] of this.#sessionIdByCharacter) {
      const hosted = this.#sessions.get(sessionId);
      const accountId = this.#accountIdByCharacter.get(characterId);
      if (hosted === undefined || accountId === undefined) continue;
      // Shard não tem snapshot (`keepsSnapshot`, FUN-71, ADR 0023). Não há progresso a guardar na
      // praça, e o que seria guardado é a praça INTEIRA — uma cópia por participante, duzentas
      // vezes o mesmo estado a cada dez segundos. O mundo chega ao banco por checkpoint, com
      // timer próprio (OW-16), e não por aqui.
      if (!keepsSnapshot(hosted.session.ruleset)) continue;
      try {
        await snapshots.save(
          characterId, accountId, this.#options.nodeId, hosted.session.snapshot(),
        );
      } catch (error) {
        // Falhar aqui é perder o próximo intervalo, não a sessão. Silenciar seria perder a
        // única pista de por que uma retomada voltou mais atrasada do que devia.
        this.#logger.error({ err: error, characterId }, 'Failed to save session snapshot');
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

  /**
   * O id numérico do alvo SELECIONADO para apresentação (#470, RF-05): `selectedTargetOf` do
   * ruleset, que NÃO é recortado pelo alcance da arma. Antes daqui saía `attackTargetOf` — o
   * alvo de combate —, e o alvo sumia da tela ao sair do corpo a corpo.
   *
   * `.get` e não `#creatureId`: quem não recebeu id numérico nunca apareceu para o cliente, e
   * um alvo que a tela não desenha não pode ser destacado. Monstro visível já tem id pelo
   * `session-state`.
   */
  #selectedTargetIdOf(hosted: HostedSession, character: CharacterRuntime | undefined): number | null {
    if (character === undefined) return null;
    const ruleset = hosted.session.ruleset as Partial<HuntRuleset>;
    const target = ruleset.selectedTargetOf?.(character) ?? null;
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
    const self = this.#statsOf(this.#participantOf(hosted, characterId));

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
      name: this.#nameByCharacter.get(participant.id) ?? participant.id,
      health: participant.health,
      maxHealth: participant.maxHealth,
      // A aparência de AGORA e as cores do ticket (FUN-104), pelo MESMO espalhamento do
      // `creature-appear`: o cliente aplica os dois pelo mesmo caminho, e o reanexado precisa ver o
      // vizinho pintado igual — e ilusionado igual (#621).
      ...this.#lookFor(hosted, participant.id),
    }));

    // Os monstros VIVOS da hunt entram na mesma lista (FUN-103): quem reanexa no meio precisa
    // ver o que já está lá, e não só o que nascer depois. O getter vem do ruleset pelo mesmo
    // cast que `#applyBotConfig` usa — sessão sem monstro devolve `undefined`, e é o normal.
    const ruleset = session.ruleset as Partial<HuntRuleset>;
    for (const monster of ruleset.monsters ?? []) {
      if (!monster.alive) continue;
      const definition = this.#options.monsterCatalog?.get(monster.monsterId);
      this.#rememberRace(hosted, monster.subject, definition);
      creatures.push({
        id: this.#creatureId(hosted, monster.subject),
        // O andar do MONSTRO (#519, hunt multiandar), nunca o padrão da instância: numa hunt de
        // andar único os dois sempre bateram, e é só por isso que `ruleset.floor` nunca apareceu
        // errado até aqui. `?? ruleset.floor ?? 0` sobra para o monstro de snapshot anterior a
        // esta issue, sem `z` nenhum na posição.
        position: { ...monster.position, z: monster.position.z ?? ruleset.floor ?? 0 },
        // A aparência de AGORA (#621): o outfit do monstro, ou a que ele tomou emprestada.
        ...this.#lookFor(hosted, monster.subject),
        name: definition?.name ?? monster.monsterId,
        health: monster.health,
        maxHealth: definition?.health ?? monster.health,
        // A apresentação (#620), pelo MESMO espalhamento do `creature-appear`: quem reanexa no
        // meio vê o monstro com luz e falas, sem esperar um segundo aparecimento. Só o que NÃO é do
        // outfit: as cores e os addons já vêm de `#lookFor`, e o monstro ilusionado os tem do
        // outfit que veste (#621) — espalhar os do monstro de novo os trocaria pelos do dono.
        ...monsterPresentationOf(definition),
        // A invocação do JOGADOR (#598) — o mesmo espalhamento do `creature-appear`, para quem
        // reanexa no meio ver a invocação já marcada, sem esperar um segundo aparecimento.
        ...(typeof monster.masterId === 'string' ? { masterId: monster.masterId } : {}),
      });
    }

    const spendingShares = partySpendingSharesOf(hosted);
    // A seção PARTY do analisador (§32, ADR 0035 d.11) — o MESMO bloco do `analyzer.party`,
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
        promoted: self.promoted,
        speed: self.speed,
        skills: self.skills,
        magicLevel: self.magicLevel,
        ...(self.loyaltyBonusPercent === undefined ? {} : { loyaltyBonusPercent: self.loyaltyBonusPercent }),
        soul: self.soul,
        soulMax: self.soulMax,
      },
      world: {
        // O mapa da sessão (FUN-120): o cliente busca a geometria e a pilha por este id.
        mapId: session.ruleset.mapId ?? null,
        creatures,
        // Os cadáveres no chão (FUN-123), com a arte da tabela; sem linha, sem cadáver.
        groundItems: (ruleset.groundItems ?? []).flatMap((corpse) => {
          const appearanceId = this.#options.monsterCatalog?.get(corpse.monsterId)?.corpseAppearanceId;
          if (appearanceId === undefined) return [];
          // O destaque de loot (#722): quem reanexa precisa ver quais cadáveres ainda têm algo.
          const lootable = (corpse.items?.length ?? 0) > 0 || (corpse.gold ?? 0) > 0;
          return [{ id: corpse.id, position: corpse.position, appearanceId, lootable }];
        }),
        // O overlay de cenário ATIVO (#729, ADR 0050 d.7): todo interativo cujo estado hoje
        // difere do inicial, para quem reanexa aplicar por cima da pilha estática que já
        // carrega — a MESMA resolução de `tile-update`, pela tabela `appearances.scenery`.
        tileUpdates: this.#tileUpdatesFor(ruleset.tileAppearanceChanges ?? []),
        // Os campos ATIVOS agora (#561, M31-06), com a arte da tabela; sem linha, sem campo —
        // a MESMA regra de `groundItems` acima. Quem reanexa no MEIO da cadeia (#560) recebe a
        // arte do ESTÁGIO ATUAL, não sempre a do nascimento — `stageIndex` ausente (campo de
        // um estágio só) ou 0 continua caindo em `appearances.fields`, como sempre.
        fields: (ruleset.fields ?? []).flatMap((field) => {
          const stageIndex = field.stageIndex ?? 0;
          const appearanceId = stageIndex === 0
            ? this.#options.appearances?.fields[field.id]
            : this.#options.appearances?.fieldStages[field.id]?.[stageIndex - 1];
          return appearanceId === undefined
            ? []
            : [{ id: field.id, tiles: [...field.tiles], appearanceId }];
        }),
      },
      // Os agregados DESTE personagem (#187, #196): numa party, o que ele rendeu — não a soma.
      aggregates: { ...session.aggregatesOf(characterId) },
      // Os do PERSONAGEM (OW-13): ver `#presentAnalyzer`.
      notableEvents: session.notableEventsFor(characterId).map((event) => ({ ...event })),
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
    // este só entra nela. Senão, o primeiro ticket cria a hunt com todos.
    const hostedParty = party === undefined ? undefined : this.#sessions.get(party.sessionId);
    // A retomada de snapshot (que já traz os N, quando ele é de uma party) só se aplica a um
    // ticket SOLO reconectando — nunca a um ticket de party (#527, invariante 8): o snapshot é
    // indexado por `characterId`, não por `sessionId`, e `/start` sempre emite um `sessionId`
    // novo (`randomUUID`). Um personagem com QUALQUER snapshot pendente de outra sessão — a
    // hunt em que ele estava quando o nó reiniciou (ADR 0010), por exemplo — nunca deveria
    // chegar aqui com um ticket de party: `/start` recusa formar a party antes disso (ver
    // `api/party.ts`). Se chegar mesmo assim, o ticket é AUTORITATIVO sobre qual sessão isto
    // é — retomar o snapshot errado seria colocar o personagem na hunt de outra pessoa.
    const resumed = (party === undefined && hostedParty === undefined)
      ? await this.#resume(characterId, accountId)
      : null;
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
      // O outro membro pode estar hospedado AQUI, na Cidade, no mesmo nó (#527) — o cenário de
      // duas caçadas locais logadas juntas. ANTES do `#register` de propósito: registrar com o
      // `sessionKey` ainda apontando para a Cidade cairia no `#takeOver`, que recusa sempre
      // (o nó está vivo — ver `#leaveForParty`).
      const existingOther = this.sessionFor(other.id);
      if (existingOther !== undefined && existingOther.id !== session.id) {
        await this.#leaveForParty(other.id, existingOther, {
          sessionId: session.id, nodeId: this.#options.nodeId, type: session.ruleset.type,
        });
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
    this.#premiumByCharacter.set(characterId, initialCharacter?.premium ?? false);
    this.#createLocal(characterId, session, accountId);
    for (const other of others) {
      // A Cidade dele já foi deixada no loop acima, ANTES do `#register` — aqui só falta o
      // mapa local, que aquele loop não mexeu de propósito (a ordem de `#createLocal` importa
      // para quem já estava na hunt ver a chegada, como o comentário duas linhas acima explica).
      this.#sessionIdByCharacter.set(other.id, session.id);
      this.#restingSince.set(other.id, this.#now());
      // Nome, cores e bot dos outros membros vêm do bloco da party (#195): quem os vê no
      // mundo precisa do nome, e a tela deles do bot — mesmo que nunca conectem.
      const member = party?.members.find((m) => m.characterId === other.id);
      if (member?.initialCharacter.name !== undefined) this.#nameByCharacter.set(other.id, member.initialCharacter.name);
      if (member?.initialCharacter.outfitColors !== undefined) this.#colorsByCharacter.set(other.id, member.initialCharacter.outfitColors);
      this.#premiumByCharacter.set(other.id, member?.initialCharacter.premium ?? false);
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
      this.#logger.error({ err: error, characterId }, 'Failed to load session snapshot');
      return null;
    }
    if (stored === null) return null;

    // O intervalo em que o nó esteve fora é DESCARTADO (ADR 0018): o relógio lógico da sessão continua
    // de onde parou. Mas `createdAtMs + nowMs` é o relógio de PAREDE que o `sim` compara com os
    // carimbos do familiar (#599, ADR 0052 d.6) — sem recolocar o anchor, ele passaria a ficar
    // atrasado em relação ao real pelo tempo todo da queda, e o cooldown de 30 min gravado por uma
    // sessão retomada nasceria já vencido em parte. Somar o intervalo descartado ao anchor devolve a
    // soma a "agora"; é dado entregue à sessão (como na criação), nunca relógio que o `sim` leia.
    const gapMs = Math.max(0, Date.now() - stored.savedAtMs);
    const session = restore({ ...stored.snapshot, createdAtMs: stored.snapshot.createdAtMs + gapMs });
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
    return { session, gapMs };
  }

  /**
   * Extrato de uma sessão que não volta mais, montado a partir do snapshot.
   *
   * A montagem em si — que campos do `CharacterState` viram extrato, `seq = ledgerSeq + 1`
   * para a idempotência — é `settleSnapshotAsReceipt` (`../snapshot-settlement.js`, #527):
   * compartilhada com `/api/party/:id/start` (recusa formar hunt para quem tem outro snapshot
   * resumível pendente) e `pnpm dev:dragon-party --reset` (limpa o snapshot pelo MESMO
   * caminho, nunca apagando a chave às cegas). Nenhum dos dois tem o resto do runtime de jogo
   * para reconstruir a sessão — e não precisam: creditar não depende disso.
   */
  async #creditUnrestorable(
    characterId: string,
    accountId: string | undefined,
    snapshot: SessionSnapshot,
  ): Promise<void> {
    const receipts = this.#options.receipts;
    if (receipts === undefined || accountId === undefined) return;
    try {
      await settleSnapshotAsReceipt(snapshot, { characterId, accountId, receipts, nowMs: this.#wallNow() });
    } catch (error) {
      // Falhar aqui perde o crédito, e é por isso que o snapshot NÃO é apagado em seguida
      // quando isto lança: a próxima conexão tenta de novo.
      this.#logger.error(
        { err: error, characterId, sessionId: snapshot.id },
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
      viewers: new ViewerSet(),
      creatureIds: new Map(),
      raceBySubject: new Map(),
      nextCreatureId: 1,
      // Só o shard tem AOI (FUN-33): numa hunt de um personagem ela seria índice para nada.
      aoi: this.#interestManaged(session) ? new AreaOfInterest() : null,
      // Vale tanto para a sessão nova quanto para a retomada de snapshot: as duas começam a
      // ser cobradas a partir de agora, e não de um relógio que não é deste processo.
      lastAdvancedAtMs: this.#now(),
      credited: new Set(),
      receiptSaves: new Map(),
      exitSaves: new Map(),
      departures: [],
      dirty: new Set(),
      sentItemsLooted: session.aggregates.itemsLooted,
      sentStats: new Map(),
      sentTarget: new Map(),
      lastTargetSeq: new Map(),
      sentAnalyzer: new Map(),
      sentBestiary: new Map(),
      sentBosstiary: new Map(),
      sentBlessings: new Map(),
      sentHazard: new Map(),
      sentTraining: new Map(),
      sentTileOverrides: new Map(),
      sentParty: null,
      lastPartyBag: null,
      sentConditions: new Map(),
      sentExit: new Map(),
      sentSlotState: new Map(),
      slotStateAtMs: 0,
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
      this.#logger.error({ err: error }, 'Failed to renew session leases');
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
        this.#logger.error({ err: error }, 'Failed to aggregate online player count');
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

  /** O relógio de parede (epoch ms) — ver `SessionHostOptions.wallNow`. */
  #wallNow(): number {
    return this.#options.wallNow?.() ?? Date.now();
  }
}
