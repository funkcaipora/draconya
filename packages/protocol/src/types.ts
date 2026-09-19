// Um schema Zod por mensagem. É ele que valida a entrada ANTES de virar estado — mensagem
// malformada é recusada com erro tipado, nunca aplicada pela metade (invariante 4).

import { z } from 'zod';
import type { C2SName, S2CName } from './messages.js';

const Point = z.object({ x: z.number().int(), y: z.number().int(), z: z.number().int() });
const Direction = z.enum(['north', 'east', 'south', 'west']);

/**
 * Um lugar do inventário (#160): posição num container, ou um slot do corpo. O slot vem como
 * string e é conferido pelo CONTEÚDO no servidor, como em `unequip`.
 */
const Place = z.union([
  z.object({ container: z.enum(['backpack', 'satchel']), index: z.number().int().nonnegative() }),
  z.object({ slot: z.string().min(1) }),
]);

/** Um índice na paleta de 133 cores do outfit (FUN-20). O cliente é quem sabe que cor é. */
const PaletteIndex = z.number().int().min(0).max(132);

/**
 * Progresso até o próximo nível de uma skill (#340, SV-04): nível atual e percentual acumulado.
 */
export const SkillProgress = z.object({
  level: z.number().int().nonnegative(),
  percentToNext: z.number().int().min(0).max(99),
});
export type SkillProgress = z.infer<typeof SkillProgress>;

/**
 * As cores com que um outfit de duas camadas é pintado (FUN-104): cabeça, corpo, pernas e
 * pés, cada um um índice da paleta. Do personagem, não do monstro — o rato é uma camada só.
 */
export const OutfitColors = z.object({
  head: PaletteIndex, body: PaletteIndex, legs: PaletteIndex, feet: PaletteIndex,
});
export type OutfitColors = z.infer<typeof OutfitColors>;

/**
 * Uma criatura como ela chega no estado completo. O MESMO schema do `creature-appear`, de
 * propósito: o cliente aplica os dois pelo mesmo caminho, e um campo que só existisse num
 * deles viraria a diferença entre "reconectei" e "vi aparecer".
 */
const CreatureState = z.object({
  id: z.number().int(),
  position: Point,
  appearanceId: z.number().int(),
  name: z.string(),
  health: z.number(),
  maxHealth: z.number(),
  /**
   * **Opcional**, pela mesma razão dos agregados do analisador: um nó `game` anterior manda a
   * criatura sem cores, e um cliente que as exigisse recusaria a mensagem inteira — em
   * silêncio. Ausente, o cliente pinta com as cores de personagem novo. Monstro nunca traz.
   */
  colors: OutfitColors.optional(),
});

/** Os agregados da sessão — o que o §16.2 chama de "quanto rendeu". */
const Aggregates = z.object({
  durationMs: z.number(),
  xpGained: z.number(),
  goldGained: z.number(),
  goldSpent: z.number(),
  kills: z.number().int(),
  deaths: z.number().int(),
  /**
   * O que a FUN-78 acrescentou. **Opcionais**, e isso é sobre deploy em rolagem: um nó `game`
   * antigo manda os agregados sem estes campos, e um cliente novo que os exigisse recusaria a
   * mensagem inteira — em SILÊNCIO, porque `decodeS2C` devolve `null` sem erro. O jogador
   * veria a tela de retorno vazia e ninguém ligaria uma coisa à outra.
   */
  itemsLooted: z.number().int().optional(),
  suppliesUsed: z.number().int().optional(),
  bestBasicHit: z.number().optional(),
  bestSpellHit: z.number().optional(),
});

/**
 * **Não existe campo "por hora" aqui, e é decisão** (§16.1, FUN-78).
 *
 * Por hora é `valor / durationMs`, e quem divide é o cliente. Mandar a divisão pela rede é
 * mandar o mesmo número duas vezes — e os dois divergem na primeira pausa entre calcular e
 * enviar, com o servidor dizendo uma coisa e a conta do jogador dizendo outra.
 */

/** Lista CURTA para a tela de retorno. Não é log: guarda só o que vale contar. */
const NotableEvent = z.object({
  atMs: z.number(),
  type: z.string(),
  detail: z.string().optional(),
});

/**
 * Uma instância de item onde quer que ela esteja — na mochila ou no corpo (§21.5, FUN-90).
 *
 * É a MESMA forma nos dois lugares, de propósito. O item equipado sai da mochila quando
 * veste (`Inventory.equip` do `sim` o move, não o copia), então `slot → instanceId` deixava o
 * cliente sem `itemId` para achar a definição no catálogo — o slot vestido desenhava a
 * inicial de "item" e o tooltip dizia "Tirar item", sem nome e sem sprite. Leva só o que
 * MUDA; nome, peso e aparência continuam no catálogo.
 */
const CarriedItem = z.object({
  instanceId: z.string().min(1),
  itemId: z.string().min(1),
  quantity: z.number().int().positive(),
});

export const C2S_SCHEMAS = {
  authenticate: z.object({ ticket: z.string().min(1), clientVersion: z.string() }),
  ping: z.object({ t: z.number() }),
  'client-ready': z.object({}),
  'session-attach': z.object({}),
  walk: z.object({ direction: Direction }),
  'walk-to': z.object({ destination: Point }),
  say: z.object({ channel: z.string(), text: z.string().max(255) }),
  logout: z.object({}),
  /**
   * Entrar numa hunt (§14.3, FUN-30). INTENÇÃO, nunca resultado: o cliente diz qual hunt e
   * qual dificuldade, e o servidor decide se a transição é válida, cria a instância e
   * responde com o estado novo (invariante 4).
   *
   * A dificuldade vem como string livre e é validada contra o CONTEÚDO, não contra um enum
   * aqui: uma hunt define as dificuldades que fazem sentido para ela, não obrigatoriamente as
   * quatro, e repetir a lista no protocolo criaria um segundo lugar para ela divergir.
   */
  'enter-hunt': z.object({ huntId: z.string().min(1), difficulty: z.string().min(1) }),
  /** Sair da hunt por ação manual (§14.8). Encerra com extrato e devolve à cidade. */
  'leave-hunt': z.object({}),
  /**
   * Salvar a configuração do bot (§13, FUN-81). INTENÇÃO: o jogador manda as REGRAS, e quem
   * decide se elas valem — vocabulário, slots, catálogo e gate de level — é o servidor
   * (invariante 4). Nada aqui é resultado: não há dano, cura nem gold nesta mensagem.
   *
   * A carga vem como objeto OPACO de propósito. O schema de verdade é `botConfigSchema`, em
   * `@draconya/content`, e ele é a fonte única do vocabulário — repetir a forma aqui criaria
   * um segundo lugar para ela divergir, que é exatamente o que o invariante 5 evita para
   * opcode. O servidor faz o `parse` com o schema real e recusa com `system-message`.
   */
  'bot-config': z.object({ config: z.unknown() }),
  /**
   * Vestir um item (§21.4, FUN-82). INTENÇÃO: o cliente diz QUAL item, e quem decide se ele
   * cabe, se o level basta e em que slot vai é o servidor (invariante 4).
   *
   * `instanceId`, e não `itemId`: o que se veste é ESTE item, o da linha de `item_instance`,
   * não "um item deste tipo". Mandar o id de catálogo deixaria o servidor escolher qual das
   * duas espadas do jogador equipar — e a que ele escolhesse não seria a que o jogador clicou.
   */
  equip: z.object({ instanceId: z.string().min(1) }),
  /**
   * Tirar o que está num slot. O slot vem como string livre e é validado contra o CONTEÚDO,
   * como a dificuldade de hunt: repetir a lista aqui criaria um segundo lugar para ela
   * divergir.
   */
  unequip: z.object({ slot: z.string().min(1) }),
  /**
   * Escolher a munição (#152, ADR 0026 decisão 3). INTENÇÃO: o cliente diz QUAL munição, e
   * quem decide se o level basta é o servidor (invariante 4). A escolha aparece de volta em
   * `player-stats.ammo`; a recusa vira `system-message`, como a de equipar.
   */
  'select-ammo': z.object({ ammoId: z.string().min(1) }),
  /**
   * Escolher a vocação (#154, ADR 0026 decisão 1). INTENÇÃO: o cliente diz QUAL, e quem decide
   * se o level basta e se ainda não há uma é o servidor (invariante 4). Sucesso é
   * `player-stats.vocationId` mais `inventory`; recusa é `system-message`, como equipar.
   */
  'choose-vocation': z.object({ vocationId: z.string().min(1) }),
  /**
   * Mover um item (#160). INTENÇÃO: origem e destino; quem decide se cabe, se empilha, se
   * veste e se o slot existe é o servidor (invariante 4). Sucesso é `inventory` reenviado;
   * recusa é `system-message`, como equipar.
   */
  'move-item': z.object({ from: Place, to: Place }),
  /**
   * O líder muda rateio, divisão de lucro, coleta ou venda automática EM TEMPO DE HUNT
   * (#393, ADR 0033 decisão 1). INTENÇÃO, sempre: um patch parcial — cada campo ausente
   * mantém o valor atual — e quem decide se quem mandou é o líder e se os ids do catálogo
   * existem é o servidor (invariante 4). Sucesso é `party-state` (v2) refletindo o estado
   * novo; recusa é `system-message`.
   */
  'party-settings': z.object({
    shareCosts: z.boolean().optional(),
    splitLoot: z.boolean().optional(),
    /** `null` = coletar tudo; `undefined` = não mexer no que já está configurado. */
    collect: z.array(z.string().min(1)).nullable().optional(),
    autoSell: z.array(z.string().min(1)).optional(),
  }),
} as const satisfies Record<C2SName, z.ZodType>;

/** Quem está na party (#196; v2 no #393): só os PRESENTES; quem saiu some da lista. */
export const PartyState = z.object({
  leaderId: z.string().min(1),
  /**
   * @deprecated Espelho de leitura para cliente anterior ao #393: `'shared'` sse os dois
   * eixos estão ligados. Sai depois de um deploy completo (ADR 0033 d.1) — não remover sem
   * antes confirmar que nenhum cliente em produção ainda o lê.
   */
  mode: z.enum(['split', 'shared']),
  /**
   * Os dois eixos como o #359 os gravou (PR #366), ainda no topo por um deploy de rolagem —
   * o agrupamento novo é `settings`. Ausente: nó anterior ao #359.
   */
  shareCosts: z.boolean().optional(),
  splitLoot: z.boolean().optional(),
  /** Os dois eixos do líder (§4/§5 do PRD). Ausente: nó anterior ao #393 — leia `mode`. */
  settings: z.object({
    shareCosts: z.boolean(),
    splitLoot: z.boolean(),
  }).optional(),
  /** A config de loot do líder e o limite dele (§6-§8, §23.1). Ausente: `splitLoot` desligado ou nó anterior. */
  loot: z.object({
    collect: z.array(z.string().min(1)).nullable(),
    autoSell: z.array(z.string().min(1)),
    autoSellLimit: z.number().int().nonnegative(),
    leaderPremium: z.boolean(),
  }).optional(),
  members: z.array(z.object({
    characterId: z.string().min(1),
    name: z.string().min(1),
    alive: z.boolean(),
    /** HP em percentual inteiro (0–100), para o painel — o absoluto é balanceamento. */
    healthPercent: z.number().int().min(0).max(100),
    /**
     * A vocação de cada membro (#339, SV-03).
     * `null` é "ainda não escolheu" (level < 8, ADR 0026 decisão 1).
     * `default(null)`: um nó game anterior manda sem.
     */
    vocationId: z.string().nullable().default(null),
    /**
     * O level de cada membro (#339, SV-03). Opcional.
     */
    level: z.number().int().positive().optional(),
    /**
     * Mana em percentual inteiro (0–100, #339, SV-03). Opcional.
     */
    manaPercent: z.number().int().min(0).max(100).optional(),
    /** Quando entrou nesta hunt (§16.1, elegibilidade; #397 filtra o extrato por isto). */
    joinedAtMs: z.number().nonnegative().optional(),
    /** Tem viewer anexado agora — não confundir com "vivo": morto pode estar conectado. */
    connected: z.boolean().optional(),
  })),
});

/** A bolsa compartilhada (#196; v2 no #393): itens, gold, reserva e elegibilidade. */
export const PartyBag = z.object({
  gold: z.number().int().nonnegative(),
  items: z.array(z.object({
    instanceId: z.string().min(1),
    itemId: z.string().min(1),
    quantity: z.number().int().positive(),
    /** Presentes no abate que deu este item (§16.1) — só quem entra na venda dele. */
    eligible: z.array(z.string().min(1)).optional(),
  })),
  weight: z.number().nonnegative(),
  capacity: z.number().nonnegative(),
  /** Σ value × quantity dos itens da bolsa (§10). Ausente: nó anterior ao #393. */
  value: z.number().int().nonnegative().optional(),
  /** `peso > capacidade disponível total` (§14). Ausente: nó anterior, ou nunca calculado. */
  overweight: z.boolean().optional(),
  /** Reserva proporcional por membro (§11-§13, ADR 0033 d.3), na ordem de `party-state.members`. */
  reservations: z.array(z.object({
    characterId: z.string().min(1),
    reserved: z.number().nonnegative(),
    available: z.number().nonnegative(),
  })).optional(),
});

/** O settlement da bolsa (#196; v2 no #393): quanto rendeu, quem levou quanto, e por quê. */
export const PartySettlement = z.object({
  total: z.number().int().nonnegative(),
  shares: z.array(z.object({ characterId: z.string().min(1), gold: z.number().int().nonnegative() })),
  /** Ausente: settlement anterior ao #393 (sempre foi saída/fim). */
  reason: z.enum(['leave', 'end', 'toggle', 'auto-sell']).optional(),
  /** Só com `reason: 'auto-sell'` — qual item da lista de venda gerou este settlement. */
  itemId: z.string().min(1).optional(),
});

/**
 * O gasto de cada membro e a prévia de rateio da party (#354, SV-18). `estimatedShare` é a
 * MESMA conta do `party-settlement` real, chamada como leitura — por isso é `.optional()`, e
 * não `.nullable()`: ausente é "não se aplica" (modo `split`, ou nó `game` anterior a esta
 * issue), nunca um zero fabricado (D8).
 */
export const PartySpending = z.object({
  shares: z.array(z.object({
    characterId: z.string().min(1),
    /** O MESMO número de `Aggregates.goldSpent` — não int-constrained, como lá (types.ts:56). */
    goldSpent: z.number(),
    estimatedShare: z.number().int().nonnegative().optional(),
  })),
});

/** A seção PARTY do analisador (§32, ADR 0033 d.11) — o mesmo bloco nos dois lugares que o usam. */
export const PartySummary = z.object({
  players: z.number().int().positive(),
  uniqueVocations: z.number().int().positive(),
  xpPercent: z.number().int().nonnegative(),
  totalXp: z.number().nonnegative(),
  totalSupplies: z.number().nonnegative(),
  shareCosts: z.boolean(),
  splitLoot: z.boolean(),
  bagValue: z.number().int().nonnegative(),
  bagWeight: z.number().nonnegative(),
  autoSell: z.object({
    used: z.number().int().nonnegative(),
    limit: z.number().int().nonnegative(),
  }),
});

/**
 * As condições que a barra de buffs do cliente sabe desenhar (#341, SV-05). Vocabulário FECHADO
 * do contrato: o host só envia estas, e uma badge nova entra aqui e no cliente na mesma PR.
 */
export const ACTIVE_CONDITION_KINDS = ['haste', 'buff', 'mana-shield', 'heal-over-time'] as const;
export type ActiveConditionKind = (typeof ACTIVE_CONDITION_KINDS)[number];
export const S2C_SCHEMAS = {
  pong: z.object({ t: z.number() }),
  welcome: z.object({ characterId: z.string(), contentVersion: z.string() }),
  /**
   * O estado ATUAL completo, nunca um replay (§16.2).
   *
   * Voltar depois de seis horas precisa mostrar onde o personagem está agora, quanto rendeu e
   * a lista curta de eventos notáveis. Tentar animar seis horas de eventos é o erro óbvio, e
   * a versão sutil dele é mandar "os últimos N eventos" e deixar o cliente decidir — por isso
   * não existe campo para fila de eventos aqui, só o agregado e a lista notável.
   *
   * É o maior payload do protocolo: numa hunt cheia são dezenas de entidades com estado. O
   * codec comprime acima do limiar sozinho.
   */
  'session-state': z.object({
    /**
     * `sessionType`, e não `type`: `type` é o discriminador da MENSAGEM em todo o protocolo,
     * e o codec o remove antes de serializar (`const { type, ...props } = msg`). Um campo de
     * carga com esse nome é apagado no caminho e a mensagem inteira passa a ser recusada na
     * validação do outro lado — sem erro, porque `decodeS2C` devolve `null` em silêncio.
     */
    sessionType: z.string(),
    elapsedMs: z.number(),
    huntId: z.string().optional(),
    difficulty: z.string().optional(),
    /** Quem é o jogador nesta instância — sem isto a câmera não tem em quem centrar. */
    self: z.object({
      creatureId: z.number().int(),
      characterId: z.string(),
      health: z.number(), maxHealth: z.number(),
      mana: z.number(), maxMana: z.number(),
      level: z.number().int(), xp: z.number(),
      /** A vocação (#154). `null` é "ainda não escolheu". `default(null)`: nó anterior manda sem. */
      vocationId: z.string().nullable().default(null),
      speed: z.number().int().nonnegative().default(0),
      skills: z.record(z.string().min(1), SkillProgress).default({}),
      magicLevel: SkillProgress.default({ level: 0, percentToNext: 0 }),
    }),
    world: z.object({
      mapId: z.string().nullable(),
      creatures: z.array(CreatureState),
      /** Os itens no chão agora (FUN-123) — quem reanexa vê os cadáveres. `default([])`: nó anterior. */
      groundItems: z.array(z.object({
        id: z.number().int(),
        position: Point,
        appearanceId: z.number().int().positive(),
      })).default([]),
    }),
    aggregates: Aggregates,
    notableEvents: z.array(NotableEvent),
    /**
     * A configuração de bot EM VIGOR para este personagem (FUN-111), opaca como a que sobe
     * em `bot-config`: o schema de verdade é `botConfigSchema`, em `content`. É o que a tela
     * do bot mostra ao abrir — sem isto ela nascia vazia a cada carregamento, e "Salvar" do
     * vazio apagava as regras que a hunt estava executando. Ausente: nunca configurou, ou nó
     * `game` anterior.
     */
    botConfig: z.unknown().optional(),
    /** A party desta sessão (#196). Ausente em solo — e em todo nó anterior. */
    party: PartyState.optional(),
    partyBag: PartyBag.optional(),
    partySpending: PartySpending.optional(),
    /**
     * A seção PARTY do analisador (§32, ADR 0033 d.11) — o MESMO bloco do `analyzer.party`.
     * Ausente: solo, ou nó `game` anterior ao #393.
     */
    partySummary: PartySummary.optional(),
    /**
     * O total de jogadores online (SV-07) — o mesmo número do `player-count` mais recente,
     * para quem reanexa não ficar sem ele até o próximo ciclo de 30 s. Ausente: nó `game`
     * anterior a esta mudança, ou este processo ainda não completou o primeiro ciclo desde que
     * subiu.
     */
    onlinePlayers: z.number().int().nonnegative().optional(),
  }),
  /**
   * A troca de cena (FUN-120): que mapa desenhar, e em que AMBIENTE (FUN-121) — `cavern`
   * escurece o mundo, `surface` não. Opcional porque um nó `game` anterior manda sem, e o
   * cliente trata ausência como superfície.
   */
  'instance-enter': z.object({
    instanceId: z.string(),
    map: z.string(),
    huntId: z.string().optional(),
    difficulty: z.string().optional(),
    ambience: z.enum(['surface', 'cavern']).optional(),
  }),
  'creature-appear': CreatureState,
  // Um passo é enviado UMA vez, com origem, destino e duração. O cliente interpola o
  // intervalo inteiro — não existe snapshot por tick (ADR 0001, seção de banda).
  'creature-move': z.object({
    id: z.number().int(),
    from: Point, to: Point, durationMs: z.number().positive(), pushed: z.boolean().optional(),
  }),
  'creature-disappear': z.object({ id: z.number().int() }),
  /**
   * Um item apareceu no chão (FUN-123): o cadáver de um monstro, na posição em que ele caiu,
   * com a aparência da tabela. Só visual — o loot nunca passa por aqui. Ids próprios, numa
   * sequência separada da das criaturas.
   */
  'ground-item-appear': z.object({
    id: z.number().int(),
    position: Point,
    appearanceId: z.number().int().positive(),
  }),
  /** O item do chão sumiu — o cadáver apodreceu. */
  'ground-item-disappear': z.object({ id: z.number().int() }),
  'party-state': PartyState,
  'party-bag': PartyBag,
  'party-settlement': PartySettlement,
  'party-spending': PartySpending,
  /**
   * O analisador ao vivo (FUN-110): os MESMOS agregados do `session-state`, mandados quando
   * mudam — abate, loot, gasto, level, morte. `durationMs` vem junto mas não é o gatilho: o
   * tempo anda no relógio local da janela, e mandá-lo a cada ciclo seria a banda inteira para
   * dizer que cem milissegundos passaram.
   *
   * `notableEvents` são só os NOVOS desde a última entrega — o `session-state` ou o
   * `analyzer` anterior —, e o cliente os acrescenta. A lista inteira a cada abate custava,
   * medido, 13 MB numa hunt de oito horas, 99 % deles repetição do que a tela já tinha.
   */
  analyzer: z.object({
    aggregates: Aggregates,
    notableEvents: z.array(NotableEvent),
    /** A seção PARTY (§32, ADR 0033 d.11). Ausente: solo, ou nó `game` anterior ao #393. */
    party: PartySummary.optional(),
  }),
  /**
   * O Bestiário do personagem (§18, FUN-113): `id do monstro → abates`, o valor inteiro e
   * atual — é um contador permanente, e a tela mostra o total, não um delta. Os marcos e o
   * bônus por marco vêm no `catalogue`, porque são conteúdo fixado na sessão (invariante 7).
   */
  bestiary: z.object({
    counts: z.record(z.string().min(1), z.number().int().nonnegative()),
  }),
  /**
   * O que o servidor decidiu sobre a configuração de bot que chegou (FUN-89).
   *
   * Tipado, e não uma frase num `system-message`, porque a TELA precisa da resposta: enquanto
   * ela não vem, o que o jogador escreveu está pendente, e uma recusa não pode descartar o que
   * ele digitou. Casar com o texto de uma mensagem de sistema faria a UI quebrar no dia em que
   * alguém melhorasse a redação.
   *
   * `reason` já vem em palavras que o jogador entende — quem recusa é quem sabe por quê
   * (FUN-73), e traduzir código no cliente espalharia a mesma explicação por dois lugares.
   */
  /**
   * O que o personagem carrega e veste (§21.5, FUN-90).
   *
   * **Peso e capacidade vêm daqui, calculados pelo servidor.** O cliente não soma peso: ele
   * mostra. Somar aqui daria dois lugares para a mesma conta divergir, e a versão do cliente
   * seria a errada — quem sabe o que cabe é quem recusa.
   *
   * As instâncias levam só o que MUDA: id, quantidade e onde estão. Nome, peso e aparência são
   * atributo base, fixo por id (§21.2), e vêm no catálogo.
   */
  inventory: z.object({
    /**
     * Um lugar por posição (#160); `null` é lugar vazio, e o comprimento é o tamanho ATUAL do
     * container — 20 ao nascer, mais cinco a cada linha que abriu.
     */
    backpack: z.array(CarriedItem.nullable()),
    /** A bolsa (#160): fixa do personagem, mesma forma. `default([])`: nó anterior manda sem. */
    satchel: z.array(CarriedItem.nullable()).default([]),
    /**
     * `slot` → o que está vestido ali, com a MESMA forma de uma entrada da mochila.
     *
     * Nasceu como `slot → instanceId` (FUN-90) e ganhou `itemId` e `quantity` na FUN-108,
     * quando o slot passou a desenhar o sprite: o equipado não está na mochila, então só o
     * id não dava ao cliente como chegar à definição. **O opcode não muda** — é a mesma
     * mensagem, com mais dentro, como o `catalogue` fez ao ganhar o vocabulário do bot.
     */
    equipped: z.record(z.string(), CarriedItem),
    /** Peso carregado e o teto. O teto sobe com o level (§9.3). */
    capacity: z.object({ used: z.number(), total: z.number() }),
  }),
  'bot-config-result': z.object({
    ok: z.boolean(),
    reason: z.string().optional(),
  }),
  /**
   * O que a tela de seleção de hunt pode mostrar (§14.3, FUN-79).
   *
   * **Level recomendado aparece; estimativa de XP/h e gold/h NÃO.** A razão é de produto, e a
   * regra vira ESTRUTURA aqui: não existe campo onde guardar a estimativa. Um comentário
   * pedindo para não mandar seria esquecido; um campo que não existe não pode ser preenchido
   * por engano. Um número oficial de XP/h vira a métrica pela qual toda hunt é julgada, e a
   * partir daí só existe uma hunt boa — o jogo passa a ter uma escolha, não quatro.
   *
   * Chega UMA vez, logo depois do `welcome`: a versão de conteúdo é fixada na sessão
   * (invariante 7), então o catálogo não muda enquanto ela vive.
   *
   * As dificuldades vêm como `string` porque são do CONTEÚDO, não do protocolo — uma hunt
   * define as que fazem sentido para ela, e um enum aqui obrigaria a mexer no protocolo para
   * cada dificuldade nova (mesma razão de `enter-hunt`).
   */
  catalogue: z.object({
    hunts: z.array(z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      recommendedLevel: z.number().int().positive(),
      difficulties: z.array(z.string().min(1)),
      /**
       * O texto de apresentação da hunt (R8-13, SV-21). Opcional: hunt sem o campo ainda não
       * teve o parágrafo escrito. Sem .default('') — ausência e string vazia são coisas diferentes.
       */
      description: z.string().min(1).optional(),
      /**
       * A contagem de monstros por dificuldade (SV-19, #355) — "Ousado · 4" do Huntera.
       * Mesma ordem de `difficulties`. `default([])`: nó game anterior manda sem.
       */
      difficultyDetails: z.array(z.object({
        id: z.string().min(1),
        monsterCount: z.number().int().positive(),
      })).default([]),
      /**
       * Os outfits dos monstros desta hunt (FUN-112), para o cliente AQUECER as folhas deles
       * na Cidade, antes de o primeiro aparecer — sem isto o rato era um quadrado por seis a
       * dez segundos na primeira entrada. Só ids (invariante 6), resolvidos pelo servidor do
       * conteúdo. `default([])`: um nó `game` anterior manda sem, e nada se aquece.
       */
      outfitIds: z.array(z.number().int().positive()).default([]),
      /**
       * Quantos drops distintos os monstros desta hunt têm — gold conta um, cada item conta um
       * (FUN-123): a linha "3 tamanhos de pull · 2 drops de loot" do Huntera. `default(0)`: nó
       * anterior manda sem.
       */
      lootDrops: z.number().int().nonnegative().default(0),
      /**
       * Os monstros que aparecem nesta hunt, em qualquer dificuldade dela — deduplicados e em
       * ordem de `id` (SV-02, #338).
       */
      monsters: z.array(z.object({
        id: z.string().min(1),
        name: z.string().min(1),
      })).default([]),
      /**
       * O loot possível desta hunt — cada item distinto uma vez, SEM raridade.
       * Gold NUNCA entra aqui (não é item).
       */
      loot: z.array(z.object({
        itemId: z.string().min(1),
        name: z.string().min(1),
      })).default([]),
    })),
    /**
     * Os monstros que existem, para a tela do Bestiário (FUN-113) ter nome onde o contador
     * tem id. Só id e nome: a arte de cada um chega pelo `creature-appear`, e o resto é
     * balanceamento que o cliente não simula (invariante 4). `default([])`: nó anterior.
     */
    monsters: z.array(z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      class: z.string().optional(),
      health: z.number().int().positive().optional(),
      experience: z.number().int().nonnegative().optional(),
    })).default([]),
    /**
     * Os marcos do Bestiário e o bônus de XP por marco (§18, FUN-113), do conteúdo fixado na
     * sessão. Ausente: o servidor não tem Bestiário configurado, e a tela mostra só a contagem.
     */
    bestiary: z.object({
      milestones: z.array(z.number().int().positive()),
      xpBonusPercentPerMilestone: z.number().nonnegative(),
    }).optional(),
    /**
     * O que a UI do bot pode oferecer (§13.3, FUN-89).
     *
     * **A tela NÃO tem lista de opções em código.** O que existe é o que este pacote diz que
     * existe: se a tela e o servidor divergirem, o jogador configura o que o bot recusa — e
     * descobre isso pelo extrato que não fecha, não por uma mensagem de erro.
     *
     * As magias e supplies vêm com o que a tela mostra e com o que o gate do §13.2 precisa —
     * level e vocação —, e nada mais: dano, cura e cooldown são balanceamento, e o cliente não
     * simula (invariante 4).
     */
    bot: z.object({
      vocabularyVersion: z.number().int().positive(),
      advancedFromLevel: z.number().int().positive(),
      slots: z.record(z.string(), z.number().int().nonnegative()),
      advancedOnly: z.object({
        conditions: z.array(z.string()),
        targetPolicies: z.array(z.string()),
        postures: z.array(z.string()),
      }),
      spells: z.array(z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        manaCost: z.number().int().nonnegative(),
        minLevel: z.number().int().positive(),
        vocationId: z.string().nullable(),
        /** `heal`, `mana` ou `damage`: é o que separa a categoria em que ela cabe. */
        effect: z.string().min(1),
        /** O grupo do Tibia (#155): `attack`, `healing`, `support`. `default`: nó anterior manda sem. */
        group: z.string().min(1).default('attack'),
        /**
         * Pode mirar um amigo (#392, #393)? Opcional SEM `default`: um nó `game` anterior manda
         * sem, e o cliente novo não pode recusar a mensagem — quem não veio é `self`.
         */
        targets: z.enum(['self', 'friend']).optional(),
      })),
      supplies: z.array(z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        price: z.number().int().nonnegative(),
        effect: z.string().min(1),
        /** Level e magic level exigidos (#165) — para a tela não oferecer o que o servidor vai recusar. `default({})`: nó anterior. */
        requires: z.object({
          level: z.number().int().positive().optional(),
          magicLevel: z.number().int().nonnegative().optional(),
        }).default({}),
        /** Pode mirar um amigo (#392, #393)? Opcional SEM `default`, como em `spells[]`. */
        targets: z.enum(['self', 'friend']).optional(),
      })),
    }),
    /**
     * As DEFINIÇÕES de item (§21.2, FUN-90). Nome, peso, onde veste e a aparência.
     *
     * Aqui, e não em cada instância do inventário: atributo base é fixo (duas espadas do mesmo
     * id são idênticas), então repeti-lo por instância mandaria o mesmo texto dezenas de vezes
     * a cada loot. A mensagem de inventário leva só o que muda — id, quantidade e onde está.
     */
    items: z.array(z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      appearanceId: z.number().int().positive(),
      weight: z.number().nonnegative(),
      /** Onde ele veste, ou `null` quando não veste em lugar nenhum. */
      slot: z.string().nullable(),
      /** Ocupa as duas mãos (#152). `default`: nó anterior manda sem. */
      twoHanded: z.boolean().default(false),
      /**
       * Preço de venda ao NPC, ataque e armadura (#337). Opcionais sem default:
       * um nó anterior manda sem, e o cliente novo não pode recusar a mensagem.
       */
      value: z.number().int().nonnegative().optional(),
      attack: z.number().int().nonnegative().optional(),
      armor: z.number().int().nonnegative().optional(),
      /**
       * Como a arma bate (#152): o tipo e o alcance, para o tooltip e para o seletor de munição
       * saber a família. Mana por golpe e faixa de dano ficam de fora — são balanceamento que o
       * cliente não simula (invariante 4).
       */
      weapon: z.object({
        kind: z.string().min(1),
        range: z.number().int().positive(),
        ammoFamily: z.string().min(1).optional(),
      }).optional(),
    })),
    /**
     * A munição que existe (#152, ADR 0026 decisão 3): o seletor no slot do escudo lista a
     * família do bow, com o preço por tiro — o único número de balanceamento aqui, pela mesma
     * razão do preço do supply: é o que o jogador olha para escolher. `default([])`: nó anterior.
     */
    ammunition: z.array(z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      family: z.string().min(1),
      attack: z.number().int().nonnegative(),
      price: z.number().int().nonnegative(),
      appearanceId: z.number().int().positive(),
      requires: z.object({ level: z.number().int().positive().optional() }),
    })).default([]),
    /**
     * As vocações (#154), para o diálogo do level da escolha. Os três ganhos por level
     * aparecem porque são o que o jogador olha para escolher — como o preço do supply. A arma
     * inicial vem como id de item, resolvido em `items`. `default([])`: nó anterior.
     */
    vocations: z.array(z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      healthPerLevel: z.number().int().nonnegative(),
      manaPerLevel: z.number().int().nonnegative(),
      capacityPerLevel: z.number().int().nonnegative(),
      startingWeaponItemId: z.string().min(1),
    })).default([]),
    /** O level da escolha (#154): a tela não pode ter o 8 em código. `default(0)`: nó anterior — sem diálogo. */
    vocationLevel: z.number().int().nonnegative().default(0),
    /**
     * A tabela ESTÁTICA de velocidade e regeneração passiva (FUN-119/FUN-36/FUN-68, #361):
     * quanto todo personagem tem ao nascer e quanto ganha por level, na fórmula
     * `startingSpeed + (level - 1) * speedPerLevel` que `packages/sim/src/progression.ts`
     * já usa — e o quanto ele regenera de HP/mana por segundo, que NÃO varia por level.
     *
     * Vocação-independente: hoje nenhuma vocação do conteúdo altera velocidade ou
     * regeneração, então o campo vive UMA vez aqui, e não dentro de cada `vocations[]` — o
     * mesmo motivo de `vocationLevel` já ser irmão de `vocations`, e não campo de cada uma.
     *
     * O valor AO VIVO (afetado por haste, level atual do personagem) é outro campo, em
     * `player-stats` — SV-04 (#340), fora desta mensagem. `.optional()`, sem `.default()`,
     * como `bestiary`: um nó `game` anterior a este deploy manda `catalogue` sem a chave, e o
     * cliente trata ausência como "—", nunca como zero (a convenção de `Aggregates` opcionais).
     */
    progression: z.object({
      startingSpeed: z.number().int().positive(),
      speedPerLevel: z.number().int().nonnegative(),
      regen: z.object({
        healthPerSecond: z.number().nonnegative(),
        manaPerSecond: z.number().nonnegative(),
      }),
    }).optional(),
  }),
  'creature-health': z.object({ id: z.number().int(), health: z.number(), maxHealth: z.number() }),
  /**
   * O número que flutua sobre a criatura (FUN-109). É APRESENTAÇÃO do que `creature-health`
   * já disse: a vida nova vai na outra mensagem, e esta leva só o quanto mudou e como.
   *
   * `amount` é sempre `>= 0`, e `kind` diz o sinal: `heal` é cura (verde), o resto é dano.
   * Um número negativo aqui seria "cura escrita como dano negativo" — dois jeitos de dizer a
   * mesma coisa, e o cliente tendo de reconhecer os dois. Zero é permitido de propósito: o
   * golpe que a armadura absorveu inteiro também aparece, como no Tibia, senão o jogador
   * não vê que o monstro está tentando.
   */
  'creature-hit': z.object({
    id: z.number().int(),
    amount: z.number().int().nonnegative(),
    kind: z.enum(['melee', 'spell', 'heal']),
  }),
  /**
   * Uma animação de efeito num tile (FUN-109): a explosão da magia, o sangue do golpe, o
   * brilho da poção. Vai no TILE, e não na criatura, porque é onde o Tibia desenha — e
   * porque um efeito de área acontece em tiles onde não há ninguém.
   *
   * `effectId` é id do pacote de assets, resolvido pela tabela de aparências em `content/`
   * (invariante 6). O protocolo não sabe o que o 13 desenha; só sabe que zero não é nada.
   */
  effect: z.object({ position: Point, effectId: z.number().int().positive() }),
  /**
   * Um projétil de `from` a `to` (FUN-109). O cliente anima o trajeto; o servidor já resolveu
   * o acerto — a mensagem não diz se acertou, porque o `creature-hit` que vem junto é quem diz.
   */
  missile: z.object({ from: Point, to: Point, missileId: z.number().int().positive() }),
  'player-stats': z.object({
    health: z.number(), maxHealth: z.number(), mana: z.number(), maxMana: z.number(),
    level: z.number().int(), xp: z.number(), capacity: z.number(), gold: z.number(), staminaMs: z.number(),
    targetId: z.number().int().nonnegative().nullable().default(null),
    /**
     * A munição escolhida por família (#152), a forma do Huntera (`ammo-selection`): `null` é
     * "a grátis". `default`: um nó `game` anterior manda sem, e o cliente mostra a grátis.
     */
    ammo: z.object({ arrow: z.string().nullable(), bolt: z.string().nullable() })
      .default({ arrow: null, bolt: null }),
    /** A vocação (#154). `null` é "ainda não escolheu". `default(null)`: nó anterior manda sem. */
    vocationId: z.string().nullable().default(null),
    speed: z.number().int().nonnegative().default(0),
    skills: z.record(z.string().min(1), SkillProgress).default({}),
    magicLevel: SkillProgress.default({ level: 0, percentToNext: 0 }),
  }),
  'experience-gain': z.object({ amount: z.number(), sourceId: z.number().int().optional() }),
  'system-message': z.object({ level: z.enum(['info', 'warning', 'error']), text: z.string() }),
  'chat-message': z.object({ channel: z.string(), author: z.string(), text: z.string() }),
  /**
   * O extrato: a sessão acabou, por quê, e o que rendeu (§16.2, ADR 0010).
   *
   * O `reason` não é enfeite. "Sua hunt foi encerrada por manutenção" é aceitável; sumir sem
   * explicação não é — e é assim que um jogo idle perde a confiança de quem deixou o
   * personagem rendendo.
   */
  'session-ended': z.object({
    reason: z.enum(['manual-exit', 'exit-rule', 'death', 'drain', 'completed']),
    aggregates: Aggregates,
    notableEvents: z.array(NotableEvent),
  }),
  /**
   * Condições ativas do jogador (#341, SV-05): tempo restante de cada condição temporária.
   * Só as de `ACTIVE_CONDITION_KINDS`: o `sim` admite chave livre desde o CMB-07 (DOT de
   * ability, campo), e o host filtra pelo vocabulário fechado daqui — uma chave nova chega ao
   * cliente quando ganhar badge, não antes.
   */
  'active-conditions': z.object({
    conditions: z.array(z.object({
      kind: z.enum(ACTIVE_CONDITION_KINDS),
      remainingMs: z.number().int().nonnegative(),
    })),
  }),
  /**
   * O total de jogadores online (SV-07). Um inteiro simples — não há por que ser mais que
   * isso, e um campo a mais aqui é um campo a mais para versionar depois.
   */
  'player-count': z.object({ count: z.number().int().nonnegative() }),
  /**
   * O Follow do bot mudou de estado (#393, ADR 0033 decisão 9): ligou, desligou, ou foi
   * interrompido porque o alvo morreu, saiu ou ficou inalcançável. Por PERSONAGEM.
   */
  'follow-state': z.object({
    active: z.boolean(),
    /** O alvo tentado — presente mesmo com `active: false`, para a UI dizer QUEM parou. */
    targetId: z.string().min(1),
    reason: z.enum(['dead', 'left', 'unreachable']).optional(),
  }),
} as const satisfies Record<S2CName, z.ZodType>;

export type C2SProps<N extends C2SName> = z.infer<(typeof C2S_SCHEMAS)[N]>;
export type S2CProps<N extends S2CName> = z.infer<(typeof S2C_SCHEMAS)[N]>;

/**
 * Carga de uma mensagem, com o caso vazio tratado.
 *
 * `z.object({})` infere `Record<string, never>` — um objeto que não aceita chave NENHUMA. A
 * interseção `{ type: 'logout' } & Record<string, never>` é impossível de satisfazer, então
 * `logout`, `client-ready` e `session-attach` eram, na prática, **impossíveis de construir em
 * código tipado**: o cliente não conseguia mandar nenhuma das três. Só não tinha aparecido
 * porque ninguém tinha tentado.
 *
 * O teste é `string extends keyof P`: só um objeto com assinatura de índice tem `string`
 * entre as chaves; um payload de verdade tem os nomes dos próprios campos.
 */
type Payload<P> = string extends keyof P ? unknown : P;

export type C2SMessage = { [N in C2SName]: { type: N } & Payload<C2SProps<N>> }[C2SName];
export type S2CMessage = { [N in S2CName]: { type: N } & Payload<S2CProps<N>> }[S2CName];
