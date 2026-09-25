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
**PRD:** §12
**Épico:** E2

## Contrato de compatibilidade (ADR 0031)

A referência de combate está fixada pelo
[ADR 0031](../adr/0031-contrato-de-compatibilidade-de-combate-e-migracao.md): **Tibia 13.32**,
com o mecanismo lido de TFS/Canary (GPL v2 — só mecanismo e caso de borda, nunca código copiado)
e os números observados no TibiaWiki. O perfil semântico `combat-v1` é conteúdo versionado: a
sessão o congela na criação e não o troca no meio da hunt.

Este documento separa três coisas: o que está **entregue** (comportamento atual), o que é
**exceção de produto aprovada** e o que ainda é **lacuna**. Nenhuma hipótese entra como
comportamento entregue.

## Comportamento atual

A resolução de dano entregue é `resolveDamage` em `packages/sim/src/combat/damage.ts`. Desde o
CMB-02 ele é o **ponto público único** de resolução — arma, magia, runa e monstro passam por
ele — e devolve um `DamageOutcome` versionado e auditável em vez de um número solto. O perfil
`combat-v1` aplica armadura por tipo, piso, uma rolagem de Dodge sempre consumida e arredonda no
fim; a seção "O resolver canônico" detalha o contrato.

## Compatibilidade aprovada

Duas regras do PRD §12 desviam explicitamente do Tibia e valem como exceção de produto fixada no
perfil `combat-v1` — não são hipótese nem fidelidade pendente:

Primeira: ataques realizados pelo jogador sempre acertam o alvo. Não existe miss ofensivo do lado do jogador — o servidor não rola chance de acerto para o atacante, o que elimina metade da matemática de combate tradicional.

Segunda: existe o atributo Dodge no defensor. Quando o Dodge ativa, o ataque recebido causa metade do dano que causaria normalmente. Isso vale contra qualquer tipo de ataque recebido — incluindo magia e ataques de boss —, não apenas contra combate corpo a corpo. A chance de Dodge é percentual e pode vir de fontes como bônus permanentes de Bestiário.

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

### A taxonomia de dano (CMB-03)

A lista canônica é a de Tibia 13.32 — físico, energia, terra, fogo, gelo, sagrado e morte — mais
`arcane`, que é a magia **não-elemental** (ou cujo elemento o conteúdo ainda não declarou) e
preserva o vocabulário `melee`/`magic` do v1. A fonte única é `DAMAGE_TYPES` em
`@draconya/content`; o `sim` importa `DamageType` e não redeclara o enum. A emenda de 2026-09-17
no [ADR 0031](../adr/0031-contrato-de-compatibilidade-de-combate-e-migracao.md) fixa a lista e a
origem.

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
sem nada explicando. Em milissegundos a conta é exata.

## Regeneração

O personagem recupera vida e mana passivamente enquanto está em hunt, por tempo decorrido. Vale
**mesmo com a stamina zerada**: regenerar não é recompensa, é sobrevivência, e o §10.2 diz que o
personagem continua podendo morrer, não que ele passa a morrer mais rápido.

Morto não regenera — sem essa linha, quem caiu voltaria sozinho na hunt em que morreu, e a morte
deixaria de encerrar coisa nenhuma.

**A taxa é do Tibia, e é por VOCAÇÃO (#521, ADR 0037).** Antes da #521 era 1 HP/s e 1 mana/s
para todo mundo, provisório; agora é `gainhpticks`/`gainmanaticks` do Canary `vocations.xml`
por vocação (Knight regenera vida mais rápido que Mago, Mago regenera mana mais rápido que
Knight), e quem ainda não escolheu vocação (levels 1–7) usa a taxa da vocação `None` — cerca de
12× mais lenta em vida que o 1 HP/s de antes. É o balanceamento que as poções (e a cura
automática do bot) vão reequilibrar — no Tibia real, sustentar uma hunt sem poção não é a
expectativa.

## Regras

- Ataques do jogador sempre acertam (sem rolagem de acerto ofensivo).
- Dodge, quando ativa no defensor, reduz o dano recebido em 50%.
- Dodge pode ativar contra qualquer ataque recebido, incluindo magia e ataques de boss.
- Bônus permanentes de Bestiário valem só em PvE; não se aplicam em Guild War.
- Escudo ou arma corpo a corpo de uma mão bloqueia parte do golpe **físico**; o bloqueio nunca
  zera o golpe, e ataque elemental não é bloqueado nem treina shielding (CMB-04).
- Shielding sobe uma vez por ataque físico elegível recebido, nunca por tick e nunca pelo HP
  perdido (CMB-04).

## Parâmetros de balanceamento

| Parâmetro | Valor | Onde mora |
|---|---|---|
| Multiplicador de dodge | 0,5 (§12.2, decidido) | `packages/content/data/combat/baseline.json` |
| Efetividade da armadura — `physical` | 1 `[ABERTO — valor provisório: 1]` | `packages/content/data/combat/baseline.json`, `armorEffectiveness.physical` |
| Efetividade da armadura — todo tipo não-físico (`energy`, `earth`, `fire`, `ice`, `holy`, `death`, `arcane`) | 0 `[ABERTO — valor provisório: 0]` | `packages/content/data/combat/baseline.json`, `armorEffectiveness.<tipo>` |
| Resistência por tipo | ausente é 0 (identidade); intervalo `[-1, 1)` | `mitigation.resistances` de monstro e item |
| Regeneração de vida/mana — sem vocação (levels 1–7) | 0,0833 HP/s / 0,3333 mana/s (a vocação `None` do Canary, #521, ADR 0037) | `packages/content/data/progression/baseline.json`, `regen` |
| Regeneração de vida/mana — por vocação (Knight/Paladin/Sorcerer/Druid) | ver `docs/product/progression.md` §Parâmetros | `packages/content/data/vocations/*.json`, `regen` |
| Piso de dano, como fração do ataque | 0,1 `[ABERTO — valor provisório: 0,1]` | `packages/content/data/combat/baseline.json` |
| Chance de bloqueio (`blockChance`) | 0,6 `[ABERTO — valor provisório: 0,6]` | `packages/content/data/combat/baseline.json`, `defense.blockChance` |
| Tipos que o blocking mitiga | `["physical"]` (v1) | `packages/content/data/combat/baseline.json`, `defense.blockTypes` |
| Defesa da arma corpo a corpo de uma mão | machete 9, steel axe 10, spike sword 10 `[ABERTO — spike sword provisório: 10]` | `packages/content/data/items/*.json`, `defense` |
| Shielding — início, curva (base), defesa por nível | 10 / 100 / +2 % `[ABERTO — defesa por nível provisória]` (base = `skillBase` do escudo no Canary; `factor` por vocação, #521, ADR 0037 — ver `docs/product/progression.md`) | `packages/content/data/skills/shielding.json` |
| Modificadores avançados (`combat.modifiers`) | **ausente é neutro** (preserva o v1); quando declarado, crítico/leech são `[ABERTO — valores provisórios]` | `packages/content/data/combat/baseline.json`, `modifiers` |

As exceções de produto — always-hit, Dodge e o escopo PvE-only do Bestiário — são contrato do
perfil `combat-v1` ([ADR 0031](../adr/0031-contrato-de-compatibilidade-de-combate-e-migracao.md)),
não parâmetro de balanceamento. O único número entre elas é o multiplicador de Dodge, já listado
acima em `combat/baseline.json`; as demais são estruturais.

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

### Magias do catálogo do Tibia (#155, ADR 0026 decisão 5)

O motor expressa o catálogo instantâneo do Tibia até o level 80; os números de cada magia são
das issues por vocação (#156–#159). O que o motor ganhou:

- **Formas** (`effect.area.shape`, `packages/sim/src/area.ts`): `circle` (centrado no alvo ou no
  lançador; raio 1 é o 3x3 completo, raio ≥ 2 recorta os cantos por Manhattan — #472),
  `cross` (cruz de `radius` tiles nos quatro eixos cardeais mais o centro, centrada no alvo —
  a Explosion), `wave` (cone à frente: fileira k tem largura `2⌊k/2⌋+1` — 1, 3, 3,
  5, 5, a onda do Tibia como fato observável, sem matriz copiada), `cleave` (os três tiles à
  frente) e `beam` (linha reta). Onda, cleave, feixe e o círculo no lançador são **self-origin**:
  não exigem alvo nem alcance (o boot recusa `range` nelas), e recusam `no-target` só quando
  nenhum monstro cai nos tiles — sem gastar mana. Saem na **direção do personagem**, que o
  passo grava (diagonal: a componente horizontal decide — regra nossa); quem nunca andou olha
  para o sul. O evento `spell-cast` leva os tiles da forma, e o efeito aparece em todos —
  inclusive onde não há monstro, como no Tibia.
- **Base Power** (`effect.basePower`, o BP do TibiaWiki) convertido por `combat.spellPower` —
  `mid = BP × (1 + level × levelFactor + skill × skillFactor)`, `[⌊mid × (1 − spread)⌋,
  ⌈mid × (1 + spread)⌉]`, uma rolagem por alvo. A skill é a da vocação (`vocation.spellSkill`:
  `magic`, e `distance` no Paladin). **A fórmula é nossa e provisória** `[ABERTO]`: o TibiaWiki
  não publica a do Tibia, e a do TFS é GPL (ADR 0019); os coeficientes (0,06 / 0,15 / 0,15)
  foram calibrados para Light Healing (BP 40) render ~59 no level 8 com magic 0, o que o `heal`
  genérico cura. Uma magia de BP NÃO passa pelo multiplicador das skills por uso
  (`damagePerLevel`) — contaria a skill duas vezes; `power`/`amount` fixos continuam passando.
- **Grupos de cooldown** (`group` + `groupCooldownMs`, `secondaryGroup`): três livros no mesmo
  `Cooldowns` (`spell:`, `group:`, `secondary:`), instante lógico absoluto. A recusa é
  `group-cooldown` com o prazo do livro que trancou, e a categoria do bot volta no vencimento.
  Magia sem `group` (as três genéricas de antes) só tem o cooldown próprio.
- **Condições** (`packages/sim/src/conditions.ts`): haste (`speedScale` lido por
  `movementDuration`, à parte de `speed` — `retarget` reescreve `speed`), postura (`buff`:
  dano causado por fonte e dano tomado, em percentuais que somam), magic shield (o dano sai da
  mana primeiro, o escudo continua até vencer mesmo com mana zero) e cura ao longo do tempo
  (Recovery: `amount` a cada `intervalMs`). Uma por tipo; relançar REINICIA. O vencimento e o
  tique são eventos da fila (`condition-expire`, `condition-tick` — invariante 2), e a condição
  vai no `CharacterState` com o prazo lógico: um snapshot no meio de um haste retoma vencendo
  no mesmo instante. `castSpell` DEVOLVE a condição; quem agenda é o ruleset.

O que fica de fora, por decisão: runas e conjurações, invocação e ilusão, party, utilidade, cura
de condição, magias de escudo, elemento e resistência. O dano ao longo do tempo e as condições
de monstro, que ficavam aqui, passaram a existir com o CMB-07 (ver a seção seguinte) — o que o
catálogo nominal ainda não traz são as magias de DOT por nome (Envenom, Curse, …).

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
| Sudden Death | `death` | **alvo único** | 45 / 15 | `level/5 + ml×4.6 + 32` / `level/5 + ml×7.4 + 48` |
| Heavy Magic Missile | `energy` | **alvo único** | 25 / 3 | `level/5 + ml×0.4 + 2` / `level/5 + ml×1.59 + 10` |
| Explosion | `physical` | **cruz** raio 1 | 31 / 6 | `level/5` (aprox.) / `level/5 + ml×4.8` |

A `formula` é a mesma da magia de dano (#474): `min = level × levelFactor + ml × skillMin +
baseMin` (idem `max`), com `levelFactor` 0,2 — o `level / 5` da referência. Runa sem `formula`
continua no caminho provisório do `basePower` × `combat.spellPower`, bit a bit (ADR 0031).

O que difere da magia de ataque, e por quê:

- **Escala sempre pelo magic level**, em toda vocação. Magia escala pela skill que a vocação
  declara (`spellSkill`, §"Magias do catálogo"); runa é do magic level no Tibia, e knight de
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
| Munição — attack e preço | arrow 25 / 1 `[ABERTO — attack e preço provisórios]`; burst arrow 27 / 3 `[ABERTO — attack e preço provisórios]`; sniper arrow 28 / 5 `[ABERTO — valor provisório: 5]`; onyx arrow 38 / 7 `[ABERTO — valor provisório: 7]` | `packages/content/data/ammunition/{arrow,burst-arrow,sniper-arrow,onyx-arrow}.json` (o projétil fica em `appearances.ammunition`) |
| Distância — início, curva (base), dano por nível | 10 / 30 / +2% `[ABERTO — dano por nível provisório]` (base = `skillBase` da distância no Canary; `factor` por vocação, #521, ADR 0037 — ver `docs/product/progression.md`) | `packages/content/data/skills/distance.json` |

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
}

resolveWeaponPower(profile, level, skillLevel, rng): number
```

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
- **Fora do escopo**, por decisão (CMB-08): invocação, scripts de boss e o detalhamento visual do
  dano. Condições e campos, que ficavam aqui, entraram no CMB-07 (ver a seção seguinte). A cura
  própria (defesa) saiu do escopo do CMB-08 e entrou no #518 — ver a seção seguinte a esta.

O `packages/content/data/monsters/rat.json` continua sem `abilities` — é o caso legado, e é o
teste de que a normalização preserva o resultado entregue.

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
  `wave` e `beam` — as duas últimas saem do MONSTRO na direção do alvo, recalculada a cada golpe
  por `facingDirection` (`packages/sim/src/area.ts`), o mesmo cálculo do TFS
  `updateLookDirection`: o eixo de MAIOR deslocamento decide (`|dx| > |dy|` → leste/oeste), e o
  empate (inclusive `dx = dy = 0`) decide horizontal pelo sinal de `dx`. A geometria da onda
  continua a do #155 (`area.ts`, cone `1, 3, 3, 5, 5…`) — fato observado do Tibia, não a matriz
  `length`/`spread` do TFS (GPL, ADR 0019). `cross`/`cleave` continuam fora; `buildContent`
  recusa.
- **Defesa (`monster.defenses`)**: cura própria, o mecanismo que o Dragon usa (`interval 2000,
  chance 15%, +40..+70`). Cada defesa é um evento NA FILA com a própria cadência — o mesmo
  desenho das abilities, subject derivado `m:<id>:<defenseId>` — e não depende de alvo: cura
  mesmo sem ninguém para atacar. `chance` é sempre declarada (o campo é conteúdo NOVO, sem
  concessão de compatibilidade). A cura nunca passa do HP máximo, e de vida cheia o `sim` não
  emite `creature-healed` — a mesma regra de `#emitHealed` do personagem (um "+0" flutuando é
  ruído). A apresentação é a mesma chave semântica de `MonsterAbilityCast.impactKey`
  (`appearances.abilities`), agora carregada por `CreatureHealed.impactKey` — só em
  `source: 'monster'`.
- **Troca de alvo (`monster.targetChange`)**: a cada `intervalMs` rola `chance`; se passa, escolhe
  um alvo válido AO ACASO dentro do `aggroRadius`, diferente do atual — o ramo
  `TARGETSEARCH_RANDOM` do TFS, que é o que o Dragon usa (`targetDistance <= 1`). O ramo
  `TARGETSEARCH_NEAREST` (monstro de alcance maior) fica de fora: nenhum monstro do recorte
  precisa dele, e o #518 não introduz o campo `targetDistance` só para essa distinção.
- **Fuga (`monster.runOnHealth`)**: `HP <= runOnHealth` é fugindo (`isMonsterFleeing`,
  `packages/sim/src/monster/monster.ts`) — pura, recalculada a cada decisão a partir do HP atual,
  nunca um booleano guardado à parte. Fugindo, `decideMonsterAction` SEMPRE devolve um passo para
  LONGE do alvo (`fleeStep`, o passo guloso com a ameaça espelhada — FUN-85), nunca aproxima;
  encurralado, fica parado (ADR 0009). As abilities CORPO A CORPO (`isMeleeAbility`: sem área,
  alcance 1) nem são armadas nem executam enquanto foge; as de alcance continuam saindo — passo
  e ataque são decisões independentes, como no TFS (`getNextStep` × `doAttacking`).
- **`staticAttack` (aceito, ainda NÃO wired)**: o campo existe no schema
  (`monster.staticAttack`, fração de vencimentos em que o monstro fica parado em vez de dar um
  passo aleatório colado no alvo — TFS `staticattack`/`randomStepping`), mas o motor de passo
  daqui não tem um "pensamento" periódico independente do passo em si; simular o shuffle exigiria
  um evento novo só para isso. Decisão explícita do #518 ("implementar só se couber sem mexer no
  determinismo; senão registrar como divergência") — ver "Divergências do PRD" abaixo.
- **`scheduledDefenses` viaja no snapshot** (opcional, sem bump de formato), como
  `scheduledAbilities`: sem ele, a hunt retomada reagendaria a defesa que já tinha evento na
  fila e curaria em dobro no primeiro vencimento.
- Rato e rotworm não declaram nenhum destes campos — o comportamento entregue não muda.

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
  readonly effect: ConditionEffect;       // haste | buff | mana-shield | heal-over-time | damage-over-time
}

interface FieldSpec {                     // declarado em content
  readonly id: string;
  readonly durationMs: number;
  readonly shape: SpellArea;              // a MESMA geometria da magia/ability
  readonly condition: ConditionSpec;
}
```

- **Alvo duplo.** O estado de runtime do #155 continua plano (compatibilidade de snapshot) e
  ganha `targetId`, `sourceId`, `merge` e `nextTickAtMs` opcionais. O monstro carrega
  `conditions`, e o vencimento/tique usam o mesmo sujeito (`<id>/<chave>`, com `m:<id>` no
  monstro) — cancelar no relançamento e na morte não varre a fila.
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
- **Sem arte (invariante 6).** Campo não tem `appearanceId`; a apresentação do tique reusa
  `creature-hit` + `creature-health-changed`, e a ausência de aparência não muda a mecânica.
- **Snapshot aditivo.** `MonsterState.conditions` e `HuntRulesetState.fields` são opcionais e o
  `tick` antigo (sem `kind`) lê como cura. `SNAPSHOT_FORMAT_VERSION` **não sobe**.

**Fora do escopo**, por decisão: campo bloqueante, novo pathfinding, dispel, invisibilidade, PvP
e a UI detalhada de buff.

**O primeiro campo de conteúdo real é o do Dragon Lord (#520).** A ability `firefield`
(`data/monsters/dragon-lord.json`) não causa dano direto (`power: 0`) — ela só larga o campo,
círculo raio 4 centrado no alvo, com uma condição `damage-over-time` de 20 de fogo a cada 10 s.
Os números vêm do Canary `items.xml` (fire field id 2118: `ticks 10000`, `count 7`,
`damage 20`): 7 tiques de 20 em 10 000 ms cada, 70 000 ms de queima total. **O Tibia real
decai o campo em três estágios** (2118 → 2119 → 2120, cada um mais fraco que o anterior, até
sumir); `FieldSpec` do Draconya é um campo só, sem decaimento — usamos os números do estágio
MAIS FORTE (2118) pelo tempo inteiro, em vez de simular a cadeia. Um jogador que pisa tarde no
campo do Tibia real levaria menos dano (estágio mais fraco); aqui leva o mesmo.

## O Dragon e o Dragon Lord (#520): a primeira ability wave/circle/defesa/fuga de verdade

O #518 desenhou o mecanismo; o #520 é quem o usa pela primeira vez em conteúdo real, e por isso
os exemplos deste documento (`staticAttack: 0,8`, `runOnHealth: 300`) já citavam o Dragon antes
de ele existir. `data/monsters/dragon.json` e `dragon-lord.json` declaram: `melee` (id reservado
diferente de `basic` — abilities declaradas substituem a básica do boot, não somam a ela),
`fireball` (círculo raio 4 centrado no alvo), `firewave` (onda comprimento 8, sem alvo — sai do
monstro na direção de quem ele mira) e `heal` (defesa). `mitigation.immunities` só cobre `fire`
— `paralyze` e `invisible` do TFS não têm mecanismo equivalente no Draconya (não há condição de
paralisia nem invisibilidade, ver CMB-07 "Fora do escopo"), então a imunidade a eles não tem o
que ser declarada. Pela mesma razão, os flags `canPushItems`/`canPushCreatures`/`isBlockable`
do Canary (`monster.flags`) e a `strategiesTarget` ponderada (nearest 70 % / health 10 % /
damage 10 % / random 10 %) não existem no schema — `monsterTargetChangeSchema` só tem o ramo
`TARGETSEARCH_RANDOM` do TFS (ver acima), e o resto fica registrado aqui como o que falta ao
motor, não implementado por esta issue.

## Outcomes avançados: crítico, leech e mana shield (CMB-08, #335)

O CMB-02 devolvia um outcome; o CMB-04 tornou a defesa um estágio; o CMB-08 completa o resultado
com os modificadores aprovados e torna a **absorção de mana** um estágio visível. Nada disso
recalcula dano fora do resolver canônico, e nada entra no snapshot nem no S2C (DT-03).

### A ordem, congelada na emenda do ADR 0031

```text
raw power
  -> Dodge (1º sorteio, sempre)
  -> defesa/escudo (2º sorteio, só com fonte elegível e tipo aprovado)
  -> crítico (3º sorteio, só quando `modifiers.critical` é declarado)
  -> armadura -> piso -> resistência -> imunidade
  -> corte do Dodge -> multiplicador do crítico -> arredondamento
```

As três posições de sorteio são contrato. O crítico é o **último**: um estágio novo que precise
de sorteio próprio entra depois dele, e mover qualquer posição exige perfil novo.

### Defaults neutros: a ausência preserva o v1

`combat.modifiers` é **opcional**, e a ausência é o default neutro:

- **sem `modifiers`, nenhum sorteio novo é consumido** e o resultado é bit a bit o do
  CMB-02/03/04 — a sequência de RNG inclusive. Todo conteúdo que não declara modificador segue
  idêntico, e é o que o `damage.test.ts`/`conformance.test.ts` prendem;
- **`critical` declarado consome UMA rolagem mesmo com `chance: 0`**, como o bloqueio do CMB-04:
  a sequência não depende do VALOR;
- `lifeLeech`/`manaLeech` são fração do HP aplicado e **não consomem RNG**.

### Leech: base, clamp e evento

- A base é o **HP efetivamente removido** (`healthDamage`), nunca o resolvido: overkill não rende
  leech, e dano absorvido pela mana não rende leech nenhum.
- `lifeLeechApplied`/`manaLeechApplied` são o que de fato entrou — a vida limitada ao teto, a
  mana ao espaço livre. Atacante cheio informa zero, e o `creature-healed` de leech **não sai**:
  o número verde não mente.
- A fração é truncada (`floor`), nunca arredondada para cima.

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

### Escopo

Os modificadores entram pelo `DamageIntent` e o CMB-08 os liga aos **ataques básicos** (corpo a
corpo, distância e wand/rod), onde a fonte é `combat.modifiers`. Magia, runa, ability de monstro
e DOT seguem sem modificadores — declará-los é conteúdo novo sob o mesmo contrato. Reflect,
imbuements não aprovados, PvP e a janela de breakdown ficam fora.

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

### As magias por vocação (#156–#159)

Os números do TibiaWiki (2026-09-12) como estão em `packages/content/data/spells/*.json`; o teste da tabela é `load.test.ts`. Magia compartilhada entre vocações é um arquivo por vocação (`vocationId` é um só). Aproximações e valores provisórios estão no `_open` de cada arquivo.

**Knight (escala por `melee`)**

| level | magia | mana | grupo (tranca) | cd próprio | efeito | BP |
|---|---|---|---|---|---|---|
| 1 | Bruise Bane | 10 | healing (2 s) | 1 s | cura | 15 |
| 1 | Lesser Front Sweep | 6 | attack (2 s) | 6 s | dano · cleave | 14 |
| 8 | Wound Cleansing | 40 | healing (2 s) | 1 s | cura | 70 |
| 14 | Haste | 60 | support (2 s) | 2 s | haste +30 % / 30 s | — |
| 16 | Brutal Strike | 30 | attack (2 s) | 6 s | dano · alvo, alcance 1 | 39 |
| 20 | Blood Rage | 20 | support (2 s) + stance (2 s) | 2 s | postura 10 s | — |
| 20 | Protector | 20 | support (2 s) + stance (2 s) | 2 s | postura 10 s | — |
| 25 | Charge | 100 | support (2 s) | 2 s | haste +90 % / 5 s | — |
| 28 | Whirlwind Throw | 40 | attack (2 s) | 6 s | dano · alvo, alcance 5 | 32 |
| 33 | Groundshaker | 200 | attack (2 s) | 8 s | dano · círculo raio 3 no lançador | 32 |
| 35 | Berserk | 125 | attack (2 s) | 4 s | dano · círculo raio 1 no lançador | 44 |
| 50 | Recovery | 75 | healing (1 s) | 60 s | cura 20 a cada 3 s por 60 s | — |
| 70 | Front Sweep | 200 | attack (2 s) | 6 s | dano · cleave | 80 |
| 80 | Intense Wound Cleansing | 200 | healing (2 s) | 120 s | cura | 500 |

**Paladin (escala por `distance`)**

| level | magia | mana | grupo (tranca) | cd próprio | efeito | BP |
|---|---|---|---|---|---|---|
| 1 | Lesser Ethereal Spear | 6 | attack (2 s) | 8 s | dano · alvo, alcance 5 | 9 |
| 8 | Light Healing | 20 | healing (1 s) | 1 s | cura | 40 |
| 14 | Haste | 60 | support (2 s) | 2 s | haste +30 % / 30 s | — |
| 20 | Divine Defiance | 250 | support (2 s) + stance (10 s) | 10 s | postura 10 s | — |
| 20 | Intense Healing | 70 | healing (1 s) | 1 s | cura | 120 |
| 20 | Sharpshooter | 250 | support (2 s) + stance (10 s) | 10 s | postura 10 s | — |
| 23 | Ethereal Spear | 25 | attack (2 s) | 2 s | dano · alvo, alcance 5 | 25 |
| 35 | Divine Healing | 160 | healing (1 s) | 1 s | cura | 250 |
| 40 | Divine Missile | 20 | attack (2 s) | 2 s | dano · alvo, alcance 5 | 60 |
| 50 | Divine Caldera | 160 | attack (2 s) | 4 s | dano · círculo raio 3 no lançador | 150 |
| 50 | Recovery | 75 | healing (1 s) | 60 s | cura 20 a cada 3 s por 60 s | — |
| 55 | Swift Foot | 400 | support (2 s) + focus (2 s) | 4 s | haste +80 % / 10 s | — |
| 60 | Ethereal Barrage | 135 | attack (2 s) | 4 s | dano · círculo raio 1 no alvo, alcance 5 | 100 |
| 60 | Salvation | 210 | healing (1 s) | 1 s | cura | 500 |
| 70 | Divine Barrage | 175 | attack (2 s) | 4 s | dano · círculo raio 1 no alvo, alcance 5 | 130 |

**Sorcerer (escala por `magic`)**

| level | magia | mana | grupo (tranca) | cd próprio | efeito | BP |
|---|---|---|---|---|---|---|
| 1 | Buzz | 6 | attack (2 s) | 2 s | dano · alvo, alcance 3 | 15 |
| 1 | Magic Patch | 6 | healing (1 s) | 1 s | cura | 10 |
| 1 | Scorch | 8 | attack (2 s) | 4 s | dano · onda 2 | 10 |
| 6 | Apprentice's Strike | 6 | attack (2 s) | 2 s | dano · alvo, alcance 3 | 15 |
| 8 | Flame Strike | 20 | attack (2 s) | 2 s | dano · alvo, alcance 3 | 45 |
| 8 | Ice Strike | 20 | attack (2 s) | 2 s | dano · alvo, alcance 3 | 45 |
| 12 | Energy Strike | 20 | attack (2 s) | 2 s | dano · alvo, alcance 3 | 45 |
| 13 | Terra Strike | 20 | attack (2 s) | 2 s | dano · alvo, alcance 3 | 45 |
| 14 | Haste | 60 | support (2 s) | 2 s | haste +30 % / 30 s | — |
| 14 | Magic Shield | 50 | support (2 s) | 14 s | magic shield 180 s | — |
| 16 | Death Strike | 20 | attack (2 s) | 2 s | dano · alvo, alcance 3 | 45 |
| 18 | Fire Wave | 25 | attack (2 s) | 4 s | dano · onda 3 | 40 |
| 23 | Energy Beam | 40 | attack (2 s) | 4 s | dano · feixe 5 | 60 |
| 29 | Great Energy Beam | 110 | attack (2 s) + great-beams (6 s) | 6 s | dano · feixe 8 | 155 |
| 30 | Ultimate Healing | 160 | healing (1 s) | 1 s | cura | 250 |
| 38 | Energy Wave | 170 | attack (2 s) | 8 s | dano · onda 5 | 150 |
| 38 | Great Fire Wave | 120 | attack (2 s) | 4 s | dano · onda 4 | 100 |
| 55 | Lightning | 60 | attack (2 s) + special (8 s) | 8 s | dano · círculo raio 1 no alvo, alcance 5 | 110 |
| 55 | Rage of the Skies | 600 | attack (4 s) + focus (40 s) | 40 s | dano · círculo raio 5 no lançador | 200 |
| 60 | Hell's Core | 1100 | attack (4 s) + focus (40 s) | 40 s | dano · círculo raio 4 no lançador | 250 |
| 66 | Great Death Beam | 140 | attack (2 s) + great-beams (6 s) | 6 s | dano · feixe 5 | 155 |
| 70 | Strong Flame Strike | 60 | attack (2 s) + special (8 s) | 8 s | dano · alvo, alcance 7 | 125 |
| 80 | Strong Energy Strike | 60 | attack (2 s) + special (8 s) | 8 s | dano · alvo, alcance 7 | 125 |

**Druid (escala por `magic`)**

| level | magia | mana | grupo (tranca) | cd próprio | efeito | BP |
|---|---|---|---|---|---|---|
| 1 | Chill Out | 8 | attack (2 s) | 4 s | dano · onda 2 | 10 |
| 1 | Magic Patch | 6 | healing (1 s) | 1 s | cura | 10 |
| 1 | Mud Attack | 6 | attack (2 s) | 2 s | dano · alvo, alcance 3 | 15 |
| 6 | Apprentice's Strike | 6 | attack (2 s) | 2 s | dano · alvo, alcance 3 | 15 |
| 8 | Flame Strike | 20 | attack (2 s) | 2 s | dano · alvo, alcance 3 | 45 |
| 8 | Ice Strike | 20 | attack (2 s) | 2 s | dano · alvo, alcance 3 | 45 |
| 8 | Light Healing | 20 | healing (1 s) | 1 s | cura | 40 |
| 12 | Energy Strike | 20 | attack (2 s) | 2 s | dano · alvo, alcance 3 | 45 |
| 13 | Terra Strike | 20 | attack (2 s) | 2 s | dano · alvo, alcance 3 | 45 |
| 14 | Haste | 60 | support (2 s) | 2 s | haste +30 % / 30 s | — |
| 14 | Magic Shield | 50 | support (2 s) | 14 s | magic shield 180 s | — |
| 16 | Physical Strike | 20 | attack (2 s) | 2 s | dano · alvo, alcance 3 | 50 |
| 18 | Ice Wave | 25 | attack (2 s) | 4 s | dano · onda 3 | 35 |
| 20 | Intense Healing | 70 | healing (1 s) | 1 s | cura | 120 |
| 30 | Ultimate Healing | 160 | healing (1 s) | 1 s | cura | 250 |
| 36 | Mass Healing | 150 | healing (1 s) | 2 s | cura | 200 |
| 38 | Terra Wave | 170 | attack (2 s) | 4 s | dano · onda 5 | 120 |
| 40 | Strong Ice Wave | 170 | attack (2 s) | 4 s | dano · onda 5 | 150 |
| 55 | Wrath of Nature | 700 | attack (4 s) + focus (40 s) | 40 s | dano · círculo raio 5 no lançador | 175 |
| 60 | Eternal Winter | 1050 | attack (4 s) + focus (40 s) | 40 s | dano · círculo raio 4 no lançador | 200 |
| 70 | Strong Terra Strike | 60 | attack (2 s) + special (8 s) | 8 s | dano · alvo, alcance 7 | 115 |
| 80 | Forked Thorns | 180 | attack (2 s) | 6 s | dano · círculo raio 1 no alvo, alcance 5 | 97 |
| 80 | Strong Ice Strike | 60 | attack (2 s) + special (8 s) | 8 s | dano · alvo, alcance 7 | 115 |

**Ficam de fora, por nome** (ADR 0026 decisão 5): Light, Great Light, Ultimate Light, Find Person, Find Fiend, Magic Rope, Levitate, Invisible, Cancel Invisibility, Cancel Magic Shield, Creature Illusion (utilidade); Cure Poison, Cure Bleeding, Cure Curse, Cure Electrification, Cure Burning (condição); Inflict Wound, Holy Flash, Ignite, Electrify, Curse, Envenom (dano ao longo do tempo); Shield Bash, Shield Slam (defesa de escudo); Challenge (promoção); Train Party, Protect Party, Enchant Party, Heal Friend, Heal Party, Shared Conservation (party); Elemental Synthesis, Master of Decay/Flames/Thunder (elemento); Arrow Call, Conjure Arrow, Conjure Explosive Arrow, Enchant Spear, Conjure Wand of Darkness, Food (conjuração); Summon Creature (convocação). O Sorcerer não tem Light Healing nem Intense Healing no TibiaWiki de 2026 — a cura dele é Magic Patch e Ultimate Healing; as três magias genéricas (`heal`, `strike`, `blast`) continuam de todo mundo.

## Em aberto

- `[ABERTO]` A chance de bloqueio (`combat.defense.blockChance`, provisória em 0,6) e a defesa
  do spike sword (10) não vêm do PRD e ainda não foram medidas contra uma hunt com escudo.
- `[ABERTO]` A conversão do Base Power (`combat.spellPower`) é nossa e provisória — ver acima.
- `[ABERTO]` Os modificadores avançados (`combat.modifiers`: chance/multiplicador do crítico e as
  frações de life/mana leech) não estão declarados no conteúdo real: **ausente é neutro**, e
  ligá-los é conteúdo novo com `Content.version` novo. Os valores só entram quando medidos.
- `[ABERTO]` As fórmulas das famílias de arma (`levelFactor` e `spread`) são provisórias e estão
  zeradas para preservar o dano entregue (CMB-05). Ligar `spread` a um valor diferente de zero
  muda o consumo de RNG e exige perfil novo (ADR 0031).
- `[ABERTO]` Os números da Avalanche Rune (preço por uso, Base Power, raio, requisitos) são
  provisórios até a leitura da infobox do TibiaWiki. O elemento é `ice` desde o CMB-03.
- `[ABERTO]` `physical-strike` é dano físico no Tibia, mas fica em `arcane` nesta versão para
  não mudar o dano entregue (a armadura passaria a contar). Trocar para `physical` exige perfil
  novo (ADR 0031).
- `[ABERTO]` A conferência visual dos efeitos e projéteis de combate está bloqueada pela
  biblioteca local parcial (47 de 4171 folhas; nenhum sprite de efeito/projétil tem PNG). Nenhum
  id foi corrigido sem evidência — ver [`combat-presentation-audit.md`](../combat-presentation-audit.md).

Nenhum `[ABERTO]` do PRD atinge diretamente este sistema. Texto flutuante de XP e "miss"/"block"
ficam para quando o protocolo os carregar.

## Divergências do PRD

- **`monster.staticAttack` é aceito no schema, mas não muda comportamento nenhum** (#518). O
  TFS usa este número para decidir se o monstro, podendo atacar, fica parado ou dá um passo
  aleatório colado no alvo (`randomStepping`/`getDanceStep`) — puramente cosmético, não afeta
  dano nem cadência de ataque. O motor de passo do Draconya não tem um "pensamento" periódico
  independente do passo em si (`decideMonsterAction` só roda quando o `MONSTER_STEP` vence), e
  criar um evento novo só para o shuffle era escopo maior do que o #518 pedia. Fica registrado
  aqui, não como `[ABERTO]` — o número é conhecido (Dragon: 80%, `staticAttack: 0.8`), só o
  mecanismo que falta implementar.
