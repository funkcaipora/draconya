# Huntera observado — números de um Tibia-idle em produção

**Data da observação:** 2026-09-10
**Fonte:** conta de teste própria em `huntera.com.br`, personagem `Liesh Onshaw`, level 1 Rookie
**Como ler:** isto é **especificação de domínio**, no sentido do ADR 0019 — observação de um
jogo do mesmo gênero, rodando com jogadores de verdade. Não é alvo a copiar: é um ponto de
referência para os `[ABERTO]` do PRD deixarem de ser palpite.

O Huntera é um Tibia-idle brasileiro com RMT, e o PRD já o cita como referência de experiência
(§5.2 e §43). O que segue foi lido da tela do próprio jogo e do tráfego dele.

---

## 1. O que ele confirma da nossa arquitetura

Duas coisas que decidimos por raciocínio e que aparecem lá, iguais:

| Huntera | Draconya |
|---|---|
| `POST /api/game-tickets` → `201`, e só então o socket | `POST /api/tickets` (FUN-12, ADR 0001) |
| `GET /api/auth/me`, `GET /api/characters` | as mesmas duas rotas, com os mesmos nomes |
| `/things/1332/catalog-content.json` + `appearances-<hash>.dat` + `sprites-<hash>.bmp.lzma` | o layout da §13.1, e `THINGS_VERSION=1332` no `.env` |

O fluxo de ticket antes do socket não é invenção nossa nem coincidência: é o que este gênero
faz. Vale como confirmação independente do ADR 0001.

## 2. O que ele resolve do pipeline de assets (FUN-16, FUN-18)

O `catalog-content.json` real, de 4.175 entradas, respondeu duas perguntas que a FUN-16 teve de
deixar em aberto por falta de um pacote:

- **`area` é sempre `0`.** Em 4.171 folhas, nenhuma traz outro valor. Ler-e-ignorar estava
  certo, e agora está verificado.
- **A geometria por `spritetype` fecha nas quatro.** O maior número de sprites por folha é
  144, 72, 72 e 36 — que são exatamente 12×12, 12×6, 6×12 e 6×6, ou seja folha de 384×384 nos
  quatro casos, como a §13.1 documenta.

E um detalhe que não estava em lugar nenhum: **folha não é sempre cheia.** Os mínimos são 6 a
33 sprites por folha. Quem assumir "folha cheia" para calcular a faixa de ids vai errar a
última folha de cada tipo.

Tipos de entrada no índice: `appearances`, `sprite`, `staticdata`, `staticmapdata`, `map`.

## 3. Os números de um personagem level 1

Lidos da tela de personagem, sem equipamento, com a roupa inicial.

| | Huntera | Draconya (`content/data`) |
|---|---|---|
| Vida inicial | **100** | 150 (`progression/baseline.json`, `[ABERTO]`) |
| Mana inicial | **10** | 0 |
| Capacidade inicial | **1500 oz** | 400 |
| Velocidade | **278** | — (temos `stepDurationMs: 500`) |
| Skills de combate iniciais | **10** (punho, clava, espada, machado, distância, escudo, pesca) | 10 (`skills/*.json`) ✅ |
| Magic Level inicial | **0** | 0 ✅ |
| XP do level 1 → 2 | **100** | `xp: { base: 20, exponent: 2 }` → 20 |
| Stamina cheia | **12 h** | **24 h** (`stamina/baseline.json`) |
| Dano do ataque automático | **3 – 7** | `player.attackPower: 25` (`combat/baseline.json`, `[ABERTO]`) |

**As duas divergências que valem decisão:**

1. **Stamina de 12 h, não 24 h.** O nosso teto de 24 h é o teto de simulação do ADR 0001 — é
   ele que limita o custo de hunt desanexada. Metade disso é metade do custo, e o Huntera
   opera com 12 h. Não é razão para mudar sozinha, mas é evidência de que 24 h é escolha, e
   não obrigação do gênero.
2. **Dano 3–7 no level 1.** O nosso `attackPower: 25` está marcado `[ABERTO]` e é uma ordem de
   grandeza acima. Com 100 de vida do lado deles, um golpe de 25 mataria em quatro acertos.

## 4. Regeneração só acontece em caçada

A tela de personagem diz, nas duas linhas: **"Regeneração de vida: só em caçadas"** e
**"Regeneração de mana: só em caçadas"**.

Isto é uma regra de jogo com consequência econômica direta, e nós não a temos: o
`progression/baseline.json` tem `regen.healthPerSecond` e `manaPerSecond` que valem sempre.
Regenerar fora da hunt torna o tempo parado produtivo, o que empurra o jogador a ficar fora —
o oposto do que um jogo idle quer.

## 5. Bônus de experiência, e um multiplicador de level baixo

A tela lista cinco fontes somando um total:

| Fonte | No level 1 |
|---|---|
| Progresso no Bestiary | — |
| Experience Scroll | — |
| Bônus da guild | — |
| Bônus de Premium | — |
| **Bônus de level** | **+200%** |

O **bônus de level** é o interessante: um multiplicador que existe *porque* o personagem é de
level baixo, e que presumivelmente decai. É uma rampa de entrada que o nosso PRD não tem.

## 6. O vocabulário de automação deles

É a parte mais próxima do nosso motor de bot (§13, M6), e a que mais informa `[ABERTO]`.

**Política de alvo** — cinco, com estes valores exatos no `select`:

```
nearest · lowest-health · highest-health · lowest-health-percent · highest-health-percent
```

O nosso `bot/baseline.json` tem `advancedOnly.targetPolicies` **vazio**, porque a §13.2 não
decidiu a lista. Aqui está uma que funciona em produção — e note que ela distingue **vida
absoluta** de **percentual**, que são estratégias diferentes (rematar o quase-morto *versus*
focar o mais frágil).

**Postura de combate** — três: `Defesa total`, `Equilibrado`, `Ataque total`. É o fight mode do
Tibia, e nós não temos equivalente.

**Distância dos inimigos** — um campo numérico de distância a manter. É a mesma família do
nosso `lure`, mas expresso como **distância alvo** em vez de dois limiares de contagem.

**Barra de ações** — 20 slots, com **conjuntos nomeados** (`Default`, "salvar como novo
conjunto", "limpar a barra"). Nós temos 5 categorias com slots por categoria (37 no total) e
nenhum conceito de conjunto salvo.

## 7. O catálogo de caçadas

**55 caçadas**, listadas em ordem de progressão, e a primeira delas é literalmente
**`Rat Cellars` / `Rat`** — o mesmo nome que já está no nosso `hunts/rat-cellars.json`.

Cada linha do catálogo mostra três coisas: o nome, **a lista de monstros** e
`3 tamanhos de pull · N drops de loot`. A ordem é Rat Cellars → Spider Nest → Troll Hills →
Orc Camp → … → Infernal Gate (Demon) → Falcon's Eye.

**"Tamanho do pull" é um nome melhor que "dificuldade".** Nós chamamos de dificuldade o que a
`huntDifficultySchema` guarda como `monsterCount` (desde a FUN-123; era `perSpawnPoint`) —
quantos monstros vêm de uma vez. Eles
chamam pelo que é, e os três são `Cautelosa`, `Ousada`, `Agressiva`. Vale considerar renomear:
"dificuldade" sugere monstro mais forte, e não é isso que muda.

A tela de detalhe traz, antes de entrar: a **lista de loot possível** (Rat Cellars: Gold Coin,
Cheese), a descrição, e **"Encontrar time"** ao lado de "Iniciar caçada" — o matchmaking de
party mora na seleção de caçada, não numa tela à parte.

E há **recorde por caçada**: *"complete uma caçada de 5 minutos para marcar um recorde"*.

## 8. O que aparece DENTRO da caçada

Três ações no topo: **`DETALHES DA CAÇADA`**, **`DESPACHAR LOOT`**, **`SAIR DA CAÇADA`**.

**As barras mostram a regeneração como número:** `110/110 +10` e `15/15 +5`. É a regra da §4
tornada visível — o `+10` só existe porque o personagem está caçando.

**A stamina drena 1 min por minuto de caçada**, e a barra dela fica ao lado das outras.

### A caixa de loot da sessão expira em 15 minutos

```
Loot da sessão
Nada aqui ainda — vá caçar!
Clique para pegar — expira em 15 min
```

Nós temos a caixa (M8, §25) e **não temos o prazo**. Quinze minutos é uma decisão de produto
com consequência clara: loot não recolhido some, o que empurra o jogador a voltar — e é
exatamente o tipo de número que o PRD deixou `[ABERTO]`.

### O analisador é PREMIUM

```
SESSÃO ATUAL 00:01:06 · PRÓXIMO LEVEL --:--:-- · EXP TOTAL --- · EXP/H ---
LUCRO TOTAL --- · LUCRO/H ---
                                                        [Assinar Premium]
```

Duas coisas aqui. A primeira: eles mostram **tempo até o próximo level**, que é derivada e nós
não temos. A segunda, e maior: **o analisador inteiro é recurso pago**. O nosso §16 o trata
como parte do jogo. Não é evidência de que estejamos errados — é evidência de que dá para
monetizá-lo, e de que alguém no gênero achou que valia.

## 9. Progressão medida, level 1 ao 3

Um minuto de Rat Cellars, com o bot padrão e sem equipamento:

| | Level 1 | Level 2 | Level 3 |
|---|---|---|---|
| Vida | 100 | 110 | 120 |
| Mana | 10 | 15 | 20 |
| Bônus de XP | +200% | +199% | +197% |

**Por level, sem vocação: +10 de vida e +5 de mana.** O nosso `progression/baseline.json` tem
`healthPerLevel: 5` e `manaPerLevel: 5` — metade da vida.

**O bônus de level decai por level**, e devagar: dois pontos percentuais do 2 para o 3. É uma
rampa de entrada longa, não um empurrão de dois minutos.

E a velocidade importa: **level 1 → 3 em cerca de um minuto**, com 15 de gold e 6 itens de
loot. O começo do jogo deles é deliberadamente rápido.

## 10. O que NÃO dá para concluir daqui

- **Nada sobre o servidor deles.** Tudo acima é tela e tráfego HTTP; não há como saber como o
  laço de simulação funciona, se a hunt roda desanexada, nem a que taxa.
- **Nada sobre balanceamento de níveis altos.** O personagem observado é level 1.
- **Nada sobre licença de assets.** Eles servem o pacote do cliente do Tibia na versão 1332,
  como nós pretendemos; isso não diz nada sobre o risco que o ADR 0008 assume, só que não
  somos os primeiros a assumi-lo.

## 11. O que isto sugere abrir

Cada linha da §3 e da §6 que diverge é candidata a issue de balanceamento — em especial a
lista de políticas de alvo (§13.2, hoje vazia) e a regeneração fora de hunt, que é regra e não
número.

---

# Parte II — 2026-09-11: Thais, o bueiro e o protocolo, lidos do socket

**Data da observação:** 2026-09-11
**Fonte:** a mesma conta de teste, personagem `Liesh Onshaw`, agora level 7, no navegador
embutido do Claude Code
**Como foi lido:** desta vez não só a tela e o HTTP — o **WebSocket** foi capturado e
decodificado, e o bundle do cliente foi lido para nomear as mensagens. Continua valendo a
regra da Parte I: isto é especificação de domínio (ADR 0019), não alvo a copiar. E continua
sem dizer nada sobre o servidor deles além do que o protocolo mostra.

## 12. Como o socket foi capturado — para repetir sem redescobrir

O jogo fala num único WebSocket (`wss://w1.huntera.com.br/ws/<n>/`) que **não é recriado**
ao entrar ou sair de caçada: o mesmo socket atravessa Cidade e hunt. Por isso um gancho no
construtor de `WebSocket` só pega o que nasce depois dele — e a página recarrega no login,
levando o gancho junto. O que funcionou foi interceptar **`WebSocket.prototype.send`**: a
primeira chamada (o `ping`, a cada 5 s) entrega a instância viva, e aí basta
`addEventListener('message')` nela. Vale para o socket que já existia antes do gancho.

Cada frame é binário: `u32 seed` (LE) + o resto mascarado por um xorshift semeado por
`seed ^ 1213550164` (uma palavra de máscara a cada 4 bytes), e dentro `u8 flags` + corpo.
`flags & 1` é corpo comprimido com **deflate cru** (fflate, nível 3, acima de 8 KiB);
`flags == 2` é **lote**: sequência de `u32 len` + frame completo (com seed e flags próprios).
O corpo é JSON `[opcode, props]`, e a tabela `opcode → nome` está no bundle
(`chunk-BPR2FEWZ.js`, objetos `ut` para servidor→cliente e `je` para cliente→servidor). É o
mesmo desenho do nosso `protocol/` — opcode numérico, compressão acima de um limiar, lote —
com uma máscara por cima que não é segurança, é ofuscação.

## 13. A Cidade é Thais de verdade, vinda de um OTBM

Ao entrar, o servidor manda **uma vez por conexão** `scenario-terrain` e depois
`instance-enter`:

```
scenario-terrain { terrainId: "otbm:thais.otbm:769c4551e28c", tiles: [...] }
instance-enter   { instanceId: "city-global", scenarioId: "main-city",
                   ambience: "surface", terrainId: "otbm:thais.otbm:769c4551e28c",
                   groundItems: [] }
```

O `terrainId` diz de onde o mapa veio: **um arquivo `thais.otbm`** — o formato do Remere's
Map Editor —, identificado pelo hash. E os tiles confirmam que é o mapa real: com o templo
deles em `(1071, 1067, 7)` e o templo de Thais no mapa comunitário do Canary em
`(32369, 32241, 7)`, o deslocamento é `(+31298, +31174)`, e sob ele os 40.485 tiles existem
no recorte `x ∈ [32275, 32458]`, `y ∈ [32153, 32291]` do `otservbr.otbm` (release v3.6.1 do
Canary): **83% dos chãos e 97% das pilhas de itens são idênticos tile a tile**; o resto são
retoques do editor deles ou outra versão do mesmo mapa — os totais por andar batem (z0 27,
z1 40, z2 78, z3 214 nos dois).

O terreno inteiro:

| | |
|---|---|
| tiles | **40.485**, numa caixa de 184 × 139 |
| andares | z0 (27) · z1 (40) · z2 (78) · z3 (214) · z4 (1.756) · z5 (6.447) · z6 (8.361) · **z7 (23.562)** |
| bloqueados / com itens | 18.977 / 19.173 (pilha de até 8 itens) |
| ids de aparência distintos | 1.259 |

Cada tile é `{ position: {x, y, z}, ground: { uid, appearanceId }, items: [{ uid,
appearanceId }], blocked }` — **o bloqueio já vem decidido pelo servidor**, o cliente não
deriva nada de flag. O mesmo formato serve a tela de personagens (`/assets/gate/
temple-terrain.json`, 1.189 tiles, com uma lista `standable` de tiles em que a câmera pode
parar).

**`ground` pode ser `null`, e o tile continua existindo**: 5.149 dos 40.485 tiles (12,7 %)
não têm chão — todos têm ao menos um item, 90 % são bloqueados (muro, água funda), e 507 são
andáveis, como os degraus de escada em que o item É o chão. Um importador que descarte "tile
sem chão" apaga escadas.

**Andares, e o que se vê de cada um.** O terreno traz z0–z7 e o cliente desenha só do andar
do jogador **para baixo** (`t.z < eye.z` é oculto): em z7 não há telhado — o interior das
casas aparece —, e em z6 (o segundo andar do depot) a rua de z7 continua visível por baixo,
escurecida por um véu por andar. Elevação é `height.elevation` acumulada com teto de 24 px;
`top` desenha acima das criaturas; `clip` é borda de chão; `shift` desloca o sprite. O
cliente (Phaser, não Pixi) monta o terreno em pedaços de 24 × 24 tiles e só constrói os que a
janela toca.

## 14. Andar por Thais

Setas **e** WASD (os dois estão no bundle, `walkKeys`), só nas **quatro direções cardeais**:
com duas teclas presas vale a pressionada por último, e nenhuma combinação vira diagonal — das
29 mensagens `walk` capturadas, nenhuma é diagonal; diagonal só sai do `walk-to { target }`
do clique. O cliente manda **um** `walk { direction }` ao apertar e **um** `walk-stop` ao
soltar; quem repete o passo enquanto a tecla está presa é o servidor.

Os passos voltam como `creature-move { id, from, to, durationMs }`, e na Cidade a duração é
**150 ms por tile, para todo mundo** — Liesh tem `speed: 292` e um level 328 tem 850, e os dois
andam a 150 ms na praça. Não é a fórmula do Tibia; é uma escolha de produto: a Cidade não é
simulação, e andar nela é navegação.

**Trocar de andar é um `creature-move` só**, com `z` diferente e, como no Tibia, o tile de
chegada deslocado: subir pela escada do depot foi `(1051,1052,7) → (1052,1051,6)`; descer,
`(1052,1051,6) → (1052,1053,7)`. Nenhuma outra mensagem acompanha — o terreno já tinha os
dois andares.

**Campo de visão de 16 tiles**: todo `creature-appear` durante a caminhada chegou a exatamente
16 de distância de Chebyshev, e o `creature-disappear` correspondente ao sair. `creature-turn`
muda só a direção; `creature-resync` reenvia a lista.

## 15. A caçada, do catálogo à saída

`hunt-catalog` traz as 58 hunts, e cada uma é `{ id, name, description, monsters: [{ name,
outfitId, bestiaryId, elements }], tiers: [{ name, monsterCount, monsterIndexes, loot }],
loot: [{ itemId, name, rarity, … }] }`, com `bests` (recorde) e `portrait` só quando existem
— 1 hunt em 58 traz cada um. **"Tamanho do pull" é `monsterCount`**: Cautious 2, Bold 5,
Reckless 8 em 34 das 35 hunts de um monstro só (Haunted Tomb é 1/2/4); Orc Fortress tem um
quarto, Suicidal. Rat Cellars: `id: "rat-hunt"`, loot gold coin (3031) e cheese (3607),
recorde solo 2.066 XP/h e 1.293 gp/h.

A entrada:

```
→ start-hunt { huntId: "rat-hunt", tier: 0 }
← hunt-pending { hunt: { huntId, tier } }        o personagem ANDA até o portal na cidade
← hunt-pending { hunt: null }                     ~4,6 s depois
← instance-enter { instanceId: "rat-hunt-681", scenarioId: "rat-hunt",
                   ambience: "cavern", terrainId: "otbm:rook-rats.otbm:e99a63cac841" }
← hunt-analyzer-session { startedAt, durationMs: 0 }
→ client-ready
```

`ambience` é só apresentação: `cavern` liga o escurecimento por mapa de luz no cliente, e
nada no jogo (regeneração, stamina) lê o campo.

Dois fatos que o nome do arquivo entrega. **A Rat Cellars é Rookgaard**, não o bueiro de
Thais: `rook-rats.otbm`, 9.396 tiles numa caixa de 118 × 80, um andar só (z7 local, o bueiro
de ratos de Rookgaard é z8 no mapa real), 2.041 tiles livres. E cada hunt é **um OTBM
próprio, com coordenadas locais** — o mesmo x ≈ 1050 aparece em Thais, na tela de
personagens e no bueiro, porque cada recorte foi salvo do editor como mapa independente.

Dentro dela, o passo segue a fórmula do Tibia: Liesh a `speed 292` andou a **450, 550 e 700
ms** conforme o chão (velocidade de chão 130, 160 e 200: `1000 × chão / speed`, arredondado
para cima em múltiplos de 50), e a **diagonal custou 3×** (2.100 ms). Os ratos (`speed 172`)
andaram a 700–1.200 ms na reta e 3.500 na diagonal — os mesmos 3×. Cada abate deixa **cadáver no chão** (`ground-item-appear` com
aparência 5964, que some sozinho), o loot vai à caixa da sessão (`loot-drop`, `loot-update`),
o golpe é `creature-hit { attackerId, targetId, value, effect }` e o projétil
`projectile-move { kind, from, to, durationMs }` (180 ms para 3 tiles). `experience-gain`
por abate; `bestiary-progress { kills, stages, killsRequired }`.

Sair: `leave-hunt` → `hunt-leave-pending { remainingMs: 5000 }` → cinco segundos depois,
`instance-enter` de volta a `city-global`, no mesmo socket.

`player-stats` é o personagem inteiro, a cada mudança: `health/maxHealth`, `mana/maxMana`,
`healthRegen/manaRegen` (10 e 5 na hunt, **zero na Cidade**, como a Parte I já dizia),
`manaShield*`, `level`, `speed` (292 no 7), `speedBonus`, `magicLevel/magicProgress/
magicProgressNeeded`, `experience/experienceNeeded`, `skills` e `skillProgress/
skillProgressNeeded` por perícia (fist, club, sword, axe, distance, shielding, fishing),
`skillBonuses`, `capacity` (156766 = 1.567,66 oz), os cinco `*BonusPercent` de XP
(`levelBonusPercent 192`), `vocation: null`, um bloco `combat` (`armor, defense, attackMin 9,
attackMax 19, weaponAttack, attackSkill: "fist", criticalChance/Extra, lifeLeech,
manaLeech, bestiaryDamage, protection`), `cooldowns` (`attack, heal, support, item,
spells`), e a stamina: `staminaMs` (43.200.000 = 12 h cheia, na Cidade; 43.158.502 e caindo
na hunt), `staminaDraining`, `staminaRefillCost/GainMs/RefillsLeft`, e um
**`huntSessionRemainingMs` de ~4 h** — a sessão de caçada tem teto, que a tela não mostra.

## 16. O que NÃO dá para concluir daqui

- **Nada sobre o servidor deles**, como na Parte I: o protocolo mostra o que sai, não como é
  calculado — nem se a hunt roda desanexada, nem a que taxa.
- **Nada sobre a licença do mapa.** O `otservbr.otbm` é uma reprodução comunitária do mapa da
  CipSoft, na mesma classe de risco do pacote de arte (ADR 0008), e a Parte II só mostra que o
  Huntera o usa. A decisão de usá-lo, e de nunca versioná-lo, é do ADR 0025 (FUN-116), não
  desta observação. A fonte de um importador nosso seria esse mapa comunitário — **nunca os
  recortes do Huntera**, que são deles.
- **Nada sobre o que está fora da janela**: 16 tiles de raio é o que o servidor manda; o
  resto do comportamento dos outros jogadores não foi visto.

## 17. O que isto muda para o Draconya

- **Cidade e hunt vêm do mesmo mapa comunitário que já temos como referência**, recortados
  com o editor. O caminho é um importador de OTBM, não um editor de mapa nosso.
- **A pilha de itens por tile é o produto**, não chão + parede. Sem ela, Thais não é Thais.
- **Andares existem desde o primeiro dia**: o depot tem escada, e a troca é um passo com `z`.
- **A Cidade anda rápido e igual para todos**; a hunt anda pela fórmula do Tibia (chão ×
  1000 / speed, diagonal × 3). São dois regimes, e os dois são conteúdo.
- **Entrar na hunt é andar até um portal**, não um teletransporte do menu — a caminhada
  automática pela cidade (A*, §11 da referência OpenTibia) entra na conta.
- **Campo de visão de 16 tiles**, contra a nossa célula de 10 com dois limiares (FUN-33).

# Parte III — 2026-09-12: o inventário, a munição e o gold, lidos da mesma captura

As mensagens abaixo estavam na captura da Parte II (`huntera-walk-frames.json` e
`huntera-hunt-frames.json`, o gancho do §12) e não tinham sido lidas. Elas respondem "como o
Huntera organiza bolsa e mochila", que o ADR 0026 precisava.

## 18. `player-inventory`: dez slots, uma mochila de 20 e uma bolsa de 10

Sai no attach, inteiro:

```json
{ "type": "player-inventory",
  "slots": [ { "uid": 1367652, "itemId": 3607, "count": 72, "cumulative": true, "name": "cheese",
               "attack": 0, "defense": 0, "armor": 0, "weight": 400 }, null, null, … ],   // 20
  "satchel": [ null, null, null, null, null, null, null, null, null, null ],             // 10
  "equipment": { "helmet": null, "amulet": null, "backpack": { "uid": 1367653, "itemId": 2854,
                 "count": 1, "name": "backpack", "weight": 1800, "slot": "backpack",
                 "imbuementSlots": 1, "imbuable": [ { "category": "capacity", "maxTier": 3 } ] },
                 "armor": null, "weapon": { "uid": 1367654, "itemId": 3074, "count": 1,
                 "name": "wand of vortex", "attack": 0, "range": 3, "weight": 1900, "slot": "weapon" },
                 "shield": null, "ring": null, "legs": null, "boots": null, "ammo": null },
  "gold": 602 }
```

- **Dez chaves de equipamento**, as do Tibia: `helmet, amulet, backpack, armor, weapon, shield,
  ring, legs, boots, ammo`.
- **`slots` é a mochila**, um vetor posicional de 20 (`slotCount: 20` no delta); **`satchel` é
  uma bolsa fixa de 10** (`satchelCount: 10`), que não aparece em nenhum slot de equipamento — é
  do personagem, não é item.
- **O item leva `uid` (a instância), `itemId` (o id do cliente 13.x: queijo 3607, mochila 2854,
  wand of vortex 3074, gold coin 3031), `count` e `cumulative`** (empilha) — e os atributos base
  repetidos por item (`attack, defense, armor, weight`, `range` na arma), que nós mandamos pelo
  catálogo uma vez.
- **O gold fica fora dos containers** (`gold: 602`): é saldo, não item.
- O personagem level 7, `vocation: null`, segurava a wand of vortex com `weaponAttack: 0` no
  `player-stats`: **arma de vocação não bate sem vocação**, mas pode ser carregada.

## 19. `inventory-delta`: o loot cai na mochila por índice

A cada abate com loot, um delta por container e índice — o queijo indo de 71 para 72 no lugar 0:

```json
{ "type": "inventory-delta",
  "changes": [ { "container": "backpack", "index": 0,
                 "item": { "uid": 1388145, "itemId": 3607, "count": 72, "cumulative": true, … } } ],
  "slotCount": 20, "satchelCount": 10, "gold": 594 }
```

O gold do loot vai direto no campo `gold` do mesmo delta (`loot-drop { item: gold coin, count:
2 }` chega ao lado, só para a animação). Não há mensagem de "bolsa cheia" na captura; com 72
queijos numa pilha só, ela nunca encheu.

## 20. `ammo-selection`: munição é uma escolha, não uma pilha

```json
{ "type": "ammo-selection", "arrow": null, "bolt": null }
```

Uma seleção por **família** — `arrow` para bow, `bolt` para crossbow —, e não um item no slot
`ammo` (que existe na `equipment` e ficou `null` o tempo todo). Sem paladino na captura, os
dois ficaram nulos; o que se conclui é a forma: a munição escolhida é um id por família, e o
consumo dela não passa pelo inventário. É a decisão 3 do ADR 0026.

## 21. O que mais estava lá, sem ser lido a fundo

`hunt-sell-rules { onCapacityFull: true, everyHalfHour: false }` e `quick-sell-update { itemIds:
[3607] }` — a autovenda deles é por regra (vender ao lotar a capacidade, ou a cada meia hora) e
por lista de itens; `auto-loot-update { disabledItemIds: [] }` — o auto-loot é liga/desliga por
item; `action-bar-update` com 20 slots e uma poção condicionada a `health <= 70%`. Ficam como
referência para a autovenda (§22) e para a action bar, quando entrarem.

## 22. O que isto muda para o Draconya

- **Mochila e bolsa são dois vetores posicionais**, não uma lista plana — o cliente desenha
  lugar vazio, e mover item é trocar índices. O Draconya adota os dois com 20 e 10 lugares
  iniciais, e cresce por linhas enquanto houver capacidade (ADR 0026, decisão 6).
- **A munição é seleção por família**, com a grátis por padrão e as pagas debitando gold por
  tiro (ADR 0026, decisão 3).
- **O gold não ocupa lugar**, como já era aqui.
