// Um schema Zod por mensagem. É ele que valida a entrada ANTES de virar estado — mensagem
// malformada é recusada com erro tipado, nunca aplicada pela metade (invariante 4).

import { z } from 'zod';
import type { C2SName, S2CName } from './messages.js';

const Point = z.object({ x: z.number().int(), y: z.number().int(), z: z.number().int() });
const Direction = z.enum(['north', 'east', 'south', 'west']);

/**
 * Uma criatura como ela chega no estado completo. Mesmos campos do `creature-appear`, de
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
} as const satisfies Record<C2SName, z.ZodType>;

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
    /** Quem é o jogador nesta instância — sem isto a câmera não tem em quem centrar. */
    self: z.object({
      creatureId: z.number().int(),
      characterId: z.string(),
      health: z.number(), maxHealth: z.number(),
      mana: z.number(), maxMana: z.number(),
      level: z.number().int(), xp: z.number(),
    }),
    world: z.object({
      mapId: z.string().nullable(),
      creatures: z.array(CreatureState),
    }),
    aggregates: Aggregates,
    notableEvents: z.array(NotableEvent),
  }),
  'instance-enter': z.object({ instanceId: z.string(), map: z.string() }),
  'creature-appear': z.object({
    id: z.number().int(),
    position: Point, appearanceId: z.number().int(), name: z.string(),
    health: z.number(), maxHealth: z.number(),
  }),
  // Um passo é enviado UMA vez, com origem, destino e duração. O cliente interpola o
  // intervalo inteiro — não existe snapshot por tick (ADR 0001, seção de banda).
  'creature-move': z.object({
    id: z.number().int(),
    from: Point, to: Point, durationMs: z.number().positive(), pushed: z.boolean().optional(),
  }),
  'creature-disappear': z.object({ id: z.number().int() }),
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
    })),
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
      })),
      supplies: z.array(z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        price: z.number().int().nonnegative(),
        effect: z.string().min(1),
      })),
    }),
  }),
  'creature-health': z.object({ id: z.number().int(), health: z.number(), maxHealth: z.number() }),
  'player-stats': z.object({
    health: z.number(), maxHealth: z.number(), mana: z.number(), maxMana: z.number(),
    level: z.number().int(), xp: z.number(), capacity: z.number(), gold: z.number(), staminaMs: z.number(),
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
