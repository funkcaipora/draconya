# Combate

**Status:** parcial — resolução de dano (FUN-35), motor de magias com alvo único, área e requisito de vocação (FUN-74, FUN-92) e skills por uso (FUN-75) implementados
**PRD:** §12
**Épico:** E2

## Comportamento

A matemática e o comportamento geral de combate usam o Tibia como referência funcional — fórmulas e parâmetros são tratados como conteúdo configurável, nunca como dependência de código ou catálogo proprietário. Duas regras do PRD desviam explicitamente dessa referência e valem como exceção fixa.

Primeira: ataques realizados pelo jogador sempre acertam o alvo. Não existe miss ofensivo do lado do jogador — o servidor não rola chance de acerto para o atacante, o que elimina metade da matemática de combate tradicional.

Segunda: existe o atributo Dodge no defensor. Quando o Dodge ativa, o ataque recebido causa metade do dano que causaria normalmente. Isso vale contra qualquer tipo de ataque recebido — incluindo magia e ataques de boss —, não apenas contra combate corpo a corpo. A chance de Dodge é percentual e pode vir de fontes como bônus permanentes de Bestiário.

Bônus permanentes obtidos via Bestiário são válidos apenas em PvE. O PvP (Guild War) não herda automaticamente essas vantagens de farm.

## O que já existe

`resolveDamage` em `packages/sim/src/combat/damage.ts`. Função pura a menos do RNG, que é o
**da sessão**: semeado e determinístico (FUN-25). `Math.random()` ali tornaria "por que eu
morri" uma pergunta sem resposta.

A ordem do cálculo, e cada passo tem um porquê:

1. **Rola o dodge — sempre**, mesmo contra alvo com chance zero. Pular a rolagem faria a
   sequência do gerador depender de um atributo do alvo, e aí dar dodge a um monstro
   deslocaria todo o loot que vem depois, num efeito que ninguém ligaria à causa.
2. Subtrai a armadura, com efetividade **por tipo de ataque** (hoje: vale contra corpo a
   corpo, não vale contra magia — provisório).
3. Aplica o **piso**: nem a armadura mais alta zera um golpe. Dano zero contra alvo pesado
   vira impasse silencioso, sem nada na tela dizendo o motivo.
4. Se esquivou, corta pela metade.
5. **Arredonda só no fim.** Arredondar antes do dodge faria 50% de 3 virar 2, e o jogador
   veria uma esquiva que reduziu um terço.

O bônus de Bestiário é **PvE-only por construção**: `resolveDamage` recebe o contexto, e o
acréscimo só entra quando ele é `pve`. A Guild War não tem como herdá-lo por esquecimento.

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

A taxa de hoje faz um rato sozinho **não** matar um personagem de level 1: ele apanha, mata, e
recupera durante o respawn. Três ratos ainda matam. É o balanceamento que as poções vão
reequilibrar quando existirem.

## Regras

- Ataques do jogador sempre acertam (sem rolagem de acerto ofensivo).
- Dodge, quando ativa no defensor, reduz o dano recebido em 50%.
- Dodge pode ativar contra qualquer ataque recebido, incluindo magia e ataques de boss.
- Bônus permanentes de Bestiário valem só em PvE; não se aplicam em Guild War.

## Parâmetros de balanceamento

| Parâmetro | Valor | Onde mora |
|---|---|---|
| Multiplicador de dodge | 0,5 (§12.2, decidido) | `packages/content/data/combat/baseline.json` |
| Efetividade da armadura — corpo a corpo | 1 `[ABERTO — valor provisório: 1]` | `packages/content/data/combat/baseline.json` |
| Efetividade da armadura — magia | 0 `[ABERTO — valor provisório: 0]` | `packages/content/data/combat/baseline.json` |
| Regeneração de vida | 1 HP/s `[ABERTO — valor provisório: 1]` | `packages/content/data/progression/baseline.json`, `regen.healthPerSecond` |
| Regeneração de mana | 1 mana/s `[ABERTO — valor provisório: 1]` | `packages/content/data/progression/baseline.json`, `regen.manaPerSecond` |
| Piso de dano, como fração do ataque | 0,1 `[ABERTO — valor provisório: 0,1]` | `packages/content/data/combat/baseline.json` |

| Parâmetro | Valor previsto | Onde mora em packages/content |
|---|---|---|
| Chance de acerto do jogador (ofensivo) | 100% fixo, sem rolagem | caminho previsto: `packages/content/combate` |
| Redução de dano quando Dodge ativa | 50% | caminho previsto: `packages/content/combate` |
| Escopo do bônus de Bestiário | PvE-only | caminho previsto: `packages/content/bestiário` |

O catálogo de magias e seus números de dano/custo/cooldown pertence a `progression.md` — este arquivo cobre só a matemática geral de acerto/Dodge.

## Magia usa a MESMA resolução de dano (FUN-74)

Uma magia de dano não tem matemática própria: ela chama `resolveDamage` com `kind: 'magic'`, e é
só isso que a distingue de um golpe. A consequência é que a efetividade da armadura contra magia
— hoje `0`, e provisória — vale por construção, e o dodge do defensor também: as duas são
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

Uma magia de dano pode declarar `area: { radius }`, em tiles a partir do **alvo** — distância de
Chebyshev, a mesma métrica da grade. Raio 1 pega o alvo mais os oito vizinhos.

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

- **Formas** (`effect.area.shape`, `packages/sim/src/area.ts`): `circle` (Chebyshev, centrado
  no alvo ou no lançador), `wave` (cone à frente: fileira k tem largura `2⌊k/2⌋+1` — 1, 3, 3,
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
de condição e dano ao longo do tempo (não há condições de monstro), magias de escudo, elemento e
resistência.

### Requisito de vocação (§9.2)

Uma magia pode declarar `vocationId`. Quem não a tem recebe `wrong-vocation`, e a recusa **não
tem prazo de retentativa** — esperar não faz ninguém virar druida, e reagendar por isso seria um
evento por segundo para redescobrir a mesma coisa.

O personagem nasce **sem** vocação e escolhe no level 8 (§7.4), então uma magia com requisito é
inacessível até lá por construção, sem nenhuma regra escrita em outro lugar.

## Como cada arma bate (#152, ADR 0026 decisões 3 e 4)

O alcance é da **arma**, não do personagem: `weapon.range` do item na mão (bow 6, wand e rod
3, corpo a corpo 1), e só desarmado vale `combat.player.attackRange`. O golpe despacha pelo
`weapon.kind`:

- **`melee`** — o `attack` do item pela skill corpo a corpo, como sempre.
- **`distance`** — o bow atira a **munição** da família dele (`ammoFamily`): a escolhida pelo
  jogador (`select-ammo`, guardada por família e persistida como preferência), ou a grátis. O
  dano é o `attack` da munição pela skill `distance` (nova, sobe por tiro). Cada tiro da
  munição paga debita `price` do gold do personagem e do agregado da sessão, como o supply
  (§20.1); sem gold para ela, o tiro sai com a grátis e o jogador é avisado uma vez por sessão
  (`ammo-fallback`) — o bot nunca para de atirar (invariante 11).
- **`wand`** — wand e rod gastam `manaPerHit` por golpe, causam dano **mágico** por faixa fixa
  (`damage.min..max`, uma rolagem do `Rng` da sessão por golpe, como o loot) e rendem magia
  pela mana gasta, como uma magia. Sem mana, o golpe não sai: fica para o intervalo seguinte.

O tiro emite um projétil (`shot` → `missile`), resolvido pela tabela de aparências no
hospedeiro: o da munição para a flecha, o da arma (`appearances.weapons`) para wand e rod. O
bow ocupa as duas mãos: com escudo vestido é recusado (`hands-full`), e vice-versa. Elemento
(energia, terra) é ignorado até haver resistência por elemento no monstro.

| Parâmetro | Valor | Onde mora |
|---|---|---|
| Bow — alcance | 6 | `packages/content/data/items/bow.json`, `weapon.range` |
| Wand of vortex — alcance, mana por golpe, dano | 3 / 2 / 8–18 | `packages/content/data/items/wand-of-vortex.json` |
| Snakebite rod — alcance, mana por golpe, dano | 3 / 1 / 8–18 | `packages/content/data/items/snakebite-rod.json` |
| Munição — attack e preço por tiro | arrow 25 / 0; sniper arrow 28 / 5 `[ABERTO — valor provisório: 5]`; onyx arrow 38 / 7 `[ABERTO — valor provisório: 7]` | `packages/content/data/ammunition/*.json` |
| Distância — início, curva, dano por nível | 10 / 50×1,1 / +2% `[ABERTO — valores provisórios]` | `packages/content/data/skills/distance.json` |

## O que o jogador vê (FUN-106, FUN-109)

O combate é calculado no `sim` e **apresentado** pelo host, como o passo (§12). Cada golpe
aplicado vira `creature-hit` — o número flutuante sobre a criatura, com o dano **aplicado**, e
não o resolvido: o golpe fatal mostra o que a criatura tinha, não o que o atacante bateu — e,
quando houve dano, um efeito de sangue no atingido. Cura vira `creature-hit` com `kind: heal`.
Magia vira `spell-cast` no `sim` e, pela tabela de aparências fixada na sessão, projétil do
conjurador ao primeiro alvo e um efeito **por alvo** (ou no conjurador, quando é cura); poção
vira efeito no tile de quem bebeu. Magia sem linha na tabela é muda, nunca erro. Quais ids são
esses mora em `packages/content/data/appearances/baseline.json` (`spells`, `supplies`, `hits`),
e só ids (invariante 6).

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

- `[ABERTO]` A conversão do Base Power (`combat.spellPower`) é nossa e provisória — ver acima.

Nenhum `[ABERTO]` do PRD atinge diretamente este sistema. Texto flutuante de XP e "miss"/"block"
ficam para quando o protocolo os carregar.

## Divergências do PRD

Vazio por enquanto. É aqui que vai o que foi construído diferente do especificado, e por quê.
