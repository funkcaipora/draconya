# Combate

**Status:** parcial — resolução de dano (FUN-35), resolver canônico e outcome v1 (CMB-02), tipos
de dano e mitigação (CMB-03), defesa, escudo e blocking físico (CMB-04), famílias de arma e
proficiências (CMB-05), abilities de monstro e apresentação tipada (CMB-06), condições
generalizadas, dano contínuo e campos de tile (CMB-07), outcomes avançados de crítico, leech e
mana shield (CMB-08), auditoria de apresentação de combate (CMB-09, bloqueada pela biblioteca
parcial), conformance seedada e benchmark misto (CMB-10), motor de magias com alvo único, área e
requisito de vocação (FUN-74, FUN-92), skills
por uso (FUN-75), contrato de compatibilidade de combate (ADR 0031) e IA de monstro do TFS —
chance por intervalo, onda/feixe direcionais, defesa (cura própria), troca de alvo e fuga (#518)
implementados
por uso (FUN-75), contrato de compatibilidade de combate (ADR 0031), o dano de arma do Canary
com variância e chance de acerto à distância (#522, ADR 0037 d.5, perfil `combat-v2`), o
pipeline de recebimento do `Creature::blockHit` — defesa com `blockCount`, armadura em faixa e
mitigação percentual (#548, M30-01, ADR 0040, perfil `combat-v3`), a condição de velocidade
com sinal — paralyze/slow de ataque de monstro e haste de defesa (CMB-11, #556) —, o desvio de
passo da condição drunk (M31-03, #558, ADR 0041) —, a seleção
ponderada de alvo do Canary (nearest/health/damage/random, #541) e a invocação de monstro por
monstro (#546, TFS/Canary `monster.summon`/`maxSummons`) e a postura de luta do jogador —
ofensiva/balanceada/defensiva, com o fator de ataque, o de defesa dinâmico e o de mitigação do
Canary (M30-03, #550) implementados
**PRD:** §12
**Épico:** E2

## Contrato de compatibilidade (ADR 0031)

A referência de combate está fixada pelo
[ADR 0031](../adr/0031-contrato-de-compatibilidade-de-combate-e-migracao.md): **Tibia 13.32**,
com o mecanismo lido de TFS/Canary (GPL v2 — só mecanismo e caso de borda, nunca código copiado)
e os números observados no TibiaWiki. O perfil semântico de combate é conteúdo versionado: a
sessão o congela na criação e não o troca no meio da hunt.

Três perfis existem hoje. `combat-v1` foi o primeiro, aditivo, e continua servindo sessão
gravada antes do #522 (retomada de perfil `breaking` diferente é recusada, nunca reinterpretada
— ADR 0031). `combat-v2` (#522) trocou o lado OFENSIVO: dano de arma pela fórmula do Canary, com
variância pela normal truncada, e chance de acerto à distância por skill e tile — o que o ADR
0037 decisão 5 pediu para o M28. `combat-v3` (#548, M30-01, ADR 0040) — o que
`packages/content/data/combat/baseline.json` declara desde esta issue — troca o lado DEFENSOR: o
bloqueio binário do CMB-04 vira a ordem e a matemática do `Creature::blockHit` do Canary (defesa
com `blockCount`, armadura em faixa, mitigação percentual) — ver a seção "O pipeline de
recebimento do combat-v3" adiante. A MITIGAÇÃO (Dodge, defesa/escudo, crítico, armadura, piso,
resistência, imunidade) continua **a mesma** entre `combat-v1` e `combat-v2` — o que o
`combat-v2` muda vive antes dela, na seção "Como cada arma bate" adiante; o `combat-v3` é quem
finalmente muda esse pipeline.

Este documento separa três coisas: o que está **entregue** (comportamento atual), o que é
**exceção de produto aprovada** e o que ainda é **lacuna**. Nenhuma hipótese entra como
comportamento entregue.

## Comportamento atual

A resolução de dano entregue é `resolveDamage` em `packages/sim/src/combat/damage.ts`. Desde o
CMB-02 ele é o **ponto público único** de resolução — arma, magia, runa e monstro passam por
ele — e devolve um `DamageOutcome` versionado e auditável em vez de um número solto. A mitigação
(armadura por tipo, piso, uma rolagem de Dodge sempre consumida e arredondamento no fim) é a
mesma sob `combat-v1` e `combat-v2`; a seção "O resolver canônico" detalha o contrato.

## Compatibilidade aprovada

Regras do PRD §12 que desviam explicitamente do Tibia e valem como exceção de produto — não são
hipótese nem fidelidade pendente:

Primeira, e **só em corpo a corpo desde o #522**: o ataque do jogador sempre acerta. Não existe
rolagem de acerto ofensivo corpo a corpo — o Canary também não rola acerto ofensivo em corpo a
corpo no PvE, então isto deixou de ser exceção e passou a ser fidelidade (`player-always-hit-melee`
no `combat-v2`, ver `COMBAT_V2` em `packages/content/src/schemas.ts`). **A DISTÂNCIA não é mais
exceção**: desde o `combat-v2` ela rola a chance de acerto do Canary, por skill e por tile — ver
"Como cada arma bate".

Segunda: existe o atributo Dodge no defensor. Quando o Dodge ativa, o ataque recebido causa metade do dano que causaria normalmente. Isso vale contra qualquer tipo de ataque recebido — incluindo magia e ataques de boss —, não apenas contra combate corpo a corpo. A chance de Dodge é percentual e pode vir de fontes como bônus permanentes de Bestiário. A #522 tinha mantido este mecanismo por acreditar que correspondia ao charm de esquiva do Tibia (que também reduz, não zera) — **o #603 mostrou que não**: o Dodge do charm NEGA o golpe inteiro (`Game::combatChangeHealth`, `return true` no ramo do Dodge), e o Dodge de metade não existe no Canary. **No `combat-v4` esta exceção SAI** (ADR 0053 d.5): `player.dodgeChance` é `0`, o resolver nem sorteia o Dodge, e o único Dodge é o charm — ver "Charms em combate" abaixo. `combat-v1`/`v2`/`v3` seguem com ele, congelados.

Bônus permanentes obtidos via Bestiário são válidos apenas em PvE. O PvP (Guild War) não herda automaticamente essas vantagens de farm.

## Lacunas

Ainda não entregues; cada uma será implementada sob o contrato do ADR 0031, com o perfil
correspondente:

- PvP e Guild War, fora do M19.

## O que já existe

`resolveDamage` em `packages/sim/src/combat/damage.ts`. Função pura a menos do RNG, que é o
**da sessão**: semeado e determinístico (FUN-25). `Math.random()` ali tornaria "por que eu
morri" uma pergunta sem resposta.

A ordem do cálculo, e cada passo tem um porquê (a versão completa, com os estágios do CMB-03,
está em "Resistência, vulnerabilidade e imunidade"):

1. **Rola o dodge — sempre**, mesmo contra alvo com chance zero. Pular a rolagem faria a
   sequência do gerador depender de um atributo do alvo, e aí dar dodge a um monstro
   deslocaria todo o loot que vem depois, num efeito que ninguém ligaria à causa.
2. **Defesa/escudo** (CMB-04): com fonte elegível e tipo aprovado, uma segunda rolagem decide o
   bloqueio; sem fonte, o estágio é identidade e não consome sorteio.
3. Subtrai a armadura, com efetividade **por tipo de dano**.
4. Aplica o **piso**: nem a armadura mais alta zera um golpe. Dano zero contra alvo pesado
   vira impasse silencioso, sem nada na tela dizendo o motivo.
5. Aplica a resistência/vulnerabilidade e depois a imunidade explícita, que zera.
6. Se esquivou, corta pela metade.
7. **Arredonda só no fim.** Arredondar antes do dodge faria 50% de 3 virar 2, e o jogador
   veria uma esquiva que reduziu um terço.

O bônus de Bestiário é **PvE-only por construção**: `resolveDamage` recebe o contexto, e o
acréscimo só entra quando ele é `pve`. A Guild War não tem como herdá-lo por esquecimento.

## O resolver canônico e o outcome v1 (CMB-02)

O CMB-02 materializou o contrato do ADR 0031. A resolução deixou de devolver um número e passou
a devolver um **outcome** que explica cada estágio, para o host e o extrato conseguirem auditar o
dano sem recalcular nada (DT-02). O contrato é:

```ts
type DamageSource = 'basic-attack' | 'spell' | 'rune' | 'monster-attack';

// O vocabulário canônico vive em `@draconya/content` e o `sim` o importa (CMB-03).
type DamageType =
  | 'physical' | 'energy' | 'earth' | 'fire' | 'ice' | 'holy' | 'death' | 'arcane';

interface DamageIntent {
  readonly rawDamage: number;
  readonly source: DamageSource;
  readonly damageType: DamageType;
  readonly secondary?: {         // dano composto (#473); ausente é o default neutro
    readonly rawDamage: number;
    readonly damageType: DamageType;
  };
}

interface DamageOutcome {
  readonly profile: string;          // 'combat-v1' — o perfil que resolveu
  readonly intent: DamageIntent;     // a entrada, preservada
  readonly damageType: DamageType;
  readonly afterDefense: number;     // depois da defesa/escudo (CMB-04)
  readonly afterArmor: number;       // depois da armadura, ainda ANTES do piso
  readonly armorReduction: number;   // quanto a armadura subtraiu
  readonly minimumDamage: number;    // o piso que valeu
  readonly afterResistance: number;  // depois do piso e da resistência, ANTES da imunidade
  readonly immune: boolean;          // imunidade explícita ao tipo
  readonly dodged: boolean;
  readonly critical: boolean;        // crítico rolou e ativou (CMB-08)
  readonly resolvedDamage: number;   // o que o ruleset aplica
  readonly secondaryOutcome?: DamageOutcome; // o componente secundário, se declarado (#473)
}
```

O outcome é **efêmero**: nunca vai ao cliente e nunca entra no snapshot. O ruleset continua
aplicando só `resolvedDamage` — `receiveDamage`, atribuição, `creature-hit` e `resolveDeath` não
mudaram. O resolver não cobra mana nem gold, não agenda evento, não escreve vida, não atribui
dano e não decide morte.

### O pipeline canônico e o dano composto (#473)

A #473 consolidou o pipeline sem mudar número nenhum — é aditiva sob o mesmo `combat-v1`:

- **Armadura e escudo incidem SÓ onde o conteúdo manda.** `armorEffectiveness` vale 1 apenas em
  `physical` e 0 em todo o resto, e `defense.blockTypes` aprova só `physical`. Dano elemental
  atravessa os dois estágios — sem consumir a rolagem de bloqueio — e aplica a tabela de
  resistência/fraqueza/imunidade do alvo.
- **Sem splitting em área.** Em magia e runa de área o poder é rolado e aplicado de forma
  independente por alvo: o primeiro alvo leva o mesmo golpe com um ou com cinco monstros na
  forma, e o total cresce com a contagem de alvos.
- **O `damageType` resolvido fica no outcome** (RF-05), e o `secondaryOutcome` estrutura o dano
  composto para o dia em que um golpe tiver dois componentes: declarado, o secundário passa
  pelos mesmos estágios contra o mesmo defensor — inclusive a própria rolagem de Dodge — e é
  resolvido depois do primário inteiro. **Nenhum conteúdo o declara ainda**, e ausente ele não
  consome rolagem nenhuma: o v1 segue bit a bit.

### A taxonomia de dano (CMB-03; drown/lifedrain/manadrain pelo #547, M29-07)

A lista canônica é a dos DEZ `CombatType` do Tibia 13.32 — físico, energia, terra, fogo, gelo,
sagrado, morte, afogamento (`drown`), dreno de vida (`lifedrain`) e dreno de mana (`manadrain`)
— mais `arcane`, que é a magia **não-elemental** (ou cujo elemento o conteúdo ainda não
declarou) e preserva o vocabulário `melee`/`magic` do v1. A fonte única é `DAMAGE_TYPES` em
`@draconya/content`; o `sim` importa `DamageType` e não redeclara o enum. A emenda de 2026-09-17
no [ADR 0031](../adr/0031-contrato-de-compatibilidade-de-combate-e-migracao.md) fixa a lista
original de sete mais `arcane`; o #547 a estende com os três tipos de dreno/afogamento.

`lifedrain` e `manadrain` são DANO, nunca cura de quem ataca — a correção que o #547 fez sobre o
inventário de paridade: o Canary (`Creature::mitigateDamage`, `creature.cpp:911-921`) só os
isenta da mitigação percentual, nunca soma vida ou mana em quem golpeia. `manadrain` resolve
contra a MANA do alvo, não a vida (`min(mana, dano)`, sem mana shield — ver "Manadrain resolve
contra a mana" abaixo); `drown` e `lifedrain` são dano de vida comum, indistinguível de
`physical`/`fire`/etc. no pipeline.

Tipo é separado de **origem** (`source`) e de **efeito visual** (`CreatureHit.source`): o mesmo
elemento pode vir de fontes diferentes, e o mesmo efeito pode desenhar sem dizer qual fórmula
resolveu (DT-01).

| Produtor | `source` | `damageType` | default que preserva o v1 |
|---|---|---|---|
| corpo a corpo (arma ou desarmado) | `basic-attack` | `weapon.damageType` / `combat.player.damageType` | `physical` |
| bow / munição | `basic-attack` | `ammunition.damageType` | `physical` |
| wand / rod | `basic-attack` | `weapon.damageType` | `arcane` |
| magia de dano | `spell` | `effect.damageType` | `arcane` |
| runa (supply de ataque) | `rune` | `effect.damageType` | `arcane` |
| ataque de monstro | `monster-attack` | `monster.damageType` | `physical` |

Um elemento só é declarado onde o catálogo o diz — nunca inferido do NOME do item ou da magia
(DT-03). A wand of vortex declara `energy`, o snakebite rod `earth`, a Avalanche `ice` e as
magias cujo elemento o TibiaWiki fixa declaram o seu. Onde o elemento é genuinamente indefinido,
o default `arcane` é o valor honesto. `physical-strike` fica em `arcane` por decisão desta
tarefa: declarar `physical` faria a armadura passar a contar e mudaria o dano já entregue, o que
exige perfil novo — está marcado em `_open` no arquivo.

Os cinco produtores — golpe básico (com seus três modos), magia, runa e monstro — passam pelo
MESMO `resolveDamage`; nenhum calcula dano por fora. `test('todo dano passa pelo resolver
canônico')` em `hunt.test.ts` prende isso.

### Resistência, vulnerabilidade e imunidade (CMB-03)

Cada entidade pode declarar `mitigation: { resistances, immunities }` — o monstro e o
EQUIPAMENTO (item). A resistência é uma fração por tipo em `[-1, 1)`: positiva reduz
(`dano × (1 − r)`), negativa é vulnerabilidade e amplifica (`dano × (1 + |r|)`). `1` é recusado
no boot porque seria imunidade disfarçada, e imunidade é **explícita** (DT-02) — declarar
resistência e imunidade para o mesmo tipo também é recusado. O perfil é compilado no boot para
uma tabela completa por tipo (lookup O(1)) e um `Set` de imunidade.

**O MONSTRO vai até -200 % (#683, M30-G6).** `monsterMitigationSchema` aceita resistência em
`[-2, 1)` — o `minElementalResistance` do Canary: `-2` TRIPLICA o dano (`(100 − (−200)) / 100`),
o que o estágio de resistência já fazia; só o schema barrava. O ITEM continua em `[-1, 1)`. O
teto `< 1` vale para os dois: `elements ≥ 100` do Canary vira IMUNIDADE no importador (#578),
nunca resistência de 100 % (DT-02).

**Cura por elemento e reflexo do monstro (#683, só `combat-v3`).** O monstro declara, além da
mitigação, dois campos por tipo, em PERCENTUAL INTEIRO (a escala do Canary, como o reflexo de
item do #552):

- `elementHealing.<tipo>` (`monster.heals`, teto 500): o golpe daquele tipo CURA o monstro em
  `ceil(dano já crítico × p / 100)`, calculado ANTES de qualquer bloqueio — então cura mesmo com
  o monstro IMUNE ao tipo (`DamageOutcome.elementHealing`). A cura soma primário e secundário e é
  aplicada DEPOIS do dano e do reflexo (`creature-healed`, `source: 'monster'`); golpe que mata
  não cura, e de vida cheia nada é emitido. Só com atacante criatura: golpe, magia, runa e tique
  de condição com dono personagem — o tique de campo não cura;
- `reflect.<tipo>` (`monster.reflects`, teto 200 — `MAX_DAMAGE_REFLECTION`): o reflexo do #552
  com refletor `monster` — `floor(dano bloqueado × p / 100)` volta ao personagem com o TIPO
  original (o equipamento dele absorve, resiste e é imune normalmente), a qualquer distância, com
  o teto `ceil(1 % da vida máxima do personagem)`, como EXTENSÃO (nunca reflete de volta). Vale
  para golpe, magia e runa; sai depois do dano no monstro, mesmo no golpe que o mata.

A ordem de mitigação, congelada na emenda do ADR 0031:

1. **uma rolagem de Dodge, sempre consumida, primeiro ato** (posição do RNG é contrato);
2. defesa/escudo (CMB-04) — uma segunda rolagem, e só com fonte elegível e tipo aprovado;
3. armadura por tipo;
4. **piso de armadura** (`minimumDamageFraction`), DEPOIS da armadura e ANTES da resistência;
5. resistência/vulnerabilidade por tipo;
6. imunidade explícita — zera, e o piso não a revoga;
7. corte do Dodge, se a rolagem ativou;
8. arredondamento só no fim, com piso em zero.

A ordem só se torna observável quando existe resistência ou imunidade: sem mitigação, todos os
estágios novos são identidade e o resultado é **bit a bit** o do v1. `damage.test.ts` tem a
matriz determinística — físico, elemental, vulnerável, resistente e imune — e um caso que
reprova se o piso trocar de lugar com a resistência.

### Defesa, escudo e blocking físico (CMB-04)

O estágio de defesa é o que o **escudo** ou a **arma corpo a corpo de uma mão** acrescentam ao
defensor. Ele não é a armadura: a armadura é do corpo e vale por tipo de dano; a defesa é da
peça e vale só contra os tipos aprovados — `physical` no `combat-v1`. A fórmula e a posição do
RNG estão congeladas na emenda do
[ADR 0031](../adr/0031-contrato-de-compatibilidade-de-combate-e-migracao.md).

- **Fonte** (`Inventory.defenseSource`, DT-01): escudo precede a arma de uma mão (DT-02), e a
  ausência das duas é `none`. Bow/twoHanded e wand/rod não dão defesa residual. A escolha mora
  no inventário porque é a mesma regra que já recusa bow com escudo (`hands-full`); o ruleset
  não repete a regra de slot.
- **Bloqueio**: com fonte e tipo aprovado, uma rolagem (`combat.defense.blockChance`) decide se
  a peça bloqueia; o quanto bloqueia é `min(defense, poder bruto)`. Sem fonte, ou em ataque
  elemental, o estágio é identidade e **não consome sorteio**.
- **O bloqueio nunca zera o golpe.** O piso (`minimumDamageFraction`) é calculado sobre o poder
  bruto, então a defesa reduz o dano mas o piso sobrevive.
- **Shielding sobe por USO** (§9.4): uma vez por ataque físico elegível recebido — nunca por
  tick, nunca condicionada ao HP perdido, nunca em ataque elemental. A skill multiplica a
  defesa da peça, e é a `skillId` de `combat.defense`.
- **Fight mode fica de fora** (DT-03). Não há seletor de postura, opcode, C2S nem UI de bloqueio
  nesta entrega; o mecanismo é autoritativo e uma intenção futura pode escolhê-lo, mas escolher
  a fonte é do equipamento, não do cliente.

O conteúdo real declara defesa nas armas corpo a corpo de uma mão (machete, steel axe, spike
sword) e no perfil; não existe item de escudo no catálogo ainda — o mecanismo do escudo é
exercitado por fixture, e um escudo real entra quando houver arte conferida (invariante 6).

**Este estágio é o do `combat-v1`/`combat-v2`.** Desde o `combat-v3` (#548, ver a seção "O
pipeline de recebimento do combat-v3" adiante), o bloqueio binário acima é SUBSTITUÍDO pela
ordem e pela matemática do `Creature::blockHit` do Canary — `combat.defense.blockChance` deixa
de ser lido. `resolveDefense`/`defense.ts` continuam existindo, intocados, para as sessões
fixadas em `combat-v1`/`v2`.

### Perfil, boot e retomada

O perfil mora no conteúdo (`combat.compatibilityProfile`, default `combat-v1` para legado e
fixture) e entra em `Content.version`; **não** é serializado no snapshot e
`SNAPSHOT_FORMAT_VERSION` não sobe por causa dele. Um perfil que o motor não conhece **derruba o
boot** em `buildContent` e o despachante do resolver **lança** — não existe fallback silencioso.
Um perfil novo exige ADR e uma nova entrada em `COMBAT_PROFILES`.

### Limites do v1

O perfil é ADITIVO e preserva bit a bit o resultado entregue quando o conteúdo não declara o
estágio. Ficam **fora** do v1, por decisão, e entram sob perfil novo nas tarefas seguintes:
chance de acerto ofensivo, crítico, leech, mana shield (CMB-08) e qualquer tela de detalhamento
do dano. O cliente não vê o outcome.

## Ação por tempo decorrido, nunca por contagem de tick

O invariante 2 em forma operacional: **todo cálculo recebe `dtMs`**, e cooldown guarda tempo,
nunca um contador decrementado. É o que faz a hunt desanexada a 1 Hz render igual à anexada a
10 Hz — e como isso é fácil de quebrar sem perceber, `pnpm source-policy` **reprova** qualquer
nome de contador de tick (`remainingTicks`, `cooldownTicks`, …) dentro de `packages/sim`.

A checagem é por **nome**, não por operação. Procurar `--` ou `-= 1` daria falso positivo em
todo laço do motor, e um check que grita sem motivo é um check que as pessoas aprendem a
ignorar. Quem escreve `remainingTicks` está declarando a intenção no nome, e é a intenção que
está proibida.

São três mecanismos, e confundi-los é o erro clássico:

| | guarda | para quê |
|---|---|---|
| ação por evento | instante absoluto de disponibilidade | poção, magia — sobrevive a snapshot e a retomada tardia |
| ação periódica | acumulador de duração | ataque, passo — é o que faz 1 Hz e 10 Hz renderem igual |
| grandeza contínua | **o mesmo acumulador** | regeneração e dano ao longo do tempo |

O terceiro não ganhou mecanismo próprio, e isso foi uma correção: uma taxa de `r` por segundo
**é** uma ação periódica de `1000 / r` milissegundos. O caminho que parecia natural — somar
`r × dtMs / 1000` num acumulador fracionário — é pior: somar `0,1` dez vezes em ponto flutuante
dá `0,9999…`, e some uma unidade a cada dez. Numa hunt de oito horas isso é regeneração faltando
sem nada explicando. Em milissegundos a conta é exata. (A regeneração nem chega a ser taxa desde
#678: o conteúdo guarda o pulso do Canary, `amount` a cada `ticksMs` — ver adiante.)

## Regeneração

O personagem recupera vida e mana passivamente enquanto está em hunt, por tempo decorrido. Vale
**mesmo com a stamina zerada**: regenerar não é recompensa, é sobrevivência, e o §10.2 diz que o
personagem continua podendo morrer, não que ele passa a morrer mais rápido.

Morto não regenera — sem essa linha, quem caiu voltaria sozinho na hunt em que morreu, e a morte
deixaria de encerrar coisa nenhuma.

**O ritmo é do Tibia, e é por VOCAÇÃO (#521, ADR 0037).** Antes da #521 era 1 HP/s e 1 mana/s
para todo mundo, provisório; agora é `gainhpticks`/`gainhpamount` e `gainmanaticks`/
`gainmanaamount` do Canary `vocations.xml` por vocação (Knight regenera vida mais rápido que
Mago, Mago regenera mana mais rápido que Knight), e quem ainda não escolheu vocação (levels 1–7)
usa a vocação `None` — cerca de 12× mais lenta em vida que o 1 HP/s de antes. É o balanceamento
que as poções (e a cura automática do bot) vão reequilibrar — no Tibia real, sustentar uma hunt
sem poção não é a expectativa.

**Em PULSOS, não em taxa (#678).** O conteúdo guarda `amount` a cada `ticksMs`, como o Canary
(`ConditionRegeneration` soma o intervalo num contador e, ao passar de `ticks`, aplica o
`amount` de uma vez). Cada pulso é um evento da fila (`health-regen`/`mana-regen`) que vence no
instante exato: Knight ganha 1 de vida e 2 de mana a cada 6 s — até #678 eram 1 ponto a cada
`1000 / taxa` ms (a mana do Knight, 1 a cada 3 s): mesma média, outro ritmo, e divisão em ponto
flutuante. O primeiro pulso vence `ticksMs` DEPOIS da entrada na hunt (o contador do Canary
começa em 0; entrar na hunt não é poção), e `amount: 0` não agenda evento nenhum. Um pulso com
o recurso cheio se perde, e o próximo segue agendado. O `catalogue.progression.regen` do
protocolo continua em pontos por segundo, derivado no `server` (`amount × 1000 / ticksMs`).

## Regras

- Ataques do jogador sempre acertam (sem rolagem de acerto ofensivo).
- Dodge, quando ativa no defensor, reduz o dano recebido em 50%.
- Dodge pode ativar contra qualquer ataque recebido, incluindo magia e ataques de boss.
- Bônus permanentes de Bestiário valem só em PvE; não se aplicam em Guild War.
- Escudo ou arma corpo a corpo de uma mão bloqueia parte do golpe (CMB-04). Em `combat-v1`/`v2`
  só o golpe **físico** é elegível — ataque elemental não é bloqueado nem treina shielding. Sob
  `combat-v3` (o perfil default desde #548) a elegibilidade é pela ORIGEM do golpe, não pelo
  tipo de dano: corpo a corpo bloqueia (e treina) mesmo elemental; distância só bloqueia
  armadura; magia/runa não bloqueiam nada — ver "O pipeline de recebimento do combat-v3" adiante.
  O bloqueio nunca zera o golpe sozinho (o piso de dano continua valendo).
- Shielding sobe uma vez por ataque elegível recebido, nunca por tick e nunca pelo HP perdido
  (CMB-04) — "elegível" segue a mesma regra do bullet acima, por perfil.

## Parâmetros de balanceamento

| Parâmetro | Valor | Onde mora |
|---|---|---|
| Multiplicador de dodge | 0,5 (§12.2, decidido) | `packages/content/data/combat/baseline.json` |
| Efetividade da armadura — `physical` | 1 `[ABERTO — valor provisório: 1]` | `packages/content/data/combat/baseline.json`, `armorEffectiveness.physical` |
| Efetividade da armadura — todo tipo não-físico (`energy`, `earth`, `fire`, `ice`, `holy`, `death`, `drown`, `lifedrain`, `manadrain`, `arcane`) | 0 `[ABERTO — valor provisório: 0]`; inerte sob `combat-v3` (ver "combat.armorEffectiveness fica INERTE" acima) | `packages/content/data/combat/baseline.json`, `armorEffectiveness.<tipo>` |
| Resistência por tipo | ausente é 0 (identidade); intervalo `[-1, 1)` no item e `[-2, 1)` no monstro (#683). No ITEM, sob `combat-v3`, é a absorção item a item (×100) | `mitigation.resistances` de monstro e item |
| Cura por elemento / reflexo do MONSTRO (#683) | percentual INTEIRO; tetos 500 e 200; nenhum monstro do catálogo atual declara ainda (no Canary: `heals` em 20 monstros, `reflects` em 18) — quem os preenche é o importador (#578) | `packages/content/src/schemas.ts`, `monster.elementHealing`/`reflect` |
| Absorção / aumento / reflexo / cleave de ITEM (M30-05, #552) | percentual INTEIRO, a escala do `items.xml` do Canary; nenhum item do catálogo atual declara ainda (os do Canary: `absorbpercent*` ~630 linhas, `reflectdamage` 5 itens, `cleavepercent` 6 itens) | `packages/content/src/schemas.ts`, `item.absorb`/`increase`/`reflect`/`cleavePercent` |
| Regeneração de vida/mana — sem vocação (levels 1–7) | 1 de vida a cada 12 000 ms / 2 de mana a cada 6 000 ms (a vocação `None` do Canary, #521, ADR 0037; pulsos desde #678) | `packages/content/data/progression/baseline.json`, `regen` |
| Regeneração de vida/mana — por vocação (Knight/Paladin/Sorcerer/Druid) | ver `docs/product/progression.md` §Parâmetros | `packages/content/data/vocations/*.json`, `regen` |
| Piso de dano, como fração do ataque | 0,1 `[ABERTO — valor provisório: 0,1]` | `packages/content/data/combat/baseline.json` |
| Chance de bloqueio (`blockChance`) | 0,6 `[ABERTO — valor provisório: 0,6]` | `packages/content/data/combat/baseline.json`, `defense.blockChance` |
| Tipos que o blocking mitiga | `["physical"]` (v1) | `packages/content/data/combat/baseline.json`, `defense.blockTypes` |
| Defesa da arma corpo a corpo de uma mão | machete 9, steel axe 10, spike sword 10 `[ABERTO — spike sword provisório: 10]` | `packages/content/data/items/*.json`, `defense` |
| Shielding — início, curva (base), defesa por nível | 10 / 100 / +2 % `[ABERTO — defesa por nível provisória]` (base = `skillBase` do escudo no Canary; `factor` por vocação, #521, ADR 0037 — ver `docs/product/progression.md`) | `packages/content/data/skills/shielding.json` |
| Modificadores avançados (`combat.modifiers`) | **ausente é neutro** (preserva o v1); quando declarado, crítico/leech são `[ABERTO — valores provisórios]`. **Desde o #603 o baseline declara o crítico BASE do jogador: 5 % de chance, +10 % de dano** (`playerBaseCriticalChance`/`Damage` do Canary `config.lua.dist`, números REAIS, não provisórios) — o item soma em cima, e Low Blow/Savage Blow também | `packages/content/data/combat/baseline.json`, `modifiers` |
| Crítico/leech de ITEM (M30-04, #551) | pontos-base (×10000), NÚMEROS REAIS do Canary — não provisórios: wand of darkness 1000/3500 (chance/dano); nenhum item do catálogo atual declara ainda | `packages/content/src/schemas.ts`, `item.combatModifiers` |
| Crítico de MONSTRO (M30-04, #551) | percentual 0-100, a escala do Lua do Canary (`critChance`); ausente/`0` em rat, rotworm, dragon e dragon lord — os únicos 6 monstros do Canary que declaram são bosses fora do recorte | `packages/content/src/schemas.ts`, `monster.critChance` |

As exceções de produto — always-hit, Dodge e o escopo PvE-only do Bestiário — são contrato do
perfil `combat-v1` ([ADR 0031](../adr/0031-contrato-de-compatibilidade-de-combate-e-migracao.md)),
não parâmetro de balanceamento. O único número entre elas é o multiplicador de Dodge, já listado
acima em `combat/baseline.json`; as demais são estruturais. No `combat-v4` (#603) o Dodge de
metade deixou de ser exceção: saiu do perfil, e o multiplicador só vale para os perfis anteriores.

O catálogo de magias e seus números de dano/custo/cooldown pertence a `progression.md` — este arquivo cobre só a matemática geral de acerto/Dodge.

## Magia usa a MESMA resolução de dano (FUN-74)

Uma magia de dano não tem matemática própria: ela chama `resolveDamage` com a intenção
`source: 'spell'` e o `damageType` declarado no efeito (ou `arcane`, o default), e é só isso que
a distingue de um golpe. A consequência é que a efetividade da armadura por tipo — `0` em todo
tipo não-físico, e provisória — vale por construção, e o dodge do defensor também: as duas são
conteúdo, e nenhuma das duas precisou ser escrita duas vezes.

O que é da magia, e não do golpe, é o **portão**: level mínimo, cooldown próprio, alcance próprio
e custo de mana. Ele mora em `packages/sim/src/casting.ts`, e os números moram em
`packages/content/data/spells/*.json`. Quem lança é o bot (ver [`bot.md`](./bot.md)); o alvo é o
monstro mais próximo, e o alcance é o **da magia**, não o da arma — uma magia de alcance 3
alcança de onde o corpo a corpo não alcança.

O cooldown de magia guarda **instante absoluto no relógio lógico da sessão**, que é a primeira
das três linhas da tabela acima. É o que faz o mesmo cooldown valer igual a 1 Hz e a 10 Hz, e o
que o mantém correto do outro lado de um snapshot.

### Magia em área (FUN-92)

Uma magia de dano pode declarar `area: { radius }`, em tiles a partir do **alvo**. Raio 1 pega o
alvo mais os oito vizinhos (o 3x3 completo); do raio 2 em diante os cantos são recortados pela
distância de Manhattan (`|dx| + |dy| <= radius + ⌊radius/2⌋`), a geometria que reproduz a
`AREA_CIRCLE3X3` do Canary — o raio 3 rende 37 tiles, em linhas 3/5/7/7/7/5/3, como fórmula e
nunca como matriz copiada (#472, ADR 0019).

Três coisas que a área traz e o alvo único não tinha:

- **Uma rolagem por alvo, e a ordem é contrato.** Cada alvo consome um sorteio do RNG da sessão,
  e trocar a ordem troca qual sorteio cai em quem — a mesma semente passaria a render uma hunt
  diferente. A ordem é a da lista de monstros, que é a de nascimento.
- **Colher todos os alvos antes de aplicar qualquer dano.** Resolver morte no meio da varredura
  seria varrer um array que está sendo substituído (`#onMonsterDied` filtra `#monsters`), e os
  alvos depois do que morreu ficariam de fora.
- **Só o alvo principal é conferido contra o alcance.** Quem foi pego pela área está lá porque
  cai dentro do raio, não porque o lançador o alcança — conferir cada um faria a área encolher
  para o alcance.

O custo de mana é da **magia**, não do número de alvos: cobrar por alvo faria o jogador pagar
mais por lançar no lugar certo, que é o inverso do que uma magia de área quer ensinar.

**Área centrada no LANÇADOR passou a existir com o #155** — ver a seção seguinte: é outra
família de forma, com o portão que essa decisão previa (sem alvo, sem alcance).

### Magias do catálogo do Tibia (#155, ADR 0026 decisão 5; fórmulas do Canary desde o #523)

O motor expressa o catálogo instantâneo do Tibia até o level 100; os números de cada magia vêm
do Canary (`opentibiabr/canary` `main`, ADR 0037) — a fórmula canônica é a regra desde o #523,
não mais a exceção. O que o motor ganhou:

- **Formas** (`effect.area.shape`, `packages/sim/src/area.ts`): `circle` (centrado no alvo ou no
  lançador; raio 1 é o 3x3 completo, raio 2-3 recortam os cantos por Manhattan com um bônus de
  achatamento — #472 —, raio ≥ 4 é o diamante de Manhattan puro, sem bônus: uma revisão do #523
  corrigiu o raio ≥ 4, que usava o MESMO bônus dos raios 2-3 e rendia tiles a mais para Eternal
  Winter/Hell's Core (raio 5: 97 em vez de 61) e Rage of the Skies/Wrath of Nature (raio 6: 145
  em vez de 85) — a `AREA_CIRCLE4X4/5X5/6X6` reais do Canary, conferidas em
  `things/sources/canary` local, não têm o bônus. A ability de MONSTRO usa um mecanismo
  diferente para "raio" — a tabela de anéis do Canary (`AreaCombat::setupArea`,
  `src/creatures/combat/combat.cpp`) —, então `areaTiles` recebe um `source: 'spell' | 'monster'`
  (default `'spell'`) que escolhe qual tabela vale; nenhum monstro do catálogo usa `circle` hoje,
  mas a distinção já está testada (`area.test.ts`, raio 1-7 dos dois mecanismos) para quando a
  primeira ability em área chegar,
  `cross` (cruz de `radius` tiles nos quatro eixos cardeais mais o centro, centrada no alvo —
  a Explosion), `rows` (a onda, #679: uma largura ímpar por fileira à frente, transcrita da
  CONTAGEM de tiles de cada fileira da `AREA_*` do Canary — nunca a matriz, ADR 0019. A fileira
  0 é a do `3`, que o motor ancora um passo à frente do lançador, `Spells::getCasterPosition`
  (`spells.cpp:337`), e atinge como qualquer valor não-zero, `AreaCombat::getList`
  (`combat.cpp:2309`): `AREA_WAVE4` é `[1,3,3,5]`, `AREA_WAVE7` é `[1,3,3,5,5]`,
  `AREA_SHORTWAVE3` é `[1,3,3]`, `AREA_SQUAREWAVE5` é `[1,1,3,3,3]`), `wave` (legado de fixture:
  o cone `2⌊k/2⌋+1` — 1, 3, 3, 5, 5 — do #155/#523, que contava sem a fileira do `3`;
  `load.test.ts` proíbe `wave` em `data/`), `cleave` (os **três tiles
  imediatamente à frente** — Front Sweep e Lesser Front Sweep; o Canary ancora `AREA_WAVE6` um
  passo à frente do lançador antes de aplicar a matriz — `getNextPosition`/`needDirection`,
  `Spells::getCasterPosition` — então em coordenadas do mundo os três tiles da matriz caem
  juntos, a um passo de distância: uma revisão do #523 tinha lido só a matriz local e "corrigido"
  isto para o lado errado, revertido depois de conferir o motor) e `beam` (linha reta; `beam n`
  é exatamente a `AREA_BEAMn`, contando o `3` — até o #679 o conteúdo tinha um tile a menos em
  todo feixe). Onda,
  cleave, feixe e o círculo no
  lançador são **self-origin**: não exigem alvo nem alcance (o boot recusa `range` nelas), e
  recusam `no-target` só quando nenhum monstro cai nos tiles — sem gastar mana. Saem na
  **direção do personagem**, que o passo grava (diagonal: a componente horizontal decide — regra
  nossa); quem nunca andou olha para o sul. O evento `spell-cast` leva os tiles da forma, e o
  efeito aparece em todos — inclusive onde não há monstro, como no Tibia.
- **Fórmula canônica** (`effect.formula`, #474/#523): `min = level × levelFactor + skill ×
  skillMin + baseMin` (idem `max`), os mesmos coeficientes que o `onGetFormulaValues` do Canary
  devolve. `levelFactor` default 0,2 é o `level / 5` da referência. Na magia de DANO a skill é a
  que `formula.scaling` declara (#677), transcrevendo o callback do Canary: `magic` é o
  `CALLBACK_PARAM_LEVELMAGICVALUE` (o MAGIC LEVEL, com o bônus de item `magic`, em qualquer
  vocação: as 37 magias LEVELMAGIC do catálogo, inclusive Divine Caldera e Divine Missile do
  Paladin); ausente (= `vocation`) é a skill da vocação (`vocation.spellSkill`: `magic`,
  `distance` no Paladin, e `SPELL_SKILL_WEAPON` ("weapon") no Knight desde o #567 — a skill da
  FAMÍLIA da arma equipada agora, resolvida em tempo de execução porque `melee` virou quatro
  skills e não há mais uma fixa só dele), o que a `CALLBACK_PARAM_SKILLVALUE` lê (as 10 de
  Knight e as Ethereal Spear). `scaling: 'magic'` com termo de ataque de arma é recusado no boot.
  Na magia e na runa de CURA é sempre o MAGIC LEVEL (#475). Onde o termo é o MAGIC LEVEL (cura,
  `scaling: 'magic'` e a runa com `formula`), ele ganha o **ML especializado** do elemento do
  efeito (#680): `healing` na cura, o `damageType` no dano — o `getMagicLevelSkill` do Canary
  (`combat.cpp:1979`), soma dos itens vestidos em `bonuses.specializedMagicLevel`
  (`Inventory.specializedMagicLevel`, lido na conjuração por `formulaSkill` em `casting.ts`). A
  SKILLVALUE, o `basePower` provisório e o `requires.magicLevel` da runa não somam; Mass Healing
  declara `includeSpecializedMagicLevel: false` porque o script dela lê `getMagicLevel()` cru.
  Nenhum item do catálogo declara o campo ainda (a importação é o #573): o resultado de hoje é
  bit a bit o mesmo, sem perfil novo. Desde o #523, TODA magia de
  dano/cura com correspondente real no Canary declara `formula` — só ficam de fora as três
  genéricas pré-vocação (`heal`/`strike`/`blast`, que o Tibia não tem) e três magias inventadas
  antes da auditoria sem nome correspondente no Canary (`divine-barrage`, `ethereal-barrage`,
  `forked-thorns`); `load.test.ts` prende essa lista por nome (`NOT_FROM_CANARY`) e falha se
  crescer sem ninguém notar. **Sem `formula`** (a exceção acima), o efeito cai no caminho
  provisório do `basePower` × `combat.spellPower` — `mid = BP × (1 + level × levelFactor + skill
  × skillFactor)`, `[⌊mid × (1 − spread)⌋, ⌈mid × (1 + spread)⌉]` — que continua **nosso e
  provisório** `[ABERTO]` (coeficientes 0,06 / 0,15 / 0,15, calibrados para Light Healing render
  ~59 no level 8 com magic 0). O `basePower` sobrevive em toda magia como o número de EXIBIÇÃO do
  catálogo de ações (ADR 0033) — o `ActionConfigModal` sempre mostra a faixa do caminho genérico,
  formula ou não, porque `detailOf` (`packages/server/src/game/catalogue.ts`) não propaga
  `formula` ao cliente; é uma prévia aproximada, nunca a rolagem real.
- **O termo de ATAQUE DA ARMA** (#523): Groundshaker, Berserk, Fierce Berserk, Front Sweep,
  Lesser Front Sweep e Whirlwind Throw usam `CALLBACK_PARAM_SKILLVALUE` no Canary — a fórmula
  soma (ou multiplica) o `attack` da arma equipada ao skill antes de escalar, então `skillMin`/
  `skillMax` sozinhos não bastam. O schema ganhou `attackMin`/`attackMax` (coeficiente LINEAR do
  `attack`, para a soma `skill + attack`: Groundshaker, Berserk, Fierce Berserk, Whirlwind Throw)
  e `skillAttackMin`/`skillAttackMax` (coeficiente do PRODUTO `skill × attack`: Brutal Strike,
  Front Sweep, Lesser Front Sweep) em `evaluateSpellPower` (`packages/content/src/spell-power.ts`)
  — ausentes, o `attack` que `sim` passa nunca entra na conta, o que preserva bit a bit toda
  fórmula que já existia antes do #523 (migração aditiva, ADR 0031). `sim` resolve o `attack` real
  em `HuntRuleset#spellScaling` (`packages/sim/src/rulesets/hunt.ts`), com
  `Inventory.weaponAttack` — `0` desarmado, a mesma resposta honesta que o resto do motor já dá.
  Strong Ethereal Spear usa o MESMO campo `attackMin`/`attackMax` com um coeficiente residual
  (2,30/2500 e 3,30/1875): a munição do Paladin no Draconya bate na casa das dezenas, então o
  termo contribui ~0,01 de dano — mantido por fidelidade ao Canary, não porque pese hoje.
- **Grupos de cooldown** (`group` + `groupCooldownMs`, `secondaryGroup`): três livros no mesmo
  `Cooldowns` (`spell:`, `group:`, `secondary:`), instante lógico absoluto. A recusa é
  `group-cooldown` com o prazo do livro que trancou, e a categoria do bot volta no vencimento.
  Magia sem `group` (as três genéricas de antes) só tem o cooldown próprio. O #523 conferiu o
  grupo secundário de cada magia contra o Canary: `focus` é o pool que TODO self-buff do
  Knight/Paladin compartilha (Blood Rage, Protector, Sharpshooter, Swift Foot — e as quatro
  ults de área centradas no lançador, Eternal Winter/Hell's Core/Rage of the Skies/Wrath of
  Nature, que também usam `focus`), `special` é o dos `X Strike` fortes (mais Lightning),
  `great-beams` o dos feixes grandes, e `ultimatestrikes` (novo, só Ultimate Energy Strike por
  ora) o do topo da linha `X Strike`.
- **Condições** (`packages/sim/src/conditions.ts`): haste (`speedScale` lido por
  `movementDuration`, à parte de `speed` — `retarget` reescreve `speed`), postura (`buff`:
  dano causado por fonte e dano tomado, em percentuais que somam), magic shield (o dano sai da
  mana primeiro, o escudo continua até vencer mesmo com mana zero) e cura ao longo do tempo
  (Recovery: `amount` a cada `intervalMs`). Uma por tipo; relançar REINICIA. O vencimento e o
  tique são eventos da fila (`condition-expire`, `condition-tick` — invariante 2), e a condição
  vai no `CharacterState` com o prazo lógico: um snapshot no meio de um haste retoma vencendo
  no mesmo instante. `castSpell` DEVOLVE a condição; quem agenda é o ruleset. A DURAÇÃO das
  posturas vem de `CONDITION_PARAM_TICKS`: 10 s para Blood Rage/Sharpshooter/Swift Foot, mas 13 s
  para Protector (corrigido numa segunda revisão do #523 — a primeira leitura tinha copiado os
  10 s dos vizinhos sem conferir o arquivo da própria magia). Os PERCENTUAIS de postura
  (`damageDealtPercent`/`damageTakenPercent`) continuam uma aproximação: o Canary usa
  `SKILL_MELEEPERCENT`/`SKILL_DISTANCEPERCENT` (+skill, não +dano) para Blood Rage e Sharpshooter,
  que o schema não modela — só Protector foi corrigido no #523 (`BUFF_DAMAGEDEALT 65` é dano
  causado ×0,65, ou seja −35 %, não −15 %) porque o Canary já expressa Protector direto em
  percentual de dano, sem passar por skill.

O que fica de fora, por decisão: runas e conjurações, invocação e ilusão, party, utilidade,
magias de escudo, elemento e resistência. O dano ao longo do tempo e as condições de monstro, que
ficavam aqui, passaram a existir com o CMB-07 (ver a seção seguinte) — o que o catálogo nominal
ainda não traz são as magias de DOT por nome (Envenom, Curse, …). **A cura de condição SAIU da
lista no #590**: Cure Poison (genérica, todas as vocações), Cure Burning/Cure Electrification
(Druid), Cure Bleeding (Druid e Knight), Cure Curse (Paladin) e a Antidote Rune (suprimento) — ver
a subseção "Cura de condição (dispel)" logo após o CMB-07. Também ficam
de fora as magias de "Wheel of Destiny" (o sistema de grades/`needLearn` do Canary moderno,
level 300 — Fair Wound Cleansing, Divine Grenade, Terra Burst): o Draconya não modela o Wheel, e
um level 200 não as alcançaria de qualquer forma. Great Death Beam já existia no catálogo com um
level inventado (66); numa revisão do #523 o level passou a ser o real do Canary (300) — a magia
fica no catálogo, correta e documentada, mas fora do alcance de qualquer personagem até o Wheel
existir, o que o ADR 0037 pede explicitamente (Tibia é a regra, mesmo quando isso significa uma
magia inacessível).

### Requisito de vocação (§9.2)

Uma magia pode declarar `vocationId`. Quem não a tem recebe `wrong-vocation`, e a recusa **não
tem prazo de retentativa** — esperar não faz ninguém virar druida, e reagendar por isso seria um
evento por segundo para redescobrir a mesma coisa.

O personagem nasce **sem** vocação e escolhe no level 8 (§7.4), então uma magia com requisito é
inacessível até lá por construção, sem nenhuma regra escrita em outro lugar.

### Runa é supply de ataque (#165, ADR 0026 decisão 8)

A runa **não é magia**: é suprimento de ataque. A Avalanche Rune
(`packages/content/data/supplies/avalanche-rune.json`) foi a primeira, e desde a #476 o catálogo
tem as runas de ataque do Canary: efeito `damage`, `formula` canônica por runa, alcance 8 e um
bloco `requires` (`level`, `magicLevel`) que a poção não tem. O `price` é debitado do gold **no
uso**, por `useSupply`, como qualquer suprimento (ADR 0032 d.6).

| Runa | Elemento | Forma | Level / ML | Fórmula (`min` / `max`) |
|---|---|---|---|---|
| Avalanche | `ice` | círculo raio 3 (37 tiles) | 30 / 4 | `level/5 + ml×1.2 + 7` / `level/5 + ml×2.8 + 17` |
| Great Fireball | `fire` | círculo raio 3 (37 tiles) | 30 / 4 | `level/5 + ml×1.2 + 7` / `level/5 + ml×2.8 + 17` |
| Thunderstorm | `energy` | círculo raio 3 (37 tiles) | 28 / 4 | `level/5 + ml×1 + 6` / `level/5 + ml×2.6 + 16` |
| Stone Shower | `earth` | círculo raio 3 (37 tiles) | 28 / 4 | `level/5 + ml×1 + 6` / `level/5 + ml×2.6 + 16` |
| Sudden Death | `death` | **alvo único** | 45 / 15 | `level/5 + ml×4.605 + 28` / `level/5 + ml×7.395 + 46` |
| Heavy Magic Missile | `energy` | **alvo único** | 25 / 3 | `level/5 + ml×0.4 + 2` / `level/5 + ml×1.59 + 10` |
| Explosion | `physical` | **cruz** raio 1 | 31 / 6 | `level/5` (aprox.) / `level/5 + ml×4.8` |
| Fireball | `fire` | **alvo único** | 27 / 4 | `level/5 + ml×1.81 + 10` / `level/5 + ml×3 + 18` |
| Icicle | `ice` | **alvo único** | 28 / 4 | `level/5 + ml×1.81 + 10` / `level/5 + ml×3 + 18` |
| Light Magic Missile | `energy` | **alvo único** | 15 / 0 | `level/5 + ml×0.4 + 2` / `level/5 + ml×0.81 + 4` |
| Light Stone Shower | `earth` | **cruz** raio 1 | 1 / 0 | `level/5 + ml×0.3 + 2` / `level/5 + ml×0.45 + 3` |
| Stalagmite | `earth` | **alvo único** | 24 / 3 | `level/5 + ml×0.4 + 2` / `level/5 + ml×1.59 + 10` |
| Intense Healing (runa) | cura | **alvo único** | 15 / 1 | `level/5 + ml×3.2 + 20` / `level/5 + ml×5.4 + 40` |
| Ultimate Healing (runa) | cura | **alvo único** | 24 / 4 | `level/5 + ml×7.3 + 42` / `level/5 + ml×12.4 + 90` |

As 5 acima fecham o catálogo de 12 runas de ataque do Canary (#597; `data/scripts/runes/`,
`things/sources/canary` 47dfd51). Fora desta contagem, de propósito: `lightest-magic-missile-rune`/
`lightest-missile-rune` (dano quase nulo ou negativo — runa de treino de skill em dummy) e
`holy-missile-rune` (restrita ao Paladin); nenhuma das três tem pedido explícito. Runas de campo
(`fire_bomb`/`energy_bomb`/`poison_bomb`) continuam fora — mecanismo de campo lançável pelo
jogador não existe ainda.

A `formula` é a mesma da magia de dano (#474): `min = level × levelFactor + ml × skillMin +
baseMin` (idem `max`), com `levelFactor` 0,2 — o `level / 5` da referência. Runa sem `formula`
continua no caminho provisório do `basePower` × `combat.spellPower`, bit a bit (ADR 0031) — hoje
só a poção (`amount` fixo, nunca teve `basePower`); toda runa de dano/cura tem `formula`
(#523, conferido em `load.test.ts`). Sudden Death e as duas runas de cura foram corrigidas no
#523: Sudden Death tinha base 32/48 (a real é 28/46), Intense Healing Rune caía na conversão
genérica com level 8 (o real é 15), e Ultimate Healing Rune tinha coeficientes 5,7/10,3 base
36/65 — a transcrição de #475 chegou perto, mas o Canary real é 7,3/12,4 base 42/90.

O que difere da magia de ataque, e por quê:

- **Escala sempre pelo magic level**, em toda vocação. Magia de dano escala pela skill que a
  fórmula declara (`formula.scaling`, #677, §"Magias do catálogo"); runa é do magic level no Tibia, e knight de
  magic level 2 usando Avalanche é a cena real — bate fraco, mas bate.
- **Cooldown por grupo do conteúdo.** A runa declara `group: attack`; a cadência é a do motor v2,
  e a runa não tranca nem é trancada pelo cooldown individual de uma magia.
- **A ordem das recusas**: `level-too-low` → `magic-level-too-low` → `no-target` →
  `out-of-range` → `not-enough-gold`. O gold é conferido **depois** da mira, pela mesma razão
  que a mana da magia sai por último: recusar antes de saber se há alvo é debitar sem lançar.
- **Só `not-enough-gold` vira linha no extrato** (#217), o aviso único de `§20.3`. As outras
  quatro recusas são silenciosas — a mesma mudez que `castSpell` já dá à magia: `level-too-low`
  e `magic-level-too-low` a validação da configuração já recusa (a única forma de aparecer é
  um level-down depois de configurada, e mesmo assim não é pergunta de gold); `no-target` e
  `out-of-range` são a mira falhando a cada vencimento da categoria, esperado toda vez que não
  há monstro à vista ou fora do alcance da runa. Misturar as cinco no mesmo aviso queimava o
  flag de gold por uma recusa que nunca foi sobre gold — o defeito que a #217 corrigiu.
- **O dano é o mesmo pipeline** (`resolveDamage` com `source: 'rune'` e o `damageType` do
  catálogo, `#applyHits` da hunt — o mesmo que a magia usa), com atribuição e morte por alvo. A
  área é **integral por alvo**: cada um consome uma rolagem própria, sem splitting.
- **Runa de alvo único não tem `area`.** Sudden Death e Heavy Magic Missile atingem só o alvo
  principal; o `area` do schema é opcional desde a #476, e a cruz da Explosion é a forma no alvo.

Apresentação: `supply-used` carrega `targets` e `tiles`, e o host desenha um efeito por tile
da forma, como o `spell-cast` em área. A poção continua com `targets` e `tiles` vazios e um
efeito só, no tile de quem bebeu. Os ids de efeito das runas moram em
`appearances/baseline.json` (`supplies[...].effect`) e a QA visual deles é **por tile** — a
auditoria de #242 está bloqueada pela biblioteca parcial (os sprites não têm PNG na máquina) e
os ids foram mantidos; ver
[`combat-presentation-audit.md`](../combat-presentation-audit.md).

Os números (preços por uso, raios e requisitos) são provisórios e estão marcados em `_open` nos
arquivos; os preços são o da runa no NPC dividido pelas cargas, arredondado.

## Como cada arma bate (#152, ADR 0026 decisões 3 e 4)

O alcance é da **arma**, não do personagem: `weapon.range` do item na mão (bow 6, wand e rod
3, corpo a corpo 1), e só desarmado vale `combat.player.attackRange`. O golpe despacha pelo
`weapon.kind`:

- **`melee`** — o `attack` do item pela skill corpo a corpo, como sempre.
- **`distance`** — o bow atira a **munição escolhida da família dele** (`ammoFamily`), pelo
  opcode 14 `select-ammo` (ou a básica da família, a primeira em ordem de id). O dano é o `attack`
  da munição pela skill `distance` (sobe por tiro), e o tipo é o `damageType` dela. Cada tiro
  **debita o `price` da munição do gold** (ADR 0032 d.7); sem saldo que cubra o preço, o tiro NÃO
  sai — nem projétil, nem dano. **Sem pilha e sem fallback grátis**: a `arrow` tem preço por tiro
  e level gate. Com bow/crossbow na mão, o slot do Escudo mostra a munição escolhida e o clique
  abre o `AmmoPicker`.
- **`wand`** — wand e rod gastam `manaPerHit` por golpe, causam dano **mágico** por faixa fixa
  (`damage.min..max`, uma rolagem do `Rng` da sessão por golpe, como o loot) e rendem magia
  pela mana gasta, como uma magia. Sem mana, o golpe não sai: fica para o intervalo seguinte.

O tiro emite um projétil (`shot` → `missile`), resolvido pela tabela de aparências no
hospedeiro: o da munição para a flecha (`appearances.ammunition[itemId]`), o da arma
(`appearances.weapons`) para wand e rod. O
bow ocupa as duas mãos: com escudo vestido é recusado (`hands-full`), e vice-versa. O elemento
da wand e do rod é declarado no conteúdo desde o CMB-03 (energia e terra) e passa a valer contra
resistência e imunidade do monstro.

| Parâmetro | Valor | Onde mora |
|---|---|---|
| Bow — alcance | 6 | `packages/content/data/items/bow.json`, `weapon.range` |
| Wand of vortex — alcance, mana por golpe, dano | 3 / 2 / 8–18 | `packages/content/data/items/wand-of-vortex.json` |
| Snakebite rod — alcance, mana por golpe, dano | 3 / 1 / 8–18 | `packages/content/data/items/snakebite-rod.json` |
| Munição — attack e preço | arrow 25 `[ABERTO — attack provisório]` / 2; burst arrow 27 `[ABERTO — idem]` / 15; sniper arrow 28 `[ABERTO — idem]` / 5; onyx arrow 38 `[ABERTO — idem]` / 7 — `attack` continua do TibiaWiki (provisório); `price` é o menor `buy` de NPC do Canary (M34-03/#574, NÃO mais provisório) | `packages/content/data/ammunition/{arrow,burst-arrow,sniper-arrow,onyx-arrow}.json` (o projétil fica em `appearances.ammunition`) |
| Distância — início, curva (base), dano por nível | 10 / 30 / +2% `[ABERTO — dano por nível provisório]` (base = `skillBase` da distância no Canary; `factor` por vocação, #521, ADR 0037 — ver `docs/product/progression.md`) | `packages/content/data/skills/distance.json` |
| Distância — início, curva, dano por nível | 10 / 50×1,1 / +2% `[ABERTO — valores provisórios]` (só vale para wand/rod e para o `combat-v1`; ver abaixo) | `packages/content/data/skills/distance.json` |

## Dano de arma e chance de acerto à distância (#522, ADR 0037 d.5, `combat-v2`)

O ADR 0019 tinha "ataque do jogador sempre acerta" como regra NOSSA, fora de discussão. O
ADR 0037 revoga esse limite para mecânica de jogo: o Tibia passa a ser a REGRA, não a
referência, e a #522 troca o dano de corpo a corpo/distância pelo do Canary. O
`packages/sim/src/combat/weapon-power.ts` despacha por `combat.compatibilityProfile`: conteúdo
`combat-v1` continua na fórmula antiga (escala + `spread`, abaixo); `combat-v2` — o que
`baseline.json` declara — usa a fórmula nova. As duas convivem porque uma sessão fixa o perfil
na criação (invariante 7) e uma sessão `combat-v1` em andamento não é reinterpretada (ADR 0031).

### A fórmula (`Weapons::getMaxWeaponDamage`, `WeaponMelee`/`WeaponDistance::getWeaponDamage`)

```text
maxDamage = round(coefficient × attackFactor × attack × skill + ⌊level/5⌋) × vocationMultiplier
minDamage = ⌊level/5⌋                      (corpo a corpo: 0 se attack ≤ 0; distância: sempre)
damage    = normalRandomInt(minDamage, maxDamage)
```

- `coefficient` é `0,085` em corpo a corpo e `0,09` à distância — os mesmos números do Canary,
  em conteúdo (`combat.weaponDamage.meleeCoefficient`/`distanceCoefficient`), nunca constante
  mágica (§12.1).
- `skill` é o nível ABSOLUTO da skill da família — ao contrário do `combat-v1`, que só contava a
  partir do `skillStartingLevel` (um personagem nasce com skill 10, não 0).
- `attackFactor` é o `getAttackFactor()` do modo de luta do Canary (ofensivo 1,0 / balanceado
  0,75 / defensivo 0,5) — a POSTURA que o jogador escolheu, `CharacterRuntime.fightMode`
  (M30-03, #550; ver "A postura de luta" abaixo). **Não é mais constante de conteúdo**: o campo
  `combat.weaponDamage.attackFactor` saiu do schema. `combat-v1`/`v2` — sessões fixadas neles —
  continuam no 1,0 de antes (a ofensiva) e ignoram a postura; só o `combat-v3` a lê.
- `vocationMultiplier` é `vocation.meleeDamageMultiplier`/`distDamageMultiplier` — `1,0` em toda
  vocação, como em `vocations.xml` do Canary hoje; entra pela mesma razão do coeficiente.
  **A truncagem é ASSIMÉTRICA por família, e a assimetria é do Canary, não nossa**:
  `WeaponMelee::getWeaponDamage` multiplica primeiro e trunca o PRODUTO
  (`static_cast<int32_t>(getMaxWeaponDamage(...) × meleeDamageMultiplier)`);
  `WeaponDistance::getWeaponDamage` trunca o MULTIPLICADOR primeiro e só então multiplica
  (`maxValue × static_cast<int32_t>(distDamageMultiplier)`) — um `distDamageMultiplier`
  fracionário (`1,5`) vira `1` antes de entrar na conta, e o bônus desaparece por inteiro na
  distância, enquanto o mesmo `1,5` vale cheio no corpo a corpo. Reproduzida bit a bit em
  `resolveWeaponPowerV2`; invisível hoje porque nenhuma das quatro vocações declara
  `distDamageMultiplier` fracionário — todas têm `1`.
- `normalRandomInt` (`combat/weapon-power.ts`) é uma reimplementação ORIGINAL (ADR 0019) do
  `normal_random` do Canary: uma normal (média 0,5, desvio 0,25) truncada em `[0,1]` por
  rejeição — Box-Muller com duas frações do `Rng` da sessão por tentativa —, escalada para
  `[min, max]` e arredondada. Roda SEMPRE, mesmo com `min === max`: a sequência de sorteios não
  pode depender do VALOR do intervalo, a mesma regra do `blockChance` (ADR 0031).
- O Canary soma `physicalAttack + elementalAttack + weaponProficiency` num único termo antes de
  multiplicar pela skill (`WeaponMelee::getWeaponDamage`/`WeaponDistance::getWeaponDamage`).
  No `combat-v2`, `attack` (`formula.base`) é o único termo: o elemento da arma é ignorado. No
  `combat-v3` o elemento entra (#687, abaixo). Proficiência de arma não existe no catálogo.

### Elemento da arma e arma vestida abaixo do level (#687, só `combat-v3`)

A arma corpo a corpo pode declarar `weapon.element: { type, attack }` — o `element<tipo>` do
Canary (Fire Sword: `attack` 24 físico + `element` fogo 11; Serpent Sword: 18 + terra 8). O
`attack` do item continua só o FÍSICO. `resolveWeaponHit` (`combat/weapon-power.ts`) reproduz o
`internalUseWeapon` do Canary:

```text
total     = trunc(normalRandomInt(min, max com attack + element) × damagePercent / 100)
physical  = trunc(total × attack / (attack + element))
elemental = trunc(total × element / (attack + element))
```

- O mínimo continua `⌊level/5⌋` só com `attack` físico > 0. O truncamento é POR PARTE, como o
  `static_cast<int32_t>` do Canary, então a soma pode perder 1 ponto (total 70 na Fire Sword →
  48 + 22).
- O elemental é o componente `secondary` do golpe (#473), com `MAGIC_BLOCK_FLAGS`: como o
  `blockHit(…, false, false)` do Canary, não perde para escudo nem armadura, só para resistência
  e imunidade. Sem elemento, ou com total 0, não há secundário nem sorteio extra.
- A postura do Draconya (`damageDealtScale('melee')`) vale para as duas partes, cada uma
  arredondada.
- O crítico ainda não multiplica o secundário (o Canary multiplica os dois): fica para a revisão
  do crítico do M30-04.
- `buildContent` recusa `element` fora de `weapon.kind === 'melee'` (munição elemental é a #575)
  e `type: physical`.

**Arma vestida abaixo do level** (`playerWeaponCheck` do Canary). `Inventory.equip` recusa
equipar abaixo do level, como o `MoveEvent::EquipItem` do Canary; o caso que sobra é a arma que
já estava na mão quando o level caiu (penalidade de morte). `Inventory.heldWeapon` devolve
`damagePercent`: `100` no level, `50` abaixo dele com `weapon.wieldUnproperly` (o `unproperly`
do Canary: Fire Sword, Double Axe, Dragon Slayer, Dragon Hammer, Dragonbone Staff, Mystic
Blade), `0` sem. Com `0` o golpe NÃO sai — nem de punho, nem prática —, como o `useWeapon` do
Canary que devolve `false`; o ataque segue agendado. Vocação errada continua mão vazia. v1/v2
leem `weapon()` e a arma abaixo do level segue virando punho (ADR 0031).

**Defesa de arma de duas mãos.** `buildContent` aceita `defense` em arma corpo a corpo de duas
mãos (Broadsword 23, Double Axe 12, Dragon Slayer 28), como o `Player::getDefense` do Canary.
Só o `combat-v3` a lê (`#playerDefenseV3`); o `defenseSource` do v1/v2 continua ignorando arma
de duas mãos. A defesa da arma abaixo do level segue fora da conta no v3 (o Canary conta).

Wand/rod **mudam a distribuição, não a faixa**: continuam com o `min`/`max` fixo do item, sem
coeficiente nem `attackFactor` — isso já era o modelo do Canary (DT-02 do CMB-05). O que muda sob
`combat-v2` é COMO o número sai da faixa: `WeaponWand::getWeaponDamage` do Canary também sorteia
pela normal truncada (`normal_random(minChange, maxChange)`), não uniformemente — a MESMA
distribuição que a #522 introduziu para corpo a corpo e distância. `resolveWeaponPower` passa a
usar `normalRandomInt` para `fixedDamage` sob `combat-v2`; `combat-v1` continua com `rng.integer`
(uniforme), como sempre — preservando o v1 bit a bit.

### Magia, runa, poção e ataque/cura de monstro: a normal truncada no `combat-v3` (#681)

O Canary sorteia TODO valor de dano e cura que não é de arma pela mesma `normal_random(min, max)`
— `Combat::getCombatDamage` (`combat.cpp:154-229`) em todos os ramos, o callback
`onGetFormulaValues` (`combat.cpp:2046`), e `doTargetCombatHealth`/`doTargetCombatMana`
(`global_functions.cpp:372`/`:455`) que a poção chama. Sob `combat-v3` o Draconya segue isso: os
seis pontos abaixo passam por `rollCombatValue` (`packages/sim/src/combat/combat-value.ts`), que
devolve `normalRandomInt` no `combat-v3` e o `rng.integer` uniforme de sempre no `combat-v1`/`v2`
(e para o chamador sem contexto de combate) — v1/v2 bit a bit, ADR 0031. A faixa (`min`/`max`)
não muda em nenhum ponto; muda só a distribuição: em `[0, 100]`, a uniforme põe ~10,9 % dos
sorteios em `[0, 10]`, a normal truncada ~3,4 %. A normal consome o sorteio mesmo com
`min === max` (a ability de poder fixo, o `firefield` 0..0 do Dragon Lord).

| Ponto (`packages/sim/src`) | O que sorteia | Canary | Distribuição no `combat-v3` |
|---|---|---|---|
| `casting.ts` `powerOf` (fórmula) | magia/runa com `formula` (dano e cura) | `combat.cpp:2046` | **normal** |
| `casting.ts` `powerOf` (`basePower`) | magia com `basePower` provisório | `combat.cpp:195` | **normal** |
| `casting.ts` `fixedAmount` | poção de vida/mana/espírito (`amountRange`) | `global_functions.cpp:372`/`:455` | **normal** (sem `rng`, o mínimo, como sempre) |
| `casting.ts` runa de ataque | runa de dano | `combat.cpp:2046` | **normal** |
| `rulesets/hunt.ts` ability de monstro | `ability.power` (a básica sintetizada inclusive) | `combat.cpp:189` | **normal** |
| `rulesets/hunt.ts` defesa de cura | `defense.heal` | `monster.cpp:2218` + `combat.cpp:189` | **normal** |
| `combat/weapon-power.ts` | arma | — | já por perfil (#522) |
| `combat/blockhit.ts` | defesa/armadura | `Creature::blockHit` `uniform_random` | uniforme |
| `conditions.ts` | dano de condição, velocidade | `condition.cpp:1908`/`:2547` `uniform_random` | uniforme |

Drunk, loot e escolha de alvo (`conditions.ts`, `loot.ts`, `monster/target-strategy.ts`) não são
valor de combate e continuam uniformes.

### Chance de acerto à distância (`WeaponDistance::useWeapon`)

Só a DISTÂNCIA rola acerto ofensivo; corpo a corpo continua sempre acertando — o Canary também
não rola acerto ofensivo em corpo a corpo no PvE. A tabela (`combat.distanceHitChance`,
`packages/sim/src/combat/distance-hit.ts`) reproduz as TRÊS tabelas que o Canary modela — os
baldes 75 (uma mão), 90 (duas mãos) e 100 —, não só a de 90 % que o catálogo usa hoje (arco):

| Distância | Balde 75 (uma mão) | Balde 90 (duas mãos) | Balde 100 |
|---|---|---|---|
| 1, 5 | `⌊min(skill,74) × 1,00⌋ + 1` | `⌊min(skill,74) × 1,20⌋ + 1` | `⌊min(skill,73) × 1,35⌋ + 1` |
| 2 | `⌊min(skill,28) × 2,40⌋ + 8` | `⌊min(skill,28) × 3,20⌋` | `⌊min(skill,30) × 3,20⌋ + 4` |
| 3 | `⌊min(skill,45) × 1,55⌋ + 6` | `⌊min(skill,45) × 2,00⌋` | `⌊min(skill,48) × 2,05⌋ + 2` |
| 4 | `⌊min(skill,58) × 1,25⌋ + 3` | `⌊min(skill,58) × 1,55⌋` | `⌊min(skill,65) × 1,50⌋ + 2` |
| 6 | `⌊min(skill,90) × 0,80⌋ + 3` | `min(skill,90)` | `⌊min(skill,87) × 1,20⌋ − 4` |
| 7 | `⌊min(skill,104) × 0,70⌋ + 2` | `min(skill,90)` | `⌊min(skill,90) × 1,10⌋ + 1` |
| outro tile | **0 (MISS garantido)** | **0 (MISS garantido)** | **0 (MISS garantido)** |
| balde não modelado (ex.: 91) | chance FIXA = o próprio valor do balde, ignora skill e distância | | |

A distância só entra na tabela quando cai num balde RECONHECIDO (75/90/100) e num tile de 1 a 7:
fora dessas duas condições, o Canary não erra "quase sempre" — erra SEMPRE (`default: chance =
it.hitChance;`, que vale 0 dentro deste ramo do código, porque só se chega até aqui quando
`it.hitChance` já é 0). Um balde que não é 75, 90 nem 100 (o power bolt do Tibia declara `91`,
`ammunition.maxHitChance`) vira chance fixa, IGUAL ao próprio valor do balde — isso sim ignora
skill e distância, e é diferente do caso "distância fora da tabela DENTRO de um balde
reconhecido", que é sempre miss.

`ammunition.hitChance`, `ammunition.maxHitChance` e `weapon.hitChance` entram em jogo pela
primeira vez (os dois últimos, "só dado" desde o #524):

1. `ammunition.hitChance` (#522), quando declarado e ≠ 0, IGNORA tudo abaixo — chance FIXA, sem
   tabela nem balde (o `it.hitChance != 0` do Canary, checado ANTES de `maxHitChance`; é o
   caminho da munição/arma de arremesso avulsa: viper star `80 %`, leaf star `90 %`).
2. Sem isso, `ammunition.maxHitChance` escolhe o BALDE — ausente é `90` (duas mãos, a única
   família de distância no catálogo hoje).
3. `weapon.hitChance` (o bônus/malus do arco, ex.: royal crossbow `+3`) SOMA ao percentual que os
   dois passos acima calcularam — tabela, balde-fixo ou miss —, sempre.

A rolagem acontece uma vez por tiro, SEMPRE consumida (mesma regra do `blockChance`), e o erro
não gasta a munição de graça: o preço já saiu antes da rolagem (o tiro existe, só não causa dano)
— mas treina a skill igual, porque o disparo aconteceu.

### Parâmetros

| Parâmetro | Valor | Onde mora |
|---|---|---|
| `meleeCoefficient` / `distanceCoefficient` | 0,085 / 0,09 | `packages/content/data/combat/baseline.json`, `weaponDamage` |
| `attackFactor` | 1,0 / 0,75 / 0,5 pela postura (ofensiva / balanceada / defensiva) — NÃO é conteúdo desde a #550 | `packages/sim/src/combat/fight-mode.ts`, `attackFactorFor` |
| `meleeDamageMultiplier` / `distDamageMultiplier` | 1,0 em toda vocação | `packages/content/data/vocations/*.json` |
| Tabela de acerto à distância (baldes 75/90/100) | ver a tabela acima | `packages/content/data/combat/baseline.json`, `distanceHitChance` |
| `ammunition.hitChance` / `ammunition.maxHitChance` / `weapon.hitChance` | ausentes hoje (nenhuma munição/arma especial no catálogo) | #522/#524, `packages/content/src/schemas.ts` |

## O pipeline de recebimento do combat-v3 (#548, M30-01, ADR 0040)

`packages/content/data/combat/baseline.json` declara `combat-v3` desde esta issue: é o perfil
que toda hunt NOVA roda. O lado OFENSIVO não muda — a fórmula de arma e a chance de acerto à
distância do `combat-v2` (seção acima) continuam valendo; o `combat-v3` exige os mesmos blocos
`weaponDamage`/`distanceHitChance`. O que muda é o lado do DEFENSOR: o bloqueio binário do
CMB-04 (`combat.defense.blockChance`) é substituído pela ORDEM e pela MATEMÁTICA do
`Creature::blockHit` do Canary (`packages/sim/src/combat/blockhit.ts`).

### A ordem

1. uma rolagem de Dodge, sempre consumida — o Draconya continua na frente de tudo, porque o
   Tibia nega o golpe inteiro ANTES de chamar `blockHit` (a mesma posição, não coincidência);
2. **crítico** (CMB-08; M30-04, #551), quando `modifiers.critical` é declarado — na GERAÇÃO do
   dano, ANTES de tudo o que segue: é onde o Canary de fato rola
   (`Combat::applyExtensions`, chamado de `getCombatDamage`/`doCombat`, roda ANTES de
   `Creature::blockHit` multiplicar `damage.primary.value`). O multiplicador incide sobre o
   PODER BRUTO, e o defensor recebe o dano JÁ com o bônus — um crítico não é "desperdiçado" por
   imunidade, porque o Canary também não sabe de imunidade neste ponto (`applyExtensions` só olha
   o ATACANTE). Esta é a posição FINAL, decidida no M30-04: a versão do #548 (M30-01) a colocava
   depois de toda a mitigação como placeholder documentado — nenhum teste a travava, e nenhum
   conteúdo real declarava `combat.modifiers` ainda;
   - **absorção do `Creature`** (M30-05, #552; `applyAbsorbDamageModifications`): a absorção
     FLAT do defensor (`absorb.<tipo>.flat` do item, sem descer de zero) e o AUMENTO do atacante
     (`increase.<tipo>` do item, `d += round(d × p / 100)`), sem sorteio. O `manadrain` já chega
     aqui capado à mana atual do alvo;
3. imunidade explícita ao tipo (`mitigation.immunities`) — zera e para tudo, sem defesa, sem
   armadura, sem mitigação percentual;
4. **defesa**: só enquanto o defensor tem CARGA de bloqueio (`blockCount`, no máximo duas,
   recarregando com o tempo — ver adiante). Com carga, `uniform_random(defesa/2, defesa)` sai do
   golpe JÁ crítico; zerou, a ARMADURA é pulada. A carga é gasta sempre que a origem do dano
   bloqueia ALGUMA coisa (defesa OU armadura), mesmo que a defesa em si não tire nada;
5. **armadura**, INDEPENDENTE da carga de bloqueio: `armor > 3` sorteia
   `uniform_random(armor/2, armor − (armor % 2 + 1))`; `armor` de 1 a 3 é sempre `−1`; `armor`
   zero não reduz nada;
6. **mitigação percentual** (`defenseMitigation`, o campo NOVO do monstro — distinto de
   `mitigation`, que é resistência/imunidade por TIPO): `dano −= dano × defenseMitigation ÷ 100`,
   sobre o que sobrou da armadura, para QUALQUER tipo de dano EXCETO lifedrain e manadrain (#547,
   M29-07: a mesma exceção do `Creature::mitigateDamage` do Canary — `drown` não é isento);
   - **absorção percentual ITEM A ITEM do jogador** (M30-05, #552; `Player::blockHit`): cada item
     vestido, na ordem de slot do Canary, tira `round(d × p / 100)` do que sobrou —
     `absorb.<tipo>.percent` e a resistência legada do item (`mitigation.resistances` × 100);
7. resistência/vulnerabilidade por tipo (`mitigation.resistances`, CMB-03) — os `elements` do
   MONSTRO (`Monster::blockHit`, depois do `Creature::blockHit`; eles NÃO passam por
   `getAbsorbPercent`). O jogador do `combat-v3` chega aqui só com as imunidades: a resistência
   do item é a absorção acima;
8. piso (`minimumDamageFraction`), sobre o poder BRUTO ORIGINAL — SEM o bônus do crítico —
   mantido como salvaguarda de PRODUTO do Draconya (o Canary não tem: lá um bloqueio pode
   legitimamente zerar um golpe, e não existe "piso" nenhum para o crítico reforçar). Pulado
   quando imune — o piso nunca revoga imunidade explícita;
9. corte do Dodge, arredondamento só no fim;
10. **reflexo** (M30-05, #552) — ver "Reflexo e cleave" abaixo.

O LEECH (M30-04) não é um estágio deste pipeline: ele opera sobre o HP EFETIVAMENTE removido, não
sobre o `DamageOutcome`, e é aplicado depois — ver a seção do CMB-08 mais abaixo.

### As flags de bloqueio vêm da ORIGEM, não do tipo

Diferente do CMB-04 (que aprovava por `damageType`), o `combat-v3` decide se defesa e armadura
valem pela ORIGEM do golpe — `checkDefense`/`checkArmor` do Canary: corpo a corpo (e o punho
desarmado) bloqueiam os dois; distância só armadura (`WeaponDistance` do Canary não seta
`blockedByShield`); magia, runa, wand/rod e DOT não bloqueiam nenhum dos dois — o default de
`CombatParams` sem `BLOCKARMOR`/`BLOCKSHIELD` declarado. Ability de monstro segue o TIPO DE
ATAQUE dela (#682, `abilityBlockFlags` em `packages/sim/src/monster/ability.ts`), a regra de
`Monsters::deserializeSpell` do Canary — alcance e área não entram:

| Ability (`kind` × `damageType`) | Escudo | Armadura | Flags |
|---|---|---|---|
| `melee` (sempre físico; o boot recusa `melee` de outro tipo) | sim | sim | `MELEE_BLOCK_FLAGS` |
| `combat` físico — qualquer alcance, com ou sem área | não | sim | `DISTANCE_BLOCK_FLAGS` |
| `combat` de qualquer outro tipo | não | não | `MAGIC_BLOCK_FLAGS` |
| sem `kind`, forma corpo a corpo (alcance 1, sem área — a básica do boot inclusive) | sim | sim | `MELEE_BLOCK_FLAGS` |
| sem `kind`, outra forma | pelo tipo, como `combat` | | |

`kind` é opcional em `monsterAbilitySchema` (`packages/content/src/schemas.ts`) e existe porque a
forma sozinha confunde os 30 `combat` físicos do Canary de alcance 1 sem área com o `melee`; o
importador de ataques (#579) o preenche. A apresentação (`source: 'melee' | 'spell'`) continua
pela FORMA — não muda número. Nenhum monstro do catálogo atual muda: só têm físico em `melee`
de alcance 1. A mitigação percentual (passo 5) é a ÚNICA que se aplica sempre, mesmo à
magia — é assim no Canary (`if (damage != 0) mitigateDamage(...)`, fora do bloco de
`checkDefense`/`checkArmor`).

**`manadrain` é a ÚNICA exceção: o TIPO, não a origem, decide.** Um mana-drain NUNCA bloqueia
por defesa/escudo nem por armadura, mesmo quando a ability é corpo a corpo
(`blockable: MELEE_BLOCK_FLAGS`) — o Canary chama `target->blockHit(attacker, COMBAT_MANADRAIN,
manaLoss)` com só três argumentos (`game.cpp:9176`), e `checkDefense`/`checkArmor` default a
`false` (`Creature::blockHit`, `creature.cpp:944`). `resolveBlockHitProfile`
(`combat/damage.ts`) força `{ armor: false, shield: false }` sempre que `damageType ===
'manadrain'`, por cima do `blockable` que a origem do golpe declararia — achado da revisão do PR
#648: a suíte do #547 só exercitava manadrain com `MAGIC_BLOCK_FLAGS` (armadura e escudo já
`false` por coincidência), e nunca provava a exceção contra uma ability corpo a corpo de
verdade. Nenhuma carga de `blockCount` é gasta nesse caso — o Canary só decrementa o contador
dentro do `checkDefense || checkArmor`, e os dois são falsos para manadrain.

O treino de shielding (`#applyMonsterHit`, `hunt.ts`) sob `combat-v3` não olha
`combat.defense.blockTypes`: desde o #686 ele segue o TIPO de bloqueio que este estágio devolve
(`blockType`/`hadBlockCharge`) — só treina quando o golpe recebido foi bloqueado por defesa ou
armadura, com carga, e com escudo na mão (`Player::onBlockHit`). O #548 tinha posto aqui a
elegibilidade por origem (`blockable.shield`, achado da revisão do PR #642); o tipo de bloqueio a
substitui e já herda a origem, porque só há `defense`/`armor` onde a origem permite. Ver
[`progression.md`](./progression.md#no-combat-v3-o-try-depende-do-tipo-de-bloqueio-686).

**`combat.armorEffectiveness` fica INERTE sob `combat-v3`.** O passo 4 (armadura) não olha mais
`armorEffectiveness[damageType]` — a coluna que o `combat-v1`/`v2` usa para decidir SE a
armadura vale para cada tipo de dano; sob `combat-v3` a armadura vale sempre que a ORIGEM permite
(`checkArmor`), para QUALQUER tipo, exatamente como o `Creature::blockHit` do Canary (que não
tem ramo por `combatType` nenhum no estágio de armadura). O schema continua exigindo o campo
para todo perfil, inclusive `combat-v3` — editar `armorEffectiveness.fire` num conteúdo `v3`
não muda resultado nenhum, e é o mesmo tipo de configuração morta que
`combat.defense.blockChance` já é para esses conteúdos (parágrafo abaixo).

### As cargas de bloqueio (`blockCount`)

O Canary acumula uma carga a cada 1000 ms de relógio de jogo (`blockTicks`/`onThink`), até um
teto de 2 — literalmente "por tick" (`creature.cpp`), e esse relógio é COMPARTILHADO pelas duas
vagas e roda INDEPENDENTE de bloqueio nenhum ter acontecido: `Creature::blockHit` só decrementa
o contador, nunca reinicia o relógio. O invariante 2 proíbe escrever assim: `packages/sim/src/
combat/block-charge.ts` calcula as cargas disponíveis SOB DEMANDA, a partir de um banco guardado
(quantas cargas já estão creditadas) e do instante a partir do qual o relógio ainda não creditou
nada — sem nenhum evento nem soma por tick, e equivalente ao contador do Canary: um relógio
ÚNICO, que credita no máximo uma carga por período de 1000 ms decorrido, até o teto de 2,
independente de QUANDO cada carga foi gasta (achado da revisão do PR #642: uma versão anterior
deste arquivo modelava duas vagas INDEPENDENTES, cada uma reagendando o próprio relógio a partir
do próprio consumo — um mecanismo diferente, que podia recusar um bloqueio que o relógio
compartilhado do Canary já teria recarregado, num padrão comum de mais de um atacante, não só
adversarial). `CharacterState.blockCharge`/`MonsterState.blockCharge` viajam no snapshot
(opcionais, sem bump de `SNAPSHOT_FORMAT_VERSION`); ausente é o banco já no teto desde o
instante 0 — uma simplificação deliberada para o caso comum (uma criatura quase sempre existe há
mais de 2 s antes do primeiro golpe de uma hunt), que NÃO reproduz a janela inicial do Canary
(uma criatura nasce com `blockCount = 0` e sobe até o teto em ~2 s) — ninguém pediu essa janela
de vulnerabilidade ainda, e fica em aberto para quando pedirem. Só `applyDamageOutcome` (CMB-08)
escreve o estado de volta no dono (invariante 9); o resolver é puro e só o calcula.

### A defesa, a armadura e a mitigação do JOGADOR (#549, M30-02)

Sob `combat-v3`, o jogador para de usar os números ad hoc que `combat-v1`/`v2` calculavam
(`combat.player.armor` mais o equipado; a defesa de `Inventory.defenseSource` escalada pela skill
`shielding` via `powerMultiplier` — uma fórmula PRÓPRIA do Draconya, não do Tibia) e passa a usar
as três funções puras de `packages/sim/src/combat/player-defense.ts`, transcritas do MECANISMO
descrito pelo Canary 13.x (ADR 0019 — nunca código copiado):

- **`playerDefense`** → `Player::getDefense` (`player.cpp:776-813`): sem nada na mão, a defesa
  vem do PUNHO (`defenseValue` 7, escalado pela skill `melee` — Draconya consolidou fist/sword/
  axe/club numa skill só, #521/ADR 0037); uma arma na mão troca os dois pelos DELA; um escudo
  troca os dois de novo — `defenseValue` vira o do escudo MAIS o `extraDefense` da arma (se
  houver uma), e a skill vira `shielding`. O resultado é o número que `resolveBlockHit`
  (`blockhit.ts`) rola em faixa (`uniform_random(defense/2, defense)`) enquanto o `blockCount`
  tiver carga — o jogador SEMPRE tem uma defesa residual agora (mesmo desarmado), diferente do
  `combat-v1`/`v2` (`Inventory.defenseSource` devolvia `none`/`0` sem peça nenhuma).
  **Achado de revisão (#549):** "a skill DELA" para uma wand/rod não é a skill de magia que a
  família aponta para o DANO — `Player::getWeaponSkill` do Canary devolve `0` para
  `WEAPON_WAND` (nenhum case no switch, `default: attackSkill = 0`, `player.cpp:474-509`).
  `hunt.ts#playerDefenseV3` zera a skill quando a família da arma é `wand` antes de montar o
  input, exatamente para reproduzir esse `default` — sem o zero, um Sorcerer/Druid sem escudo
  cairia na fórmula cheia com `defenseValue` 0 (wand/rod nunca declaram `defense`/
  `extraDefense`) e teria defesa 0 em vez do piso fixo (1 ofensivo/equilibrado, 2 defensivo).
  A skill de escudo (`#shieldSkillLevelOf`) também soma o bônus de EQUIPAMENTO da mesma skill
  (`Inventory.skillBonus`, #524) — a mesma leitura que a skill de arma/punho já fazia, e que
  `getSkillLevel` do Canary aplica sem exceção para `SKILL_SHIELD` (`player.cpp:7480`).
- **`playerArmor`** → `Player::getArmor` (`player.cpp:658-667`): a soma do equipado, sem o
  baseline de 4 que `combat.player.armor` inventava para "o personagem desarmado no level 1" —
  esse número nunca existiu no Tibia. Um personagem sem NADA vestido agora tem armadura ZERO,
  como no Canary.
- **`playerMitigation`** → `PlayerWheel::calculateMitigation` (`player_wheel.cpp:4072-4124`): a
  mitigação percentual (`Defender.defenseMitigation`) que antes só o monstro tinha. Escudo e arma
  contribuem em SEQUÊNCIA (não em exclusão mútua) — `vocation.mitigation.{multiplier,
  primaryShield, secondaryShield}` (`vocations.xml` `<mitigation>`) escalam a skill de escudo e a
  defesa da peça; spellbook e quiver (os dois novos campos de item, `Item.spellbook`/`.quiver`)
  usam `secondaryShield` como `distanceFactor` em vez de `primaryShield`, como faz uma arma de
  duas mãos ou uma que atira munição (`Item.extraDefense`, `Weapon.ammoFamily`).

`fightMode` é PARÂMETRO das duas primeiras (a postura do Canary — ofensiva/balanceada/defensiva)
e, desde a M30-03 (#550), é a postura que o jogador ESCOLHEU (`CharacterRuntime.fightMode`) —
`hunt.ts#playerDefenseV3`/`#playerMitigationV3` leem o estado do personagem, não mais um
`'attack'` fixo. Os fatores estão em "A postura de luta" abaixo: a defesa usa a variante
DINÂMICA do `getDefenseFactor(false)` (que depende de o jogador ter batido há pouco) e a
mitigação o `fightFactor` estático (0,8/1,0/1,2).

**Fora do escopo, de propósito** (ADR 0040 decisão 1, "o multiplicador da Roda é 0 até o M41"): o
bônus `Combat Mastery` (soma em `defenseValue` quando um escudo tem `defense > 0`) e o
`mitigation += mitigation × getMitigationMultiplier() ÷ 100` no fim de `calculateMitigation` — os
dois são exclusivamente da Wheel of Destiny, zero sem gema.

`vocation->defenseMultiplier`/`armorMultiplier` (`<formula defense="1.0" armor="1.0">`) ficam de
FORA do conteúdo: as cinco vocações e todas as promoções do `vocations.xml` declaram `1.0`
(conferido em 2026-09-26) — as duas funções aplicam a identidade e documentam a citação, em vez
de uma tabela de conteúdo que nunca diverge de 1.

`combat.player.armor`/`combat.player.dodgeChance` continuam existindo no schema e valendo para
`combat-v1`/`v2` (`#playerDefender` em `hunt.ts` agora BIFURCA pelo perfil: números antigos em
v1/v2, `playerDefense`/`playerArmor`/`playerMitigation` só em v3). `combat.defense.blockChance`
(o percentual do CMB-04) continua sem uso sob `combat-v3`; `combat.defense.skillId` passa a ser
REUSADO por `playerDefense`/`playerMitigation` como a skill de escudo do jogador — a mesma
entrada de conteúdo, dois consumidores.

### Parâmetros de conteúdo (#549)

| Campo | Onde | Knight | Paladin | Sorcerer | Druid | Base (sem vocação) |
|---|---|---|---|---|---|---|
| `mitigation.multiplier` | `vocations/*.json` | 1,3 | 1,28 | 1,26 | 1,26 | 1,3 |
| `mitigation.primaryShield` | `vocations/*.json` | 2,05 | 2,08 | 2,0 | 2,0 | 2,05 |
| `mitigation.secondaryShield` | `vocations/*.json` | 1,25 | 1,2 | 1,2 | 1,2 | 1,25 |

Fonte: Canary `data/XML/vocations.xml`, `<mitigation multiplier primaryShield secondaryShield>`
das entradas `id="4"` (Knight), `id="3"` (Paladin), `id="1"` (Sorcerer), `id="2"` (Druid) e
`id="0"` (None — a base de `progression/baseline.json`), conferido em 2026-09-26. A base repete
os números do Knight por coincidência do arquivo real, não erro de cópia — Sorcerer e Druid
também coincidem entre si.

| Item | `extraDefense` | `spellbook`/`quiver` | Fonte |
|---|---|---|---|
| Mystic Blade (Knight) | 2 | — | Canary `items.xml` id 7384, `extradef value="2"` |
| Spellbook of Mind Control (Sorcerer/Druid) | — | `spellbook: true` | `Item::isSpellBook`, `item.hpp:553-555` |

Nenhum item do catálogo atual declara `quiver: true` — a Royal Crossbow (Paladin) é de duas mãos
e usa `Weapon.ammoFamily` (não um item de escudo) para o mesmo efeito em `playerMitigation`.

### O monstro ganha `defense` e `defenseMitigation`

`monsterSchema` ganha os dois campos novos (ambos opcionais, default `0` — a identidade de rato e
rotworm, que não os declaram). Os únicos dois monstros do catálogo real com o par declarado hoje
são o Dragon e o Dragon Lord, conferidos contra `dragon.lua`/`dragon_lord.lua` do Canary local
(47dfd51) em 2026-09-25:

| Monstro | `armor` | `defense` | `defenseMitigation` |
|---|---|---|---|
| Dragon | 25 | 30 | 0,99 |
| Dragon Lord | 34 (era 35 — um palpite anterior a esta issue, corrigido aqui) | 34 | 1,29 |

`defenseMitigation` é o valor DIRETO que o Canary usa — `0,99` tira 0,99 % do dano, não 99 %; o
Canary o capa em 30.

### Reflexo e cleave (M30-05, #552)

**Reflexo** (`combat/reflect.ts`; Canary `game.cpp:7957-7981`). O item declara
`reflect.<tipo>: { percent, flat }` (inteiros); `equipmentReflect` soma os vestidos. Sobre o dano
JÁ bloqueado do golpe, volta ao ATACANTE `flat + floor(dano × percent / 100)`, com o teto
`ceil(1 % da vida máxima do atacante)`. Reflexo SÓ flat de `physical` (o `reflectdamage` dos cinco
itens do Canary) exige o atacante adjacente; com percentual, ou em tipo elemental, a distância
não importa. A segunda resolução é uma EXTENSÃO contra o atacante: nunca reflete de volta, não
critica, não faz leech, não bloqueia por defesa/armadura, e — refletida por jogador — é dano
NEUTRO (não passa por absorção, imunidade nem resistência do monstro; a mitigação percentual e o
piso continuam). Sai ANTES do dano no alvo, credita o dano e o DPS a quem refletiu, e a morte do
monstro refletido é resolvida no fim da ability. Hoje só o golpe de ability de monstro contra o
jogador reflete; o reflexo de MONSTRO é o #683, pelo mesmo `resolveReflect`
(`reflector: 'monster'`: tipo original, sem a exceção de distância).

**Cleave** (Canary `WeaponMelee::useWeapon`, `weapons.cpp:531-589`). `cleavePercent` (inteiro,
somado entre os vestidos) faz o golpe corpo a corpo COM arma acertar os dois tiles que
flanqueiam o alvo (`combat/cleave.ts`): alvo na mesma coluna → leste e oeste do alvo; mesma linha
→ sul e norte; diagonal → os dois vizinhos comuns ao atacante e ao alvo. Cada monstro vivo nesses
tiles leva uma rolagem PRÓPRIA do poder da arma × `cleavePercent / 100` (truncado), ANTES do
golpe principal, como extensão (sem crítico, leech nem reflexo; o aumento por tipo vale), e
pratica a skill uma vez. O punho não tem cleave.

**Reflexo do MONSTRO (#683).** O espelho do de cima: `monster.reflect.<tipo>` (percentual
inteiro) e o mesmo `resolveReflect` com `reflector: 'monster'` — tipo original, sem a exceção de
distância. O golpe, a magia e a runa do personagem levam o `attacker` (vida máxima e distância)
só quando o monstro reflete; a segunda resolução (`#reflectOntoCharacter`) passa pelo
`#playerDefender` e pelo mana shield, e sai depois do dano no monstro. Ver "Resistência,
vulnerabilidade e imunidade" acima para a cura por elemento, que mora ao lado.

**Fora, por enquanto:** reflexo de tique de condição, reflexo do componente secundário (o #683
também o deixou de fora: a conta do Canary usa o valor do PRIMÁRIO com o tipo do secundário, e
nenhum conteúdo tem secundário contra monstro que reflete), e consumo de carga por
reflexo/cleave.

### O que fica para depois

Absorção/aumento por tipo e reflexo fecharam com o **M30-05 (#552)** — seção seguinte. Postura de luta de VERDADE (um seletor por personagem, em
vez do `'attack'` fixo que `playerDefense`/`playerMitigation` recebem desde o #549) é o
**M30-03**. A exceção de lifedrain/manadrain na mitigação percentual (passo 6 acima) fechou com
o **#547 (M29-07)**: `combat/damage.ts` calcula `mitigationExempt` do `intent.damageType`, e não
fica mais fixo em `false`.

### Manadrain resolve contra a mana, não a vida (#547, M29-07)

`manadrain` é o único tipo de dano que `applyDamageOutcome` (`combat/outcome.ts`) desvia da
vida: a aplicação final tira `min(mana, resolvido)` da MANA do alvo e nunca toca a vida
(`healthDamage` fica em zero). O pipeline que produz o `resolvido`, porém, **não é igual ao dos
outros tipos** — dois pontos em que `manadrain` diverge, corrigidos na revisão do PR #648:

- **defesa/escudo e armadura NUNCA se aplicam** — ver "`manadrain` é a ÚNICA exceção: o TIPO, não
  a origem, decide" acima. Só Dodge (posição do Draconya), resistência/vulnerabilidade por tipo
  (CMB-03) e o piso (`minimumDamageFraction`, salvaguarda do Draconya, sem equivalente no Canary)
  seguem incidindo, como em qualquer outro tipo;
- **a mana disponível capa o poder bruto ANTES da resistência**, não depois. O Canary computa
  `manaLoss = min(mana atual, poder bruto)` (`game.cpp:9175`) e só então roda `blockHit` — que
  aplica a resistência/absorção — sobre o valor JÁ capado (`creature.cpp:948`). Resolver a
  resistência sobre o poder bruto inteiro e capar a mana só no fim (o que a aplicação sozinha
  faria) dobraria o dreno sempre que a mana disponível for menor que o poder bruto e o alvo tiver
  resistência ao tipo — exemplo: poder 100, mana 30, resistência 50 %; capar primeiro dá
  30 × 0,5 = 15 (o certo), resistir primeiro dá 100 × 0,5 = 50, capado a 30 só no fim (o dobro).
  `Defender.mana` (`combat/damage.ts`) existe só para isto: `resolveBlockHitProfile` o lê para
  capar ANTES de aplicar `mitigation.resistances`, e fica ausente sem efeito nenhum contra um
  monstro (que não tem mana — o dreno dele já é zerado depois, em `applyDamageOutcome`).

Duas consequências que seguem do próprio Canary (`Game::combatChangeMana`, `game.cpp:9176`,
`Creature::drainMana`):

- **a mana shield NÃO entra** — ela existe para converter dano de VIDA em mana; aqui o golpe já é
  mana, e "absorver" duas vezes não faz sentido nenhum;
- **um alvo sem mana não perde nada.** Todo `MonsterRuntime` (monstro não tem mana no Draconya) e
  um `CharacterRuntime` já com mana zerada tratam o manadrain como um no-op — o mesmo
  `manaLoss <= 0` que o Canary já reporta como "nada aconteceu", sem mensagem nem efeito.

`lifedrain` e `drown`, ao contrário, são dano de vida comum — passam por `applyDamageOutcome`
sem desvio nenhum, mana shield e leech inclusos como qualquer outro tipo (leech nunca ocorre de
qualquer forma num ataque de monstro, porque `attacker` chega `null`).

**O desvio para a mana é uniforme nos CINCO produtores de dano, não só nos quatro que o #547
original cobria.** DOT (`#applyConditionTick`), ability de monstro (`#applyMonsterHit`) e o golpe
básico (`#land`) sempre passaram por `applyDamageOutcome`; magia e runa de dano (`castSpell`/
`useSupply`, aplicadas por `HuntRuleset#applyHits`) foram corrigidas na revisão do PR #648 —
antes, `#applyHits` chamava `monster.receiveDamage` direto sobre o `resolvedDamage`, sem olhar
`damageType`, e um `manadrain` declarado numa magia ou runa bateria na vida do monstro como dano
comum (o schema de `effect.damageType` sempre aceitou qualquer `DamageType`, `manadrain`
incluso). `CastSuccess.hitOutcomes` (`casting.ts`) carrega o `DamageOutcome` inteiro de cada
alvo, na mesma ordem de `hits`, para `#applyHits` poder chamar `applyDamageOutcome` como os
outros quatro produtores — o mesmo fix foi replicado no palco de golden traces
(`combat/traces/harness.ts`), que tinha a MESMA lacuna.

O número flutuante do manadrain usa o novo `AppliedDamageOutcome.manaDamage` no lugar do
`healthDamage` (`hunt.ts`, `amount: applied.healthDamage + applied.manaDamage` — exatamente um
dos dois é não-zero para qualquer golpe), e a cor sai da mesma tabela de elemento do cliente
(azul saturado, distinto do azul claro de `drown` e do azul-gelo de `ice`).

## A postura de luta (M30-03, #550, ADR 0040)

O jogador escolhe a postura de luta — o `fightMode` do Canary — e ela multiplica o dano que ele
causa, a defesa que ele tem e a mitigação percentual que ele recebe. Um estado por PERSONAGEM,
não constante de conteúdo: `CharacterRuntime.fightMode` (`packages/sim/src/character.ts`).

- **Três modos**, na ordem do `FightMode_t` do Canary (`creatures_definitions.hpp:813-815`):
  `attack` (ofensiva), `balanced` (balanceada), `defense` (defensiva). O default é `attack` — o
  `FIGHTMODE_ATTACK` de `player.hpp:1857` — para quem nunca escolheu, na coluna, no ticket, no
  construtor do runtime e no `player-stats` que o cliente lê.
- **Quem escolhe**: a intenção `set-fight-mode` (C2S 35, `{ mode }`), tratada pela sessão dona
  (invariante 9) na Cidade e na hunt, na chegada — como `select-ammo` —, sem passar pelo
  ruleset. A resposta é o `player-stats.fightMode` (a marca do botão só troca quando ele
  chega). Uma troca no meio da hunt vale do evento seguinte em diante; a hunt DESANEXADA
  continua com o modo que o jogador deixou (o estado vive no `CharacterRuntime` hospedado).
- **Persistência**: `character.fight_mode` (migração `0022`, `NOT NULL DEFAULT 'attack'` com
  CHECK dos três valores). ABSOLUTA e última-escrita-vence, como as bênçãos — não há ordem entre
  os modos, então nada de fusão por máximo. O ticket a leva à sessão (`initialCharacter.fightMode`)
  e o extrato a traz de volta (`Receipt.fightMode`, sempre incluída quando o personagem
  participou, nunca gateada pelo default: voltar à ofensiva é uma escolha real).

### Os três fatores (cada um numa escala própria)

| Onde entra | Ofensiva | Balanceada | Defensiva | Canary |
|---|---|---|---|---|
| Fator de ataque — o MÁXIMO do dano de arma (`getMaxWeaponDamage`) | 1,0 | 0,75 | 0,5 | `Player::getAttackFactor`, `player.cpp:840-851` |
| Fator de defesa — `playerDefense`, **DINÂMICO** | 0,5 batendo · 1,0 parado | 0,75 batendo · 1,0 parado | 1,0 sempre | `Player::getDefenseFactor(false)`, `player.cpp:853-872` |
| Fator da mitigação percentual — `playerMitigation`, estático | 0,8 | 1,0 | 1,2 | `PlayerWheel::calculateMitigation`, `player_wheel.cpp:4078-4090` (= `getCombatTacticsMitigation`, `player.cpp:754-774`) |

A tabela do TFS (`getAttackFactor` 1,0/1,2/2,0, usada como divisor) NÃO é a que vale aqui: a
fórmula de arma do Draconya é a do Canary (`0,085 × attackFactor × attack × skill`, multiplicando),
e o Canary é a fonte de precedência para a fórmula (ADR 0037 d.4). Os números vivem em código puro
— `combat/fight-mode.ts` —, porque são MECANISMO do Canary, não balanceamento do Draconya.

- **O fator de ataque** entra em `resolveWeaponPower`/`resolveWeaponHit` para corpo a corpo, punho
  e distância — e no componente elemental da arma (que o Canary também multiplica dentro de
  `getWeaponDamage`, antes da divisão físico/elemento). Wand/rod NÃO o leem (`WeaponWand` do Canary
  não usa `attackFactor`), e as magias tampouco: os `onGetFormulaValues` de `data/scripts/spells`
  recebem o `factor` mas nenhum o usa (conferido no `47dfd51`).
- **O fator de defesa é o dinâmico**, o que `Creature::blockHit` chama (`getDefense()` com
  `sendToClient = false`, `creature.cpp:967`): nos modos ofensivo e balanceado a defesa cai
  enquanto o jogador bateu há menos de um intervalo de ataque — `(now − lastAttack) <
  getAttackSpeed()` — e volta a 1,0 quando ele parou por um intervalo inteiro. `getAttackSpeed()`
  é o `attackspeed` da vocação (2000 ms em todas, `vocations.xml`), que é o
  `combat.player.attackIntervalMs` do conteúdo. A variante ESTÁTICA (0,5/0,75/1,0 sem olhar o
  relógio) é o que o Canary manda ao CLIENTE para o painel de stats — apresentação, fora do
  resultado da caça, e por isso não implementada.
- **Quando `lastAttack` é escrito** (`CharacterRuntime.lastAttackAtMs`, relógio LÓGICO da sessão):
  só quando a arma foi de fato usada — o `result` de `Player::doAttacking`, que só é `true` se
  `useWeapon`/`useFist` devolveu `true` (`player.cpp:4030`) — e DEPOIS do golpe, então o reflexo
  que ele provoca ainda enxerga a janela anterior. `HuntRuleset#strike` devolve `true` quando o
  golpe saiu (acertando ou errando); `false` quando NÃO saiu: sem visão livre (#553), sem munição,
  monstro fora do conteúdo — e a wand sem mana e a arma abaixo do level exigido (`damagePercent`
  0) nem chegam ao `strike`. Só o `combat-v3` o escreve (o único perfil que o lê), então o
  snapshot de uma sessão `combat-v1`/`v2` continua sem a chave. Não vai para o Postgres: o
  relógio é da sessão; viaja só no snapshot quente, para a hunt retomada não perder a janela.
  `null` é "nunca bateu": fator 1,0 — o `lastAttack == 0` do Canary sem o relógio de processo.
  **O carimbo não atravessa a troca de sessão**: o relógio da sessão nova nasce em zero e o
  `CharacterRuntime` é o MESMO objeto na transição, então `Session.enter` zera `lastAttackAtMs`
  (o restore de snapshot não passa por `enter` e mantém a janela quente), e `attackedRecently`
  ainda trata um carimbo no futuro como "nunca bateu". Sem isso um herói vindo de uma hunt de
  57 s teria a defesa pela metade por quase um minuto na hunt seguinte sem bater — o resultado
  dependeria do caminho do objeto, não do estado e da semente.
- **O empate exato da janela** (`agora − lastAttack == 2000 ms`): quem bate sem parar nunca fecha
  a janela no Canary (o golpe seguinte corre `attackSpeed` mais a latência do despachante, e um
  golpe de monstro só cai nessa fresta de poucos ms por ciclo). No motor de tempo discreto o
  monstro que ANDOU até o herói e o próprio herói armam as duas cadências no mesmo instante e
  batem no mesmo ms para sempre — e a ordem de dois eventos no mesmo ms é só a ordem da fila. O
  empate conta como janela ABERTA quando o golpe do herói está agendado para este mesmo ms
  (`session.dueAtOf('player-attack', id)`, lido só no empate exato); se o herói parou, é a
  comparação estrita do Canary (fechada). O reflexo do próprio golpe (`#reflectOntoCharacter`,
  dentro de `#onPlayerAttack`) vê o evento do golpe já fora da fila e a janela fechada, como o
  Canary — o carimbo só é reescrito depois dele.
- **Perfis**: só o `combat-v3` (e o v4 que o herda) lê a postura. `combat-v1`/`v2` — sessões
  fixadas neles — seguem no 1,0 fixo que a constante `weaponDamage.attackFactor` dava, bit a bit
  (ADR 0031/0040 d.3): a postura entrou no `combat-v3` porque ele ainda não chegou à `main` — um
  perfil já publicado nunca é reaberto.

### Parâmetros

| Parâmetro | Valor | Onde mora |
|---|---|---|
| Modo default | `attack` (`FIGHTMODE_ATTACK`) | `packages/sim/src/combat/fight-mode.ts` (`DEFAULT_FIGHT_MODE`); `character.fight_mode` `DEFAULT` |
| Fatores de ataque / defesa / mitigação | ver a tabela acima | `packages/sim/src/combat/fight-mode.ts` |
| Intervalo de ataque da janela de defesa | 2000 ms | `packages/content/data/combat/baseline.json`, `player.attackIntervalMs` |
| Vocabulário e opcode | `attack`/`balanced`/`defense`; C2S 35 `set-fight-mode` | `packages/protocol/src/{types,messages}.ts` |

### Divergências e o que fica de fora

- **Chase mode e secure mode** ficam de fora (issue #550, ADR 0037 d.2): a perseguição é do bot
  (rota, follow, `targeting.posture`) e o modo seguro é regra de PvP.
- **`Player::attackTotal`** (o "dano" que o Canary mostra no painel de stats do cliente, com a
  postura em `1,2/1,0/0,6`) é apresentação: o Draconya não tem esse painel de dano.
- **A postura NÃO é do bot.** O bot não a troca, e o vocabulário da automação não mudou. O campo
  `stance` (`offensive`/`balanced`/`defensive`) que a config v2 do bot já carregava (ADR 0032
  d.10, que o previa como a postura de combate) NÃO é lido por nada e não tem efeito: ele fica no
  schema só por compatibilidade com config já salva (ADR 0014); a postura de verdade é
  `character.fight_mode`.

## Famílias de arma e proficiências (CMB-05, #333)

`Weapon.kind` continua sendo o DESPACHO (`melee`, `distance`, `wand`), mas a fórmula e a
proficiência deixaram de ser genéricas: cada arma declara uma **família**, e a família é dado em
`packages/content/data/weapon-families/`. O `sim` resolve o poder por `resolveWeaponPower` com o
perfil da arma — sem conhecer nome de item nem vocação (DT-01).

```ts
interface WeaponProfile {
  readonly family: WeaponFamily;      // fist | sword | axe | club | distance | wand | rod
  readonly damageType: DamageType;
  readonly range: number;
  readonly power?: WeaponPowerFormula;          // base, levelFactor, skillFactor, skillStartingLevel, spread
  readonly manaPerHit?: number;                 // wand/rod
  readonly fixedDamage?: { min: number; max: number }; // wand/rod
  readonly hitChance?: number;                  // #524: bônus/malus da ARMA (ver #522, acima)
}

resolveWeaponPower(profile, level, skillLevel, rng, combat?, vocationMultiplier?): number
```

`combat` é OPCIONAL de propósito (DT-03): ausente, ou com `combat.compatibilityProfile` diferente
de `combat-v2`, a fórmula é a v1 de sempre — nenhuma chamada existente precisou mudar. `power`
(`levelFactor`, `skillFactor`, `skillStartingLevel`, `spread`) continua existindo e alimenta o
`combat-v1`; o `combat-v2` usa só `power.base` (o `attack` da arma/munição) e ignora o resto —
a escala por level/skill do v2 vem do `combat.weaponDamage`, não da família. `damagePerLevel`
das skills `melee`/`distance` (`skills/*.json`) **deixa de alimentar o dano de arma sob
`combat-v2`** (ele virava `skillFactor` só no v1, via `compileWeaponFamilies`); continua
alimentando a defesa/escudo do CMB-04 (`powerMultiplier`, `skills.ts`), que a #522 não toca.

| Família | `kind` | Skill | Fórmula / recurso |
|---|---|---|---|
| `fist` | melee | `melee` | fórmula; `attack`/alcance/tipo de `combat.player` (fallback sem item) |
| `sword`, `axe`, `club` | melee | `melee` | fórmula; `base` = `attack` da arma |
| `distance` | distance | `distance` | fórmula; `base` = `attack` da **munição**, tipo também |
| `wand`, `rod` | wand | `magic` | **sem fórmula**: faixa fixa e `manaPerHit` da arma; pratica por mana |

Quatro coisas que a estrutura garante, e não a inspeção:

- **A família é coerente com o `kind`.** `buildContent` recusa família inexistente, família de
  outro `kind`, e `fist` como arma — ela é o fallback desarmado, nunca um item.
- **A fórmula preserva o v1 bit a bit.** `levelFactor` e `spread` são 0 no conteúdo inicial, e a
  contribuição por nível é o `damagePerLevel` da skill apontada. `spread: 0` **não consome
  sorteio**, então a sequência de RNG da hunt é a mesma de antes (DT-03).
- **Wand/rod não recebem multiplicador de weapon skill.** O perfil delas não tem `power`; a
  fórmula de arma e o `spellPower` continuam separados (DT-02), e mudar isso exige perfil novo
  (ADR 0031).
- **A prática é uma só por golpe, e não depende do dano final.** Imunidade, resistência alta,
  bloqueio (CMB-04) ou alvo que morre no impacto não impedem a prática — ela sai do gatilho da
  skill da família (`melee-hit`, `distance-hit`, `spell-cast`), nunca de um `if` por nome.
  **No `combat-v3` (#686) isto mudou:** quantos tries o golpe rende vem do tipo de bloqueio que
  `resolveBlockHit` devolve (`blockType`/`hadBlockCharge` no `DamageOutcome`) — corpo a corpo 1
  ou 0 (imune, ou bloqueado depois de 30 seguidos sem tirar sangue), distância 2/1/0 e o tiro
  errado herdando o estado do anterior, e shielding só quando o golpe recebido foi bloqueado com
  escudo na mão. A regra está em `combat/attack-practice.ts` e a tabela em
  [`progression.md`](./progression.md#no-combat-v3-o-try-depende-do-tipo-de-bloqueio-686).

O perfil é indexado no boot, junto das famílias e das skills: nenhuma varredura de catálogo por
golpe. O `Item.weapon` compilado carrega família, tipo, alcance e fórmula, e é o que o ruleset lê.

## Abilities de monstro (CMB-06, #235)

O ataque único do monstro virou uma lista declarativa em `monster.abilities`. **Ausente (ou
vazia), o boot normaliza para UMA ability básica** montada do `attack`/`attackIntervalMs`/
`attackRange`/`damageType` de sempre — é o que preserva o rato **bit a bit**, com o mesmo sorteio
e a mesma ordem de eventos. A normalização é do BOOT, nunca de cada golpe (DT-02): o caminho
quente não ramifica, e duas formas de ler o ataque não divergem.

```ts
interface MonsterAbility {
  readonly id: string;
  readonly cadenceMs: number;
  readonly target: { readonly range: number; readonly area?: SpellArea };  // área: `circle`
  readonly power: { readonly min: number; readonly max: number };           // faixa, 1 rolagem
  readonly damageType: DamageType;
  readonly presentation?: { readonly missileKey?: string; readonly impactKey?: string };
}
```

- **A distância deixou de ser decorativa.** O alcance de parada do passo guloso é o MAIOR entre
  as abilities, e uma ability de alcance > 1 emite `monster-ability-cast` ANTES do golpe: o host
  resolve `missileKey`/`impactKey` na tabela versionada e desenha projétil e impacto. O golpe de
  uma ability não-corpo-a-corpo é `spell` (sem o sangue melee); a básica legada continua `melee`,
  e não ganha evento nenhum a mais.
- **A área reusa `area.ts`** (`circle` centrado no alvo ou no lançador). `wave`/`cleave`/`beam`
  saem da DIREÇÃO do lançador, que o monstro não carrega — o boot recusa. Os alvos são colhidos
  ANTES de qualquer dano, na ordem de ENTRADA dos participantes, e morto é pulado: a ordem é
  contrato, como a do loot — cada alvo consome uma rolagem do `Rng` da sessão.
- **Cada ability é um evento na fila** com subject derivado (`m:<id>:<abilityId>`), e a morte
  cancela os subjects que o conteúdo conhece — sem varrer a fila. A básica segue em
  `monster-attack` (`m:<id>`), então um snapshot de um nó anterior retoma durante o deploy.
- **A arte é do host** (invariante 6). O conteúdo declara chaves semânticas, e o host as resolve
  em `appearances.abilities`. **Chave sem linha é MUDA**: a mecânica — dano, morte, atribuição e
  recibo — acontece igual; derrubar a apresentação esconderia que ela funcionou.
- **`scheduledAbilities` viaja no snapshot** (opcional, sem bump de formato). Sem ele, a hunt
  retomada reagendaria a ability que já tinha evento na fila e bateria em dobro no primeiro
  vencimento.
- **Fora do escopo**, por decisão (CMB-08): scripts de boss e o detalhamento visual do dano.
  Condições e campos, que ficavam aqui, entraram no CMB-07 (ver a seção seguinte). A cura própria
  (defesa) saiu do escopo do CMB-08 e entrou no #518; a invocação de monstro por monstro também
  saiu do escopo do CMB-08 e entrou no #546 — ver a seção "Invocação de monstro por monstro"
  abaixo.

O Rat, em `packages/content/data/monsters/generated/mammals.json` desde o #581, continua sem
`abilities` — é o caso legado, e é o teste de que a normalização preserva o resultado entregue.

**O catálogo (#580) trouxe 933 monstros gerados** para `packages/content/data/monsters/generated/`.
Rat, Rotworm, Dragon e Dragon Lord ficaram fora daquela promoção por decisão
(`HAND_AUTHORED_MONSTER_IDS`, `scripts/catalog/promote-monsters.ts`) — o #581 os regenerou à parte,
uma única vez, direto na mesma pasta (Rat em `mammals.json`, Rotworm em `vermins.json`, Dragon e
Dragon Lord em `dragons.json`), com override (`data/monsters/overrides/`) para o `blockable: true`
temporário que Rat Cellars e Rotworm Caves exigiram até o #586 (M36-05) converter as duas para os
spawns reais do Canary e apagar os dois arquivos de override. O que ficou de fora do
corte e por quê — inclusive as linhas de loot removidas por item ainda não catalogado (#573/#574)
— está em `docs/reference/catalog/monsters-promotion-report.md`;
`scripts/catalog/promote-monsters.ts` é quem separa `bestiary`/`outfitId` do monstro ao promover.

## IA de monstro do TFS: chance, onda direcional, defesa, troca de alvo e fuga (#518)

O CMB-06 deu ao monstro uma lista de abilities, mas cada uma disparava **sempre** que o
`cadenceMs` vencia — o TFS rola uma chance a cada intervalo, e o monstro não tinha defesa, troca
de alvo nem fuga. O #518 fecha essa distância, seguindo a referência §15-19
(`docs/reference/opentibia-engine-reference.md`) e o mecanismo do TFS `Monster::doAttacking`/
`onThinkDefense`/`onThinkTarget`/`isFleeing` (código GPL v2 lido, nunca copiado — ADR 0019).

```ts
interface MonsterDefense {
  readonly id: string;
  readonly cadenceMs: number;
  readonly chance: number;                              // SEMPRE declarada — conteúdo novo
  readonly heal: { readonly min: number; readonly max: number };
  readonly presentation?: { readonly impactKey?: string };
}
interface MonsterTargetChange { readonly intervalMs: number; readonly chance: number; }
// #541 — inteiros não-negativos, soma > 0. Dragon/Dragon Lord: { 70, 10, 10, 10 }.
interface MonsterTargetStrategy {
  readonly nearest: number;
  readonly health: number;
  readonly damage: number;
  readonly random: number;
}
```

- **`chance` por ability** (`monsterAbilitySchema.chance`, `[0, 1]`): a cada vencimento do
  `cadenceMs`, a entrada rola a PRÓPRIA chance — corpo a corpo, onda e bola podem sair no mesmo
  intervalo, como no TFS. **Ausente é sempre passa e NÃO consome sorteio** (o mesmo argumento do
  `blockChance`/CMB-04 e do `modifiers.critical`/CMB-08): é o que preserva o rato e o rotworm bit
  a bit, porque a ability básica sintetizada pelo boot nunca declara o campo. Declarada, consome
  UMA rolagem por vencimento mesmo com o valor 1 — a sequência de RNG não pode depender do
  número. `#onMonsterAttack`/`#onMonsterAbility` sempre REAGENDAM a próxima tentativa antes de
  rolar a chance: o intervalo continua correndo mesmo quando a rolagem falha.
- **Onda e feixe direcionais**: `monsterAbilityTargetSchema.area` aceita `circle` (de sempre),
  `wave`, `rows` (#679) e `beam` — as três últimas saem do MONSTRO na direção do alvo, recalculada a cada golpe
  por `facingDirection` (`packages/sim/src/area.ts`), o mesmo cálculo do TFS
  `updateLookDirection`: o eixo de MAIOR deslocamento decide (`|dx| > |dy|` → leste/oeste), e o
  empate (inclusive `dx = dy = 0`) decide horizontal pelo sinal de `dx`. Desde o #679 a onda de
  monstro é `rows`, com as larguras que `AreaCombat::setupArea(length, spread)` (`combat.cpp`)
  gera, transcritas já calculadas (números, não a fórmula nem a matriz — ADR 0019): a `firewave`
  do Dragon e do Dragon Lord (`length = 8, spread = 3`) é `[1,1,3,3,3,5,5,5]`, 26 tiles — o cone
  `wave 8` de antes dava 40. `cross`/`cleave` continuam fora; `buildContent`
  recusa.
- **Defesa (`monster.defenses`)**: cura própria, o mecanismo que o Dragon usa (`interval 2000,
  chance 15%, +40..+70`). Cada defesa é um evento NA FILA com a própria cadência — o mesmo
  desenho das abilities, subject derivado `m:<id>:<defenseId>` — e não depende de alvo: cura
  mesmo sem ninguém para atacar, mas SÓ com o monstro acordado — o ocioso (#655, sem ninguém à
  vista no spawn) vence o timer sem rolar nada, como o `onThinkDefense` que o Canary não roda para
  ele. `chance` é sempre declarada (o campo é conteúdo NOVO, sem
  concessão de compatibilidade). A cura nunca passa do HP máximo, e de vida cheia o `sim` não
  emite `creature-healed` — a mesma regra de `#emitHealed` do personagem (um "+0" flutuando é
  ruído). A apresentação é a mesma chave semântica de `MonsterAbilityCast.impactKey`
  (`appearances.abilities`), agora carregada por `CreatureHealed.impactKey` — só em
  `source: 'monster'`.
- **Raio de agressão (`monster.aggroRadius`)**: a distância em que `chooseTarget`
  (`packages/sim/src/monster/monster.ts`) aceita um jogador NOVO como alvo (Chebyshev, como todo
  o resto do movimento) — o mesmo raio de `Monster::canSee` do TFS/Canary, que gate-keeper
  `updateTargetList`/`onCreatureFound` (só quem `canSee` vê entra na lista de alvos possíveis).
  O Dragon e o Dragon Lord passaram de 8 para **11** (#527, achado reproduzindo a QA do M28 com
  conteúdo real: a party não era notada a 17 tiles de distância, valor menor que o Tibia real). O
  TFS restringe a `Monster::canSee` PRÓPRIA — um quadrado de `Map::maxClientViewportX + 1` = 9
  (`src/monster.cpp`, `src/map.h`); o Canary NÃO sobrescreve `canSee` para monstro e herda o
  quadrado de `Creature::canSee`, `MAP_MAX_VIEW_PORT_X`/`_Y` = 11 (`src/map/map_const.hpp`,
  `src/creatures/creature.cpp`) — os dois conferidos contra o código em 2026-09-25. Pela
  precedência do ADR 0037 d.4 (Canary primeiro quando ele define algo; TFS só onde a escala é a
  clássica — não é o caso aqui), o valor certo é o do Canary, 11. **Desde o #655 é também a área
  de visão que MANTÉM o alvo**: o alvo retido que sai dela é largado (o Canary o tira da
  `targetList`), e é a mesma área que decide o ocioso, a volta ao spawn e o passo aleatório —
  ver "Volta ao spawn, passo aleatório e monstro ocioso".
- **Aquisição sem alvo (`chooseTarget`, #645)**: SEMPRE `TARGETSEARCH_NEAREST` fixo — o mesmo
  passo único de sempre, mais perto dentro do `aggroRadius`, desempate estrito por ordem de
  candidatos — e o `targetStrategy` do conteúdo NUNCA é consultado aqui, nem para o Dragon
  (`Monster::onThink_async`, ramo "sem `followCreature`/`hasFollowPath`",
  `monster.cpp:1736,1741-1742`). Zero sorteio, zero alocação nova.
- **Troca de alvo (`monster.targetChange`, #518/#645)**: a cada `intervalMs` rola `chance`; se
  passa, escolhe um alvo válido diferente do atual dentro do `aggroRadius` — e, desde o #645,
  **também NUNCA consulta `targetStrategy`**, como `Monster::onThinkTarget`
  (`monster.cpp:2141-2192`, idêntico no TFS `forgottenserver/src/monster.cpp:919-963`): o
  critério é `useRandomSearch = targetDistance <= 1` — o `targetDistance` do TIPO do monstro
  (`definition.targetDistance`, o campo do #542 — NÃO a distância corrida até o alvo agora, nem
  o `attackRange`), lido uma vez do conteúdo. Corpo a corpo (Dragon, Dragon Lord, rato, rotworm
  — todos `targetDistance = 1` nos `.lua` do Canary, mesmo o Dragon tendo bola/onda de alcance
  7) é sempre `TARGETSEARCH_RANDOM`; um monstro que mantém distância (`targetDistance > 1`,
  nenhum no recorte hoje) é `TARGETSEARCH_NEAREST` fixo.
- **Seleção ponderada de alvo (`monster.targetStrategy`, #541/#645)**: o CRITÉRIO da escolha é
  sorteado pelos pesos declarados — mais perto, menos vida, mais dano causado no monstro, ou
  aleatório —, com a MESMA matemática de `MonsterTargetRanker::rank`
  (`monster_targeting.cpp:17-83`): `rankTarget` (`packages/sim/src/monster/target-strategy.ts`)
  reproduz a ordem fixa de sorteio (um para o critério, um segundo SÓ quando o critério é
  `random`) e o desempate por redução determinística (nearest/health/damage ficam com quem
  aparece primeiro na lista de candidatos — o mesmo `<`/`>` estrito do `.cpp`). O schema
  (`monsterTargetStrategySchema`) exige os quatro pesos como inteiros não-negativos com soma >
  0; ao contrário do Canary (que trata `random` como "o que sobra até 100", e nunca soma o
  campo), aqui `random` é um peso EXPLÍCITO como os outros três, e a soma não precisa ser 100 —
  `rankTarget` sorteia proporcionalmente à soma real. Dragon e Dragon Lord declaram
  `{ nearest: 70, health: 10, damage: 10, random: 10 }` (`dragon.lua`/`dragon_lord.lua`,
  conferidos em 2026-09-25); os outros 644 monstros do bestiário do Canary só declaram
  `nearest: 100` — fora do recorte desta issue (ver "Fora do escopo" do #541), então o rato e o
  rotworm continuam sem o campo.

  **O gatilho é o mesmo do Canary desde o #645 (ADR 0037 d.6) — não é mais divergência.**
  `rankTarget` só entra no ramo estreito equivalente a `TARGETSEARCH_DEFAULT`
  (`Monster::searchTargetImmediate`, `monster.cpp:906-931`), cujo ÚNICO chamador é
  `Monster::onThink_async`: o monstro já tem um alvo perseguido (esta função ia RETER o
  `current`), está FUGINDO (`isFleeing()`) E não consegue atacá-lo agora (`!canUseAttack`)
  (`monster.cpp:1737-1739`). O sim não tem linha de visão nem `followCreature`/`hasFollowPath`;
  "não consegue atacar agora" é derivado do único estado equivalente que já existe —
  `distance(monstro, alvo) > monsterAttackRange(definição)` (o alcance combinado de TODAS as
  abilities, a mesma métrica que `canUseAttack` real usa: qualquer spell cujo alcance cubra a
  distância). Fora desse corner case — a aquisição e o reroll periódico acima —, o critério é
  SEMPRE o mais perto (aquisição) ou o sorteio uniforme/mais perto por `targetDistance`
  (reroll), nunca o peso; nenhum script de monstro do bestiário chama `self:searchTarget()`
  (conferido com grep em `data-otservbr-global/`), então na prática esse ramo só dispara quando
  o Dragon/Dragon Lord já está fugindo E o alvo perseguido saiu do alcance de toda ability dele.

  **A CADÊNCIA do ramo também é a do Canary, corrigida na revisão do #654.** `chooseTarget` é
  chamada de três eventos independentes em `hunt.ts` (`#onMonsterStep`, `#onMonsterAttack`, e
  cada `#onMonsterAbility` declarada) — um Dragon com três abilities a `cadenceMs: 2000` gera
  4-5 vencimentos a cada 2 s, e o passo sozinho vence bem mais rápido que isso. Sem um gate, cada
  um desses vencimentos reentraria no ramo estreito acima e consumiria um sorteio NOVO do
  critério — contra o Canary real, em que `Monster::onThink_async` roda sozinho, uma vez, a cada
  `EVENT_CREATURE_THINK_INTERVAL` = 1000 ms (`creature.hpp:47`), e nunca é chamado por
  `doAttacking` (o caminho de ataque/spell). Isso faria um Dragon fugindo e bloqueado reavaliar o
  peso — e queimar sorteio do `rng` da sessão — várias vezes mais rápido que o Canary para o
  MESMO estado de HP/posição, ainda que o ALVO final quase sempre convirja (os pesos do Dragon
  favorecem `nearest` a 70 %). `chooseTarget` agora impõe "no máximo uma reavaliação por
  1000 ms por monstro" com um cooldown de sessão (`monster.cooldowns`, chave `target-think`,
  `packages/sim/src/monster/monster.ts`): os três eventos continuam chamando a função a cada
  vencimento deles, mas só o primeiro dentro de cada janela de 1000 ms de fato entra no ramo —
  os demais devolvem o alvo retido, como o Canary faria entre um `onThink_async` e o próximo.
  Coberto por `packages/sim/src/monster/monster.test.ts` (descreve "gate de cadência"), com um
  `Rng` que estoura se consultado provando que as reentradas dentro da janela não sorteiam nada.
- **Fuga (`monster.runOnHealth`)**: `HP <= runOnHealth` é fugindo (`isMonsterFleeing`,
  `packages/sim/src/monster/monster.ts`) — pura, recalculada a cada decisão a partir do HP atual,
  nunca um booleano guardado à parte. Fugindo, `decideMonsterAction` SEMPRE devolve um passo para
  LONGE do alvo (`fleeStep`, o passo guloso com a ameaça espelhada — FUN-85), nunca aproxima;
  encurralado, a decisão de perseguição devolve `idle` (ADR 0009) e é o passo aleatório do #655
  que roda em seguida (`decideUnengagedMove` — ver "Volta ao spawn, passo aleatório e monstro
  ocioso"), como o `doRandomStep` do Canary para quem não tem `hasFollowPath`. As abilities CORPO A CORPO (`isMeleeAbility`: sem área,
  alcance 1) nem são armadas nem executam enquanto foge; as de alcance continuam saindo — passo
  e ataque são decisões independentes, como no TFS (`getNextStep` × `doAttacking`).
- **`staticAttack` (dança de alvo, #543, TFS `staticattack`/`randomStepping`,
  `Monster::getDanceStep`)**: fração de vencimentos em que o monstro FICA PARADO colado no alvo;
  `1 − staticAttack` é a fração de dança. Um evento `MONSTER_DANCE` próprio (1000 ms, decisão de
  produto do Draconya — o Canary não tem um "think" de movimento separado do passo) só existe
  agendado ENQUANTO o monstro está colado, sem passo a dar (`decideMonsterAction` devolvendo
  `'attack'`) — armado e desarmado por `#onMonsterStep`, nunca uma varredura periódica fora do
  engajamento (invariante 2). Cada vencimento rola UMA `rng.chance(1 − staticAttack)`; a dança
  escolhida move o monstro por `danceStep` (`monster/step.ts`) para um dos até quatro vizinhos
  CARDINAIS que preservam a MESMA distância Chebyshev ao alvo — nunca aproxima, nunca afasta, e
  nunca perde a capacidade de atacar (a distância preservada garante isso sozinha). A dança
  durante a fuga (`isMonsterFleeing`) fica fora do escopo: `decideMonsterAction` nunca devolve
  `'attack'` fugindo, então o ramo nunca é armado nesse estado.
- **`scheduledDefenses` viaja no snapshot** (opcional, sem bump de formato), como
  `scheduledAbilities`: sem ele, a hunt retomada reagendaria a defesa que já tinha evento na
  fila e curaria em dobro no primeiro vencimento.
- Rato e rotworm não declaram nenhum destes campos — o comportamento entregue não muda.

## Linha de visão (isSightClear, #553, M30-06)

O TFS/Canary recusam dano — tiro, magia mirada, habilidade de monstro, tile de área — quando não
há linha de visão livre entre a origem e o destino (`Map::isSightClear`/`checkSightLine`,
`src/map/map.cpp`): uma varredura tile a tile entre os dois extremos, reprovando se algum tile NO
MEIO (nunca os extremos) tem a propriedade `CONST_PROP_BLOCKPROJECTILE` — a flag `unsight` do
pacote de aparências 13.x. Antes desta issue, todo portão de combate do Draconya olhava só
distância; um paladin atrás de uma quina acertava um monstro do outro lado da parede.

**A camada de dado é nova, e é OPCIONAL** (`packages/content`): `floorSchema` ganha `sight` —
uma grade `#`/livre, exatamente como `grid`, mas em camada SEPARADA, porque bloquear passo
(`unpass`) e bloquear visão (`unsight`) são flags independentes do pacote — uma peça de
decoração pode ter uma sem a outra. `Floor.blocksSight` é `Uint8Array | null`; `null` (nenhum
mapa reimportado ainda tem a camada) significa "nada bloqueia visão neste andar", o mesmo
"sem dado, sem restrição" que `speed` ausente já usa para velocidade de chão — **todo mapa de
hoje continua com LOS sempre livre até ser reimportado** (`pnpm map:import`, que agora deriva
`sight` da flag `unsight`, espelhando como `grid` já deriva de `unpass`).

**O algoritmo é novo, e mora em `sim`** (`packages/sim/src/line-of-sight.ts`,
`isSightClear(map, from, to)`), não em `content` ao lado de `isBlocked`: a própria issue #553
enquadra LOS como mecanismo de COMBATE, e os dados (`blocksSight`) continuam em `content`, só a
varredura muda de pacote. Um midpoint-line (Bresenham) comum — não a variante de Wu com
acumulador de erro do TFS (ADR 0019: nunca copiar código GPL) — decide o MESMO resultado
qualitativo: tile bloqueado ENTRE os extremos derruba a visão; os extremos nunca bloqueiam a
própria linha; andar diferente é SEMPRE bloqueado (nenhuma chamada de combate do Canary permite
LOS entre andares — todas usam `floorCheck: true`; a única exceção, arremesso livre de item, o
Draconya não tem).

**Cinco portões consultam `isSightClear`, e a escolha de alvo continua ignorando visão em
todos** (a automação mira o mesmo alvo atrás da parede e espera abrir linha, em vez de trocar
para um pior; ver `packages/sim/src/rulesets/hunt.ts`):

1. **Tiro** (`#strike`, arma `distance`): sem visão, o tiro não sai — nem munição gasta, nem
   gold debitado, nem `shot` emitido — exatamente como "sem munição" já recusava.
2. **Magia mirada e magia em área** (`#aimFor`): o alvo principal só é capturado com visão
   livre do lançador; cada alvo SECUNDÁRIO da forma (onda, círculo em volta do alvo) também
   precisa da PRÓPRIA visão — alguém atrás de uma parede não é atingido só porque outro, mais à
   frente, está.
3. **Habilidade de monstro** (`#onMonsterAttack`/`#onMonsterAbility`/`#armMonsterAbilities`):
   entra na MESMA condição composta que já olhava `distance(...) > ability.target.range` —
   sem visão, a ability fica engatilhada, como "fora de alcance".
4. **Tile de área de ability de monstro** (`#executeMonsterAbility`): os alvos que
   `abilityTargets` colhe da forma são filtrados por `isSightClear` a partir do monstro, a
   mesma regra do item 2 do lado do jogador.
5. **Recuo de `targetDistance`** (`decideMonsterAction`, ver "Manter distância" abaixo): fecha
   a divergência que aquela seção registrava — o monstro só recua com visão livre, como o
   Canary.

**Bônus, fora da lista de cinco da issue**: a postura `keep-distance` do PERSONAGEM
(`#holdPosture`) também só recua (`fleeStep`) com visão livre até o alvo — o mesmo princípio do
item 5, aplicado ao lado do jogador, que já tinha a mecânica de recuo por distância configurada
e sofria do mesmo problema.

**Custo**: a checagem de visão é sempre a ÚLTIMA da cadeia, nos seis pontos acima — nunca antes
da conferência de andar/distância/alcance —, para não pagar Bresenham por par já descartado por
outro motivo. Sem a camada `sight` (todo mapa hoje), o custo é um `if` e retorno imediato.

**Fora do escopo**: reimportar os mapas reais (`thais`, `rat-cellars`, `rotworm-caves`,
`darashia-dragon-lair`) com a camada `sight` — feito quando alguém rodar `pnpm map:import` numa
máquina com `THINGS_DIR` apontando para o pacote 13.x; arremesso livre de item entre andares
(mecânica que o Draconya não tem); e uma IA de monstro "persegue e recua sozinho" além do que
`targetDistance` já cobre.

## Trava de ataque ao trocar de andar (stairhop, #554, M30-07, ADR 0040 decisão 1)

O TFS/Canary aplicam `CONDITION_PACIFIED` por `STAIRHOP_DELAY` (`stairJumpExhaustion`,
`config.lua.dist:45`, `2 * 1000`) toda vez que a posição de um JOGADOR muda de andar ou é
redirecionada por teleporte (`Player::internalCreatureChangeOutfit`/`onChangeZone`,
`player.cpp:2857-2866` e `player.cpp:12417-12423`: `if (teleport || oldPos.z != newPos.z)`).
Enquanto a condição vale, `Player::doAttacking` recusa o golpe corpo a corpo/distância inteiro
(`player.cpp:3982`), e toda magia AGRESSIVA recusa com `RETURNVALUE_YOUAREEXHAUSTED`
(`Spell::playerSpellCheck`, `spells.cpp:517`: `if (aggressive && player->hasCondition
(CONDITION_PACIFIED))`) — `Spell::aggressive` é `true` por padrão, e só as magias que não
precisam de alvo hostil (cura, condição própria) o desligam. Vale **só para jogador**: o monstro
não conhece a condição.

**Desde o #622 (M44-04) a trava É a condição `pacified`** — a mesma de qualquer outra fonte (o
Swift Foot, abaixo), lida por `Conditions.isActive('pacified', nowMs)`. Antes ela era um instante
solto no personagem (`CharacterRuntime.attackLockedUntil`); esse campo deixou de existir no
runtime, e um snapshot antigo que o traga é lido pelo construtor como um `pacified` que vence no
mesmo instante (ADR 0014, sem bump de `SNAPSHOT_FORMAT_VERSION`). `HuntRuleset#step`, o ÚNICO lugar
que escreve posição de criatura (FUN-69), aplica a condição por `#applyConditionTo`: pisar numa
escada ou num teleporte (#734) redireciona o passo para um tile que não é o adjacente pedido — `z`
diferente, ou a distância pedida — e é ESSE sinal (não um booleano "é escada?" separado) que dispara
`pacified` por `stairhopDelayMs`. Um passo comum, adjacente e no mesmo andar, nunca aplica nada. A
fusão é a de `Condition::updateCondition` (`merge: 'longest'`, ver "Condições de controle"): um
`pacified` de 10 s que já corre não é encurtado por uma troca de andar de 2 s.

**`combat.stairhopDelayMs` é conteúdo, opcional, e só o `combat-v3` aplica a trava de escada**
(`HuntRuleset#isV3`, `packages/content/src/schemas.ts`) — a mesma disciplina aditiva do ADR
0031/0040: ausente é IDENTIDADE, e todo conteúdo `combat-v1`/`v2`, ou um `combat-v3` que não declare
o campo, segue bit a bit sem trava de escada nenhuma. A baseline real declara `2000` (o
`stairJumpExhaustion` do Canary). O que o portão lê, porém, é a CONDIÇÃO, em qualquer perfil: um
`pacified` que o conteúdo aplica por outro caminho vale numa sessão v1/v2.

**Dois portões conferem a condição, e os dois carregam o prazo exato de volta — como o
cooldown:**

1. **O golpe básico** (`#onPlayerAttack`): com `pacified` vigente, o golpe NÃO sai — e o Canary
   também não o re-arma quando a condição acaba: `Player::doAttacking` volta ANTES de criar a tarefa
   do golpe seguinte (`player.cpp:3982`), a cadeia de golpes morre ali, e o golpe só volta no primeiro
   GATILHO depois do prazo (`Player::onEndCondition` não faz nada). Os gatilhos do Canary são o
   pensamento do personagem — `Game::checkCreatures` chama `onAttacking` uma vez por 1000 ms, numa
   fase própria (`game.cpp:7726`) — e o passo do próprio personagem ou do alvo dele
   (`Creature::onCreatureMove` com `hasExtraSwing`, `creature.cpp:569`); o `sim` reproduz os dois. O
   golpe fica ESTACIONADO (`Runner.attackParked`: engatilhado, nenhum `PLAYER_ATTACK` na fila): o
   `ATTACK_THINK` é agendado UMA vez, no primeiro instante da grade de pensamento do personagem
   (`Runner.thinkPhaseMs`, sorteada uma vez com o `Rng` da sessão e persistida no snapshot) a partir
   do vencimento — o golpe sai ATÉ 1000 ms DEPOIS do prazo, não no instante exato dele —, e um passo
   aceito do personagem ou do alvo (`HuntRuleset#step` → `#releaseParkedAttacks`) depois do
   vencimento o antecipa. Os gatilhos genéricos do motor (o combate-stop do `PLAYER_STEP`, o passo
   de qualquer monstro) NÃO o soltam enquanto estacionado: um personagem parado não reacende a
   cadeia. O portão lê o PRAZO (`Conditions.isActive`, vencimento exclusivo), e não o evento
   `condition-expire` — que vence depois do ataque do mesmo instante (`Housekeeping`).
2. **A magia e a runa AGRESSIVAS** (`castSpell`/`useSupply`, `packages/sim/src/casting.ts`):
   `effect.kind === 'damage'`, `'damage-over-time'` ou `'summon'` (magia) e as runas de dano, de
   campo, a Paralyze Rune e as duas runas de invocação (Convince Creature e Animate Dead, #600 —
   `convince_creature.lua` e `animate_dead_rune.lua` também não chamam `isAggressive(false)`, apesar
   do grupo `support`) recusam com a razão tipada `attack-locked` e `retryInMs` — ANTES da
   conferência de alvo/alcance, na mesma posição relativa do `playerSpellCheck` do Canary. A
   invocação é agressiva porque `Spell::aggressive` é `true` por padrão e o
   `data/scripts/spells/support/summon_creature.lua` NÃO chama `isAggressive(false)` — ao contrário
   de toda cura, condição própria e conjuração (`grep -L 'isAggressive(false)'` nos scripts de
   `data/scripts/spells/` lista só as magias de ataque, `summon_creature`, `sap_strength`,
   `expose_weakness`, `blank_rune`, `lightest_magic_missile_rune` e as que curam monstro — e das do
   catálogo do Draconya só a invocação não é de ataque). Cura, cura
   contínua, haste, postura, magic shield, Challenge, Cancel Invisibility, a conjuração, a runa de
   cura, o antídoto e o Destroy Field **não conferem a condição**: são o que os scripts do Canary
   marcam `isAggressive(false)`.

`attack-locked` entra em `SlotRefusal` (`packages/sim/src/rulesets/hunt.ts`, disparo manual de
slot) e em `host.ts` (`'Você está exausto.'`, a mesma frase do `RETURNVALUE_YOUAREEXHAUSTED`).

**A trava atravessa a troca de sessão como PRAZO, não como instante (#812, #622).** O
`CharacterRuntime` é o MESMO objeto na transição enquanto o relógio lógico da sessão nova nasce em
zero, e um instante gravado no relógio da anterior (59 700 ms) lido cru seguraria o golpe e a magia
agressiva da hunt seguinte por quase um minuto, sem escada nenhuma. Quando a trava era
`attackLockedUntil` ela era um CARIMBO e `Session.enter` o zerava; agora que é a condição `pacified`
ela é PRAZO como toda condição: `Session.enter` a traduz para o relógio novo
(`CharacterRuntime.moveToClock` → `Conditions.rebase`), o que faltava continua faltando, e a hunt que
entra reagenda o vencimento (`#armConditions`) — como o Canary, em que a condição é persistente. Com
os 2 s reais da baseline isso é, no máximo, o resto de uma janela de 2 s; nunca o instante cru. O
restore de snapshot não traduz nada (o relógio é o mesmo) e lê um `attackLockedUntil` antigo como
`pacified` no instante em que ele estava.

**Fora do escopo**: o `skull`/PvP do Canary que também gate a magia agressiva (o Draconya não tem
PvP nem sistema de skull ainda); qualquer travamento fora de hunt/quest/boss/guild war — a Cidade
não simula combate.

## Manter distância: o atirador recua quando o alvo chega perto (#542, `targetDistance`)

O M29-02 dá ao monstro um segundo número de alcance, distinto de `attackRange`: `monster.
targetDistance`, a distância que ele PREFERE manter do alvo (TFS/Canary `targetDistance`,
`Monster::getDistanceStep`, `monster.cpp:2632`). Com `targetDistance > 1`, um monstro que persegue
alguém que chegou mais perto do que isso dá um passo para AUMENTAR a distância, em vez de colar
como um corpo a corpo — o comportamento de 175 dos 1.601 monstros do `data-otservbr-global/
monster` real (Necromancer, Priestess, Monk Familiar), verificado contra o código em 2026-09-26.

- **Independente da fuga por vida baixa (`runOnHealth`)**: as duas são decisões de movimento
  separadas em `decideMonsterAction` — a fuga dispara SEMPRE que o HP cai no limiar, o recuo de
  `targetDistance` só quando o monstro NÃO está fugindo. O Dragon e o Dragon Lord continuam com
  `targetDistance` declarado IGUAL ao default `1` (`dragon.lua`/`dragon_lord.lua` declaram o
  campo, só que com o mesmo valor que o schema já assume quando ausente) — corpo a corpo de
  sempre, sem o novo ramo.
- **`attackRange` continua sendo até onde o monstro ALCANÇA para bater**; `targetDistance` é a
  distância que ele PREFERE manter enquanto persegue. Ao contrário do que a versão anterior desta
  seção afirmava, os dois RARAMENTE coincidem no bestiário real: um atirador tipicamente declara
  `targetDistance` bem menor que o alcance da ability mais longa — Necromancer `targetDistance` 4
  com abilities de alcance 1/1/7; Priestess `targetDistance` 4 com abilities de alcance 7×3; Monk
  Familiar `targetDistance` 2 com abilities de alcance 5 — e não o oposto (schema não os acopla;
  são campos independentes, como já eram `attackRange` e `aggroRadius`).
- **A APROXIMAÇÃO também para em `targetDistance`, não no maior alcance de ability** (revisão do
  #649): a primeira versão desta issue só implementava a METADE do recuo de
  `Monster::getPathSearchParams` (`monster.cpp:3830`, `fpp.maxTargetDist = targetDistance`) — um
  atirador com ability de alcance maior que o `targetDistance` preferido (a norma real, ver item
  acima) parava e atirava assim que entrava no alcance da ability, sem nunca fechar até o
  stand-off documentado. Com `targetDistance > 1`, `decideMonsterAction` agora usa `targetDistance`
  como alcance de parada da aproximação em vez de `monsterAttackRange`; sem o campo (ou com `1`),
  o alcance de parada continua sendo o maior alcance de ability, como sempre (CMB-06, rato e
  rotworm). As abilities continuam armando pela PRÓPRIA faixa (`#armMonsterAbilities`,
  independente de `decideMonsterAction`) — um atirador de alcance 7 e `targetDistance` 4 já pode
  disparar a partir de 7 tiles enquanto ainda está se aproximando, exatamente como o Canary real
  (passo e ataque são decisões separadas, ver abaixo).
- **O passo é o `fleeStep` que a fuga já usava** (o guloso com o alvo espelhado, FUN-85) — a
  MESMA função, reaproveitada como "o mecanismo que aumenta distância" em vez de reescrever a
  árvore de direções do `getDistanceStep` real do Canary linha a linha (GPL v2, ADR 0019). Sem
  passo livre (parede atrás), o monstro ataca parado em vez de ficar preso tentando um recuo
  impossível — a MESMA regra de "encurralado, fica" que a fuga já tinha (ADR 0009).
- **Precisa do MESMO andar** (`sameFloor`, #519): um alvo em outro piso nunca é "perto demais" —
  a Darashia Dragon Lair tem três andares na mesma caixa `(x, y)`, e sem esta checagem um monstro
  de `targetDistance > 1` recuaria de um alvo que nem está no andar dele.
- **`retreat` é um resultado NOVO de `decideMonsterAction`** (`MonsterAction`), distinto de
  `step`: o TILE que ele pisa é executado do MESMO jeito (`#onMonsterStep` trata os dois igual ao
  decidir SE anda), mas o nome deixa explícito, para quem lê a decisão ou uma telemetria futura,
  que o monstro se afastou por escolha — não é preciso comparar posições para saber.
- **O cadence de ATAQUE não é consumido pelo recuo**: `decideMonsterAction` só decide o que o
  `MONSTER_STEP` faz — se o monstro anda ou fica parado —, e é uma decisão TOTALMENTE separada do
  vencimento de ataque (`MONSTER_ATTACK`/`MONSTER_ABILITY`, com a própria cadência). Um atirador
  pode recuar E atirar no MESMO instante, como o Dragon já foge E lança bola de fogo ao mesmo
  tempo (`isMeleeAbility` só bloqueia o corpo a corpo durante a fuga) — passo e ataque continuam
  sendo decisões independentes, a mesma separação do TFS entre `getNextStep` e `doAttacking`.

`targetDistance: int ≥ 1`, default `1` (`monsterSchema`), preserva rato, rotworm, Dragon e Dragon
Lord bit a bit — rato e rotworm não declaram o campo (caem no default), Dragon e Dragon Lord
declaram (`dragon.lua`/`dragon_lord.lua:69`), mas com o MESMO valor `1` que o default já assume —
e `1` nunca aciona nem o ramo de recuo (a condição é `distance < targetDistance`, sempre falsa
quando `targetDistance` é `1` e a distância Chebyshev nunca é negativa) nem muda onde a
aproximação para (o alcance de parada continua sendo o maior alcance de ability, CMB-06).

**Linha de visão exigida no recuo (#553, M30-06 — fechada a divergência que esta seção
registrava)**: o Canary só entra no ramo de recuo com `isSightClear(creaturePos, targetPos,
true)` verdadeiro — sem visão livre, ele cai no caminho normal (aproxima) mesmo com o alvo mais
perto que `targetDistance`. `decideMonsterAction` (`packages/sim/src/monster/monster.ts`) recebe
agora um quinto parâmetro opcional, `sightClear: (from, to) => boolean` — ausente é sempre
`true`, o comportamento de antes do #553, o que preserva as dezenas de chamadas de
`monster.test.ts` que não têm mapa para consultar. `hunt.ts#onMonsterStep` é o único chamador em
produção, e passa `(from, to) => isSightClear(this.#world.map, from, to)` —
`packages/sim/src/line-of-sight.ts`, a linha de visão pura que este mesmo issue introduz (ver
"Linha de visão" mais abaixo). Sem visão, o monstro cai para a checagem de alcance seguinte
(aproxima ou ataca parado), exatamente como o Canary.

## Volta ao spawn, passo aleatório e monstro ocioso (#655, TFS/Canary `Monster::getNextStep`)

Até o #655 o monstro do Draconya só tinha UMA decisão de movimento — perseguir o alvo — e um
"espera" quando não havia passo. O Canary tem três, em `Monster::getNextStep`
(`src/creatures/monsters/monster.cpp:2443-2492`), e a ordem entre elas é a regra:

1. **perseguir** (`getFollowCreature() && hasFollowPath`) — o que o motor já fazia;
2. **voltar ao spawn** (`isWalkingBack`, `doWalkBack`, `monster.cpp:2501-2526`);
3. **passo aleatório** (`doRandomStep`, `monster.cpp:2494-2499`).

Antes delas vem `updateIdleStatus` (`monster.cpp:1521-1560`), que decide se o monstro está OCIOSO
(`isIdle`) — e um monstro ocioso não anda (`getNextStep` devolve `false` no topo).

**Onde mora.** `decideMonsterAction` continua decidindo só a perseguição (e devolvendo `idle`
quando não há alvo, ou há alvo e nenhum passo até ele — o "preso" do #545). Quando devolve `idle`,
`HuntRuleset#onMonsterStep` chama `decideUnengagedMove` (`packages/sim/src/monster/monster.ts`),
que faz o `updateIdleStatus` e escolhe entre os dois ramos que sobram. É evento na fila como todo o
resto (o `MONSTER_STEP` que já reagendava): nada é por tick (invariante 2), e o resultado é o mesmo
a 1 Hz e a 20 Hz — os testes de `hunt.test.ts` ("volta ao spawn, ocioso e passo aleatório")
comparam o snapshot inteiro das duas taxas e o de uma retomada no meio.

### A lista de alvos e o ocioso

A `targetList` do Canary (`Monster::updateTargetList`/`onCreatureFound`) é quem o monstro
ENXERGA: `Creature::canSee` (`creature.cpp:68-87`), o quadrado de `MAP_MAX_VIEW_PORT_X`/`_Y` = 11
tiles. É exatamente o `aggroRadius` do monstro (11 em todo o catálogo, ver "Raio de agressão"
acima), então a "lista vazia" daqui é: nenhum participante vivo (nem invocação de personagem
viva) em `canSeePoint(monster.position, prey.position, aggroRadius)` (`monster/step.ts`).
**No mesmo andar** é a distância de Chebyshev; **entre andares** valem as regras do Canary — de
superfície (z ≤ 7) não se enxerga o subsolo, do subsolo só até dois andares, e a caixa desliza
`from.z − to.z` tiles por andar. Quem está à vista SEM ser alvo (invisível, outro andar) mantém a
lista cheia, e o monstro anda ao acaso.

O monstro fica **ocioso** com a lista vazia, no `home` (`isInSpawnLocation`) e **sem nenhuma
condição** (`conditions.empty()`): não anda, e — `Creature::onIdleStatus` — esquece quem bateu nele
(`Contribution.clear()`). Uma condição ativa (fogo, veneno, haste, lentidão) impede o ocioso: o
monstro queimando no spawn, sem ninguém à vista, anda ao acaso. **A provocação (Challenge) NÃO conta
como condição**: no Canary ela é o contador `challengeFocusDuration` (`monster.cpp:2146-2152`,
`3470-3483`), que nunca entra em `conditions` — aqui ela mora em `MonsterRuntime.conditions` só por
conveniência de armazenamento (prazo e snapshot), e `hasActiveCondition` a descarta. Um monstro
provocado que perde o alvo volta ao spawn e sossega, sem esperar o prazo da provocação.

**O ocioso não usa defesa, não troca de alvo e não invoca.** O Canary tira o monstro ocioso da lista
de `onThink` (`setIdle(true)` → `removeCreatureCheck`), e é o `onThink` que roda `onThinkDefense`
(defesa de cura, self-haste e o laço de invocação) e `onThinkTarget` (troca de alvo por tempo). Aqui
`MonsterRuntime.idle` (escrito por `HuntRuleset#onMonsterStep` a cada decisão: liga no `idle`,
desliga em qualquer outra) cala os três timers — `MONSTER_DEFENSE`, `MONSTER_TARGET_CHANGE` e
`MONSTER_SUMMON` continuam REAGENDANDO (a fila segue dirigida por evento, invariante 2), mas vencem
sem rolar nada, e a semente da sessão não é tocada. Sem esse corte, um Doom Deer ocioso no spawn se
daria haste sozinho (`doom_deer.lua`: defesa de velocidade, 30 % a cada 3 s, 8 s), a condição
impediria o ocioso e ele passearia pelo spawn para sempre. O reverso vale igual: um monstro ferido
que voltou e ficou ocioso NÃO se cura pela defesa enquanto ninguém o acorda. Invocação (`masterId`) nunca fica
ociosa nem volta ao spawn (`spawnMonster.expired()` no Canary devolve "no spawn"); sem alvo, a de
PERSONAGEM segue o mestre (#599, `updateSummonTarget` — ver "O familiar de vocação"; sem mestre à vista
ou sem caminho até ele ela vagueia pelo `doRandomStep`), e a invocação de outro MONSTRO (#546) continua
parada — o que este motor não modela para ela.

A retenção do alvo (`chooseTarget`) passou a exigir a mesma área de visão: o alvo que sai do
`aggroRadius` é largado (`Creature::onCreatureMove` → `onCreatureDisappear`), mesmo com o
`leashRadius` zero — sem isso, o monstro perseguiria para sempre e a lista nunca esvaziaria. O
`leashRadius` continua valendo por cima (medido do `home`, e agora também filtra a aquisição, para
"desistir" não ser desfeito no mesmo vencimento).

### Volta ao spawn

Lista vazia, sem condição (a provocação não conta) e fora do `home`: liga
`MonsterRuntime.walkingBack` e o monstro anda UM tile por vencimento rumo ao `home`, sem sortear
nada. O caminho é o **passo guloso** de sempre (`walkBackStep`, `monster/step.ts`) enquanto ele
andar; o Canary usa A* aqui (`getPathTo(masterPos, …)`), e é por isso que o guloso NÃO basta:
empacar numa concavidade é o comportamento certo de quem PERSEGUE, mas quem volta para casa preso
numa bolsa sem saída nunca chega, nunca fica ocioso e mantém o slot de spawn ocupado. Quando o guloso
empaca fora do `home`, `MonsterRuntime.walkBackByPath` liga e cada passo até a chegada vem da busca
de caminho limitada (`walkBackPathStep`, o BFS de `route/pathfind.ts`, ordem de vizinho fixa; ADR
0009, emenda de 2026-09-29): o primeiro tile do caminho mais curto até o `home`, dentro de 50 tiles
(`deSpawnRadius`), com o `home` ocupado recusado antes de varrer. O flag PERSISTE até a chegada — do
tile de fora da bolsa o guloso a entraria de novo, e a volta seria um vaivém eterno. O predicado da
busca (`HuntRuleset#walkBackPathBlocked`) é o de "tile qualquer": o do guloso só admite vizinhos.
Sem caminho nenhum (`home` ocupado, região isolada) a volta desliga sem andar, como o Canary faz, e o
vencimento seguinte a religa. Duas coisas do Canary valem:

- **A flag persiste** (`isWalkingBack` só é desligada por `doWalkBack`, ao chegar ou sem
  caminho): um alvo que aparece no meio da volta não a desliga, e o monstro que tem alvo mas não
  alcança volta ao spawn — em vez de andar ao acaso — enquanto ela estiver ligada.
- **A um tile do `home` só se pisa NELE** (`walkBackStep`): o guloso puro rodearia um `home` ocupado
  para sempre; o Canary nem chega a andar sem caminho até o tile exato.

### Passo aleatório

Com a volta desligada e sem passo de perseguição (sem alvo mas não ocioso; ou com alvo e nenhum
passo até ele; ou fugindo encurralado): se o último passo do monstro foi há pelo menos 1000 ms
(`RANDOM_STEP_INTERVAL_MS`, contado de `MonsterRuntime.lastMoveAtMs`, escrito por `#step` em
QUALQUER deslocamento do próprio monstro — passo, volta, dança, empurrão), liga
`randomStepping` e sorteia as quatro direções cardinais embaralhadas (`shuffledCardinals`, três
`rng.integer` por tentativa — o mesmo Fisher-Yates do empurrão de criatura, M29-08); vale a
primeira com tile livre para `Monster::canWalkTo` (`randomBlocked`, `hunt.ts#randomStepBlocked`):
sem criatura no tile MESMO que empurrável, sem escada nem teleporte, com o campo pelo mesmo
`canMonsterEnterField` da perseguição (`FLAG_IGNOREFIELDDAMAGE` do Canary), dentro de 50 tiles do
`home` (`deSpawnRadius`). `randomStepping` só desliga quando a perseguição roda de novo
(`doFollowCreature`) — persiste pela volta e pelo ocioso, como no Canary.

`randomStepping` é a segunda metade da condição que arma `ignoresFieldDamage` ao tomar dano
(`Monster::drainHealth`, `monster.cpp:3450`: `randomStepping || (!hasFollowPath &&
getFollowCreature())`): `MonsterRuntime.noteDamageTaken` é o ponto único dos cinco caminhos que
aplicam dano a um monstro. O passo aleatório e o ocioso NÃO gastam o bypass; só a perseguição e a
volta o zeram.

### O que NÃO foi modelado

- **A\* na volta** — o guloso e, quando ele empaca, o BFS limitado (ADR 0009). A divergência é de
  CAMINHO, não de gatilho: quando a volta liga e desliga é a do Canary, e o monstro sempre chega
  em casa quando há caminho.
- **Os segmentos de 5 tiles de `doWalkBack`** (`getPathTo(…, distance - 5, …)`) e a pausa de um
  vencimento entre segmentos — detalhe do A*.
- **O que o Canary faz DEPOIS de uma volta sem caminho**: `isWalkingBack` desliga e o monstro dá
  passos aleatórios até o próximo `onThink` (1 s) religá-la; aqui a volta é religada no vencimento
  seguinte e o monstro espera. Só vale para o `home` ocupado ou a região isolada — com caminho, a
  busca o acha.
- **O teleporte de volta de `Monster::onThink`** para quem passa de `deSpawnRadius`.
- **Seguir o mestre** (`Monster::updateSummonTarget`) — só a invocação de PERSONAGEM o faz (#599); a
  invocação de outro monstro (#546) sem alvo continua parada.

### Efeito nas hunts

Rato e rotworm mudam de comportamento **de propósito**: o monstro que perdeu o alvo (o herói se
afastou mais que `aggroRadius`) volta ao spawn e fica ocioso, em vez de ficar parado onde estava; o
que ficou preso atrás de obstáculo ou campo anda ao acaso. Medido na Darashia Dragon Lair com a
party de quatro do #526 (kit e bot reais, combate de verdade) e HP imortal para não saturar,
16 sementes × 10 min: abates 1.536 → 1.560 (+1,6 %), dano recebido pela party 184.108 → 185.405
(+0,7 %); os deslocamentos de monstro sobem de 2.104 para 12.623 (as voltas e os passos
aleatórios). Com o HP real do nível 200 a party morre nos DOIS lados dentro dos 10 minutos (15/16
sementes na versão anterior, 16/16 aqui; 46 × 48 mortes, 211 × 214 abates) — o cenário sintético
é mais letal que a QA ao vivo, e o número serve só de comparação entre as duas versões: não há
regressão de mortes, e o teste de 30 sementes da Darashia (`darashia-dragon-lair-party-movement`)
segue verde.

## Invocação de monstro por monstro (#546, TFS/Canary `monster.summon`/`maxSummons`)

Um monstro que declara `monster.summon` cria monstros próprios durante o combate, até o teto,
seguindo a referência §15-19 e o mecanismo TFS/Canary `Monster::onThinkDefense` — o MESMO laço
que avalia `defenses` (#518), mais um bloco (código GPL v2 lido, nunca copiado — ADR 0019).

```ts
interface MonsterSummonEntry {
  readonly monsterId: string;
  readonly intervalMs: number;
  readonly chance: number;   // fração 0–1, como monsterDefenseSchema.chance
  readonly count: number;    // teto de invocações VIVAS deste NOME
}
interface MonsterSummons {
  readonly max: number;      // teto de invocações VIVAS, no TOTAL, entre todos os nomes
  readonly entries: readonly MonsterSummonEntry[];
}
```

- **Uma entrada por NOME**, cada uma com a própria cadência e a própria chance — um evento NA
  FILA por entrada (o desenho das defesas), subject derivado `m:<id>:<monsterId>`. A CADÊNCIA
  reagenda SEMPRE, como a defesa — mas a rolagem em si só acontece com o mestre ENGAJADO
  (`targetId !== null`): é o equivalente do Draconya para `hasFollowPath`, que embrulha o laço
  `summons` inteiro na fonte (`!isSummon() && summons.size() < maxSummons && hasFollowPath`,
  TFS `monster.cpp:991`, idêntico no Canary `monster.cpp:2224`) — um monstro que nunca viu
  ninguém não invoca nada, mesmo tendo `monster.summon` declarado. `chance` é sempre declarada
  (conteúdo novo, sem concessão de compatibilidade) e consome UMA rolagem por vencimento, mesmo
  em 1, SÓ quando engajado — sem alvo, nem a rolagem acontece, e a sequência de RNG não muda.
- **Dois tetos independentes.** `summons.max` é o do MONSTRO inteiro (TFS `m_summons.size() <
  maxSummons`); `entries[].count` é o DESTA entrada, por nome (`summonCount >=
  summonBlock.max`/`summonsCount >= summonCount`). Os dois seguram ao mesmo tempo: uma entrada
  pode ter folga própria (`count` alto) e ainda assim parar porque o monstro já está no teto
  geral, contando toda invocação viva de QUALQUER nome.
- **Nasce perto do mestre, só nos 8 vizinhos imediatos** (TFS/Canary `Map::placeCreature(...,
  extendedPos: false)`, chamado com `false` pelo `Game::placeCreature` de `monster.summon`): a
  posição exata dele já está ocupada por ELE — tile é exclusivo (invariante 8) —, então a busca
  tenta os vizinhos, como `Spawner.#freeTile` (`tilesAround`, raio 1 — o `normalRelList` de 8
  posições da fonte, sem expansão nenhuma além dele). Sem tile livre, a tentativa se perde — a
  próxima cadência da entrada tenta de novo, como o respawn adiado do Spawner. O bloqueio é
  PRÓPRIO da invocação (`#summonBlockedFor`: só parede e ocupação) — nunca o
  `spawnClearRadius`/`blockable` de `#spawnBlockedFor`, que é a supressão do SPAWNER perto de um
  jogador vivo e que a fonte não aplica a `Map::placeCreature` nenhuma.
- **Não ocupa lugar do Spawner.** A invocação nasce por um caminho direto (`#spawnMonster`, o
  mesmo que o Spawner usa por baixo, sem o registro de lugar) — o `monsterCount`/`composition` da
  dificuldade continuam contando só quem o Spawner de fato administra.
- **Nunca paga XP, loot nem Bestiário** (TFS `setDropLoot(false)`/`setSkillLoss(false)`, Canary
  `Player::onKilledMonster` → `hasBeenSummoned()` devolve cedo, antes de tocar hunting task ou
  Bestiário). O abate ainda conta no "matei N" do extrato (#190) — a mesma condição de sempre —,
  mas o sorteio de destinatário do loot NUNCA roda para ela: rolar para quem nunca ganha nada
  moveria a sequência de RNG de toda a hunt (FUN-63) por um abate que o Tibia nem registra.
- **Some quando o mestre morre ou é removido** (TFS `Game::removeCreature`, que remove cada
  `creature->summons` do dono que some). É uma REMOÇÃO, não um abate: sem golpe, sem cadáver, sem
  entrada no "matei N" — libera o tile e cancela os eventos dela (ability, defesa e a própria
  lista de invocação — vazia nela mesma, que nunca arma), e emite `creature-vanished` como
  qualquer desaparecimento. `#onMonsterDied` faz a cascata: ao processar a morte do mestre,
  remove toda invocação viva com aquele `masterId`.
- **Uma invocação não invoca** (TFS `!isSummon()` em `onThinkDefense`): só quem nasce SEM mestre
  arma a própria lista de `summons`. Sem isto, uma invocação declarando `summons` encadearia
  mestre → invocação → invocação da invocação — o TFS não deixa, e nenhum monstro do recorte
  precisa disso.
- **`masterId`/`scheduledSummons` viajam no snapshot** (opcionais, sem bump de formato), como
  `scheduledDefenses`/`scheduledAbilities`. `masterId` ausente é "não é invocação" — o
  comportamento de sempre.
- Nenhum monstro do recorte atual (rat, rotworm, dragon, dragon-lord) declara `monster.summon` na
  fonte (conferido em 2026-09-25) — a mecânica existe e tem cobertura de teste com fixture, mas
  nenhum monstro real do catálogo a usa ainda.
- **Fora do escopo** (#546): invocação pelo JOGADOR (magia/item que convoca uma criatura própria
  — M38), scripts de boss e o `staticAttack` que já ficava de fora do #518.

## Invocação do PERSONAGEM (#598, M38-01, ADR 0057; TFS/Canary `summon_creature.lua`)

Estende o `masterId` do #546 (acima) a `characterId`: a mesma criatura da sessão, mesmo
mecanismo de nascimento/desaparecimento, dono diferente — e por isso esta seção presume a
anterior lida. `MonsterState.masterId` é `number | string`: numérico é invocação de MONSTRO
(#546), string é `characterId` — a distinção de TIPO decide qual dos dois comportamentos vale,
sem um campo `masterKind` à parte.

**Level 25, ambos Sorcerer e Druid** (`spell:vocation("druid;true", "sorcerer;true", ...)`,
conferido linha a linha contra `summon_creature.lua` em 2026-09-28) — duas entradas de catálogo,
`summon-creature-sorcerer`/`-druid` (o padrão de duplicação por vocação deste repositório),
`effect: { kind: 'summon' }` **sem** `monsterId` fixo: o parâmetro vem da barra
(`BotAction.kind === 'spell'` ganhou `monsterId?: string`, opcional, sem subir
`BOT_VOCABULARY_VERSION`) ou do preset do bot. `spell.manaCost` do catálogo é **0**, PLACEHOLDER:
o custo real sai do `manaCost` do MONSTRO invocado (`monsterSchema.summonable`/`manaCost`, 184
monstros no Canary o declaram — nenhum promovido ao catálogo real ainda) — `HuntRuleset#castSpell`
lê o monstro e passa o custo como `manaCostOverride` para `casting.ts#castSpell` (que continua
puro e genérico, sem conhecer monstro nenhum); a skill `magic` também pratica por ESTE valor, não
por `spell.manaCost`.

- **Teto de 2 invocações vivas por personagem**, contando qualquer nome (`player:getSummonCount()
  >= 2` do Canary) — `HuntRuleset#playerSummonCountOf`, antes de qualquer débito. Sem
  `monsterId`, monstro fora do catálogo, `summonable: false` ou teto atingido: recusa
  `not-summonable` (`CastRefusal`/`SlotRefusal` novos), sem debitar mana.
- **Nasce perto do mestre** — mesmo `#spawnSummon`/raio 1/ordem fixa de vizinhos do #546, agora
  por `HuntRuleset#spawnPlayerSummon`. **A mana e o cooldown já saíram quando a invocação nasce**
  (a mesma ordem do Canary: débito, depois `Game::createMonster`) — sem tile livre, a magia sai do
  mesmo jeito, e o jogador sente o custo mesmo sem a invocação nascer (`Game::createMonster`
  devolvendo `nullptr` não desfaz o `player:addMana(-manaCost)` que já rodou).
- **Segue o alvo do mestre, nunca escolhe sozinha** (`HuntRuleset#chooseMonsterTarget`): ao
  contrário da invocação de MONSTRO (#546, que roda `chooseTarget` normal), a de PERSONAGEM tem o
  `targetId` PROPAGADO do alvo atual do mestre (`attackTargetOf`, a mesma resolução que já limpa
  alvo morto/fora de alcance) a cada passo/ataque/ability — e troca junto quando o mestre troca.
  Sem mestre vivo ou mestre sem alvo, o `targetId` é `null` (sem sortear nada); não roda o
  timer de `targetChange` do próprio monstro (gated, mas continua reagendando — inofensivo, como
  o de `MONSTER_SUMMON` numa invocação que nunca arma a própria lista).
  - **Sem alvo, ela SEGUE O MESTRE** (#599; antes era uma divergência aceita do #598): `Monster::
    updateSummonTarget` manda `setFollowCreature(master)` quando o mestre não está atacando nada, e
    `HuntRuleset#onMonsterStep` reproduz isso com `summonFollowStep` (`monster/monster.ts`): só
    segue quem ENXERGA o mestre (mesmo andar, dentro da visão de 11 — a condição do
    `setFollowCreature`), anda por uma BUSCA de caminho de menor custo (`cheapestPath`, cardinal 10 e
    diagonal 35 como o A* do Canary, raio 12) até um tile a EXATAMENTE 2 do mestre COM linha de
    visão livre até ele (`getPathSearchParams`: `minTargetDist = 1`, `maxTargetDist = 2`,
    `clearSight`), e para lá. O objetivo é de DUAS camadas, como `FrozenPathingConditionCall`: só um
    tile a 2 encerra a busca — um a 1 é só o "melhor até agora", e a invocação encostada no mestre se
    afasta até a 2; sem nenhum tile a 2 alcançável (beco, mestre cercado) ela fica a 1. Vale para a
    Summon Creature comum e para o familiar, que são a mesma invocação de personagem. Não é o passo
    guloso: numa concavidade ele faria a invocação oscilar. A invocação de outro MONSTRO (#546) sem
    alvo continua parada. Parada ou não, a invocação nunca trava a rota do personagem: ele a atravessa
    (o bullet abaixo; o familiar pela troca do #599, a comum pela do #600).
  - **O que a invocação faz quando NÃO consegue seguir** (`Creature::goToFollowCreature`,
    `Monster::getNextStep`): **(a)** sem mestre à vista (outro andar ou além da visão de 11) o Canary
    não tem `followCreature` (`setFollowCreature` recusa), e **sem caminho** até um tile bom
    (`getPathTo` falso) `hasFollowPath` é falso — nos dois casos o `getNextStep` cai no
    `doRandomStep`, e a invocação VAGUEIA (um passo aleatório por segundo, no máximo, como todo
    monstro sem perseguição: `decideUnengagedMove`); **(b)** a Summon Creature COMUM não segue o
    mestre INVISÍVEL que ela não enxerga (`canFollowMaster`: `canSeeInvisibility() ||
    !master->isInvisible()`) e fica parada — o FAMILIAR segue sempre (`!isFamiliar()` faz parte da
    condição). A parte do tile de proteção (`TILESTATE_PROTECTIONZONE`) da mesma checagem não se
    aplica: a hunt não tem zona de proteção.
- **Monstros HOSTIS a atacam** (`isOpponent` do Canary): a lista de presas de um monstro
  hostil (`masterId === null`, ou invocado por OUTRO monstro) é estendida pelas invocações de
  personagem VIVAS (`HuntRuleset#playerSummonPrey`/`#livePlayerSummons`) — devolve a MESMA
  referência de `session.participants` quando não há nenhuma, então uma hunt sem ninguém
  invocando não aloca nada a mais e não sorteia nada a mais (garantia que os testes de RNG
  prendem). O golpe de um monstro contra uma invocação usa `#monsterDefender` (o "monstro como
  defensor" que já existia para o reflexo do #552) — nunca o caminho do jogador (sem mana shield,
  sem carga de colar/anel, sem shielding): `#applyMonsterHitOnSummon` é a metade nova de um par
  com `#applyMonsterHit`.
- **O contrário também: `#hostileMonsters()` protege contra fogo amigo.** Achado da implementação
  — sem isto, o auto-target (#444), a mira de área e o clique do próprio jogador (`chooseTarget`,
  opcode `select-target`) tratariam a invocação (a própria, ou a de um companheiro de party) como
  QUALQUER monstro comum, e o personagem mataria o que acabou de invocar no primeiro golpe
  engatilhado — foi reproduzido e corrigido durante os testes deste sistema. `#hostileMonsters()`
  é `#monsters` menos as invocações de personagem vivas (mesma referência quando não há
  nenhuma); `chooseTarget`/`#resolveManualTarget` recusam explicitamente `monster.masterId ===
  character.id` mesmo com o subject certo — defesa em profundidade contra o cliente pedindo por
  fora do auto-target. **A colheita das ÁREAS também pula a invocação de jogador** (#600): as duas
  formas de `#aimFor` (a centrada no lançador e a centrada no alvo) e o golpe de varredura
  (`#cleave`) varrem `#monsters` direto, e sem o corte a primeira Great Fireball ou Exori Mas perto
  do convencido (ou do Skeleton animado) o mataria — o jogador pagou a runa e perdia a invocação. É a
  regra do mundo no-pvp (ADR 0060; Canary `Combat::canTargetCreature`: `target->isSummon() &&
  targetMasterPlayer` recusa), e vale para a invocação de QUALQUER jogador, a do companheiro de party
  inclusive; a mira explícita de um efeito de dano numa invocação alheia também é `no-target` (a
  Convince Creature fica de fora: ela chega ao script, que recusa `not-possible`).
- **O jogador ATRAVESSA a invocação de jogador** (#600, `Player::canWalkthrough`, mundo no-pvp): o
  Canary deixa as duas criaturas dividirem o tile; este motor tem ocupação exclusiva (invariante 8),
  então o passo do personagem para o tile de uma invocação vira TROCA de lugar (`swapPlaces`, em
  `movement.ts`, chamada por `HuntRuleset#step` — o ponto único de todo passo: a rota do bot, o follow
  e o `walk` à mão). Os dois tiles continuam ocupados, então porta não fecha e placa de pressão não
  solta; o personagem leva o dano do campo do tile novo, e a invocação — que no Canary nem se mexeu —
  não leva o do tile velho. A invocação NÃO atravessa nada sozinha: monstro hostil continua bloqueado
  por ela. Sem isto, o Skeleton animado (ou o convencido) em cima do próximo tile da rota travava o
  passo do herói pelo resto da hunt — a invocação nunca morre pela mão do mestre e o bot não a
  ataca. **O planejador concorda com o passo** (#599): o Canary decide a travessia numa só função,
  `Tile::queryAdd` (`tile.cpp:788`), que o passo e a busca de caminho (`getPathfindingTile`,
  `map.cpp:138`, com `FLAG_PATHFINDING`) consultam. Aqui os predicados de quem planeja —
  `#moverBlocked` (o passo guloso do follow) e `#occupiedForPlayer` (o BFS do follow e do `walk-to`) —
  perguntam a mesma coisa que `#step`, por `#playerSummonAt`. Antes só o commit atravessava: o
  `walk-to` para depois da invocação num corredor de um tile era `unreachable`, e o seguidor empacava
  atrás da invocação do líder. **Não coberto:** a invocação parada no tile de CHEGADA de uma escada. A
  troca (`swapPlaces`) é com o tile PEDIDO — o degrau, onde monstro nenhum pisa —, e a chegada ocupada
  continua `tile-occupied`; o Canary teleporta com `FLAG_NOLIMIT` e divide o tile. Vale igual para o
  familiar desde o #599, e só acontece com a invocação deixada do outro lado (ela segue o mestre, que
  está do lado de cá); fica registrado, sem regra divergente escrita.
- **O dano da invocação credita o MESTRE, nunca ela mesma** (ADR 0057 decisão 2,
  `Creature::getGainedExperience`/`attackerMaster` do Canary): quando o ATACANTE de um golpe
  monstro-contra-monstro tem `masterId` string, `#applyMonsterHitOnSummon` redireciona o
  `recordDamage`/`session.creditDamage` para o `characterId` do mestre, não para o `subject` da
  invocação — é o que faz a XP por razão de dano (#523) e o Bestiário renderem para o
  PERSONAGEM: `xpByDamage`/`session.participants` nunca reconheceriam um `m:<id>` como
  participante, e sem o redirecionamento o abate renderia ZERO para o mestre mesmo com a
  invocação tendo matado sozinha.
- **Nunca ganha nada por si mesma** — sem `CharacterRuntime`, sem XP nem Bestiário possíveis; e o
  abate que ELA sofre (morre em combate) segue a regra de sempre do #546: `isSummon` no
  `#onMonsterDied` continua gatendo por `masterId !== null` (número OU string), então uma
  invocação de personagem morta também não paga nada a ninguém.
- **Some ao morrer o mestre, sair da hunt, ou a sessão acabar** — o `#removeSummon` do #546 é
  reusado tal e qual (masterId numérico ou string, o filtro não distingue); `HuntRuleset#onLeave`
  ganhou a MESMA cascata para `masterId === character.id`, cobrindo morte, saída manual e regra
  de saída (todas passam por `Session.leave`). Fim de sessão não precisa de código: a instância
  inteira morre junto, como todo outro monstro.
- **Recusada na Cidade — estruturalmente, não por um campo de PZ.** A Cidade
  (`rulesets/city.ts`) não implementa `castSpell` nenhum hoje; não existe caminho para invocar lá
  até a Cidade ganhar magia (M42+). Quando ganhar, precisará repetir a checagem de PZ que outra
  mecânica de dano/invocação já tiver decidido — não há mecanismo de zona de proteção neste
  repositório ainda.
- **`combat-v4` (ADR 0052 decisão 7):** o veículo único do endgame — ver "O `combat-v4`" em
  `docs/product/combat-conformance.md` para o estágio que este sistema declara nele (additive:
  nenhum abate ou golpe que já existia muda de número quando ninguém invoca).
- **Fora do escopo** (M38): o PRESET "sem invocação viva → invocar" para Druid/Sorcerer. O
  vocabulário (`kind: 'summons'`, a ação `spell` com `monsterId`) já suporta configurá-lo à mão pela
  barra, mas o mecanismo de PRESET em si (aplicar automaticamente ao escolher vocação) não existe; o
  preset da party de dragões (#526) já leva a regra do FAMILIAR (seção abaixo). Os quatro familiares
  chegaram no #599 (seção abaixo) e Convince Creature e Animate Dead no #600 (a seção "Convince
  Creature e Animate Dead", depois dela).
- **O alvo da invocação é o alvo SELECIONADO do mestre (#599).** `HuntRuleset#chooseMonsterTarget`
  passou a herdar `#attackTargetOfRunner(owner) ?? #botCandidateOf(owner)` — a criatura que o
  mestre escolheu atacar (`master->getAttackedCreature()` do Canary, `Monster::updateSummonTarget`)
  — em vez do `attackTargetOf`, que só vale dentro do alcance da ARMA dele (o desarmado alcança 1).
  Com o segundo, o Sorcerer e o Druid, que lutam a três ou sete tiles com magia e runa, deixavam a
  invocação sem alvo enquanto a luta acontecia.

## O familiar de vocação (#599, M38-02, ADR 0057 d.3–d.4; Canary `Player:CreateFamiliarSpell`)

Fontes locais (Canary `47dfd51`): `data/scripts/spells/familiar/{knight,paladin,sorcerer,druid}_
familiar.lua`, `data/libs/functions/player.lua` (`CreateFamiliarSpell`/`createFamiliar`),
`data/libs/systems/familiar.lua` (`FAMILIAR_ID`, os outfits), `data/scripts/creaturescripts/
familiar/{on_login,on_death}.lua`, `data-otservbr-global/monster/familiars/*.lua`,
`data-otservbr-global/scripts/spells/monster/summonchallenge.lua` e `config.lua.dist` (`familiarTime`).

**O que existe.** Quatro magias (`packages/content/data/spells/summon-<vocação>-familiar.json`),
level 200, mana 1000 (Knight) / 2000 (Paladin) / 3000 (Sorcerer) / 3000 (Druid), grupo `support`, e
quatro monstros importados de `familiars/` (`packages/content/data/monsters/generated/
familiars.json`, pelo `pnpm catalog:import monsters` — o familiar do Monk fica de fora, ADR 0051).
O familiar dura **15 minutos** (`60 × familiarTime / 2` s, `familiarTime = 30`) e a magia volta **30
minutos depois do lançamento** (`2 ×` a duração) — os dois números moram no EFEITO da magia
(`effect.durationMs`/`effect.cooldownMs`), e o `cooldownMs` da magia fica em 2 s (o `groupCooldown`
do script; o `spell:cooldown(0)` do Canary diz que quem cobra é a `CreateFamiliarSpell`).
Como toda magia instantânea, ela só é lançada DEPOIS de aprendida (#624, ADR 0058): o `learnPrice`
das quatro é o do NPC do Canary (50 000, importado por `pnpm catalog:spell-prices`), e quem lança sem
tê-la recebe `spell-not-learned`.

- **Não é `summonable`.** O Canary declara `summonable = false` nos quatro: a Summon Creature não os
  invoca. O que os liga é o `flags.familiar` (`monsterSchema.familiar`), que `buildContent` exige
  do `monsterId` da magia.
- **Lançar** (`HuntRuleset#castSpell`, ramo `familiar`): recusa com **zero invocações vivas**
  (`has-summons` — o teto do familiar não é o 2 da Summon Creature; ele OCUPA um lugar do teto de 2,
  então sobra uma Summon Creature) e recusa sem sala em volta (`not-enough-room`), **as duas antes
  de gastar mana e de armar qualquer cooldown**: o `onCastSpell` do Canary devolve `false` e o
  framework não cobra (`castSpell` ganhou o parâmetro `precondition`, chamado depois de level/
  cooldown/mana e antes do custo). A mana sai pelo `spell.manaCost` e rende skill de magia como
  qualquer magia (`addManaSpent`).
- **Onde nasce:** `Game.createMonster(name, pos, extended = true, …)` — os doze tiles da
  `extendedRelList` de `Map::placeCreature` (`familiar.ts`): os quatro do norte ({0,−2}, {−1,−1},
  {0,−1}, {1,−1}) embaralhados entre si e só depois os outros oito, o primeiro que serve (parede,
  ocupação, sem escada/teleporte, com linha de visão livre até o mestre). O embaralhamento usa o
  `Rng` da sessão (o Canary usa `std::random_device`): 10 sorteios por tentativa, e zero quando
  ninguém invoca.
- **Velocidade:** a MAIOR entre a do mestre e a do monstro, **fixada no lançamento**
  (`changeSpeed(math.max(self:getSpeed() - base, 0))`) — inclui a haste que o mestre tinha naquele
  instante, e o Canary não a atualiza depois.
- **Duração e cooldown são carimbos de relógio de PAREDE** no `CharacterRuntime.familiar`
  (`{ version, summonUntilMs, cooldownUntilMs }`, epoch em ms — `packages/sim/src/familiar.ts`),
  gravados no lançamento e persistidos na coluna `character.familiar` (`jsonb`, migração `0023`):
  lidos inteiros no ticket, escritos inteiros pelo extrato, última escrita vence (NUNCA fundidos
  pelo maior — o `summonUntilMs` desce quando o familiar morre). O `sim` não lê relógio nenhum
  (invariante 1): o "agora" é `Session.createdAtMs + Session.nowMs`, dados pelo servidor — e é o
  SERVIDOR quem mantém a soma verdadeira: na retomada de um snapshot o intervalo descartado (ADR
  0018) é somado ao `createdAtMs` (`SessionHost#resume`), senão o relógio de parede do `sim` ficaria
  atrasado pela queda inteira e o cooldown gravado numa sessão retomada nasceria já curto. **Os
  carimbos são sempre INTEIROS**: o relógio lógico do hospedeiro é `performance.now()`, fracionário,
  e todo consumidor (estado do personagem, extrato, ticket) valida inteiro seguro e troca o torto
  pelo vazio em silêncio — o lançamento grava o teto (`Math.ceil`, nunca encurta o cooldown) e a morte
  grava o piso (nunca recria o que acabou de morrer). **O fim da
  vida é um evento da fila** (`familiar-expire`, subject `m:<id>`; invariante 2) — mesmo estado a 1
  Hz e a 10 Hz, e o evento volta no snapshot. Um `Cooldowns` de sessão não serviria: ele guarda
  instante LÓGICO, que nasce em zero a cada sessão.
- **A recusa por cooldown NÃO carrega prazo para o bot** (`retryInMs: 0`, engatilha). Um prazo de 30
  min faria o grupo `support` do bot dormir 30 min — inclusive a haste, que vive nele. A barra
  mostra o cooldown REAL (`#cooldownWaitOf` inclui o carimbo: `slotStates`/`useSlot` recusam com o
  prazo em relógio de parede) e o bot lança sozinho no instante em que a magia volta.
- **Ao entrar na hunt o familiar volta com o tempo que sobra** (`familiarOnLogin`,
  `HuntRuleset#restoreFamiliar`): `summonUntilMs − agora`, para quem tem a magia da vocação, o level
  dela e nenhuma invocação viva — sem mana, sem tocar no cooldown, e sem nova tentativa se não
  houver sala. **A morte do familiar zera a recriação** (`FamiliarDeath`: `familiar-summon-time =
  os.time()`) e deixa o cooldown de pé. O mestre que sai da hunt leva o familiar junto (#598) e os
  carimbos ficam; a Cidade não simula nem tem invocação (`City#useSlot` recusa o efeito).
- **Segue o mestre** (`Monster::updateSummonTarget`): sem alvo, o familiar anda até um tile a 2 do
  mestre (a 1 só se não houver tile a 2 alcançável), se o enxerga (visão de 11), por uma busca de
  menor custo (cardinal 10, diagonal 35) — e para lá; com alvo, luta. Sem o mestre à vista ou sem
  caminho até ele, vagueia como todo monstro sem perseguição, e o teleporte abaixo o traz de volta.
- **Teleporte ao mestre** (`Creature::checkSummonMove`, a cada passo dele): outro andar OU mais de
  15 tiles em x/y (`FAMILIAR_TELEPORT_DISTANCE`) — a invocação comum só some além de 30 tiles/2
  andares, o familiar nunca. **Sai como RELOCAÇÃO para quem olha**: o par `creature-vanished` +
  `creature-appeared` do mesmo subject (com id numérico novo no cliente), nunca um `creature-moved`
  de duração zero — o protocolo exige duração positiva e o hospedeiro descartaria o evento, deixando
  o familiar desenhado no tile (e no andar) antigos.
- **O jogador atravessa o familiar** (`Player::canWalkthrough`, `player.cpp:1424-1444`: `monster->
  isFamiliar() || noPvpThroughAtSummon` — o familiar de qualquer dono, e toda invocação cujo mestre é
  jogador no mundo no-pvp do ADR 0060, que é o caso da invocação comum, descrita no #600 acima): o tile
  ocupado só por ele não bloqueia o caminho do personagem (`#moverBlocked` no passo guloso,
  `#occupiedForPlayer` nas buscas de caminho do follow e do `walk-to` — as MESMAS duas que valem para a
  invocação comum, por `#playerSummonAt`), e o passo TROCA os dois de lugar (`#step`: o familiar libera o
  tile um instante, o passo acontece, e ele ocupa o tile que o jogador acabou de deixar, com um
  `creature-moved` para ele). Sem isto, um familiar parado num corredor tranca a party — achado pela
  regressão de coesão do #527 com o preset novo. O monstro hostil continua sem atravessá-lo. **Duas
  trocas, uma regra**: o familiar passa pela troca que libera o tile ANTES do `move` (a do #599, com o
  fallback de recolocação quando o tile deixado fecha), a invocação comum pela de
  `swapPlaces` DEPOIS do `move` recusado (#600); o que decide quem atravessa é o mesmo — `masterId` de
  jogador.
- **A ability do familiar bate nos monstros HOSTIS, nunca na party.** `#executeMonsterAbility`
  troca as presas de uma invocação de PERSONAGEM por `#hostileMonsters()` (o Canary passa a área
  pelo `canDoCombat`, que protege jogador e invocação de jogador). O #598 só tinha exercitado o golpe
  de alvo único: uma onda de familiar acertaria o próprio mestre. O crédito de dano, XP e Bestiário
  é do mestre, como antes — e **o mestre recebe a XP INTEIRA** (`Creature::onGainExperience` só
  divide por 2 a invocação que NÃO é familiar).
- **`summon challenge`** (Druid e Sorcerer, 40 % a cada 2 s): a ability `challenge: { durationMs:
  8000 }` — `doChallengeCreature(..., 8000)` sobre a `AREA_CIRCLE2X2` centrada no lançador (o círculo
  de raio 4 da tabela de anéis de monstro, os mesmos 21 tiles): cada monstro hostil atingido passa a
  mirar o familiar (`Monster::challengeCreature` recusa quem é invocação) e ganha a condição
  `challenge`. Sem dano, sem sorteio de dano.
- **Ice Strike e Sudden Death Rune** (Knight): o monstro lança a magia REGISTRADA pelo nome
  (`Monsters::deserializeSpell` → `getSpellByName`) com o dano da PRÓPRIA entrada
  (`Monster::getCombatValues`). O `spell:range(3)` do Ice Strike vale por cima do `range 5` do
  monstro (`canThrowSpell`) — a ability sai com alcance 3.
- **Preset (#526)**: `botConfigFor` (`packages/tools/src/dev/dragon-party-plan.ts`) leva, para cada
  vocação, `summon-<vocação>-familiar` com a condição `summons <= 0` ("familiar pronto → invocar",
  ADR 0057 d.4) no grupo `support`, ao lado da haste.

**Divergências, com o motivo** (nenhuma é regra de caça; as que são, estão marcadas):

1. **O cooldown também corre na Cidade e offline (relógio de parede).** No Canary é uma
   `CONDITION_SPELLCOOLDOWN` persistente cujos `ticks` só andam com o jogador ONLINE. Dentro da hunt
   os dois coincidem. É a decisão do ADR 0057 d.3 e do ADR 0052 d.6 ("cooldown de parede"), anterior a
   esta issue; ver a emenda do ADR 0057.
2. **Premium não é conferido** (`CreateFamiliarSpell`: "You need a premium account."). O catálogo
   inteiro de magias ignora `isPremium` (`scripts/catalog/spells.ts`), e o Premium do personagem só
   chega ao ruleset da party — uma hunt solo não o conhece.
3. **O teleporte cai no tile livre mais perto do mestre, não NO tile dele** (`internalTeleport` com
   `FLAG_NOLIMIT`): o tile do `sim` é exclusivo (`TileOccupancy`).
4. **Atravessar o familiar é uma TROCA de tiles, não dividir o tile** (mesma razão): o Canary deixa
   o jogador e o familiar no mesmo tile. Quando o tile que o jogador deixou não admite mais o familiar
   (uma porta comum que fecha no `vacate`), o familiar é recolocado no tile livre mais perto do
   jogador — como no teleporte, e com o mesmo par de eventos de relocação. O familiar sem alvo SEGUE o mestre (`summonFollowStep`,
   acima), e o teleporte ao mestre cobre o que a visão de 11 não alcança (> 15 tiles/outro andar).
5. **Sem as mensagens "Your summon will disappear in less than one minute / 10 seconds"** (texto
   privado ao mestre, `MESSAGE_LOOT`): apresentação, sem canal no protocolo.
6. **O familiar nasce fora de escada e de teleporte** — o Canary o aceita em tile de mudança de
   andar, exceto com o mestre atacando (`Tile::queryAdd`).
7. **A XP de uma invocação COMUM ainda é a inteira**, e o Canary a divide por 2 (`Creature::
   onGainExperience`: `gainExp /= 2` para `!isFamiliar()`, exceto com XP compartilhada de party) —
   achado ao ler a fonte do familiar, que é o caso certo; o #598 nunca modelou a metade.

## Convince Creature e Animate Dead (#600, M38-03, ADR 0057 d.5–d.6; TFS/Canary `convince_creature.lua`, `animate_dead_rune.lua`)

As duas runas de invocação que sobravam depois da Summon Creature (acima) e dos familiares (#599).
Ambas são **supply abstrato** (gold no uso, ADR 0044 — a carga é o preço da runa, `charges(1)`), do
grupo `support`, com o par `cooldown 2 s` + `groupCooldown 2 s` do Canary (`cooldownMs` e
`groupCooldownMs`, os dois livros — o mesmo desenho da Paralyze Rune) e a exaustão de ação de 1 s de
toda runa. **Nenhuma das duas declara `rune:vocation`**: qualquer vocação usa (a issue dizia "druid",
que é o TibiaWiki — vale o Canary, ADR 0037 d.4). Vivem em `packages/content/data/supplies/
convince-creature-rune.json` e `animate-dead-rune.json`, com os efeitos novos `convince` e
`animate-dead` no `supplySchema`; o preço vem de `pnpm catalog:npc-prices` (80 e 375, o menor `buy`
dos NPCs para os clientId 3177 e 3203).

O que o script do Canary confere fica FORA de `casting.ts` (que não conhece monstro nem cadáver,
invariante 1) e entra em `useSupply` como uma **precondição** que o ruleset passa
(`HuntRuleset#summonRunePrecondition`): roda depois dos requisitos, da mira e do alcance e ANTES de
gastar o gold — a carga só sai quando o script devolve `true`, então recusa nenhuma custa gold,
mana ou cooldown. Recusas novas: `not-possible` (`RETURNVALUE_NOTPOSSIBLE`, "Isso não é possível.")
e `too-many-summons` ("You cannot control more creatures."), ao lado de `not-enough-mana`,
`no-target`, `out-of-range`, `level-too-low`/`magic-level-too-low` de sempre.

### Convince Creature (level 16, magic level 5)

- **Mira uma criatura** (`needTarget(true)`), alcance 8 (a convenção do catálogo para runa de alvo
  único — o Lua não declara `rune:range`); monstro invisível recusa `no-target`, como as outras runas
  de alvo único.
- **A ordem do script**: o alvo é `convinceable` (`monster.convinceable`, `MonsterType::
  isConvinceable`) e NÃO tem mestre nenhum — nem o de outro personagem (`target:getMaster()`) —, senão
  `not-possible`; menos de 2 invocações vivas (`getSummons() >= 2`), senão `too-many-summons`; mana >=
  `monster.manaCost`, senão `not-enough-mana`. `manaCost` ausente é zero: o `info.manaCost` do monstro
  fica zerado, e o convencimento é de graça. **Nota de fonte:** o script escreve `target:getType():
  getManaCost()` (e `summon_creature.lua`, `monsterType:getManaCost()`), mas nem o Canary nem o TFS
  registram esse método — o binding Lua é `monsterType:manaCost()`, e só o C++ `Monster::getManaCost()`
  existe, lendo `info.manaCost`. Como escritos, os dois scripts falhariam com "attempt to call method"
  nos motores de referência; o catálogo implementa a INTENÇÃO evidente (o custo é o `manaCost` do
  monstro), e isso fica registrado aqui e na emenda do ADR 0057.
- **O custo é a mana DO MONSTRO** (`addMana(-manaCost)`), e o magic level sobe por ela
  (`addManaSpent` → `#gainSkills(..., 'spell-cast', manaCost)`, a mesma conta da Summon Creature).
  O gold da runa (`price`) sai por cima.
- **`HuntRuleset#convertToSummon`** é o `Creature::setMaster(master, true)` + `setSummon`: o
  monstro do Spawner passa a ter `masterId` = o `characterId` — a partir daí é exatamente a
  invocação do #598: segue o alvo do mestre, o dano dela credita o mestre, monstro hostil a ataca,
  some com o mestre (morte, saída, fim da sessão), **nunca paga XP, loot nem Bestiário** e **nunca
  deixa cadáver** (`Creature::dropCorpse` do Canary devolve cedo com um POFF quando `!lootDrop`).
  O que a conversão limpa: o alvo antigo (`targetId` — o personagem que o atacava), o estado de
  "voltando ao spawn"/ocioso, a lista de invocação PRÓPRIA (`!isSummon()` em `onThinkDefense` — as
  invocações que ele já tinha continuam dele, e morrem com ele) e o alvo de ATAQUE de todo
  personagem que o tinha na mira, inclusive o do próprio mestre (`#inSightOf` passou a recusar
  invocação de personagem, e cada personagem reavalia o alvo). A apresentação recebe o
  `creature-appeared` de novo, agora com `masterId` — o mesmo evento de nascimento, aplicado pelo
  cliente por cima da criatura que ele já conhece.
- **O ponto de spawn NÃO começa o respawn ao convencer** — corrige o ADR 0057 d.5 (emenda de
  2026-09-30). O Canary mantém o monstro no `SpawnMonster::spawnedMonsterMap`, que só é limpo quando
  ele é REMOVIDO (`cleanup`: `monster->isRemoved()`): o lugar continua ocupado enquanto a invocação
  vive, e o respawn corre quando ela morre ou some (com o mestre). O `spawn->removeMonster` que o ADR
  citava só existe no ramo `monsterOverspawn` do `Monster::onThink` do TFS (config desligada por
  padrão) e não tem relação com convencer. Aqui isso cai de graça: o lugar do Spawner segue com o
  convencido, e `#onMonsterDied`/`#removeSummon` chamam o mesmo `#releaseSpawnSlot`, que agenda o
  respawn do ponto (`respawnDelayMs`, mais a metade da Boosted Creature) a partir DAQUELE instante.

### Animate Dead (level 27, magic level 4)

- **Mira um TILE** (`allowFarUse`, sem `needTarget`): manual, pelo tile apontado; o BOT, que não
  aponta nada, escolhe o cadáver animável MAIS PRÓXIMO ao alcance (mesmo andar, linha de visão livre,
  o do topo da pilha; empate para o mais antigo) — a mira da automação é do Draconya (ADR 0037 d.2),
  a regra que ela dispara é a do Canary.
- **O item do topo do tile precisa ser um cadáver movível** (`itemType:isCorpse() and
  itemType:isMovable()`), e isso é propriedade de CADA ESTÁGIO da cadeia `decayTo` — o dado do Canary
  está em `appearances.dat` (flags `corpse` e `unmove`), não no `items.xml`. O primeiro estágio de
  quase todo monstro é `unmove` (5972 → 4024 no esqueleto): **o cadáver recém-abatido NÃO pode ser
  animado**; vira movível no primeiro decaimento (10 s depois, no caso comum). `monster.
  corpseAnimatable` guarda as janelas `[fromMs, untilMs)` em ms desde a morte (o mesmo relógio de
  `corpseTtlMs`), geradas pelo importador; o instante da morte sai do evento `CORPSE` que a fila já
  guarda (vencimento menos `corpseTtlMs`), então a conta sobrevive ao snapshot e não depende de
  alguém olhar (invariante 3). Monstro sem janela (cadeia sem estágio movível, ou sem cadáver) nunca
  é animável. O "topo" é o cadáver mais RECENTE do tile (`Tile::getTopDownItem` devolve o último
  item posto): um cadáver novo ainda `unmove` cobre o velho, que não conta.
- **A ordem do script**: tile SÓLIDO sem criatura visível, `not-possible` (abaixo); sem cadáver
  movível no topo, `not-possible`; com 2 invocações vivas, `too-many-summons`; e nasce o Skeleton.
- **Tile sólido recusa antes do script** (`rune:isBlocking(true)` = `blockingSolid`, Canary
  `Spell::playerRuneSpellCheck`: `tile->hasFlag(TILESTATE_BLOCKSOLID) && !topVisibleCreature` →
  `RETURNVALUE_NOTENOUGHROOM`): com um campo bloqueante (Magic Wall, Wild Growth) em cima do tile do
  cadáver e ninguém visível nele, a runa recusa SEM consumir o cadáver, o gold nem o cooldown —
  `not-possible` no motor, que não tem recusa própria para "sem espaço" (o texto do Canary é outro; é
  apresentação, não regra). Criatura visível no tile (personagem, ou monstro não invisível) dispensa a
  recusa, como no Canary.
- **Consome o cadáver e destrói o loot que ainda estava nele** (ADR 0048 d.5: o item no cadáver nunca
  foi instância no banco, então não há linha de ledger a fechar nem `removedInstances`): o cadáver sai
  de `#corpses`, o evento `CORPSE` é cancelado (nada de segundo `ground-item-disappear`), o cliente
  recebe `ground-item-vanished` e depois `creature-appeared` (com `masterId`). Nada vai para o herói
  nem para o Skeleton.
- **O monstro nasce do CONTEÚDO** (`effect.monsterId`, `skeleton` — o `"Skeleton"` que o Lua escreve
  no código; `buildContent` confere que existe), como invocação do lançador. **Não custa mana** (o
  script nunca chama `addMana`): só o gold da runa.
- **Onde nasce**: o Canary o coloca no tile do cadáver à força (`Game.createMonster(..., true,
  true)`), empilhado com quem estiver ali; o tile é exclusivo neste motor (invariante 8), então nasce
  no tile ou no primeiro vizinho livre da ordem fixa de `tilesAround` — e sem nenhum livre a runa
  recusa `not-possible` antes de gastar a carga (no Canary a colocação forçada não falha). Divergência
  de geometria, não de regra de caça: o vizinho só entra quando o tile do cadáver está OCUPADO por
  alguém (a colocação à força do Canary o empilharia); o tile sólido é a recusa de cima, e nunca
  desvia o Skeleton para o lado.

### O que mudou fora das duas runas

- **Invocação NUNCA deixa cadáver.** Antes desta issue o `#onMonsterDied` empilhava o cadáver de toda
  invocação que morria; o Canary (`Creature::dropCorpse`, `!lootDrop`) não deixa nenhum. Sem esta
  regra o Skeleton animado morreria e deixaria um cadáver animável — a cadeia infinita de Animate Dead
  que o Canary não permite.
- `HuntRuleset#releaseSpawnSlot` (extraído do `#onMonsterDied`) devolve o lugar de um monstro e agenda
  o respawn; o `#removeSummon` o chama para o convencido que some com o mestre.
- O importador (`pnpm catalog:import monsters`) lê `flags.convinceable`, `manaCost` (todo monstro que o
  declara, `summonable` ou não) e as janelas `corpseAnimatable` de `appearances.dat`. **`summonable`
  continua NÃO importado** — ligar a Summon Creature (#598) no catálogo real é decisão à parte.

### Divergências e o que fica de fora

- **Despawn por raio** (`Monster::isInSpawnRange`, `deSpawnRadius` 50): o Canary teletransporta de
  volta ao ponto de spawn o monstro que passa de 50 tiles dele — inclusive o convencido, que ainda
  tem `spawnMonster`. Este motor nunca modelou o teleporte (`isInSpawnRange` de `monster.ts` devolve
  `true` para invocação), e nenhuma hunt do catálogo tem 50 tiles de raio útil a partir de um spawn.
  Fora do escopo; nada divergente foi implementado.
- **Campo no tile do cadáver**: o item do topo pode ser um campo mágico que caiu depois do cadáver
  (`downItems` — o Animate Dead falharia). O motor não guarda a ordem entre campo e cadáver; a regra
  só olha cadáveres.
- **`PlayerFlag_CanConvinceAll`** (GM) e **caveira preta** (`SKULL_BLACK`, Animate Dead): PvP e flags
  de GM não existem na hunt.
- **A invocação sem alvo NÃO segue o mestre** (a divergência do #598): um convencido sem alvo fica
  onde está. O seguir do mestre é do #599 (`Monster::updateSummonTarget`) e vale para toda invocação
  de personagem quando pousar.

## Charms em combate (#603, M39-03, ADR 0053 d.5 — `combat-v4`)

Os 24 Charms do Canary que agem em combate (todos menos o Scavenge, que age na esfola — #626, ver
`docs/product/items.md`) rolam DENTRO do
pipeline de dano, na ordem do `Game::combatChangeHealth`/`applyCharmRune`. O que cada um faz, o
que rola e onde mora cada número está na tabela de estágios de `docs/product/combat-conformance.md`
(seção "Estágio #603"); o catálogo (id, categoria, tipo, `percent`, `chance[3]`) é
`packages/content/data/charms/generated/charms.json`, e a economia (desbloquear, atribuir, remover)
é `docs/product/bestiary.md`.

- **Ofensivos** (Wound, Enflame, Poison, Freeze, Zap, Curse, Divine Wrath, Overpower, Overflux,
  Cripple): depois de todo golpe do jogador que tirou vida do monstro do charm — melee, distância,
  wand, magia e runa, cada alvo da área —, `chance ≥ uniform(1, 100)` (a chance nominal, exata). O
  dano é uma EXTENSÃO passando pelo mesmo resolver: `min(2× o level, percent % da vida máxima do
  monstro)` no tipo do charm (elementais); `min(8 % da vida do alvo, 5 % da vida máxima do jogador
  | 2,5 % da mana)` NEUTRO no Overpower/Overflux. Resistência, imunidade e cura por elemento do
  monstro valem; o aumento por tipo do atacante também; defesa, armadura, crítico, leech e reflexo
  não. O neutro pula absorção, aumento, imunidade e resistência (a mitigação percentual e o piso
  continuam). Cripple paralisa o monstro por 10 s (velocidade 40, como a Paralyze Rune) — inclusive
  o monstro imune a `paralyze`, porque o Canary aplica a condição direto, sem o portão de imunidade
  do `CombatConditionFunc`. O dano do charm conta para o DPS e para a atribuição de kill/XP do
  jogador.
- **Defensivos** (Dodge, Parry, Adrenaline Burst, Numb; Cleanse é à parte): no golpe de monstro
  que já passou pelo `blockHit` e pelo reflexo do equipamento — e em cada tique de condição que um
  monstro VIVO aplicou (o `owner` da condição é o atacante) —, antes do mana shield; minor antes de
  major. O Dodge nega o golpe inteiro (o `blockHit` já gastou carga e treinou escudo, então o golpe
  segue com dano zero); o Parry devolve o dano recebido como neutro; Adrenaline Burst dá haste de
  10 s (`2,5 × (base − 40) + 40`); Numb paralisa o monstro (também o imune a `paralyze`, como o
  Cripple). Golpe já zerado não rola. A
  probabilidade REAL é a da normal truncada (~1,4 % a 4,3 %), não a nominal.
- **Passivos**: Low Blow abre um segundo sorteio de crítico contra o monstro do charm (chance
  `base + charm`) e Savage Blow soma ao multiplicador do crítico dele — sobre o crítico BASE de todo
  jogador (5 %, +10 %), que entrou junto (`combat.modifiers`); Vampiric Embrace e Void's Call somam
  ao leech; Fatal Hold impede a fuga por 30 s; Void Inversion converte dreno de mana em ganho;
  Bless reduz a perda de morte (`chance/100`, multiplicativa); Gut sobe o drop dos creature
  products do cadáver.
- **Carnage** age na morte do monstro: dano neutro `min(15 % da vida do morto, 6× o level)` nos
  quatro vizinhos ortogonais, com a morte deles resolvida e creditada ao jogador. Vale para o monstro
  invocado por outro monstro também (o `Monster::death` não confere `isSummon()`).
- **O Dodge do PRD saiu** (ver "As exceções de produto"): o único Dodge deste perfil é o charm.

Sob `combat-v3` nada disso roda, mesmo com charm atribuído (o registro é do personagem, o perfil é
da versão de conteúdo — invariante 7).

## Condições generalizadas, dano contínuo e campos (CMB-07, #334)

O #155 criou as condições como estado temporário do PERSONAGEM com quatro chaves fixas (haste,
postura, magic shield, cura ao longo do tempo). O CMB-07 generalizou o mecanismo: condição
TIPADA sobre personagem **e monstro**, com DANO AO LONGO DO TEMPO (DOT) e CAMPOS por tile. Tudo
reusa a fila lógica, o resolver canônico e a apresentação — nenhum laço por tick novo.

```ts
interface ConditionSpec {                 // declarado em content
  readonly key: string;
  readonly merge: 'replace' | 'refresh' | 'strongest';
  readonly durationMs: number;
  readonly effect: ConditionEffect;       // speed | buff | mana-shield | heal-over-time | damage-over-time
}

interface FieldStage {                    // declarado em content (#560)
  readonly durationMs: number;
  readonly condition?: ConditionSpec;     // ausente: estágio MUDO (só ocupa/bloqueia)
}

interface FieldSpec {                     // declarado em content
  readonly id: string;
  readonly durationMs: number;
  readonly shape: SpellArea;              // a MESMA geometria da magia/ability
  readonly condition?: ConditionSpec;     // #560: opcional — campo puramente bloqueante não tem
  readonly stages?: readonly FieldStage[]; // #560: a cadeia `decayTo`; ausente é UM estágio só
  readonly blocksMovement?: boolean;      // #560: Magic Wall/Wild Growth
  readonly blocksProjectile?: boolean;    // #560: alimenta a LOS quando o M30-06 existir
}
```

- **Alvo de PARTY (#588: Heal/Protect/Enchant/Train Party, level 32, uma por vocação).**
  `spellEffectSchema` ganhou `target: 'party'` nos efeitos `heal-over-time` e `buff` — um TERCEIRO
  alvo ao lado de `self`/`friend` (a cura, §26), mas RAIO, não forma: quem está a até `range`
  tiles (Chebyshev, mesmo andar) do lançador, roster inteiro da sessão, líder incluso, recebe a
  MESMA condição — sem geometria desenhada no chão (`AREA_CIRCLE5X5` do Canary é só o efeito
  visual). `HuntRuleset#collectPartyAllies` (`sim/rulesets/hunt.ts`) resolve quem está no
  alcance; sozinho, o lançador recusa `no-target`, a mesma mensagem "No party members in range"
  do Canary. O custo de mana também pode ser `{ kind: 'party-scaled', base, decay }`
  (`spellSchema.manaCost`, união com o número fixo de sempre) — `ceil((decay^(n−1) × base) × n)`,
  `n` sendo quantos estão no alcance —, resolvido em `party.ts#partyScaledManaCost` e cobrado
  ANTES do cast, nunca o `base` do catálogo (que é só o custo de exibição,
  `manaCostDisplayOf`). `skillDeltas` (bônus FLAT por skill, #576) chega pela primeira vez ao
  `buff` de MAGIA — antes só o de SUPPLY o tinha —, e o consumo é o MESMO
  `Conditions.skillBonus` já ativo, sem lógica nova. Ver `docs/product/party.md`.
- **Alvo duplo.** O estado de runtime do #155 continua plano (compatibilidade de snapshot) e
  ganha `targetId`, `sourceId`, `merge` e `nextTickAtMs` opcionais. O monstro carrega
  `conditions`, e o vencimento/tique usam o mesmo sujeito (`<id>/<chave>`, com `m:<id>` no
  monstro) — cancelar no relançamento e na morte não varre a fila.
- **O dano ao longo do tempo tem a forma do Tibia (M31-02, #557).** `ConditionEffect` do `kind
  'damage-over-time'` aceita DUAS formas do conteúdo — a mesma divisão que
  `ConditionDamage::init`/`ItemParse::parseFieldCombatDamage` do Canary fazem por `startDamage`
  presente ou ausente (nunca as duas ao mesmo tempo, um `discriminatedUnion` por `form`):
  - `generated`: `{ totalDamage, startDamage?, intervalMs }`, a lista DECRESCENTE de
    `ConditionDamage::generateDamageList` (`condition.cpp:2143-2160`) — soma até `totalDamage`,
    começando em `startDamage` (ausente, `max(1, ceil(totalDamage / 20))`, o default do próprio
    Canary) e descendo até 1. O poison field do Canary (`items.xml` id 2121, `start=5 damage=100`)
    rende `[5,5,5,5,4,4,4,4,4,3,3,3,3,3,3,3,2,2,2,2,2,2,2,2,2,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]`
    — soma exata 100, e `conditions.test.ts` prende esse vetor calculado à mão.
  - `rounds`: `{ rounds: [{ count, intervalMs, damage }] }`, o `addDamage(rounds, interval,
    value)` que os SCRIPTS de magia do Canary usam (Ignite: `addDamage(25, 3000, -45)`, 25
    rodadas iguais de 45) e que o campo de fogo do Dragon Lord também usa (`count=7 damage=20
    ticks=10000`, sem `start`) — várias rodadas do MESMO valor, concatenáveis em mais de um
    grupo com cadência diferente.

  O `sim` (`conditions.ts`) expande as duas para a MESMA fila ORDENADA de tiques
  (`damageOverTimeTicks`, pura): o primeiro elemento é o tique CORRENTE de `ConditionTick`
  (`amount`/`intervalMs`, sem mudança de contrato) e o resto é `tick.queue`, opcional — ausente
  é o tique antigo (repete a `intervalMs` até `expiresAtMs`, cura ao longo do tempo e qualquer
  snapshot anterior a esta issue); presente, mesmo `[]`, é a fila nova, que PARA de tiquetar
  quando esgota, mesmo antes do vencimento (`advanceTick`, o mesmo `ConditionDamage::
  executeCondition` esvaziando `damageList`). O campo de tile (`#onFieldTick`/`#enterField`)
  **não acompanha a fila** — ele regenera a condição a cada pulso a partir do `ConditionSpec` e
  usa só o primeiro elemento; um campo com a forma `generated` bateria sempre o valor de
  `startDamage`, nunca decrescendo. Não é regressão: nenhum campo de conteúdo usa `generated`
  hoje, e é o mesmo comportamento de antes desta issue para um `rounds` de valor constante.
- **`durationMs` não pode ficar curto demais para a própria fila (achado da revisão do #557).**
  No Canary, um `ConditionDamage` nunca tem essa divergência POR ESTRUTURA:
  `ConditionDamage::addDamage` ESTENDE `ticks`/`endTime` a cada rodada somada
  (`condition.cpp:1863-1889`), então o prazo da condição e o tempo que a fila de dano precisa são
  sempre o MESMO número. Aqui `ConditionSpec.durationMs` é um campo solto (histórico, mantido por
  compatibilidade) — sem conferência, um conteúdo com `form: 'generated'` e um `durationMs`
  "razoável" mas curto demais para o número REAL de tiques que `generateDamageList` produz (a
  contagem não é aritmética simples: 46 tiques para `totalDamage: 100, startDamage: 5`, não um
  número redondo) truncava o DOT em silêncio — `#onConditionTick` (`hunt.ts`) para de agendar o
  próximo tique assim que ele cairia depois de `expiresAtMs`, mesmo com tiques ainda por entregar.
  `conditionSpecSchema` (`content/schemas.ts`) agora recusa no boot qualquer `durationMs` menor
  que `damageOverTimeTotalMs(effect)` (a soma de `intervalMs` de toda a fila), nomeando o
  déficit no erro; `durationMs` MAIOR que o total continua aceito, sem efeito observável — a
  condição só carrega a fila zerada (`retiredTick`) até vencer. `generateDamageList`/
  `damageOverTimeTicks` moraram em `sim/conditions.ts` até este achado; moveram para
  `content` porque o schema também precisa delas, e `content` não pode importar de `sim` — `sim`
  agora as importa de lá, para não haver duas contas do mesmo número (DT-03).
- **A tabela de tipo do Tibia (M31-02).** `ConditionEffect.damageType` é o elemento
  (`Combat::ConditionToDamageType` do Canary, `combat.cpp:245`):

  | Condição Tibia | `damageType` do Draconya |
  |---|---|
  | poison | earth |
  | fire (burning) | fire |
  | energy (electrified) | energy |
  | bleeding | physical |
  | cursed | death |
  | drown (drowning) | `drown` — chegou ao enum pelo #547 (M29-07); `sim/conditions.ts` já aceita qualquer `DamageType`, então um conteúdo de afogamento pode declarar `damageType: 'drown'` sem mudança nenhuma de código. |
  | freezing | ice |
  | dazzled | holy |

- **Reaplicação: `strongest` compara o TOTAL que falta, não o próximo tique isolado (M31-02).**
  A regra de `ConditionDamage::updateCondition` do Canary — o total NOVO só substitui o antigo se
  for MAIOR (`getTotalDamage()`, a soma do `damageList` inteiro) — vale para QUALQUER condição
  com `tick`: `strengthOf` soma `tick.amount` mais `Σ tick.queue[].amount`. Sem fila (tique
  antigo), a comparação continua sendo só o `amount`, como sempre foi — não há total finito a
  somar. Uma condição de fila menor no PRÓXIMO tique mas maior no TOTAL vence uma de próximo
  tique maior mas fila mais curta; `conditions.test.ts` prende os dois lados. Quando a fila
  ESGOTA (achado da revisão do #557), `retiredTick` zera `tick.amount`/`queue` em vez de deixar o
  `amount` do ÚLTIMO tique já entregue: sem isso, uma condição já esgotada — sem nenhum tique
  agendado — reportaria força fantasma e `strongest` recusaria uma reaplicação real mais fraca em
  `amount` bruto. Um tique PLANO (sem fila) nunca precisa dessa limpeza: o `amount` não muda ao
  longo da vida da condição.
- **O DOT entra pelo mesmo pipeline.** Cada tique chama `resolveDamage` com um `DamageIntent`
  tipado (`source` e `damageType`) e passa por `recordDamage` e `resolveDeath`/`session.kill`.
  Não existe escrita direta de vida: a armadura, a resistência e a esquiva valem no tique como
  valem no golpe. A atribuição vai para quem aplicou (`sourceId`); num campo, para o id do campo.
- **Política de fusão declarada (DT-02).** `refresh` é o de sempre (relançar reinicia);
  `replace` substitui; `strongest` mantém o de maior magnitude. Relançar cancela o evento antigo
  antes do novo — e, quando o intervalo do tique é o mesmo E HÁ de fato um tique pendente,
  REAPROVEITA esse evento em vez de cancelar e reagendar, senão a cadência coincidente empurraria
  o tique para sempre e o DOT nunca aconteceria. O segundo requisito é o que o #334 corrigiu: um
  `nextTickAtMs` guardado sem evento correspondente na fila (o tique que só caberia depois do
  vencimento, e por isso não foi agendado) não é reaproveitável — reaproveitá-lo era o fantasma
  que silenciava o DOT para sempre a partir do relançamento seguinte. Sem tique pendente,
  `nextTickAtMs` fica AUSENTE do estado, nunca com um valor sem evento.
- **O campo vive no ruleset, não no `Tilemap` (DT-01).** Índice por chave NUMÉRICA de tile,
  leitura O(1); sobreposição no mesmo tile fica com o mais recente. A ENTRADA é observada só
  depois de um passo ACEITO (DT-03): `movement` devolve resultado e nunca infringe dano, e um
  tile recusado não aplica o campo. O campo também carrega `nextTickAtMs` opcional (#334, mesmo
  papel do `ConditionState`) para o relançamento do mesmo id decidir se reaproveita o tique.
- **Tique x vencimento.** No instante em que o tique do campo cai no vencimento, o VENCIMENTO
  vence (é agendado primeiro) e o tique encontra o campo removido. É a única ordem, e é testada.
  Alvo morto não tiqueta, e o campo é INDEPENDENTE: continua no chão até o próprio prazo.
- **Snapshot aditivo.** `MonsterState.conditions` e `HuntRulesetState.fields` são opcionais e o
  `tick` antigo (sem `kind`) lê como cura. `SNAPSHOT_FORMAT_VERSION` **não sobe**.
- **O campo agora aparece no mundo (#561, M31-06).** `applyField` emite `field-appeared` (id de
  conteúdo + os tiles da forma) ao aplicar OU relançar o mesmo id; `#onFieldExpire` emite
  `field-vanished` quando de fato removeu um campo — a MESMA indireção de
  `ground-item-appeared` resolvendo `corpses` (invariante 6): o `sim` diz QUE campo e ONDE, a
  arte é `appearances.fields` (`id de conteúdo → appearanceId`), resolvida só no hospedeiro.
  Campo sem linha na tabela é MUDO — a mecânica do tique (acima) não muda, só a apresentação —,
  e o `session-state.world.fields` leva os campos ATIVOS para quem reanexa no meio da hunt,
  como `session-state.world.groundItems` já leva os cadáveres. Opcodes S2C `field-appear` (40) e
  `field-disappear` (41).
- **A cadeia de estágios (`decayTo` do Canary, #560, M31-05).** `fieldSpecSchema.stages` é a
  cadeia inteira — `items.xml:4212-4246`: o fire field 2118 (dano 20, 200 s) decai para 2119
  (10, 148 s) e depois para 2120 (sem dano, 98 s) antes de sumir, e o `dragon-lord`/
  `dragon-lord-hatchling` do catálogo já declaram os três estágios (`load.test.ts` prende os
  números). `stages` AUSENTE é um estágio só, do próprio `durationMs`/`condition` do spec — todo
  campo declarado antes desta issue continua bit a bit (`fieldStagesOf`, `content/schemas.ts`).
  `TileFieldState` ganhou `stageIndex` (ausente é 0) e, só quando há mais de um estágio, a
  cadeia INTEIRA (`stages`) — ela precisa viajar no estado porque `#onFieldStageAdvance` roda
  bem depois de `applyField`, sem mais acesso ao `FieldSpec` que criou o campo. Um evento novo,
  `FIELD_STAGE_ADVANCE`, troca de estágio no vencimento do atual — reagendando ele mesmo se
  sobrar outro estágio, ou caindo em `FIELD_EXPIRE` no último —, cancela e reagenda o tique da
  condição do estágio novo (nunca herda a cadência do estágio anterior) e emite
  `field-stage-changed` (S2C opcode 42) com o `stageIndex` novo; o hospedeiro resolve a arte por
  ÍNDICE em `appearances.fieldStages[id][stageIndex − 1]` (o índice 0 continua em
  `appearances.fields`, como sempre) — campo sem entrada troca de estágio MUDO. Quem reanexa no
  MEIO da cadeia recebe, no `session-state`, a arte do estágio ATUAL, não sempre a do nascimento.
- **Campo bloqueante (Magic Wall, Wild Growth, #560).** `blocksMovement` (default falso) faz o
  campo agir como PAREDE — para QUALQUER criatura, jogador e monstro, diferente do desvio de
  dano do M29-05 (`canMonsterEnterField`), que só o monstro respeita e só quando o campo tem
  `damageType`. Mecanismo: `Fields.blockedAt`/`blocksProjectileAt` (novos métodos em
  `sim/fields.ts`) e `TileOccupancy.blockedAt` os combina com o mapa e com `TileOverrides`
  (#728) — a MESMA composição de três fontes, uma pergunta só para `canOccupy`/`move`, o passo
  guloso do monstro e o BFS do `walk-to` distante. Magic Wall (Canary id 2128) e Wild Growth
  (rush wood, id 2130) são um estágio só, `blocking="1"`/`duration=20`/`decayTo=0` — 20 s e
  sumiu, sem cadeia decrescente. `blocksProjectile` (também default falso) alimenta
  `isSightClear` (`sim/line-of-sight.ts`, parâmetro novo e opcional) para quando o M30-06
  importar a flag `unsight` do pacote de aparências — **nenhum conteúdo declara a flag hoje**
  (Magic Wall no Canary é `blockSolid`, não `blockProjectile` — a segunda vem do pacote de
  assets, não de `items.xml`), e por isso os chamadores de combate em `hunt.ts` continuam
  passando só três argumentos: testado ligar os dez pontos de LOS de `hunt.ts` ao predicado
  revelou que ele quebrava mira explícita num alvo fora do mapa de teste (a checagem de limites
  do passeio, antes escondida atrás do atalho "sem camada de sight, sempre livre", passou a
  rodar de verdade) — a fiação de produção fica para quando o M30-06 tiver conteúdo real e mapa
  real para testar contra.

- **Runa de campo e parede do jogador (#591)**: Fire/Poison/Energy Field/Wall, Magic Wall, Wild
  Growth, Destroy Field e as três bombas (Fire/Poison/Energy Bomb) — `supplySchema.effect`
  ganhou os `kind`s `field` (planta o `FieldSpec` inteiro no tile mirado) e `destroy-field`
  (remove um campo não-bloqueante no tile). Mira SEMPRE de CHÃO — `HuntRuleset#groundAimFor`,
  distinto de `#aimFor`: não exige criatura no tile (o campo nasce vazio), só andar (#519) e
  linha de visão (a mesma checagem de 3 argumentos que a mira manual já usa). `#needsTarget`
  passou a reconhecer os dois `kind`s como "sempre exige alvo" — sem isso, `target.position`
  (`#725`/`#726`) seria descartado como "não se aplica" antes de chegar ao `sim`.
  `spellAreaSchema` ganhou duas formas: `point` (um tile só, no alvo — Fire/Poison/Energy Field,
  Magic Wall, Wild Growth) e `wall` (a fileira perpendicular ao lançador→alvo, CENTRADA no alvo
  — Fire/Poison/Energy Wall; só a CONTAGEM de 3 tiles é transcrita do `AREA_WALLFIELD*` do
  Canary, nunca a matriz, ADR 0019). `applyField` ganhou um parâmetro `direction` (default
  `'south'`, preservando bit a bit o único chamador de antes — a ability de monstro, sempre
  `circle`) para a `wall` se orientar pela direção real lançador→alvo
  (`directionOf(character.position, at)`). Cada cast em tile DIFERENTE é uma instância PRÓPRIA —
  `Fields` indexa por id de conteúdo, então o `sim` deriva o id por TILE
  (`fieldInstanceId`, `"<specId>@x,y,z"`); relançar a MESMA runa no MESMO tile reinicia, como
  `applyField` já documentava. Destroy Field (`HuntRuleset#destroyFieldAt`) recusa remover campo
  com `blocksMovement: true` — o mesmo corte que `destroy_field_rune.lua` faz ao listar só ids de
  fogo/veneno/energia, nunca Magic Wall (2128) nem Wild Growth (2130); a checagem de presença
  roda ANTES do gold sair, para não cobrar carga de uma remoção que falha (o Lua também só
  consome o uso em sucesso). Magic Wall usa a duração BASE do `items.xml` (20 s) como número
  fixo — o Lua sorteia `setDuration(16, 24)` por instância, e reproduzir isso exigiria um
  mecanismo de duração aleatória em `applyField` que esta issue não pede (desvio documentado).
  `scripts/catalog/monster-abilities.ts#CANARY_FIELD_ITEMS` ganhou `stages` para os três tipos —
  fechando o TODO(#560) que só o Dragon Lord tinha cadeia real: fire field (2118→2119→2120,
  a mesma cadeia do Dragon Lord) agora sai assim para TODO monstro gerado; poison (105) e energy
  (2122) declaram `stages` de um elemento só (redundante com `fieldStagesOf`, mas explícito).

**Fora do escopo**, por decisão: novo pathfinding, dispel, invisibilidade, PvP e a UI detalhada
de buff.

## Condição de velocidade com sinal — paralyze e haste de monstro (CMB-11, #556)

O #155 só tinha `haste`, sempre positivo (`speedPercent` inteiro positivo). O CMB-11 generaliza
o `ConditionEffect` de velocidade para `speed`, reproduzindo `ConditionSpeed` — a classe existe
tanto no Canary quanto no TFS (`src/creatures/combat/condition.cpp`), mas o mecanismo do `−40` e
do piso abaixo é só do CANARY (o TFS usa `baseSpeed` direto, sem deslocamento nem piso —
`monsters.cpp`); a precedência é a do ADR 0037 decisão 4. `type: 'haste' | 'paralyze'` é o nome
do Tibia, não derivado do sinal calculado, porque só ele decide o PISO — e uma magnitude por UMA
das duas formas, nunca as duas:

- **`delta`** (inteiro, em MILÉSIMOS): o formato do ATAQUE/DEFESA de monstro — o `speedChange`
  copiado sem conversão do Lua (`{ name = "speed", speedChange = -600, duration = 30000, target
  = true }` do mutated_rat; `speedChange = 400` do Doom Deer, como defesa self-haste). O `sim`
  deriva a MESMA fórmula que `Monsters::deserializeSpell` deriva sozinho: nunca menos que -1000
  ("Cant be slower than 100%"), `multiplier = 1 + delta/1000`, `mina = multiplier/2`,
  `maxa = multiplier`, `minb = maxb = 40`.
- **`formula`** (`{ mina, minb, maxa, maxb }`): o formato da RUNA/MAGIA, copiado direto do
  `setFormula` do Lua (a runa de paralyze usa `-1, 0, -1, 0`) — fora do escopo desta issue como
  CONTEÚDO real (a runa de paralyze do jogador é a M37-05), mas o mecanismo já existe para ela.

As duas convergem no MESMO cálculo (`resolveSpeedPercent`, `packages/sim/src/conditions.ts`):
`difference = baseSpeed − 40`; `min`/`max` são LINEARES nele e TRUNCADOS para inteiro — como o
C++ trunca ao atribuir um `float` a `int32_t`, nunca arredonda —; o resultado é sorteado INTEIRO
e inclusivo no intervalo com o `Rng` da sessão (`min === max` não consome sorteio, como
`uniform_random` do Canary não consome quando os limites coincidem); e o piso
(`speedDelta < 40 − baseSpeed`) é a MESMA trava do Canary — a escala do `speed` do Draconya já é
a do TFS (ADR 0037 decisão 4: Dragon 172, jogador 220), então "40" é o valor REAL do Canary, não
um número reescalado. `baseSpeed` é o `speed` do ALVO no instante da aplicação (o `mover.speed`
de `movement.ts`), como `Creature::getBaseSpeed()` lê o de quem recebe a condição.

**O piso vale SEMPRE, não só quando `type === 'paralyze'`.** No Canary o clamp é condicionado ao
`ConditionType_t`; aqui `type` é um campo de CONTEÚDO, e nada além de disciplina impediria um
`delta`/`formula` de sinal de paralyze rotulado por engano como `haste`. Sem o piso incondicional
isso produziria `speedDelta` arbitrariamente negativo e um `speedScale` NEGATIVO — que
`movement.ts` trata como velocidade zero (congelado), o oposto e pior do que o efeito rotulado.
O schema (`packages/content/src/schemas.ts`) reforça isso na origem com dois `.refine` sobre
`conditionEffectSchema`: `type` precisa concordar com o sinal de `delta` (`haste` exige > 0,
`paralyze` exige <= 0, como `Monsters::deserializeSpell` do Canary decide) e, para `formula`,
uma fórmula cujos quatro coeficientes só podem reduzir velocidade não pode ser `type: 'haste'`
(e vice-versa) — o caso real que motivou isto é a runa de paralyze (`-1, 0, -1, 0`) rotulada como
`haste`. O piso incondicional continua como rede de segurança para o caso de `formula` cujo sinal
não é estaticamente decidível pelo schema.

**A política `strongest` compara MAGNITUDE, não o valor com sinal.** `speedPercent` passou a ter
sinal com este efeito (paralyze é negativo); `strengthOf` (`packages/sim/src/conditions.ts`) usa
`Math.abs(speedPercent)` para a condição `speed`, senão um paralyze severo (`-80`) perderia para
um haste fraco (`+5`) numa comparação `strongest` — o inverso do que a política promete.

**A chave é RESERVADA** (`SPEED_CONDITION_KEY = 'speed'`, `packages/content/src/schemas.ts`):
`conditionSpecSchema` recusa `key` diferente de `"speed"` quando `effect.kind === 'speed'`. É o
que faz haste e paralyze de QUALQUER fonte — ability de ataque, defesa self-haste, magia futura —
se SUBSTITUÍREM inteiro um ao outro, sem lógica de exclusão mútua nova: `Conditions.apply` já
substitui por chave, e é a MESMA propriedade de `Creature::onAddCondition` do Canary/TFS
(aplicar `CONDITION_HASTE` remove `CONDITION_PARALYZE` e vice-versa) — só que aqui as duas
nascem no mesmo slot em vez de precisar de dois tipos que se removem.

`monsterAbilitySchema.condition` (CMB-07) já aceitava qualquer `ConditionSpec`, `speed`
inclusive — nenhuma mudança lá. `monsterDefenseSchema` ganhou `condition` como ALTERNATIVA a
`heal` (`buildContent` exige pelo menos um dos dois), para o self-haste de defesa; uma
`condition` de defesa só aceita `type: 'haste'` — uma defesa que paralisa a SI MESMA não é o
mecanismo que o bestiário observado usa.

**A haste do JOGADOR (as quatro magias de vocação e Swift Foot) não muda.** Elas continuam no
`spellEffectSchema`/`casting.ts` — um `kind: 'haste'` com `speedPercent` FLAT, sem relação com o
`conditionEffectSchema` do CMB-07/CMB-11 —, e o resultado delas é idêntico ao de antes desta
issue: nenhum arquivo de `data/spells/` mudou. As duas mecânicas produzem o MESMO campo de
runtime (`ConditionState.speedPercent`, lido por `Conditions.speedScale()`), mas por caminhos de
conteúdo diferentes — a #556 é sobre paralyze/slow e haste de MONSTRO (mecânica de caça, ADR
0037 decisão 6); unificar a haste do jogador com o mecanismo `delta`/`formula` do Canary é
trabalho novo, não coberto por esta issue, e fica registrado aqui como divergência PENDENTE, não
decidida — puxada por trabalho quando alguém precisar (ADR 0019 limite 3).

**O primeiro campo de conteúdo real é o do Dragon Lord (#520).** A ability `firefield`
(`data/monsters/dragon-lord.json`) não causa dano direto (`power: 0`) — ela só larga o campo,
círculo raio 4 (a tabela de anéis de MONSTRO, #523 — 21 tiles, não as `AREA_CIRCLEnXn` da
magia) centrado no alvo, com uma condição `damage-over-time` de 20 de fogo a cada 10 s. Desde o
M31-02 (#557) a condição usa a forma `rounds` — `{ rounds: [{ count: 7, intervalMs: 10000,
damage: 20 }] }`, a leitura direta de `count=7 damage=20 ticks=10000` do item 2118 do Canary —
em vez do `{ amount, intervalMs }` fixo de antes; o número final não muda (7 tiques iguais de 20
a cada 10 s, 70 000 ms de queima), só a forma no schema. `merge` também passou de `refresh` para
`strongest`, a regra real do Canary — sem efeito OBSERVÁVEL aqui porque o campo nunca persiste
condição no alvo (ver "Condições generalizadas..." acima: `#onFieldTick`/`#enterField`
recalculam a cada pulso), mas correto para quando uma ability aplicar a mesma condição direto
(`ability.condition`, sem campo).

**Dois números diferentes, duas fontes diferentes (achado da revisão do #536).**
`condition.durationMs` (70 000 ms) é a QUEIMA no personagem: Canary `items.xml` id 2118 declara
`ticks 10000`, `count 7`, `damage 20` — 7 tiques de 20 em 10 000 ms cada, 70 000 ms de queima
total, e esse número está certo. `field.durationMs` (200 000 ms) é o CAMPO NO CHÃO — quanto
tempo o próprio item 2118 existe antes de decair —, e é um número DIFERENTE: o mesmo id declara
`duration="200"`, que o Canary lê em segundos e multiplica por 1000 (`item.cpp`,
`newDuration = it.decayTime * 1000`) — 200 000 ms, não 70 000. Os dois valores coincidirem por
acidente na primeira versão desta issue era o defeito: o campo sumia do chão na metade do tempo
real, embora a queima em quem pisou nele estivesse certa.

**O Tibia real decai o campo em três estágios** (2118 → 2119, mais fraco, → 2120, sem dano) ao
longo de ~446 s no total; `FieldSpec` do Draconya é um campo só, sem decaimento por estágio —
usamos os números do estágio MAIS FORTE (2118) pelos 200 000 ms inteiros, em vez de simular a
cadeia. Um jogador que pisa tarde no campo do Tibia real levaria menos dano (estágio mais
fraco) e o campo sumiria mais cedo (a soma dos três estágios, não só o primeiro); aqui o campo
fica no chão os 200 000 ms cheios com a força do primeiro estágio o tempo todo.

## Drunk: desvio de passo (M31-03, #558, ADR 0041)

`Creature::onWalk` (`src/creatures/creature.cpp:291-301`) do Canary/TFS desvia o passo de quem
carrega `CONDITION_DRUNK`: a cada passo, sorteia `r = uniform_random(0, 60)` (61 valores, os dois
extremos inclusive); `r <= 4` (`DIRECTION_DIAGONAL_MASK`, `game/movement/position.hpp`) faz a
criatura falar "Hicks!", e só `r < 4` troca a direção do passo — para a CARDEAL do PRÓPRIO `r`
(`NORTH=0, EAST=1, SOUTH=2, WEST=3` no enum do Canary), nunca relacionada à direção que o passo já
ia tomar. `r === 4` representaria a diagonal `DIRECTION_SOUTHWEST` — o próprio Canary NÃO troca a
direção nesse caso (só fala); é o algoritmo dele que nunca pede uma diagonal aqui, não uma
limitação do Draconya, que TEM passo diagonal de criatura (`packages/sim/src/monster/step.ts`,
ADR 0009 — o passo guloso do monstro anda nas oito direções, e `movement.ts` cobra ×3 de duração
numa diagonal). Taxa observável: 4/61 (~6,6 %) de desvio de direção, 5/61 (~8,2 %) de fala.

**`rollDrunkDeviation` (`packages/sim/src/conditions.ts`) reproduz exatamente esse sorteio**, com
o `Rng` da sessão (`rng.integer(0, 60)`, inclusive nos dois extremos como o `uniform_random` do
Canary) — sem campo de conteúdo nenhum: o mecanismo INTEIRO é este sorteio, e por isso o efeito
`drunk` de `conditionEffectSchema` (`packages/content/src/schemas.ts`) não carrega parâmetro
próprio, só `kind: 'drunk'`. A ÁREA do ataque que aplica a condição (`radius`/`length`+`spread` do
Canary, ex. `{ name = "drunk", length = 5, spread = 0 }` do demon parrot) já é o `target.area` de
`monsterAbilitySchema` — o MESMO mecanismo de toda ability em área (#523); nada de novo precisou
entrar aí.

**A chave é RESERVADA** (`DRUNK_CONDITION_KEY = 'drunk'`, `packages/content/src/schemas.ts`), pelo
MESMO motivo de `speed`: o estado (`ConditionState`) da condição não tem nenhum campo de leitura
próprio — é `{ key, targetId, sourceId, expiresAtMs, merge }` e nada mais —, então nada além da
chave distingue "esta criatura está bêbada" de qualquer outra condição vazia. `Conditions.hasDrunk`
(`packages/sim/src/conditions.ts`) lê exatamente essa chave, como `hasManaShield` já lê
`'mana-shield'`.

**O desvio acontece em `HuntRuleset#step` (`packages/sim/src/rulesets/hunt.ts`), o ÚNICO lugar por
onde todo passo da hunt passa** — bot, monstro e o `walk` do socket (ver "Movimentação com
escritor único" nas notas de arquitetura do `sim`). `#drunkTarget` confere `Conditions.hasDrunk`
de quem vai andar (personagem OU monstro — os dois únicos tipos que `#step` recebe) e, se ativo,
sorteia e troca só x/y do destino a partir da posição ATUAL, preservando o `z` que o chamador já
resolveu; uma criatura sem drunk nunca chama `rollDrunkDeviation`, e por isso nunca consome esse
sorteio (a mesma disciplina do `chance` ausente de uma ability, CMB-06). Um tile desviado
bloqueado FALHA como `move()` já falha por qualquer outro motivo — sem tratamento especial: o bot
replaneja sozinho no vencimento seguinte, e um `walk` manual do jogador simplesmente não anda.

**Isso vale IGUAL para o passo conduzido pelo bot** (ADR 0041 decisão 3, invariante 11): como
`#step` é o mesmo choke point para o `walk` do socket, a rota do bot e o passo guloso do monstro,
não existe um caminho de automação que escape do desvio — o jogador embriagado sofre o mesmo
sorteio jogando manualmente ou automatizado. Excluir o bot seria dar à automação uma vantagem que
o jogo real não dá ao jogador manual, o tipo de assimetria que o invariante 11 proíbe.

**"Hicks!" (a fala da criatura) fica sem consumidor.** O Draconya ainda não tem evento de fala de
criatura no protocolo; `rollDrunkDeviation` devolve `speak` (verdadeiro sempre que `r <= 4`, mesmo
quando a direção não muda) para quando esse evento existir, mas hoje nada o lê. Isso é
apresentação, não regra de hunt (ADR 0037 decisão 6) — a divergência é aceitável e fica registrada
aqui, não no passo em si.

**Nenhum monstro do catálogo (`rat`, `rotworm`, `dragon`, `dragon-lord`) declara `drunk` hoje** —
é mecanismo puro, sem conteúdo real associado ainda (o ataque `drunk` é dos 77 usos do Canary,
concentrados em bosses de quest fora do recorte atual). `conditions.test.ts` prende a taxa exata
(4/61 de desvio, 5/61 de fala, com seed fixa e 61 000 rolagens) e o mapeamento `r → direção`;
`hunt.test.ts` prova a integração — o desvio passa pelo `#step` de verdade, para personagem e para
monstro, sem consumir sorteio de quem não tem a condição.

## Condições de controle: rooted, feared e pacified (#622, M44-04, ADR 0041)

As três últimas do vocabulário de condição do ADR 0041 decisão 1. Vivem no MESMO
`conditionEffectSchema`/`Conditions` do drunk e do speed — chave RESERVADA (`ROOTED_CONDITION_KEY`,
`FEARED_CONDITION_KEY`, `PACIFIED_CONDITION_KEY`, `packages/content/src/schemas.ts`), efeito sem
campo próprio (`{ kind: 'rooted' | 'feared' | 'pacified' }`) e as duas implicações conferidas por
`conditionSpecSchema` (a chave reservada só com o efeito dela, e vice-versa). Cada uma exige
**`merge: 'longest'`**, o quarto valor de `conditionMergeSchema` (`Condition::updateCondition` do
Canary, que as três — `ConditionGeneric` e `ConditionFeared` — usam): relançar com um prazo que
termina ANTES do que já corre não muda nada, e com um que termina no mesmo instante ou depois
substitui. Não é `refresh` (o novo sempre vence) nem `strongest` (compara magnitude, e estas não
têm). O prazo é absoluto dos dois lados (`Conditions.apply`).

**A vigência é lida do PRAZO**, não do evento que limpa a lista: `Conditions.isActive(key, nowMs)`
(`expiresAtMs > nowMs`, vencimento exclusivo) — o `condition-expire` vence depois do movimento e do
ataque do mesmo instante, e o Canary consulta `hasCondition` contra o `endTime`
(`Creature::hasCondition`, `creature.cpp:1585`), nunca contra a limpeza.

### `rooted` — ninguém dá passo

`Game::internalMoveCreature` recusa o passo de QUALQUER criatura enraizada (`game.cpp:1965`), e
`Creature::startAutoWalk` recusa a caminhada que ela decidir (`creature.cpp:329`). O `sim` tem UM
ponto de escrita de posição, `HuntRuleset#step`, e é lá que a recusa mora — o `walk` do socket, a
rota do bot, o passo guloso do monstro e o empurrão (`#pushAside`, que passa `forced`) caem todos
nela, com a razão nova `'rooted'` em `MoveRejection` (`movement.ts`). A recusa da caminhada PRÓPRIA
(`startAutoWalk`) vem antes de qualquer sorteio; só o passo forçado (a fuga do medo, o passo de um
`walk-to` já guardado) rola o drunk (`onWalk`) e depois esbarra no `rooted` de
`internalMoveCreature`. O `walk-to` distante de `requestMove` é recusado antes de guardar caminho
nenhum (`Runner.manualWalkTo`), e o que JÁ estava guardado quando a raiz chega CAI no primeiro passo
que ela recusa: `Creature::onCreatureMove` zera a lista de passos de quem está enraizado
(`resetMovementState`, `creature.cpp:503`) e `onCreatureWalk` já tira um passo da lista por
tentativa recusada — o caminho não resiste à condição, e nada anda sozinho quando ela acaba (o
bot retoma pelo tile mais próximo). Vale para monstro também — um monstro enraizado não persegue
—, e o empurrão que não consegue mover um monstro enraizado o esmaga, como o Canary
(`Monster::pushCreature` recusa igual).

### `pacified` — sem golpe e sem magia agressiva

É a trava de escada (seção anterior) e o Swift Foot. **Swift Foot** (`swift_foot.lua`, ramo sem a
Roda — a Roda está fora do recorte): acelera (`haste`) E aplica `CONDITION_PACIFIED` pelos mesmos
10 s. O `haste` do `spellEffectSchema` ganhou `pacifies: true`; `castSpell` devolve a pacificação em
`CastSuccess.alsoConditions` e o ruleset a aplica no mesmo alvo. O conteúdo deixou de carregar a
redução de 30 % de dano (TibiaWiki, anterior ao Canary `main`) — divergência que existia desde o
#523 e some aqui. O grupo de cooldown `attack` de 10 s que o script também aplica
(`CONDITION_SPELLGROUPCOOLDOWN`) não tem efeito próprio: toda magia desse grupo é agressiva, e a
pacificação já as recusa.

### `feared` — a caminhada forçada

**Não é "um passo sorteado como o drunk"**, ao contrário do que o plano do endgame supunha: é a
`ConditionFeared` do Canary (`condition.cpp:2163-2455`), e o RNG da sessão só entra num caso (o
tile do próprio lançador, abaixo). O mecanismo, na ordem em que acontece:

1. **A aplicação.** `Combat::CombatConditionFunc` recusa o medo (`checkFearConditionAffected`,
   `combat.cpp:1003`) quando o personagem está na imunidade de 10 s do medo anterior (11 s depois de
   um Cleanse — `Player::isImmuneFear`, o mesmo mapa `cleanseImmunity`, chave `feared`), quando já
   está com medo, e quando a party dele já tem gente demais com medo: `(membros + 5) / 5` de cada
   vez, em inteiro, contando os membros SEM o líder (o `memberList` do Canary não o inclui) e
   descontando os membros com medo agora — o líder com medo não desconta. Só o combate consulta
   (`fromCombat`); sozinho não há party. Só o PERSONAGEM entra nesse caminho: `forcePlayerAutoWalk`
   ignora qualquer criatura que não seja `Player`, então em monstro a condição é só o estado
   (nenhum conteúdo do Canary aplica medo a monstro) e o `condition-expire` a encerra.
2. **A direção de fuga** (`startCondition` → `getFleeDirection`, `fear.ts#initialFleeIndex`): cinco
   regiões pela posição do personagem relativa ao LANÇADOR (`fleeingFromPos`, gravado no estado da
   condição em `ConditionState.flee`), cada uma com o índice inicial do `m_directionsVector`. No
   MESMO tile do lançador sorteia com o `Rng` da sessão entre os vizinhos que aceitam o passo — e o
   Canary grava o VALOR do enum `Direction` como se fosse um índice do vetor (esquisitice preservada).
3. **O pensamento** (`FEAR_THINK`, `hunt.ts`). O Canary roda `executeCondition` uma vez por 1000 ms
   por criatura (`Game::checkCreatures`), numa fase sorteada ao entrar no jogo; aqui o pensamento é
   AGENDADO quando o medo começa, no próximo instante da grade de pensamento do personagem
   (`Runner.thinkPhaseMs`, a fase sorteada UMA vez com o `Rng` da sessão — a mesma grade que retoma o
   golpe depois de `pacified`) e se re-arma a cada 1000 ms (invariante 2: nada é relógio por
   criatura). Com MENOS de dois passos por dar (`getWalkSize() < 2` — a lista de passos do jogador é
   a MESMA da fuga, então um `walk-to` distante que já estava guardado conta: com dois passos ou
   mais ele continua e a fuga espera), escolhe a direção (se ainda não escolheu) e busca o caminho
   (`getFleePath`, `fear.ts#fleePath`): as distâncias `{15, 9, 3, 1}` na direção do índice, o
   primeiro caminho não vazio vale, e sem nenhum o índice avança um para o próximo pensamento. O
   ponto sintético mantém as esquisitices da fonte (o `SOUTH` cai do lado do `NORTH`, e os dois
   diagonais do norte miram o mesmo ponto: `fear.test.ts` fixa o resultado de cada índice num campo
   aberto).
4. **A caminhada** (`Runner.fearWalk`, `#advanceFearWalk`). A lista de passos SUBSTITUI a caminhada
   do próprio jogador (`forcePlayerAutoWalk` → `startAutoWalk` limpa `listWalkDir`, e o `walk-to`
   distante em curso cai) e é consumida um passo por vencimento de `PLAYER_STEP`, com PRIORIDADE
   acima de tudo (rota, combate-stop, follow); o personagem continua batendo em quem estiver ao
   alcance. Um passo recusado (parede, campo de dano, criatura) é DESCARTADO e o seguinte sai da
   posição em que ele ficou, sem replanejar. A lista vazia é o `Player::onWalkComplete`: se o medo
   ainda vale, reavalia a fuga na hora. `feared` recusa o INÍCIO do passo do PRÓPRIO jogador
   (`startAutoWalk`: o `walk` do socket e a rota do bot recebem `'feared'`), mas não a fuga nem a
   lista de passos que já corria (`forced`). Um passo de lista num campo que causa dano e não
   bloqueia é recusado em DOIS lugares, nesta ordem: `Player::onWalk` olha o campo do tile PEDIDO
   antes de tudo (`player.cpp:2942-2955`) — sem sorteio de drunk e sem desvio —, e
   `internalMoveCreature` olha o do tile DESVIADO depois dele (`game.cpp:1975-1980`); a fuga desvia
   do campo, nunca o atravessa.
5. **O fim** (o primeiro pensamento DEPOIS do prazo, `expiresAtMs < nowMs`). A ordem é a do Canary:
   a fuga é calculada, a condição fecha (a caminhada em curso para, `stopEventWalk`, e o personagem
   ganha 10 s de imunidade) e a lista que a fuga acabou de enfileirar roda DEPOIS — o jogador foge
   uma última lista inteira com o medo já encerrado. Não há `condition-expire` para o medo do
   personagem: o pensamento é quem o fecha, e por isso a condição continua no estado (com
   `isActive` falso) até esse pensamento. Consequência que é do Canary e não bug: uma oferta do
   mesmo medo nesse intervalo (a condição existe, `hasCondition` já é falso, a imunidade ainda não
   começou) o renova. **Troca de sessão (#812):** as três condições de controle atravessam como
   qualquer condição — prazo traduzido para o relógio da sessão nova, pausado na Cidade — e a hunt
   que entra as rearma: `rooted` e `pacified` com o `condition-expire` de sempre, o medo de
   personagem com um `FEAR_THINK` no próximo instante da grade de pensamento da sessão nova (e a
   fuga recalculada, porque a caminhada forçada é do runner e não atravessa).
6. **O que ele proíbe.** Nenhuma magia nem runa (`spells.cpp:104,503`, "You are feared" — razão
   `feared` em `CastRefusal`/`SlotRefusal`, retry no prazo do medo); a poção não passa por esse
   checklist e continua liberada. O equipar do Canary (`game.cpp:4191`) não tem equivalente numa
   hunt.

**A busca de caminho é original, e o que NÃO é reproduzível.** O Canary é GPL v2 (ADR 0019): a
versão anterior de `fear.ts` era uma transcrição do A* de `Map::getPathMatchingCond` — a lista de
vizinhos por direção do pai, o laço do melhor nó, a heurística — e foi retirada por violar o limite
de licença (revisão do #622). `fear.ts` entrega o que a busca do Canary ENTREGA: a caixa de sete
tiles em volta do personagem, andada em oito direções com custo 10 (cardinal) e 35 (diagonal) — a
diagonal sai mais cara que dois cardinais, e por isso o caminho é quase sempre em L e passa por
quina —, e o destino é o tile alcançável MAIS DISTANTE (Chebyshev) do ponto sintético, com visão
livre até ele e a até 30 tiles por eixo (`maxTargetDist`), o que faz a busca FUGIR do ponto; o tile
de partida entra na disputa (nenhum alcançável mais longe → lista vazia). É uma varredura de custo
mínimo seguida da escolha do destino, a mesma separação que `line-of-sight.ts` faz com o
`checkSightLine` do TFS.

O que o Canary não fixa é o DESEMPATE — a ordem em que o A* visita os nós, com o empate de total
decidido por uma versão do `getBestNode` que muda com o conjunto de instruções (AVX2/SSE) — e aqui
ele é uma escolha declarada: entre destinos à mesma distância do ponto vale o de menor
`custo + 8 × (|dx| + |dy|)`, e sobrando empate (e entre caminhos do mesmo custo) o de passos
"menores" na ordem oeste, leste, norte, sul e depois as diagonais (`STEP_ORDER`). Medido contra a
transcrição que saiu, em ~20 000 casos de campo com parede e visão aleatórias: o custo e o tamanho do
caminho coincidem em TODOS, o destino em ~98 % e o caminho inteiro em ~70 % (o resto são caminhos de
mesmo custo com a curva em outro passo); em campo aberto os oito índices coincidem sempre, e é isso
que `fear.test.ts` fixa. O primeiro passo forçado cai no próximo `PLAYER_STEP` (no máximo um passo
depois do pensamento), em vez do `getEventStepTicks` do Canary — o cadenciador do passo do `sim` é o
próprio `PLAYER_STEP`, e um relógio de passo à parte dobraria o estado persistido. Nenhuma das duas
coisas muda QUANDO o medo dispara ou acaba — o gatilho é o do Canary.

### Imunidade por monstro e Cleanse

`monster.conditionImmunities` (`CONDITION_IMMUNITIES`) ganhou `rooted`, `feared` e `pacified` — o
vocabulário sobe de onze para catorze nomes. É vocabulário AUTORAL: `Monster::isImmune` é um bitset
sobre todo `ConditionType_t`, mas a ponte do Lua só nomeia os que já existiam, e nenhum monstro do
bestiário declara imunidade a estes três (`conditionImmunityOf`, `conditions.ts`, mapeia a chave
reservada para o nome). Vale pelo mesmo portão de sempre (`#applyConditionTo`, só quando o
chamador é um COMBATE).

O Cleanse (#603, `combat-v4`) limpa `rooted` e `feared` (`Creature::getCleansableConditions`,
`creature.cpp:1527-1549` — `pacified` não), com a mesma imunidade de 11 s por tipo; limpar o medo passa
por `#endFear`, que para a caminhada e nunca deixa a imunidade menor que a do Cleanse (o Canary
grava 10 s no `endCondition` e 11 s logo depois).

### O que vem do Canary (importador)

`fear` e `root` são feitiços Lua de nome próprio (`data-otservbr-global/scripts/spells/monster/
fear.lua`/`root.lua`) que o Canary acha por nome em `deserializeSpell` e usa SEM ler a linha do
monstro além de `interval`, `chance`, `range` e o alvo: alvo único, 3000 ms fixos, sem dano. O
importador (`scripts/catalog/monster-abilities.ts#mapControl`) os mapeia para a ability `fear`/`root`
com `power: 0` (o mesmo desenho do drunk) e `merge: 'longest'`; entraram no catálogo o Fungosaurus,
o Gore Horn e o Branchy Crawler (os três só eram bloqueados por isto). O `soulwars fear` continua
sem mapeador — o Lua o executa com atraso de 2 s por `addEvent`, e a ability não tem atraso.
Continuam de fora, por outras magias, o Doctor Marrow e o Mitmah Vanguard.

**Parâmetros e onde moram.** A duração (3000 ms) e o `merge` são conteúdo de cada ability/runa; o
pensamento (`CREATURE_THINK_INTERVAL_MS`, 1000) e a imunidade natural (`FEAR_IMMUNITY_MS`, 10 000)
são constantes do Canary em `hunt.ts`; a busca (`{15, 9, 3, 1}`, 7, 30, custos) e o vetor de direções
moram em `packages/sim/src/fear.ts`.

## Cura de condição (dispel, #590)

Cure Poison, Cure Burning, Cure Electrification, Cure Bleeding e Cure Curse (Canary
`data/scripts/spells/healing/cure_*.lua`) e a Antidote Rune (`data/scripts/runes/
antidote_rune.lua`) removem uma condição do lançador — nada mais. É a metade "remove" da mecânica
de condição do CMB-07: a metade "aplica" já existia (haste, postura, magic shield, cura ao longo
do tempo, DOT); faltava como um efeito TIRA uma dessas do próprio personagem.

- **`kind: 'dispel'`** é um efeito NOVO de `spellEffectSchema`/o `effect` do `supplySchema`:
  `{ kind: 'dispel', types: string[] }` — sem sorteio, sem cura, sem mira. `types` são as MESMAS
  chaves de `ConditionState.key` que `field.condition.key` já usa em conteúdo real (`"burning"`
  no Dragon Lord) — vocabulário livre de string, não um enum fechado no schema. Uma magia com
  `types: ["poison", "burning"]` removeria as duas de uma vez, embora nenhuma do catálogo real o
  faça hoje (cada Cure X do Tibia remove uma condição só).
- **`heal` ganhou um campo `dispel` opcional** (`{ types: string[] }`), para a cura COMPOSTA que o
  Canary tem (Fair Wound Cleansing, Nature's Embrace, Restoration: cura E remove
  `CONDITION_PARALYZE` no mesmo lançamento). Na época do #590 o Draconya ainda não modelava
  paralisia, e nenhum conteúdo real usava o campo — o #592 (com o `paralyze` do #556 já em pé)
  ligou o `dispel: { types: ['paralyze'] }` em TODA cura real do catálogo cujo script do Canary
  declara `COMBAT_PARAM_DISPEL, CONDITION_PARALYZE` ao lado da cura: Light/Intense/Ultimate
  Healing, Heal Friend, Divine Healing, Salvation, Wound Cleansing, Intense Wound Cleansing,
  Bruise Bane, Magic Patch, Mass Healing e as runas Intense/Ultimate Healing — praticamente toda
  cura do jogo, exceto a Cidade genérica pré-vocação (`heal.json`, fora da conformidade Canary).
  Mass Healing (cura em ÁREA) dispensa cada ALIADO curado, não só o lançador — o `result.dispel`
  do lançamento cobre só o recipiente único, então `#castSpell` (`sim/rulesets/hunt.ts`) repete o
  dispel por aliado no mesmo laço que já cura cada um.
- **`castSpell`/`useSupply` devolvem as chaves a remover** (`CastSuccess.dispel`), nunca removem
  em si — a mesma divisão da `condition` que uma magia de haste devolve: só o ruleset tem a fila
  de eventos (`condition-expire`/`condition-tick`) para cancelar. `HuntRuleset.#dispelConditions`
  é quem de fato chama `Conditions.remove` e cancela os dois eventos, por CHAVE — ao contrário de
  `#cancelConditions` (morte/saída), que zera TUDO, aqui só as chaves declaradas saem: Cure
  Poison remove o poison e não toca o burning do mesmo personagem.
- **Chave ausente no alvo não é erro.** A magia sai (gasta mana, entra em cooldown) mesmo sem
  nada para remover — a mesma filosofia de recusa tipada de `castSpell`: só a AÇÃO é recusada por
  algo, nunca o efeito por não ter alvo a limpar.
- **Antidote Rune é self-target só, nesta primeira versão** (desvio do Canary, que permite mirar
  qualquer criatura à distância com `allowFarUse`/`needTarget`): estender o alvo `friend` para o
  efeito `dispel` tocaria `#healRangeOf`/a resolução de candidato do bot, fora do recorte de uma
  issue sobre CURAR condição. Fica registrado para uma issue futura, se um suprimento de dispel
  em aliado for pedido.
- **Cure Poison é a QUARTA magia genérica** (sem `vocationId`): o Canary a dá para todas as
  vocações do jogo (o Draconya não tem monge), como `heal`/`strike`/`blast` já eram as três
  genéricas pré-vocação. Cure Bleeding tem DUAS linhas de catálogo (`cure-bleeding-druid`/
  `cure-bleeding-knight`), como `recovery-knight`/`recovery-paladin` já fazem para a mesma magia
  em duas vocações — o Canary a dá para Druid E Knight, não uma só.

## Imunidade de condição, invisibilidade e a Paralyze Rune (M31-04, #559/#592, ADR 0041 d.2)

O #556 deu à condição `speed` o sinal (paralyze/haste); faltava o monstro poder ser IMUNE a ela, e
faltava a invisibilidade — do jogador e do monstro — existir. As duas issues (#559, a
generalização; #592, o conteúdo jogável: Paralyze Rune, Invisibility, Cancel Invisibility) saíram
juntas na mesma PR porque uma não fecha sem a outra: a runa do jogador precisa de monstro que
possa ser imune para o teste de aceite fazer sentido, e a imunidade sem conteúdo que a exercite é
mecanismo morto.

- **`Monster.conditionImmunities`** (`packages/content/src/schemas.ts`) é o `monster.immunities`
  do Canary com `condition = true` (`Monster::isImmune`, `src/creatures/monsters/monsters.hpp`) —
  distinto da imunidade de DANO (`mitigation.immunities`, `combat = true`), que já existia. **Onze
  nomes, o vocabulário do ADR 0041 d.1** (`CONDITION_IMMUNITIES`): `paralyze`, `drunk`, `invisible`
  e as oito DOTs — `bleeding`, `poison`, `burning`, `electrified`, `cursed`, `drowning`,
  `freezing`, `dazzled`. O importador (`scripts/catalog/monsters.ts`, `CONDITION_IMMUNITY_MAP`)
  traduz os nomes do Lua pela tabela de `luaMonsterTypeConditionImmunities` do Canary
  (`monster_type_functions.cpp:915-968`): `bleed`/`physical` → `bleeding`, `fire` → `burning`,
  `ice` → `freezing`, `poison`/`earth` → `poison`, `energy` → `electrified`, `holy` → `dazzled`,
  `death` → `cursed`, `drown` → `drowning`, `invisibility` → `invisible`. Só `outfit` (119 monstros
  imunes) fica de fora até o M44-03 trazer a condição, e o importador o reporta em
  `ignoredFields` por NOME. Dos monstros do Canary, só 14 declaram uma DOT imune (`bleed` ×12,
  `fire` ×1, `ice` ×1) e 6 `drunk`; as 1 244 imunidades a `paralyze` e 1 385 a `invisible` são a
  maioria. Ausente é `[]`: todo monstro sem a entrada continua sem imunidade nenhuma, bit a bit.
- **O ponto de bloqueio é ÚNICO** — `HuntRuleset#applyConditionTo` (`sim/rulesets/hunt.ts`), o
  mesmo lugar que já recusa `drunk` por anel (#688), com a tradução condição → imunidade em
  `conditionImmunityOf` (`sim/conditions.ts`). `paralyze` é um caso à parte: a condição vive
  na chave RESERVADA `speed` (haste e paralyze dividem o slot, CMB-11), então só o sinal NEGATIVO
  é bloqueável — a imunidade nunca impede o PRÓPRIO monstro de se acelerar. `drunk` casa direto
  pela chave; a **DOT** casa pelo `damageType` do tique (`DAMAGE_OVER_TIME_CONDITION_IMMUNITY`,
  a `Combat::DamageToConditionType` do Canary), então Inflict Wound (`physical`) não sangra um
  monstro imune a `bleeding`, Ignite (`fire`) não queima um imune a `burning`, e a imunidade é
  POR condição — `burning` não protege de veneno. **O portão é opt-in do chamador**
  (`#applyConditionTo(..., fromCombat)`): só a magia/runa (o DOT de `#castSpell`, a Paralyze Rune
  de `#useSupply`) e a ability de monstro o ligam, porque no Canary `Combat::CombatConditionFunc`
  (`combat.cpp:1079`) é o ÚNICO chamador de `Monster::isImmune(ConditionType_t)` que BLOQUEIA uma
  condição (`Monster::canSeeInvisibility` a lê também, `monster.cpp:304`, mas para outro fim).
  O que entra por `Creature::addCondition` direto — que só confere `isSuppress` — não consulta a
  imunidade, e um chamador novo e não combativo nasce SEM o portão: o **campo de tile**
  (`MagicField::onStepInField`; `FIELD_TICK` tiqueta sem passar por aqui, e o que zera o dano do
  campo é a imunidade de DANO, que já existia), a **defesa que o monstro aplica em si**, e os
  charms Cripple/Numb do Bestiário (`iobestiary.cpp:105-109`/`:144-152`: uma `ConditionSpeed`
  paralyze adicionada ao monstro sem checar imunidade — Dragon Lord e as outras 1 244 imunidades
  a `paralyze` continuam paralisáveis por eles). Dentro do combate, **`caster == target` pula a
  checagem** (a auto-aplicação nunca é barrada — `condition.sourceId === target.subject`).
  **`invisible` NUNCA entra neste portão**: no Canary, a MESMA imunidade que
  bloquearia a condição em qualquer outro caso é repropositada —
  `Monster::canSeeInvisibility() { return isImmune(CONDITION_INVISIBLE); }` — para "este monstro
  ENXERGA quem está invisível", nunca "este monstro não pode ficar invisível". Bloquear a
  aplicação teria o efeito ABSURDO de um Killer Rabbit com `canSeeInvisibility` não conseguir
  usar a própria defesa de invisibilidade.
- **`seesInvisible(definition)`** (`sim/monster/monster.ts`) é só `conditionImmunities.includes
  ('invisible')` — uma função, não um campo de schema separado, para não haver dois lugares
  guardando o mesmo bit. **Um monstro sem a imunidade nunca ESCOLHE quem está invisível** — o
  `Monster::isTarget` do Canary exige `canSeeCreature` — e isso vale em TODOS os caminhos que
  escolhem alvo: a aquisição "mais perto" e o ramo estreito da estratégia ponderada (#645) em
  `chooseTarget`, o sorteio do `targetChange` (`#onMonsterTargetChange` → `searchTarget`) e a
  Provocação (`Monster::challengeCreature` → `selectTarget` → `isTarget`: um lançador invisível
  não provoca quem não o vê, e a fuga do monstro segue valendo). `Prey.invisible` (opcional,
  ausente é `false`) é o campo que `CharacterRuntime` e `MonsterRuntime` expõem via
  `Conditions.hasInvisible()` — o envelope da invocação de personagem também o carrega.
- **Largar o alvo que ficou invisível tem TIMING, e o timing é o do Canary** — `Creature::onThink`
  (`creature.cpp:130-140`) confere `canSeeCreature(attackedCreature)` UMA vez por
  `EVENT_CREATURE_THINK_INTERVAL` (1000 ms, `creature.hpp:47`), numa fase por criatura sorteada em
  `Game::addCreatureCheck` (`game.cpp:7672`). Até o próximo think o monstro segue com o alvo — e
  ataca. O sim não tem relógio de think por criatura (seria um evento por criatura por segundo,
  invariante 2), então o think é AGENDADO quando a invisibilidade COMEÇA (`#applyConditionTo`,
  não na renovação): cada monstro que perseguia o invisível e não o enxerga ganha UM evento
  `visibility-think` em `[0, 1000)` ms (sorteio da sessão — a mesma distribuição da fase do
  Canary), e o alvo cai nesse instante se ainda estiver invisível (`#onVisibilityThink`; alvo que
  já mudou, morreu ou reapareceu não é largado — a checagem é a do instante do think). O
  `chooseTarget` NÃO larga por conta própria: ele roda a cada passo do monstro e largaria antes do
  Canary (a versão da #592 largava na hora).
- **O bot do jogador nunca mira monstro invisível**, na direção oposta: `targeting.ts`
  (`selectTarget`/`countTargets`/`countAreaTargets`) ganhou o mesmo filtro em `TargetLike.
  invisible`, que `MonsterRuntime.invisible` expõe. Não existe "o jogador vê invisível" (`Player::
  canSeeCreature`, `player.cpp:1418`: só GM/`CanSenseInvisibility` vê) — só monstro tem a
  imunidade —, então a checagem aqui é incondicional: um monstro que ficou invisível sozinho (a
  própria defesa, abaixo) some do alcance do bot até a condição vencer. **O alvo ELEITO pelo bot
  (`botCandidate`, `attackTarget` não fixado) cai na hora** — o targeting do bot é do Draconya
  (ADR 0037 d.2) e a eleição nunca escolhe um invisível —, **enquanto o alvo FIXADO pelo jogador
  segue até o think agendado** (`#scheduleVisibilityThinks` agenda um para o personagem): até lá o
  golpe dele ainda sai e REVELA o monstro (abaixo). **O alvo eleito que fica invisível é limpo NO
  EVENTO em que a invisibilidade começa** (`#scheduleVisibilityThinks`), e os leitores do alvo
  (`#attackTargetOfRunner`/`#botCandidateOf`) devolvem `null` SEM escrever para o invisível não
  fixado: eles são alcançáveis da apresentação (`slotStates`, só com visualizador anexado), e o
  campo que o snapshot guarda não pode depender de alguém estar olhando (invariante 3).
- **A mira MANUAL num monstro invisível é um substituto de apresentação, não uma regra do
  Canary.** No Canary a proteção é do lado do CLIENTE: `ProtocolGame::canSee`
  (`protocolgame.cpp:2381`) e as descrições de tile (`:2171`, `:2253`) descartam a criatura que
  `Player::canSeeCreature` (`player.cpp:1409-1422`) não enxerga, então não há o que clicar — o
  servidor não confere visibilidade nenhuma em `Game::playerSetAttackedCreature`
  (`game.cpp:7001-7031`) nem em `Game::playerUseWithCreature` (`game.cpp:4853-5026`). O que ele
  decide é o TILE
  (`Spell::playerRuneSpellCheck`, `spells.cpp:704`): a runa que precisa de alvo (`needTarget`:
  Sudden Death, Fireball, Paralyze…) recusa o tile sem criatura VISÍVEL
  (`CANONLYUSETHISRUNEONCREATURES`), e a que não precisa (Great Fireball, Avalanche, os campos)
  sai igual e atinge quem estiver lá, invisível inclusive — revelando-o. O cliente do Draconya
  ainda DESENHA o monstro invisível (a apresentação não some com ele), então o clique nele chega:
  `setAttackTarget`/`select-target` (host: `target-cancel`) e a mira de efeito de ALVO ÚNICO
  (`use-slot`/`use-item-on`: dano ou DOT sem forma) o recusam `no-target`, e o efeito de
  ÁREA/campo mira o TILE do monstro (`#resolveManualTarget`), como o jogador faria ali. É a
  única recusa server-side desta seção; a matemática nos dois casos é a do Canary.
- **O monstro invisível que leva dano REAL volta a ficar visível** — `Monster::drainHealth`
  (`monster.cpp:3454`: `if (isInvisible()) removeCondition(CONDITION_INVISIBLE)`), o cano de TODO
  dano de vida que um monstro sofre e que só é alcançado com `realDamage > 0`
  (`Game::combatChangeHealth`, `game.cpp:8735`). No sim é `#drainMonster(session, monster,
  outcome, attacker)`, o cano ÚNICO do dano de vida num `MonsterRuntime` — golpe, magia/runa,
  tique de DOT e de campo, reflexo, golpe de invocação —: ele aplica o `applyDamageOutcome` e, com
  `healthDamage > 0`, arma o bypass de campo (`ignoresFieldDamage`, o outro efeito do
  `drainHealth`) e revela o monstro; um ponto novo de dano num monstro entra por ele, e não pelo
  `applyDamageOutcome` direto. Dano integralmente absorvido/bloqueado ou `manadrain` não revela
  ninguém. A remoção passa por `#dispelConditions`, que cancela o `condition-expire` pendente.
  **A invisibilidade do JOGADOR não cai por dano**: o
  Canary só tem esse comportamento em `Monster::drainHealth` (no motor, `src/`, só duas chamadas
  de `removeCondition(CONDITION_INVISIBLE)` existem: essa e o desequipar de item) — cai por prazo,
  por Cancel Invisibility ou pelo equipamento. É o que faz o Killer Rabbit (e ~107 monstros com a
  defesa `invisible`) voltar a ser golpeável: o jogador que o tinha fixado ainda o acerta no
  intervalo do think, e uma magia de área o acerta a qualquer momento.
- **`invisible` é um `ConditionEffect` novo** (chave reservada `INVISIBLE_CONDITION_KEY =
  'invisible'`, sem campo além do prazo — o mesmo desenho de `drunk`/`mana-shield`), com DOIS
  pontos de entrada:
  - **Spell do jogador** (`spellEffectSchema.kind: 'invisible'`, `{ durationMs }`): Invisibility
    (Canary `data/scripts/spells/support/invisible.lua`, level 35, 440 mana, 200 s, Druid E
    Sorcerer — dois arquivos de conteúdo, `invisibility-druid`/`invisibility-sorcerer`, a mesma
    duplicação de `light-healing-druid`/`-paladin`). `castSpell` a resolve como `mana-shield`
    (self, sem `SpeedContext` nenhum) — a chave reservada é o que `Conditions.hasInvisible`
    reconhece depois.
  - **Defesa de monstro** (`monsterDefenseSchema`, `invisible` somado a `DEFENSE_SELF_CONDITION_
    KINDS`): o Killer Rabbit e ~107 outros do bestiário (`{ name = "invisible", interval, chance,
    effect }` em `monster.defenses`) ficam invisíveis SOZINHOS — `scripts/catalog/
    monster-abilities.ts` tinha esse nome em `UNMAPPED_OWNERS` (excluindo o monstro inteiro do
    catálogo); `mapInvisible` agora o mapeia, restrito a `defenses` (o Canary nunca usa em
    `attacks` — o oposto de `drunk`, que só existe do lado do ATACANTE). Sem `duration`
    declarado, cai no mesmo default de 10 s que `speed`/`drunk` já usam.
- **Cancel Invisibility** (paladin, level 26, 200 mana, Canary `data/scripts/spells/support/
  cancel_invisibility.lua`) é `kind: 'dispel'` com `area` NOVO (`{ shape: 'circle', radius: 3,
  centered: 'caster' }`): o `AREA_CIRCLE3X3` do Canary (`data/scripts/lib/register_spells.lua:
  372-380`) é o círculo de RAIO 3, os 37 tiles em linhas 3/5/7/7/7/5/3 que "Magia em área"
  descreve e que o Mass Healing já usa — o "3X3" do nome é o raio, não o lado (a #592 o
  copiou como raio 1, 9 tiles, e a #559 corrigiu). `dispel.area` é sempre centrado no LANÇADOR
  (`buildContent` recusa o resto, como a cura em grupo); `#castSpell` entra pelo ramo self-origin
  de `#aimFor` — o mesmo que já colhia MONSTROS para dano em área — e dispensa os MONSTROS
  colhidos, em vez do recipiente único de sempre. **O lançador NÃO é dispensado**, nem os
  aliados: `Combat::CombatFunc` (`combat.cpp:1562`/`1610`) só inclui o lançador quando
  `!params.aggressive`, e o `combat` do script nunca chama `COMBAT_PARAM_AGGRESSIVE` — o
  `spell:isAggressive(false)` é o `Spell::aggressive` do portão de proteção, outro campo —, então
  vale o default do Canary (`CombatParams::aggressive = true`, `combat.hpp:106`): `caster !=
  creature`. Outro jogador só entraria pelas regras de PvP (`canDoCombatWithExpertPvp`), que a
  hunt não tem (invariante 8: instanciada, PvE). Um Paladin invisível pelo Invisibility segue
  invisível depois do próprio Cancel Invisibility.
- **A Paralyze Rune** (Druid, level 54, magic level 18, Canary `data/scripts/runes/
  paralyze_rune.lua`: `runeId(3165)`, `setFormula(-1, 0, -1, 0)`) é o primeiro supply a mirar um
  MONSTRO com uma condição — até aqui, `kind: 'condition'` (as quatro poções de postura) era
  SEMPRE auto-alvo. `supplySchema.effect` ganhou `target: 'enemy'` + `range` (a mesma forma de
  `kind: 'damage'`): `useSupply` (`sim/casting.ts`) faz o MESMO portão da runa de ataque —
  level/vocação/magicLevel, alvo, alcance, só então o gold — e resolve `conditionFromSpec` com o
  `SpeedContext` do ALVO (`SpellTarget.speed`/`creatureId`, dois campos novos que `HuntRuleset
  #collect` preenche do `MonsterRuntime`), não do usuário: a fórmula `-1, 0, -1, 0` sorteia sobre
  a velocidade BASE de quem é atingido, como `ConditionSpeed::startCondition` do Canary sempre
  fez. `#useSupply` (o wrapper do ruleset) aplica a condição ao MONSTRO mirado, não ao personagem
  — a primeira vez que essa divisão importa, porque toda condição de supply anterior era self.
- **Cooldown PRÓPRIO, além do grupo** (achado da auditoria de #556/#557 sobre a matemática do
  Tibia, 2026-09-26): a Paralyze Rune tranca `group:support` por 2 s COMO qualquer supply do
  grupo, e ADICIONALMENTE `supply:paralyze-rune` por 6 s — os dois trancam juntos, e os dois
  precisam vencer para o próximo uso. Até aqui `supplySchema` só tinha `groupCooldownMs`
  ("o supply não tem cooldown individual separado", o comentário que este campo revoga);
  `cooldownMs` é o novo campo OPCIONAL, e `supplyCooldownKey` (que já existia, mas nunca era
  iniciada por nada — só CONSULTADA pelo caminho manual de `#groupOrIndividualWaitOf`, #726) passa
  a ser iniciada por `startSupplyCooldown` quando o supply o declara. Um supply sem `cooldownMs`
  continua exatamente como antes: só o livro do grupo.
- **Fora do escopo** (§12, como toda spec): `outfit` em `conditionImmunities` (o M44-03 traz a
  condição) e a extração AUTOMÁTICA de imunidade de DOT a partir de `mitigation.immunities` (o
  Canary não a deriva — `immunities` de dano e de condição são listas independentes no Lua); a
  Paralyze Rune com `area` (o Canary não a tem); o `invisible` de `monster.attacks` (só o Tirecz,
  chefe de quest, o declara — o resto está em `defenses`); a invisibilidade por EQUIPAMENTO
  (`movement.cpp:564`, o item que a dá) e a magia do jogador em si (M37-05); a **apresentação**:
  o Canary não envia o monstro invisível ao cliente (`Game::internalCreatureChangeVisible`), e o
  cliente do Draconya ainda o desenha — a matemática (alvo, dano, revelação) já é a do Canary, só
  a tela não some com ele; a invocação de personagem herda o alvo do mestre
  (`#chooseMonsterTarget`) sem passar pelo think de visibilidade — nenhum monstro do catálogo é
  `summonable` ainda (#598).

## O Dragon e o Dragon Lord (#520): a primeira ability wave/circle/defesa/fuga de verdade

O #518 desenhou o mecanismo; o #520 é quem o usa pela primeira vez em conteúdo real, e por isso
os exemplos deste documento (`staticAttack: 0,8`, `runOnHealth: 300`) já citavam o Dragon antes
de ele existir. `data/monsters/dragon.json` e `dragon-lord.json` declaram: `melee` (id reservado
diferente de `basic` — abilities declaradas substituem a básica do boot, não somam a ela),
`fireball` (círculo raio 4 centrado no alvo — 21 tiles pela tabela de anéis de MONSTRO do #523,
`MONSTER_CIRCLE_HALF_WIDTHS[3] = [5,5,3]`, não os 69 que a fórmula de MAGIA daria para o mesmo
raio; achado da revisão do #536, que também corrigiu `applyField` — o campo de fogo do Dragon
Lord usava a tabela errada por padrão e cobria 69 tiles em vez de 21, ver "Condições
generalizadas..." acima), `firewave` (onda `rows [1,1,3,3,3,5,5,5]` — o `setupArea(8, 3)` do Canary, 26 tiles desde o
#679 —, sem alvo — sai do
monstro na direção de quem ele mira) e `heal` (defesa). `mitigation.immunities` só cobre `fire`
— desde o CMB-11 (#556) existe MECANISMO de `paralyze` (a condição `speed`, ver abaixo), mas
nenhum monstro do recorte o declara em `mitigation.immunities`: a IMUNIDADE por condição é a
M31-04 (#559, já fechada — ver "Imunidade de condição, invisibilidade e a Paralyze Rune" abaixo).
Pela mesma razão, os flags `canPushItems`/`canPushCreatures`/`isBlockable` do Canary
(`monster.flags`) não existem no schema — ficam registrados aqui como o que falta ao motor, não
implementado por esta issue. A `strategiesTarget` ponderada (nearest 70 % / health 10 % / damage
10 % / random 10 %) deixou de ser divergência de CONTEÚDO com o #541: `monster.targetStrategy`
existe no schema, e Dragon/Dragon Lord já declaram os mesmos quatro pesos. Desde o #645 (ADR
0037 d.6) o GATILHO também é o do Canary — `rankTarget` só entra no ramo estreito de fuga
bloqueada, não mais nos dois vencimentos de sempre — ver "Seleção ponderada de alvo" acima.

## Outcomes avançados: crítico, leech e mana shield (CMB-08, #335)

O CMB-02 devolvia um outcome; o CMB-04 tornou a defesa um estágio; o CMB-08 completa o resultado
com os modificadores aprovados e torna a **absorção de mana** um estágio visível. Nada disso
recalcula dano fora do resolver canônico, e nada entra no snapshot nem no S2C (DT-03).

### A ordem em `combat-v1`/`v2`, congelada na emenda do ADR 0031

```text
raw power
  -> Dodge (1º sorteio, sempre)
  -> defesa/escudo (2º sorteio, só com fonte elegível e tipo aprovado)
  -> crítico (3º sorteio, só quando `modifiers.critical` é declarado)
  -> armadura -> piso -> resistência -> imunidade
  -> corte do Dodge -> multiplicador do crítico -> arredondamento
```

As três posições de sorteio são contrato PARA `combat-v1`/`v2` — perfis antigos, mantidos bit a
bit para sessão nenhuma quebrar. O crítico é o **último** multiplicador ali. Em `combat-v3`
(M30-04, abaixo) a posição é OUTRA, e fiel ao Canary: ver "O pipeline de recebimento do
combat-v3" mais acima.

### Defaults neutros: a ausência preserva o v1

`combat.modifiers` é **opcional**, e a ausência é o default neutro:

- **sem `modifiers`, nenhum sorteio novo é consumido** e o resultado é bit a bit o do
  CMB-02/03/04 — a sequência de RNG inclusive. Todo conteúdo que não declara modificador segue
  idêntico, e é o que o `damage.test.ts`/`conformance.test.ts` prendem;
- **`critical` declarado consome UMA rolagem mesmo com `chance: 0`**, como o bloqueio do CMB-04:
  a sequência não depende do VALOR;
- `lifeLeech`/`manaLeech` são fração do HP aplicado e **não consomem RNG**.

O default neutro é do CÓDIGO, não do conteúdo real: o `baseline.json` declara `critical` (5 %, ×1,1)
desde o #603, então todo golpe, magia e runa do `combat-v4` consome a rolagem de crítico; o leech
segue sem declaração.

### Leech: base, fórmula, clamp e evento

- A base é o **HP efetivamente removido** (`healthDamage`), nunca o resolvido: overkill não rende
  leech, e dano absorvido pela mana não rende leech nenhum.
- `lifeLeechApplied`/`manaLeechApplied` são o que de fato entrou — a vida limitada ao teto, a
  mana ao espaço livre. Atacante cheio informa zero, e o `creature-healed` de leech **não sai**:
  o número verde não mente.
- **A fórmula (M30-04, #551) é `Game::calculateLeechAmount` do Canary** (`game.cpp:9058`), não
  uma fração direta: `realDamage × leechFraction × (0,1 × n + 0,9) / n`, arredondada
  (`std::lround`, meio para cima — `Math.round`) e limitada a `[0, realDamage]`, onde `n` é
  `targetsAffected` — o total de criaturas que a MESMA ação atingiu (`damage.affected` do
  Canary), não só as elegíveis a leech. Para `n = 1` o fator vale exatamente `1` — o golpe de
  alvo único de sempre, e a fórmula reduz à fração pura. Para `n = 5` vale `0,28`, **não** `0,2`:
  uma magia em área rende, POR ALVO, mais que um quinto do que renderia sozinha — a "divisão
  pelos alvos" é a descrição solta do produto, o número real vem da fórmula. Vive em
  `calculateLeechAmount`/`applyLeech` (`packages/sim/src/combat/modifiers.ts`), compartilhada
  entre o golpe de alvo único (`applyDamageOutcome`, `targetsAffected` `1` por padrão) e a magia
  em área (`HuntRuleset#applyHits`, um `targetsAffected` só para todos os alvos da MESMA mira).

### Mana shield como estágio visível (DT-02)

A absorção de mana saiu de `CharacterRuntime.receiveDamage` e virou um estágio de
`applyDamageOutcome`, com `absorbedByMana` no outcome. A semântica é a de sempre: o escudo
absorve até onde a mana alcança e **continua ativo até vencer mesmo com mana zero**. Absorção
total dá `healthDamage` 0 — sem morte, sem contribuição de HP e sem `creature-hit` positivo.

```ts
interface AppliedDamageOutcome extends DamageOutcome {
  readonly absorbedByMana: number;   // quanto a mana shield absorveu
  readonly healthDamage: number;     // o que saiu da VIDA (hit e contribuição)
  readonly lifeLeechApplied: number; // vida de fato reposta no atacante
  readonly manaLeechApplied: number; // mana de fato reposta no atacante
}
```

O `critical` vive no `DamageOutcome` base, porque é o resolver quem o decide. O
`AppliedDamageOutcome` é **efêmero**: não vai ao cliente nem ao snapshot, e existe para o host e
o extrato conseguirem auditar o golpe sem recalcular (DT-01).

### Telemetria e apresentação

- `creature-hit` carrega o **APLICADO** (`healthDamage`), nunca o raw nem o overkill; a
  contribuição e o `recordDamage` usam a mesma base, então mana absorvida **não** conta como
  dano.
- `bestBasicHit`/`bestSpellHit` continuam guardando o **RESOLVIDO** — um golpe de 300 num rato de
  10 foi um golpe de 300.
- O life leech repõe vida do atacante e sai como `creature-healed` (`source: 'leech'`), que o
  hospedeiro desenha como qualquer cura. Mana leech não tem evento enquanto não houver UI.
- **Nenhum cliente calcula ou modifica o outcome** (DT-03): não há campo novo no protocolo nem
  janela de breakdown. O detalhamento é CMB-10.

### Escopo, e de onde os modificadores vêm (M30-04, #551)

Os modificadores entram pelo `DamageIntent` — o contrato do CMB-08 não muda —, mas a FONTE deixou
de ser só `combat.modifiers` (o andaime original, um valor estático de conteúdo que nenhum
conteúdo real declara, e que a conformance ainda exercita):

- **Item** (`ItemCombatModifiers`, `packages/content/src/schemas.ts`): `criticalChance`,
  `criticalDamage`, `lifeLeech`, `manaLeech`, em pontos-base (×10000) — a MESMA escala do
  `criticalhitchance`/`criticalhitdamage`/`lifeleechamount`/`manaleechamount` do Canary
  (`items.xml`, conferido em 2026-09-26 contra `47dfd51`). `Inventory.combatModifiers` soma os
  EQUIPADOS, como já faz `armor`/`skillBonus`/`speedBonus` — o mesmo molde. O `criticalhitchance`/
  `criticalhitdamage` do wand of darkness (1000/3500) são o vetor de conteúdo do CMB-08.
  **`lifeleechchance`/`manaleechchance`** (também no `items.xml`, 19/17 itens) **não têm campo
  aqui de propósito**: `Game::calculateLeechAmount` só lê a skill AMOUNT — a CHANCE não entra na
  fórmula —, e o próprio Canary pula as duas ao montar a descrição do item (`item.cpp:91`); são
  vestigiais nesta versão, sem consumidor na resolução de dano.
- **Monstro** (`Monster.critChance`): PERCENTUAL inteiro 0-100, a escala do Lua do Canary
  (`critChance = 10`), convertido para pontos-base por `monsterCriticalModifiers`
  (`combat/modifiers.ts`) — `getCriticalChance() * 100` do Canary. Sem `criticalDamage`
  declarável: o Canary não tem esse campo em conteúdo nenhum (só runtime, sempre `0`), então um
  crítico de monstro ativa a FLAG sem multiplicar dano — fiel ao que o Canary de fato faz.
  Nenhum dos quatro monstros do bestiário atual (rat, rotworm, dragon, dragon lord) declara
  `critChance` — só 6 bosses do Canary o fazem, fora do recorte hoje.
- `combat.modifiers` continua existindo e SOMA com as fontes acima (`combineCombatModifiers`,
  em pontos-base) — é o que mantém a conformance do CMB-08 original passando sem mudança.

`HuntRuleset#attackerModifiers` agrega equipamento + `combat.modifiers` uma vez por ação, e
alimenta o golpe básico (`#strike`), a magia (`castSpell`) e a runa (`useSupply`) — o Canary rola
crítico para qualquer combate do JOGADOR, magia inclusive (`Combat::applyExtensions`, chamado de
`doCombat`/`doAreaCombatHealth`, não só o golpe básico). Ataque de monstro (básico ou ability) usa
só `monsterCriticalModifiers`, nunca leech — leech é mecanismo exclusivo do atacante JOGADOR no
Canary (`applyLifeLeech`/`applyManaLeech` exigem `attackerPlayer`). DOT/condição seguem sem
modificadores. Reflect, imbuements (M40), charms (M39), PvP e a janela de breakdown ficam fora.

**A ROLAGEM em si é da AÇÃO, não do alvo** (correção pós-#551/#653): `Combat::applyExtensions` do
Canary decide o crítico UMA vez por `doCombat`/ability inteira, antes de o dano se dividir pelos
alvos (`combat.cpp:2657`/`2757`) — nunca um alvo criticando e outro não na MESMA magia em área,
runa em área ou ability de monstro que acerta vários personagens. `rollSharedCriticalOutcome`
(`combat/modifiers.ts`) é quem garante isso: `castSpell`, `useSupply` e
`HuntRuleset#executeMonsterAbility` rolam o crítico uma vez ANTES do laço por alvo, e cada
`resolveDamage` por alvo recebe o resultado já decidido (`chance` fixado em `0` ou `1`) — o
sorteio de MAGNITUDE (a faixa de poder) continua por alvo, só o crítico é compartilhado.

## Conformance e benchmark (CMB-10, #336)

O contrato do ADR 0031 virou executável em dois lugares, e os dois são complementares:

- **Matriz de conformance** (`packages/sim/src/combat/conformance.test.ts`, sobre o contrato
  puro de `packages/sim/src/combat/conformance.ts`): casos com semente, plano de avanço e
  oráculo escrito à mão, cada um rodando a 100 ms, a 1000 ms e com snapshot/retomada. Cobre
  físico/elemental, resistência/vulnerabilidade/imunidade, defesa/escudo, famílias de arma,
  ability de monstro, condição/DOT, campo e outcomes avançados. É o que reprova no CI quando
  fórmula, ordem de RNG ou arredondamento mudam — sem depender da média de dano, que esconde
  exatamente essa mudança.
- **Benchmark misto** (`SCENARIO=combat pnpm bench:hunts`, cenário em
  `packages/tools/src/bench/combat-scenario.ts`): compõe ability em área, resistência, defesa,
  condição/campo e modificadores sobre 40 monstros, e imprime plataforma, Node, CPU, µs/tick por
  instância, memória e GC. O número **não** é teto de CI: máquina lenta é contexto, não falha.

O método, a máquina da medição e a interpretação da linha de base estão em
[`combat-conformance.md`](./combat-conformance.md).

## O que o jogador vê (FUN-106, FUN-109)

O combate é calculado no `sim` e **apresentado** pelo host, como o passo (§12). Cada golpe
aplicado vira `creature-hit` — o número flutuante sobre a criatura, com o dano **aplicado**, e
não o resolvido: o golpe fatal mostra o que a criatura tinha, não o que o atacante bateu — e,
quando houve dano, um efeito de sangue no atingido. Cura vira `creature-hit` com `kind: heal`.
Magia vira `spell-cast` no `sim` e, pela tabela de aparências fixada na sessão, projétil do
conjurador ao primeiro alvo e um efeito **por alvo** (ou no conjurador, quando é cura); poção
vira efeito no tile de quem bebeu, e runa (#165) um efeito por tile da forma, como a magia em
área. A ability de monstro (CMB-06) vira `monster-ability-cast` no `sim` e, pela tabela, um
projétil do monstro ao alvo e um efeito de impacto por alvo/tile. Magia ou ability sem linha na
tabela é muda, nunca erro. Quais ids são esses mora em
`packages/content/data/appearances/baseline.json` (`spells`, `supplies`, `hits`, `abilities`), e
só ids (invariante 6). A auditoria visual desses ids é a de
[`combat-presentation-audit.md`](../combat-presentation-audit.md): hoje **bloqueada** pela
biblioteca parcial — os 33 efeitos/projéteis existem no índice, mas nenhum tem PNG na máquina.

Os vitais do personagem saem ao vivo: `creature-health` do personagem em todo lugar que escreve
a vida dele (golpe, cura, poção, regeneração, level up, penalidade de morte), e `player-stats`
a cada ciclo em que algo mudou — a stamina comparada no minuto, porque ela queima a cada evento
e comparada exata faria a mensagem sair dez vezes por segundo.

### As magias por vocação (#156–#159; números do Canary desde o #523)

Os números vêm do Canary (`opentibiabr/canary` `main`, 2026-09-24) como estão em
`packages/content/data/spells/*.json`; o teste da tabela é `load.test.ts`. Magia compartilhada
entre vocações é um arquivo por vocação (`vocationId` é um só). Divergências documentadas (Wheel
of Destiny não modelado, aproximação de postura por skill) estão no `_open` de cada arquivo.
`BP` é só o número de EXIBIÇÃO do catálogo (ADR 0033) — a coluna "fórmula" ao lado do nome, onde
existe, é o que o motor de fato rola; `círculo` no self-buff de área lista o raio real do Canary
(`AREA_CIRCLEnXn`, raio = n), não mais uma aproximação de raio menor.

**Knight (escala por `melee`)**

| level | magia | mana | grupo (tranca) | cd próprio | efeito | BP |
|---|---|---|---|---|---|---|
| 1 | Bruise Bane | 10 | healing (1 s) | 1 s | cura | 15 |
| 1 | Lesser Front Sweep | 6 | attack (2 s) | 6 s | dano · cleave (3 tiles à frente) · skill×attack | 14 |
| 8 | Wound Cleansing | 40 | healing (1 s) | 1 s | cura | 70 |
| 14 | Haste | 60 | support (2 s) | 2 s | haste +30 % / 30 s | — |
| 16 | Brutal Strike | 30 | attack (2 s) | 6 s | dano · alvo, alcance 1 · skill×attack | 39 |
| 20 | Challenge (#589) | 30 | support (2 s) | 2 s | provocação: força o alvo, suspende a fuga · alvo, alcance 3 · 6 s | — |
| 25 | Charge | 100 | support (2 s) | 2 s | haste +90 % / 5 s | — |
| 28 | Whirlwind Throw | 40 | attack (2 s) | 6 s | dano · alvo, alcance 5 · skill+attack | 32 |
| 33 | Groundshaker | 160 | attack (2 s) | 8 s | dano · círculo raio 3 no lançador · skill+attack | 32 |
| 35 | Berserk | 115 | attack (2 s) | 4 s | dano · círculo raio 1 no lançador · skill+attack | 44 |
| 50 | Recovery | 75 | healing (1 s) | 60 s | cura 20 a cada 3 s por 60 s | — |
| 55 | Protector | 200 | support (2 s) + focus (2 s) | 2 s | postura 13 s (−35 % causado / −15 % tomado) | — |
| 60 | Blood Rage | 290 | support (2 s) + focus (2 s) | 2 s | postura 10 s (+25 % causado / +15 % tomado) | — |
| 70 | Front Sweep | 200 | attack (2 s) | 6 s | dano · cleave (3 tiles à frente) · skill×attack | 80 |
| 40 | Inflict Wound (`utori kor`, novo #596) | 30 | attack (2 s) | 30 s | dano ao longo do tempo · alvo, alcance 1 · 50 a cada 2 s por 30 s | — |
| 80 | Intense Wound Cleansing | 200 | healing (1 s) | **10 min** | cura | 500 |
| 90 | **Fierce Berserk** (`exori gran`, novo #523) | 340 | attack (2 s) | 6 s | dano · círculo raio 1 no lançador · skill+2×attack | 90 |
| 110 | **Annihilation** (`exori gran ico`, novo #596) | 300 | attack (2 s) | 30 s | dano · alvo, alcance 1 · skill×attack | — |
| 150 | Chivalrous Challenge (#589) | 80 | support (2 s) | 2 s | provocação em área (raio 3): força o alvo, suspende a fuga · 12 s | — |

Blood Rage e Protector eram level 20/mana 20 (um placeholder de bootstrap): o Canary real os
pede level 60/mana 290 e level 55/mana 200. Groundshaker (mana 200→160) e Berserk (mana 125→115)
também tinham mana acima da real.

**Paladin (escala por `distance`)**

| level | magia | mana | grupo (tranca) | cd próprio | efeito | BP |
|---|---|---|---|---|---|---|
| 1 | Lesser Ethereal Spear | 6 | attack (2 s) | 2 s | dano · alvo, alcance 7 | 9 |
| 8 | Light Healing | 20 | healing (1 s) | 1 s | cura | 40 |
| 14 | Haste | 60 | support (2 s) | 2 s | haste +30 % / 30 s | — |
| 20 | Intense Healing | 70 | healing (1 s) | 1 s | cura | 120 |
| 23 | Ethereal Spear | 25 | attack (2 s) | 2 s | dano · alvo, alcance 7 | 25 |
| 35 | Divine Healing | 160 | healing (1 s) | 1 s | cura | 250 |
| 40 | Divine Missile | 20 | attack (2 s) | 2 s | dano · alvo, alcance 4 | 60 |
| 50 | Divine Caldera | 160 | attack (2 s) | 4 s | dano · círculo raio 3 no lançador | 150 |
| 50 | Recovery | 75 | healing (1 s) | 60 s | cura 20 a cada 3 s por 60 s | — |
| 55 | Swift Foot | 400 | support (2 s) + focus (10 s) | 10 s | haste +80 % / 10 s **e `pacified` (10 s)** (#622) | — |
| 60 | Salvation | 210 | healing (1 s) | 1 s | cura | 500 |
| 60 | Sharpshooter | 450 | support (2 s) + focus (10 s) | 10 s | postura 10 s | — |
| 70 | Holy Flash (`utori san`, novo #596) | 30 | attack (2 s) | 40 s | dano ao longo do tempo · alvo, alcance 3 · 20 a cada 3 s por ~27 s (tique aleatório 7-11, aproximado pela média) | — |
| 90 | **Strong Ethereal Spear** (`exori gran con`, novo #523) | 55 | attack (2 s) | 8 s | dano · alvo, alcance 7 | 70 |

Lesser Ethereal Spear e Ethereal Spear tinham alcance 5 (o real é 7) — Lesser também tinha
cooldown 8 s (o real é 2 s, igual ao da versão normal). Sharpshooter era level 20/mana 250 (o
real é 60/450). Swift Foot tinha cooldown próprio 4 s e o do grupo `focus` 2 s (os dois são 10 s
no Canary, o mesmo prazo da postura). Divine Barrage, Ethereal Barrage e Divine Defiance NÃO
tinham correspondente no Canary/TibiaWiki — duas varreduras do #523 (a segunda incluindo
`data-otservbr-global/` e `src/`, não só `data/scripts/spells/`) não acharam o nome nem a palavra
mágica em nenhuma das três, e a decisão de 2026-09-25 na issue #596 (a captura do Huntera
confirma independentemente: nenhuma das três aparece no menu de um paladino real) removeu as
três do catálogo — `botConfig` que as referenciasse seria migrado, mas nenhum personagem real
havia sido criado ainda. Divine Grenade e Ice/Terra Burst (Wheel of Destiny, `revelationStageWOD`)
continuam fora — a Roda não existe (M41-03).

**Sorcerer (escala por `magic`)**

| level | magia | mana | grupo (tranca) | cd próprio | efeito | BP |
|---|---|---|---|---|---|---|
| 1 | Buzz | 6 | attack (2 s) | 2 s | dano · alvo, alcance 3 | 15 |
| 1 | Magic Patch | 6 | healing (1 s) | 1 s | cura | 10 |
| 1 | Scorch | 8 | attack (2 s) | 4 s | dano · onda 4 | 10 |
| 8 | Apprentice's Strike | 6 | attack (2 s) | 2 s | dano · alvo, alcance 3 | 15 |
| 12 | Energy Strike | 20 | attack (2 s) | 2 s | dano · alvo, alcance 3 | 45 |
| 13 | Terra Strike | 20 | attack (2 s) | 2 s | dano · alvo, alcance 3 | 45 |
| 14 | Flame Strike | 20 | attack (2 s) | 2 s | dano · alvo, alcance 3 | 45 |
| 14 | Haste | 60 | support (2 s) | 2 s | haste +30 % / 30 s | — |
| 14 | Magic Shield | 50 | support (2 s) | 14 s | magic shield 180 s | — |
| 15 | Ice Strike | 20 | attack (2 s) | 2 s | dano · alvo, alcance 3 | 45 |
| 16 | Death Strike | 20 | attack (2 s) | 2 s | dano · alvo, alcance 3 | 45 |
| 18 | Fire Wave | 25 | attack (2 s) | 4 s | dano · onda 4 | 40 |
| 20 | Strong Haste (`utani gran hur`, novo #596) | 100 | support (2 s) | 2 s | haste +70 % / 22 s | — |
| 23 | Energy Beam | 40 | attack (2 s) | 4 s | dano · feixe 5 | 60 |
| 26 | Ignite (`utori flam`, novo #596) | 30 | attack (2 s) | 30 s | dano ao longo do tempo · alvo, alcance 3 · 45 a cada 3 s por 75 s | — |
| 29 | Great Energy Beam | 110 | attack (2 s) + great-beams (6 s) | 6 s | dano · feixe 8 | 155 |
| 30 | Ultimate Healing | 160 | healing (1 s) | 1 s | cura | 250 |
| 34 | Electrify (`utori vis`, novo #596) | 30 | attack (2 s) | 30 s | dano ao longo do tempo · alvo, alcance 3 · 45 a cada 3 s por 75 s | — |
| 38 | Energy Wave | 170 | attack (2 s) | 8 s | dano · onda 5 | 150 |
| 38 | Great Fire Wave | 120 | attack (2 s) | 4 s | dano · onda 5 | 100 |
| 55 | Lightning | 60 | attack (2 s) + special (8 s) | 8 s | dano · alvo, alcance 4 | 110 |
| 55 | Rage of the Skies | 600 | attack (4 s) + focus (40 s) | 40 s | dano · círculo raio 6 no lançador | 200 |
| 60 | Hell's Core | 1100 | attack (4 s) + focus (40 s) | 40 s | dano · círculo raio 5 no lançador | 250 |
| 70 | Strong Flame Strike | 60 | attack (2 s) + special (8 s) | 8 s | dano · alvo, alcance 3 | 125 |
| 80 | Strong Energy Strike | 60 | attack (2 s) + special (8 s) | 8 s | dano · alvo, alcance 3 | 125 |
| 90 | **Ultimate Flame Strike** (`exori max flam`, novo #596) | 100 | attack (2 s) + ultimatestrikes (30 s) | 30 s | dano · alvo, alcance 3 | 180 |
| 100 | **Ultimate Energy Strike** (`exori max vis`, novo #523) | 100 | attack (2 s) + ultimatestrikes (30 s) | 30 s | dano · alvo, alcance 3 | 180 |
| 300† | Great Death Beam | 140 | attack (2 s) + great-beams (6 s) | 10 s | dano · feixe 6 | 155 |
| — | Cancel Magic Shield (`exana vita`, novo #596) | 50 | support (2 s) | 2 s | remove a própria condição `mana-shield`, sem prazo | — |

Cancel Magic Shield entra no level 14, ao lado de Magic Shield — listada por último porque o
mecanismo é diferente de toda outra magia da tabela: `effect.kind: 'remove-condition'` é NOVO
desta issue (`spellEffectSchema`, `packages/sim/src/casting.ts`/`rulesets/hunt.ts`) e não agenda
nada — remove a condição `mana-shield` do próprio lançador na hora, sem `expiresAtMs`.

Os `X Strike` fortes (Strong Energy/Flame Strike) e Lightning tinham alcance 7 (o real é 3/4).
Ice Strike (level 8→15) e Flame Strike (level 8→14) tinham level abaixo do real. † Great Death
Beam é level 300 + grade do Wheel of Destiny no Canary real (`needLearn`, não modelado); numa
revisão do #523 o level inventado (66) virou o real (300, por isso a linha aparece por último
apesar do BP baixo) e o cooldown próprio virou 10 s (era 6 s, o valor do grupo secundário
copiado por engano) — a magia fica no catálogo mas fora de alcance de qualquer personagem sem o
Wheel, o que o ADR 0037 aceita como resultado correto.

**Druid (escala por `magic`)**

| level | magia | mana | grupo (tranca) | cd próprio | efeito | BP |
|---|---|---|---|---|---|---|
| 1 | Chill Out | 8 | attack (2 s) | 4 s | dano · onda 4 | 10 |
| 1 | Magic Patch | 6 | healing (1 s) | 1 s | cura | 10 |
| 1 | Mud Attack | 6 | attack (2 s) | 2 s | dano · alvo, alcance 3 | 15 |
| 8 | Apprentice's Strike | 6 | attack (2 s) | 2 s | dano · alvo, alcance 3 | 15 |
| 12 | Energy Strike | 20 | attack (2 s) | 2 s | dano · alvo, alcance 3 | 45 |
| 13 | Terra Strike | 20 | attack (2 s) | 2 s | dano · alvo, alcance 3 | 45 |
| 14 | Flame Strike | 20 | attack (2 s) | 2 s | dano · alvo, alcance 3 | 45 |
| 14 | Haste | 60 | support (2 s) | 2 s | haste +30 % / 30 s | — |
| 14 | Magic Shield | 50 | support (2 s) | 14 s | magic shield 180 s | — |
| 15 | Ice Strike | 20 | attack (2 s) | 2 s | dano · alvo, alcance 3 | 45 |
| 16 | Physical Strike | 20 | attack (2 s) | 2 s | dano · alvo, alcance 3 | 50 |
| 18 | Heal Friend (`exura sio`) | 120 | healing (1 s) | 1 s | cura, alvo em terceiro alcance 5 | 60 |
| 18 | Ice Wave | 25 | attack (2 s) | 4 s | dano · onda 4 | 35 |
| 20 | Intense Healing | 70 | healing (1 s) | 1 s | cura | 120 |
| 20 | Strong Haste (`utani gran hur`, novo #596) | 100 | support (2 s) | 2 s | haste +70 % / 22 s | — |
| 30 | Ultimate Healing | 160 | healing (1 s) | 1 s | cura | 250 |
| 36 | Mass Healing | 150 | healing (1 s) | 2 s | cura · círculo raio 3 no lançador | 200 |
| 38 | Terra Wave | 170 | attack (2 s) | 4 s | dano · onda 5 | 120 |
| 40 | Strong Ice Wave | 170 | attack (2 s) | 8 s | dano · onda 3 | 150 |
| 50 | Envenom (`utori pox`, novo #596) | 30 | attack (2 s) | 40 s | dano ao longo do tempo · alvo, alcance 3 · 45 a cada 3 s por 75 s | — |
| 55 | Wrath of Nature | 700 | attack (4 s) + focus (40 s) | 40 s | dano · círculo raio 6 no lançador | 175 |
| 60 | Eternal Winter | 1050 | attack (4 s) + focus (40 s) | 40 s | dano · círculo raio 5 no lançador | 200 |
| 70 | Strong Terra Strike | 60 | attack (2 s) + special (8 s) | 8 s | dano · alvo, alcance 3 | 115 |
| 80 | Strong Ice Strike | 60 | attack (2 s) + special (8 s) | 8 s | dano · alvo, alcance 3 | 115 |
| 90 | **Ultimate Terra Strike** (`exori max tera`, novo #596) | 100 | attack (2 s) + ultimatestrikes (30 s) | 30 s | dano · alvo, alcance 3 | 180 |
| 100 | **Ultimate Ice Strike** (`exori max frigo`, novo #596) | 100 | attack (2 s) + ultimatestrikes (30 s) | 30 s | dano · alvo, alcance 3 | 180 |
| — | Cancel Magic Shield (`exana vita`, novo #596) | 50 | support (2 s) | 2 s | remove a própria condição `mana-shield`, sem prazo | — |

Mass Healing tinha raio 1 (9 tiles) — o Canary real é `AREA_CIRCLE3X3`, raio 3 (37 tiles). Heal
Friend saiu da lista de excluídas desde o §26 (ADR 0035 d.10); o `_open` dizia "não auditado
nesta task" e o #523 confirmou os números reais (level 14→18, mana 30→120). Strong Ice Wave
tinha onda 5 e cooldown 4 s — o Canary real é `AREA_SHORTWAVE3` (3 fileiras contando a do `3`, #679) e cooldown 8 s. Ice
Strike (level 8→15) e Flame Strike (level 8→14) tinham level abaixo do real. Forked Thorns NÃO
tinha correspondente no Canary/TibiaWiki (duas varreduras, a segunda com `data-otservbr-global/`
e `src/` também) — a decisão de 2026-09-25 na issue #596 removeu-a do catálogo, como Divine
Barrage/Ethereal Barrage/Divine Defiance (ver a nota do Paladin, acima). Ice Burst e Terra Burst
(Wheel of Destiny, `revelationStageWOD("Twin Burst")`) continuam fora — M41-03.

Ignite/Electrify/Envenom/Inflict Wound/Holy Flash usam o mecanismo `Condition:addDamage` do
Canary (M31-02) — um `amount` FIXO a cada `intervalMs`, por `durationMs` (`spellEffectSchema.
damage-over-time`). Holy Flash é a exceção: `math.random(7, 11)` tiques (número aleatório), dano
por tique fixo (20) — o schema não modela duração aleatória, e a tabela usa a MÉDIA (9 tiques,
27 s), preservando o dano total esperado (180) com ±40 de erro. Curse (`utori mort`, DOT de morte
do Sorcerer, 17 estágios de dano DECRESCENTE) ficou de fora: a forma não é um valor fixo — é uma
curva —, e `damage-over-time` não a modela; reportada, não aproximada (ver `EXCLUDED_SPELLS` em
`load.test.ts`).

**Ficam de fora, por nome** (ADR 0026 decisão 5): Light, Great Light, Ultimate Light, Find Person, Find Fiend, Magic Rope, Levitate, Invisible, Cancel Invisibility, Creature Illusion (utilidade); Cure Poison, Cure Bleeding, Cure Curse, Cure Electrification, Cure Burning (condição); Curse (dano ao longo do tempo, forma não reconhecida — ver acima); Shield Bash, Shield Slam (defesa de escudo); Train Party, Protect Party, Enchant Party, Heal Party, Shared Conservation (party); Elemental Synthesis, Master of Decay/Flames/Thunder (elemento); Arrow Call, Conjure Arrow, Conjure Explosive Arrow, Enchant Spear, Conjure Wand of Darkness, Food (conjuração); Summon Creature (convocação); e o que só existe no Wheel of Destiny do Canary moderno — Divine Grenade, Executioner's Throw, Ice Burst, Terra Burst, Fair Wound Cleansing, Great Death Beam (level 300 + grade, não modelado). O Sorcerer não tem Light Healing nem Intense Healing no TibiaWiki de 2026 — a cura dele é Magic Patch e Ultimate Healing. Challenge/Chivalrous Challenge (#589) e Cancel Magic Shield (#596) SAÍRAM desta lista — estão implementadas, acima. As três magias genéricas pré-vocação (`heal`, `strike`, `blast`) e as quatro sem fonte no Canary (`divine-defiance`, `divine-barrage`, `ethereal-barrage`, `forked-thorns`) saíram do CATÁLOGO no #596 — o Tibia não dá magia nenhuma antes da escolha de vocação, e não havia "fórmula do Canary" para nenhuma das sete; Cure Poison é a única magia que segue sem `vocationId`.

## Em aberto

- `[ABERTO]` (#589) Challenge no Canary exige a vocação Elite Knight
  (`spell:vocation("elite knight;true")`); o Draconya ainda não modela promoção de vocação (#566,
  aberta, sem PR), então a magia entra com `vocationId: "knight"` sozinho, sem o gate. Chivalrous
  Challenge não tem esse problema — o Canary já aceita `"knight;true"` OU `"elite knight;true"`.
  Quando #566 fechar, Challenge ganha o mesmo gate que qualquer outra magia de promoção. A
  Chivalrous Challenge também diverge do Canary por decisão (DT-03 da issue): vira `circle raio 3
  centrado no lançador` em vez do chain-picker exato (até 5 monstros à distância, sem reward
  boss/invocação) — o Draconya não tem chain-picker nem Wheel of Destiny, e não força
  `changeTargetDistance` (o atirador melee temporário) — ver "Fora do escopo" da issue #589.
- `[ABERTO]` A chance de bloqueio (`combat.defense.blockChance`, provisória em 0,6) e a defesa
  do spike sword (10) não vêm do PRD e ainda não foram medidas contra uma hunt com escudo.
- `[ABERTO]` A conversão do Base Power (`combat.spellPower`) é nossa e provisória — ver acima.
- `[ABERTO]` Só o **life/mana leech** de `combat.modifiers` segue sem declaração no conteúdo real
  (**ausente é neutro**, e ligá-lo é conteúdo novo com `Content.version` novo; o valor só entra
  quando medido). O crítico BASE do jogador **já está declarado** desde o #603 — 5 % de chance,
  +10 % de dano, números REAIS do Canary (`config.lua.dist`), não provisórios: como o `critical`
  declarado consome uma rolagem mesmo com `chance: 0`, a sequência de RNG de todo golpe, magia e
  runa do `combat-v4` inclui essa rolagem — ver "Charms em combate".
- `[ABERTO]` As fórmulas das famílias de arma (`levelFactor` e `spread`) são provisórias e estão
  zeradas para preservar o dano entregue (CMB-05). Ligar `spread` a um valor diferente de zero
  muda o consumo de RNG e exige perfil novo (ADR 0031).
- `[ABERTO]` Base Power, raio e requisitos da Avalanche Rune são provisórios até a leitura da
  infobox do TibiaWiki (o preço por uso é `[RESOLVIDO]` — 64, menor `buy` de NPC do Canary,
  M34-03/#574). O elemento é `ice` desde o CMB-03.
- `[ABERTO]` `physical-strike` é dano físico no Tibia, mas fica em `arcane` nesta versão para
  não mudar o dano entregue (a armadura passaria a contar). Trocar para `physical` exige perfil
  novo (ADR 0031).
- `[ABERTO]` A conferência visual dos efeitos e projéteis de combate está bloqueada pela
  biblioteca local parcial (47 de 4171 folhas; nenhum sprite de efeito/projétil tem PNG). Nenhum
  id foi corrigido sem evidência — ver [`combat-presentation-audit.md`](../combat-presentation-audit.md).
- `[ABERTO]` (#523) O `compatibilityProfile` continua `combat-v1`: este PR muda o RESULTADO de
  muita magia (coeficientes, e agora a contagem de alvos do Front Sweep — dois tiles em vez de
  três) e, pelo ADR 0031/0037, isso pede um perfil novo, `breaking`. Não foi criado aqui de
  propósito: a #522 (dano de arma, também M28) mexe na MESMA infraestrutura
  (`COMBAT_PROFILES`, o `switch` de `resolveDamage`) e as duas issues inventarem o mesmo id em
  paralelo colidiria. Quem mesclar as duas decide o id (`combat-v2`, o próximo livre) e a
  migração de sessão em voo (invariante 7).
- `[ABERTO]` Os percentuais de postura de Blood Rage (+25 % dano) e Sharpshooter (+32 % dano) são
  uma aproximação anterior ao #523: o Canary real dá +35 %/+40 % de SKILL (`SKILL_MELEEPERCENT`/
  `SKILL_DISTANCEPERCENT`), não de dano, e o schema (`damageDealtPercent`) só expressa dano. Só
  Protector foi corrigido (o Canary já expressa em `BUFF_DAMAGEDEALT`, percentual de dano puro).
  Converter skill % em dano % exigiria a fórmula de arma nova da #522 primeiro.
- ~~`[ABERTO]` `combat.weaponDamage.attackFactor` (#522) é uma CONSTANTE de conteúdo em `1,0`~~
  — **fechado na M30-03 (#550)**: o campo saiu do conteúdo e o fator é a postura do personagem
  (ver "A postura de luta").
- `[ABERTO]` `ammunition.maxHitChance` e `weapon.hitChance` (#524) não têm nenhum valor não-default
  no catálogo real hoje — nenhuma munição ou arma especial (power bolt, royal crossbow) existe
  ainda. Os campos e a leitura (#522) já existem; falta o item.
- O erro de tiro (#522) tem apresentação própria desde o #555, **só no `combat-v3`**: o `missile`
  do `shot` — a MESMA mensagem de sempre, sem opcode nem campo novo — desenha o projétil num
  tile ERRADO em vez do tile do alvo. `WeaponDistance::useWeapon` (Canary `things/sources/canary/
  src/items/weapons/weapons.cpp:830-855`): adjacente ao alvo (distância Chebyshev ≤ 1) o Canary
  não redireciona — o destino continua sendo o alvo; a mais de 1 tile, sorteia um tile ANDÁVEL
  entre os nove do quadro 3×3 centrado nele (8 vizinhos + o próprio tile do alvo, que também é
  candidato — um tiro que erra pode, por sorte, "acertar" visualmente sem causar dano).
  `missShotTile` (`packages/sim/src/combat/distance-hit.ts`) reproduz o MECANISMO (ADR 0037
  d.1/d.3): filtra os andáveis primeiro e sorteia um índice uniforme entre eles com
  `session.rng`, em vez do `shuffle`+primeiro-válido do Canary — mesma distribuição, uma rolagem
  por tiro errado a mais de 1 tile, nenhuma quando adjacente ou quando o tiro acerta.
  **`combat-v1`/`v2` continuam com `to` fixo no tile do alvo mesmo no erro, sem NENHUMA rolagem
  extra** (ADR 0031/0040): os dois perfis já publicados são contrato bit a bit, e o sorteio do
  tile errado é uma rolagem NOVA que só o perfil aberto para mudança (`combat-v3`, ADR 0037
  decisão 5) pode ganhar — `#strike`/`#throwWeapon` (`hunt.ts`) só chamam `#missDestination`
  atrás de `this.#isV3()`. Ainda não existe texto "MISS" nem efeito de "flecha na parede" — só o
  destino errado do projétil, que é o que a issue pediu; aquilo fica para quando a apresentação
  de combate (CMB-09/#242) sair do bloqueio da biblioteca parcial.
- `[ABERTO]` A #522 investigou se o monstro deveria ganhar um segundo atributo de defesa
  (`Monster::getMitigation`/`getDefense` do Canary — um redutor percentual, distinto do `armor`
  que já existe) para bloquear o corpo a corpo do jogador como o escudo do CMB-04 bloqueia o do
  monstro. **Decisão: não adotado nesta issue.** O mecanismo do Canary é uma tabela de mitigação
  percentual nova, não um ajuste da fórmula de arma — mudaria como TODO monstro reduz dano
  recebido, não só o que a #522 pede. **O `armorReduction = armor × armorEffectiveness` que já
  existe (`combat/damage.ts`, inalterado por esta issue) NÃO é da mesma família de mecanismo que
  o Tibia usa** — é uma fórmula DETERMINÍSTICA original do Draconya. TFS e Canary reduzem dano
  por um bloqueio ALEATÓRIO em `Creature::blockHit`
  (`things/sources/forgottenserver/src/creature.cpp`, `things/sources/canary/src/creatures/
  creature.cpp`): para `armor > 3`, `damage -= uniform_random(armor/2, armor − (armor%2 + 1))` —
  uma ROLAGEM, não um produto fixo — e o Canary soma por cima `Monster::getMitigation()`
  (`monster.cpp`, um redutor percentual por monstro, capado em 30%, aplicado a QUALQUER
  atacante, jogador incluso). Nem o sorteio nem o teto de mitigação existem no Draconya hoje.
  Isso é uma LACUNA DE FIDELIDADE em aberto, não algo já resolvido por acidente — fica para a
  issue do catálogo de monstros do M28 planejar (armadura/mitigação de cada monstro é conteúdo
  que ainda não existe para o Dragon/Dragon Lord de qualquer forma).
- **RESOLVIDO pelo #547 (M29-07).** A tabela de tipo drowning→`drown` do M31-02 (#557) não pôde
  ser LIGADA naquela issue porque `drown` ainda não existia em `DAMAGE_TYPES`
  (`packages/content/src/schemas.ts`). O #547 acrescentou `drown`/`lifedrain`/`manadrain` ao
  enum; `sim/conditions.ts` já aceitava qualquer `DamageType`, então nenhuma mudança de mecanismo
  foi necessária — um conteúdo de afogamento já pode declarar `damageType: 'drown'` na condição
  `damage-over-time`. Nenhum monstro do catálogo atual declara um campo de afogamento ainda; a
  ligação de fato ao primeiro monstro real fica para quando ele entrar no catálogo.

Nenhum `[ABERTO]` do PRD atinge diretamente este sistema. Texto flutuante de XP e "miss"/"block"
ficam para quando o protocolo os carregar.

## Divergências do PRD

- **Três magias sem correspondente no Canary** (`divine-barrage.json`, `ethereal-barrage.json`,
  `forked-thorns.json`, mais o self-buff `divine-defiance.json`): DUAS varreduras do #523 no
  `opentibiabr/canary` local (`things/sources/canary` — `data/`, `data-otservbr-global/` e
  `src/`, não só `data/scripts/spells/`) não acharam nome, palavra mágica nem efeito que bata
  com nenhuma das quatro. Ficam como conteúdo próprio do Draconya, fora da paridade e da
  conformidade de fórmula (`load.test.ts`, `NOT_FROM_CANARY`, para as três com `effect.formula`
  — Divine Defiance é `buff` e não entra nessa checagem), com **remoção planejada** (ADR 0037) —
  o motivo está no `_open` de cada arquivo; a remoção em si, com a migração de `botConfig` de
  quem já as tiver configurado, é uma issue separada.
- **Três magias genéricas pré-vocação** (`heal.json`, `strike.json`, `blast.json`): o Tibia real
  não dá NENHUMA magia antes da escolha de vocação no level 8, então não existe "fórmula do
  Canary" para elas por definição — são um kit de bootstrap do próprio Draconya (§4.1), também
  fora da conformidade de fórmula.
- **Great Death Beam** (`great-death-beam.json`) é level 300, como no Canary real — numa revisão
  do #523 o level inventado (66) que uma leitura anterior tinha mantido foi substituído pelo
  real. O que continua não modelado é o MECANISMO que caberia nesse level: no Canary a magia
  também exige uma grade do sistema "Wheel of Destiny" (`needLearn`), que o Draconya não tem.
  Resultado aceito pelo ADR 0037: a fórmula é a real e a magia fica inacessível a qualquer
  personagem, porque é isso que "Tibia é a regra" significa aqui.
O PRD §12.2 tinha "ataque ofensivo do jogador sempre acerta" como regra do PRODUTO, sem
distinguir corpo a corpo de distância. O ADR 0037 (decisão 3) revogou esse limite para mecânica
de jogo, e a #522 aplicou a revogação só onde o Canary também rola acerto: a distância passa a
errar por skill/distância, e o corpo a corpo continua sempre acertando — não porque o PRD
mandou, mas porque é isso que o Canary faz no PvE.
O Dodge do §12.2 **não** mudou na #522 — que o julgou equivalente ao charm de esquiva do Tibia
(reduz à metade, não zera). O #603 corrigiu o julgamento: o charm NEGA o golpe, e o Dodge de metade
saiu no `combat-v4` (ADR 0053 d.5), com o charm entrando no lugar dele.
