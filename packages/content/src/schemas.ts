// Schemas de todo dado de jogo. São a definição normativa: o que não passa aqui não entra
// na simulação, e conteúdo inválido derruba o boot em vez de virar bug de balanceamento
// três semanas depois.

import { z } from 'zod';

/** Referência a uma aparência no pacote de assets. NUNCA um caminho de arquivo (invariante 6). */
const appearanceId = z.number().int().positive();

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
  'head', 'neck', 'chest', 'legs', 'feet', 'hand', 'shield', 'finger', 'ammo',
] as const;
export type ItemSlot = (typeof ITEM_SLOTS)[number];

/** De onde uma instância veio. É a proveniência do §25.3, e ela existe desde o dia um. */
export const ITEM_ORIGINS = ['loot', 'boss', 'quest', 'market', 'admin'] as const;
export type ItemOrigin = (typeof ITEM_ORIGINS)[number];

/**
 * A DEFINIÇÃO de um item (§21.2, FUN-76).
 *
 * **Atributos base são FIXOS.** Não há rolagem aleatória: duas espadas do mesmo id são
 * idênticas, e item melhor é item DIFERENTE. É a decisão do §21.2, e ela apaga toda a
 * matemática de variação por instância — junto com a pergunta "por que a minha é pior".
 *
 * O que distingue uma instância da outra é identidade e proveniência, não número.
 */
export const itemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** A ÚNICA ligação com arte (invariante 6, ADR 0008). Nunca um caminho de arquivo. */
  appearanceId,
  kind: z.enum(['weapon', 'armor', 'shield', 'ring', 'amulet', 'ammunition', 'other']),
  slot: z.enum(ITEM_SLOTS).optional(),
  /** Em unidades de capacidade. Capacidade é do personagem (§21.4). */
  weight: z.number().nonnegative(),
  /** Empilha na mesma linha de inventário? Munição empilha; espada não. */
  stackable: z.boolean().default(false),
  attack: z.number().int().nonnegative().default(0),
  armor: z.number().int().nonnegative().default(0),
  /**
   * O que o personagem precisa para equipar. Vazio é item que qualquer um veste.
   *
   * Vocação aqui é o mesmo campo que a magia usa (FUN-92): o personagem nasce sem uma e
   * escolhe no level 8, então item de vocação é inacessível até lá por construção.
   */
  requires: z.object({
    level: z.number().int().positive().optional(),
    vocationId: z.string().min(1).optional(),
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
  _open: z.string().optional(),
});

export type Item = z.infer<typeof itemSchema>;

export const monsterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  outfitId: appearanceId,
  recommendedLevel: z.number().int().positive(),
  health: z.number().int().positive(),
  experience: z.number().int().nonnegative(),
  /** Dano por ataque, antes de defesa. */
  attack: z.number().int().nonnegative(),
  armor: z.number().int().nonnegative(),
  /** Milissegundos entre ataques. Tempo decorrido, nunca contagem de tick (invariante 2). */
  attackIntervalMs: z.number().int().positive(),
  /** Tiles por passo de movimento, em milissegundos. */
  stepDurationMs: z.number().int().positive(),
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
});

export const huntDifficultySchema = z.object({
  /** Monstros por ponto de spawn. Sem variação aleatória de densidade no MVP (§14.5). */
  perSpawnPoint: z.number().int().positive(),
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
    z.enum(['beginner', 'professional', 'hero', 'legendary']),
    huntDifficultySchema,
  ).refine((d) => Object.keys(d).length > 0, 'a hunt precisa de ao menos uma dificuldade'),
});

export const vocationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  healthPerLevel: z.number().int().nonnegative(),
  manaPerLevel: z.number().int().nonnegative(),
  capacityPerLevel: z.number().int().nonnegative(),
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
   * Milissegundos por tile andado. Fica aqui, e não em `combat`, porque velocidade é
   * atributo do personagem: quando haste e botas existirem, elas modificam ESTE número.
   */
  stepDurationMs: z.number().int().positive(),
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
 * Coeficientes de combate. O §12.1 é explícito: fórmula e parâmetro são CONTEÚDO, não código.
 *
 * O que o PRD decide (§12.2) e o que ele não decide estão separados de propósito — o que não
 * está decidido carrega `_open`, para não passar por escolha de balanceamento.
 */
export const combatSchema = z.object({
  id: z.literal('baseline'),
  /** §12.2 DECIDIDO: dodge não zera o dano, reduz à metade. */
  dodgeMultiplier: z.number().min(0).max(1),
  /** Quanto da armadura do alvo é subtraído, por tipo de ataque. */
  armorEffectiveness: z.object({
    melee: z.number().min(0).max(1),
    magic: z.number().min(0).max(1),
  }),
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
    /** Alcance em tiles. `1` é corpo a corpo — o único que existe hoje. */
    attackRange: z.number().int().positive().default(1),
    armor: z.number().int().nonnegative(),
    dodgeChance: z.number().min(0).max(1),
  }),
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
export const BOT_VOCABULARY_VERSION = 1;

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
    z.object({ on: z.literal('spell-cast'), pointsPerMana: z.number().positive() }),
  ]),
  /** Fração acrescentada ao poder por nível ACIMA do inicial. `0` é skill que não bate. */
  damagePerLevel: z.number().nonnegative().default(0),
  _open: z.string().optional(),
});

export type Skill = z.infer<typeof skillSchema>;

/** Os quatro tipos de condição, como lista — é o que o gate do bot básico nomeia (FUN-81). */
export const BOT_CONDITION_KINDS = ['hp', 'mana', 'targets', 'target-hp'] as const;
export type BotConditionKind = (typeof BOT_CONDITION_KINDS)[number];

export const botConditionSchema = z.discriminatedUnion('kind', [
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

/**
 * Como o bot ESCOLHE o alvo (§13.6).
 *
 * Fechado como o resto do vocabulário: o compilador só transforma em política o que conhece.
 * `nearest` é o padrão e é o que a hunt sempre fez — as outras duas existem porque "termine o
 * que está quase morto" e "bata no mais gordo primeiro" são estratégias diferentes, e escolher
 * entre elas é do jogador.
 */
export const botTargetPolicySchema = z.enum(['nearest', 'lowest-hp', 'highest-hp']);

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

/** Uma linha de slot: a condição e o que fazer quando ela vale. */
export const botRuleSchema = z.object({
  when: botConditionSchema,
  do: botActionSchema,
});

/**
 * As cinco categorias do §13.5. Independentes: uma ação de poção não consome o cooldown de
 * runa, e não há prioridade global entre elas — cada uma avalia os próprios slots de cima
 * para baixo, e a primeira regra válida executa.
 */
export const BOT_CATEGORIES = ['heal', 'potion', 'attack', 'rune', 'support'] as const;
export type BotCategory = (typeof BOT_CATEGORIES)[number];

/**
 * Os limites do bot, em CONTEÚDO e não em código (§13.3).
 *
 * Quantos slots cada categoria tem é balanceamento, e balanceamento mora onde um designer o
 * alcança sem deploy. O `_open` registra que o subconjunto do bot básico (até o level 49)
 * continua `[ABERTO]` no PRD §13.2.
 */
export const botSchema = z.object({
  id: z.literal('baseline'),
  /** A versão do vocabulário que este conteúdo entende. Recusa configuração de outra. */
  vocabularyVersion: z.number().int().positive(),
  /** Cooldown de cada categoria, independente das outras. §13.5: 1 s. */
  categoryCooldownMs: z.number().int().positive(),
  /** A partir de qual level o bot avançado abre. §13.2: 50. */
  advancedFromLevel: z.number().int().positive(),
  /**
   * O que só o bot AVANÇADO pode usar (§13.2, FUN-81).
   *
   * O gate é por LEVEL: abaixo de `advancedFromLevel` a configuração é recusada se usar
   * qualquer coisa listada aqui. Uma lista de exceções, e não uma lista do que o básico
   * permite, porque o básico é a regra e o avançado é o recorte — descrever a regra por
   * enumeração faria toda adição ao vocabulário exigir uma edição aqui para continuar
   * funcionando, e esquecer essa edição travaria o recurso novo para todo mundo abaixo do 50.
   *
   * **Vazia hoje, e isso é deliberado.** O subconjunto exato do bot básico é `[ABERTO]` no PRD
   * §13.2, e o que o §13.2 cita como avançado — lure dinâmico e ring swap — é vocabulário que
   * ainda não existe (FUN-87). Inventar um recorte aqui seria decidir balanceamento por conta
   * própria e disfarçá-lo de implementação. O mecanismo entra agora; o recorte entra quando o
   * PRD o decidir, editando dado.
   */
  advancedOnly: z.object({
    conditions: z.array(z.enum(BOT_CONDITION_KINDS)).default([]),
    targetPolicies: z.array(botTargetPolicySchema).default([]),
    postures: z.array(z.enum(['stand', 'follow', 'keep-distance'])).default([]),
  }).default(() => ({ conditions: [], targetPolicies: [], postures: [] })),
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
 * A configuração que o JOGADOR salva. Não é conteúdo — é dado dele —, mas o schema mora aqui
 * porque quem define o que é aceitável é o vocabulário, e o vocabulário é conteúdo.
 *
 * Os limites de slot NÃO são checados aqui: eles vêm de `bot/baseline.json`, que o schema não
 * enxerga. Quem cruza os dois é `validateBotConfig`.
 */
export const botConfigSchema = z.object({
  version: z.number().int().positive(),
  /** Alvo e postura (FUN-85). Ausente é `nearest` + `stand`, o comportamento de sempre. */
  targeting: botTargetingSchema.default(defaultTargeting),
  /**
   * Regras de saída (FUN-86). Lista vazia é a hunt que só encerra por morte ou por ação do
   * jogador — o comportamento de antes desta issue, e o default para quem não configurou.
   */
  exit: z.array(botExitRuleSchema).default(() => []),
  /**
   * O bot AVANÇADO (§13.2, FUN-87). Ausente é o bot básico, que é o de todo mundo abaixo do
   * level 50 — e de quem, acima dele, não configurou nada disso.
   */
  lure: botLureSchema.optional(),
  ringSwap: botRingSwapSchema.optional(),
  heal: z.array(botRuleSchema),
  potion: z.array(botRuleSchema),
  attack: z.array(botRuleSchema),
  rune: z.array(botRuleSchema),
  support: z.array(botRuleSchema),
});

export type BotOperator = z.infer<typeof botOperator>;
export type BotCondition = z.infer<typeof botConditionSchema>;
export type BotAction = z.infer<typeof botActionSchema>;
export type BotRule = z.infer<typeof botRuleSchema>;
export type BotLimits = z.infer<typeof botSchema>;
export type BotConfig = z.infer<typeof botConfigSchema>;

/**
 * Uma magia (FUN-74, §4.1, §9.2).
 *
 * Tudo em CONTEÚDO: custo, cooldown, alcance e efeito. O motor não sabe quanto cura nem quanto
 * custa — ele sabe *que* cura e *que* custa. É a mesma regra que vale para monstro e progressão,
 * e é o que permite balancear sem deploy.
 *
 * O `kind` do efeito é fechado como o do bot, e pela mesma razão: o `sim` só executa o que
 * conhece, e uma magia com efeito desconhecido é recusada no boot em vez de virar uma linha
 * morta que ninguém explica.
 */
export const spellSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Mana gasta ao lançar. Sem mana, o lançamento é RECUSADO — não fica devendo. */
  manaCost: z.number().int().nonnegative(),
  /** Tempo até poder lançar de novo. Evento na fila, nunca acumulador (ADR 0020). */
  cooldownMs: z.number().int().positive(),
  /** Level mínimo. */
  minLevel: z.number().int().positive().default(1),
  /**
   * Vocação exigida (§9.2, FUN-92). Ausente é magia que qualquer um lança.
   *
   * O personagem nasce SEM vocação e escolhe no level 8 (§7.4), então uma magia com requisito
   * é inacessível até lá — por construção, não por regra escrita em outro lugar.
   */
  vocationId: z.string().min(1).optional(),
  effect: z.discriminatedUnion('kind', [
    /** Cura o próprio lançador. Alcance não se aplica. */
    z.object({ kind: z.literal('heal'), amount: z.number().int().positive() }),
    /**
     * Dano no alvo. Passa por `resolveDamage` com `kind: 'magic'`, então armadura mágica e
     * esquiva valem — os dois são conteúdo (`combat/baseline.json`), não motor.
     */
    z.object({
      kind: z.literal('damage'),
      power: z.number().int().positive(),
      range: z.number().int().positive(),
      /**
       * A ÁREA atingida, centrada no alvo (FUN-92). Ausente é alvo único.
       *
       * Centrada no ALVO, e não no lançador: uma magia centrada em quem lança não precisa de
       * alvo nenhum, e isso muda o portão inteiro — some a recusa por `no-target`, some a
       * conferência de alcance. É outra forma de magia, não um parâmetro desta, e entra quando
       * o §4.1 disser que ela existe.
       *
       * `radius` é distância de Chebyshev, a mesma da grade: raio 1 pega os oito vizinhos do
       * alvo mais ele.
       */
      area: z.object({ radius: z.number().int().positive() }).optional(),
    }),
  ]),
  _open: z.string().optional(),
});

/**
 * Um supply (FUN-77, §20.1 **[DECIDIDO]**).
 *
 * Poção e runa **não são itens físicos**: usar debita gold direto. Por isso supply tem preço e
 * não tem peso, slot nem instância — e por isso ele mora aqui, e não no catálogo de itens que
 * ainda não existe.
 */
export const supplySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Gold debitado por uso. Sem gold, o uso é RECUSADO — o saldo nunca fica negativo. */
  price: z.number().int().nonnegative(),
  effect: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('heal'), amount: z.number().int().positive() }),
    z.object({ kind: z.literal('mana'), amount: z.number().int().positive() }),
  ]),
  _open: z.string().optional(),
});

export type Spell = z.infer<typeof spellSchema>;
export type Supply = z.infer<typeof supplySchema>;

export type Monster = z.infer<typeof monsterSchema>;
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
export const tilemapSchema = z.object({
  id: z.string().min(1),
  z: z.number().int(),
  grid: z.array(z.string().min(1)).min(1),
  /**
   * Onde um personagem nasce neste mapa (FUN-60, FUN-69). É CONTEÚDO, não código: o valor
   * antigo era um literal `(0,0)` no servidor, que é parede na borda de qualquer tilemap. O
   * `buildContent` valida contra `isBlocked` — ponto de entrada em parede quebra o boot, e
   * não o jogador.
   */
  entryPoint: z.object({ x: z.number().int(), y: z.number().int() }).optional(),
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
export type RouteData = z.infer<typeof routeSchema>;
export type Point = z.infer<typeof point>;
