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

A cada abate com loot, um delta por container e índice — o queijo passando a 71 no lugar 0 (mensagem 98 de `huntera-hunt-frames.json`):

```json
{ "type": "inventory-delta",
  "changes": [ { "container": "backpack", "index": 0,
                 "item": { "uid": 1388145, "itemId": 3607, "count": 71, "cumulative": true, … } } ],
  "slotCount": 20, "satchelCount": 10, "gold": 594 }
```

O gold do loot vai direto no campo `gold` do mesmo delta (o `loot-drop { item: gold coin, count:
4 }` da mensagem 96 chega logo antes, só para a animação; o delta seguinte com o queijo, na
mensagem 263, leva `count: 72` e `gold: 602`). Não há mensagem de "bolsa cheia" na captura; com
72 queijos numa pilha só, ela nunca encheu.

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

---

# Parte IV — 2026-09-22: o bot por dentro, lido de uma party de level 300+

**Fonte:** conta própria, personagem `Funkcaipora` (Royal Paladin 360), numa party de quatro
(EK 306 líder, ED 354, MS 324) na hunt **Issavi Steppe**, ~11 minutos de socket decodificado
(83.446 frames) mais a leitura da barra de ações pela própria interface. Tudo continua sendo
**especificação de domínio** no sentido do ADR 0019: o que o jogador vê e configura, e o que o
servidor manda — nunca o código deles.

## 23. O decodificador, agora exato

A §12 dizia "xorshift"; a função é esta, lida do bundle (`chunk-FGPCPUBX.js`) e reescrita:

```ts
const SALT = 1213550164;
function unmask(bytes: Uint8Array, seed: number) {
  let r = (seed ^ SALT) >>> 0; if (r === 0) r = SALT;
  for (let n = 0; n < bytes.length; n++) {
    if ((n & 3) === 0) { r ^= r << 13; r >>>= 0; r ^= r >>> 17; r ^= r << 5; r >>>= 0; }
    bytes[n] ^= (r >>> ((n & 3) << 3)) & 255;
  }
}
// frame = u32 seed LE + unmask(resto): u8 flags + corpo; flags&1 = deflate-raw (>= 8 KiB),
// flags==2 = lote de (u32 len + frame). Corpo: JSON [opcode, props].
```

O gancho em `WebSocket.prototype.send` continua sendo o caminho (o `ping` a cada 5 s entrega
o socket vivo). As tabelas `ut` (S2C, 177 opcodes) e `je` (C2S, 180) estão no mesmo chunk.

## 24. A barra de ações é o bot — regra por slot

Vinte slots. Cada slot é **uma ação** (aba `Magias`, `Runas` ou `Itens`) mais **uma lista de
condições**, e o servidor dispara a ação sozinho quando a regra passa ("Bebe sozinha quando a
regra dela passa"). O editor de um slot tem exatamente isto:

- **Ação:** uma magia da vocação (paladin: Haste, Intense Healing, Ethereal Spear, Divine
  Healing, Divine Missile, Divine Caldera, Salvation, Strong Ethereal Spear, Swift Foot,
  Sharpshooter), uma runa (UH, HMM, Fireball, Holy Missile, Icicle, Stone Shower,
  Thunderstorm, Avalanche, GFB, Explosion, SD) ou uma poção. Runa e poção mostram o **custo em
  gold por uso** no próprio slot (UH 160, Avalanche 55, SD 150, Ultimate Spirit 195, Strong
  Mana 108); a magia mostra mana e cooldown ("160 de mana · 4s de cooldown").
- **Condições:** `sujeito × atributo × comparador × valor`, com `%` opcional. Sujeito:
  `Você | Alvo | Área | Aliado | No alcance`. Atributo: `HP | Mana | Alvos | Preso |
  Paralisado | Magic shield`. Comparador: `< | <= | == | >= | >`. `Aliado` ganha um
  multiplicador `×1…×6` ("quantos aliados"). **Todas precisam bater; sem condição, dispara
  sempre.**
- **Alvo da cura** (só cura): `Você mesmo | Membro da party com menos vida | Membro da party:
  <nome> | Jogador pelo nome…`.
- **Monstros ignorados** (só ataque): lista por ação.
- **Ativada** (liga/desliga sem apagar — o slot fica com `rule-off`).
- **Conjuntos:** `Default`, salvar como novo, limpar, "abrir o builder", **copiar como
  código** e **importar por código** — o preset é serializável e compartilhável.

A configuração real do Funkcaipora, do jeito que estava:

| # | Ação | Condições | Estado |
|---|------|-----------|--------|
| 1 | Ultimate Spirit Potion | Você HP ≤ 30% | on |
| 2 | Ultimate Spirit Potion | Você HP ≤ 60% **e** Você Mana ≤ 60% | on |
| 3 | Strong Mana Potion | Você Mana ≤ 60% | on |
| 5 | Divine Caldera (área) | Você Mana ≥ 20% **e** Área Alvos ≥ 2 | **off** |
| 6 | Divine Healing (`exura san`) | Você HP < 85% **e** Você HP > 75% | on |
| 7 | Salvation (`exura gran san`) | Você HP ≤ 75% | on |
| 10 | Ultimate Healing Rune | Alvo da cura HP ≤ 50%, alvo = membro com menos vida | on |
| 13 | Avalanche Rune | Área Alvos ≥ 2 | on |
| 14 | Strong Ethereal Spear (`exori gran con`) | (nenhuma) | on |
| 15 | Ethereal Spear | Você Mana ≥ 20% | off |
| 16 | Divine Missile | Você Mana ≥ 20% | off |
| 17 | Sudden Death Rune | (nenhuma) | on |
| 18 | Swift Foot (`utamo tempo san`) | Você Mana ≥ 70% | on |
| 19 | Haste | Você Mana ≥ 20% **e** Você Paralisado == 1 | on |
| 20 | Sharpshooter | Você HP ≥ 80% **e** No alcance Alvos ≥ 1 | off |

Duas regras vêm do catálogo, não do slot: Swift Foot "só lança sem nada no alcance e acaba no
momento em que você ataca"; Sharpshooter "sem defesa, 30% mais lento e sem cura ou suporte
enquanto durar".

## 25. Estratégia de alvo, e o que "Seguir" faz de fato

O `select` "Alvo" tem `nearest | boss | lowest-health | highest-health |
lowest-health-percent | highest-health-percent` (a §6 tinha cinco; **`boss` é novo**) mais um
`follow-member-<id>` por membro da party. Numa versão do mesmo select aparece
`follow-party-leader` genérico.

Com `follow-member-12116` (o knight) ligado, 150 trocas de alvo em 11 minutos disseram o que a
opção significa:

- **O alvo é o monstro adjacente ao membro seguido.** Em todas as trocas com monstro a 1 tile
  do knight, o escolhido estava a 1 tile do knight — e a 2–6 do paladin. Não é o mais próximo
  do paladin nem o de menor vida entre todos; é o que o knight está segurando.
- **Sem monstro colado no knight** (início do pull), o alvo é o que o knight escolheu ao
  longe (7 tiles dele, 9 do paladin).
- **O alvo é pegajoso:** zero trocas com o alvo ainda vivo. A troca vem **0–100 ms depois**
  do `creature-disappear` do alvo anterior — no mesmo tick ou no seguinte.
- `player-target { targetId | null }` é a única mensagem: o servidor decide, o cliente
  só exibe.

## 26. Postura e distância — e a nota de changelog

Três posturas (`defensive | balanced | aggressive`, "Defesa total / Equilibrado / Ataque
total") e um número, **"Distância dos inimigos"** (3 no Funkcaipora). O changelog do jogo, no
mesmo dia da captura, diz o que a distância significa em party:

> Os setups de distância de personagens Caster/Ranged agora utilizam o Knight/Tank da Party
> como referência, quando aplicável. Casters e ranged tentarão manter melhor o posicionamento
> em relação ao Knight. O Paladin, quando configurado para distância 1, passa a preferir ficar
> ao lado do Knight, em vez de ocupar o mesmo tile.

A referência da distância segue uma prioridade, anotada pelo dono do projeto na mesma data:
**boss > monstro > knight da party (se configurado)** — o ranged mede a distância do boss quando
há boss, do monstro quando não há, e do knight só quando o jogador escolheu segui-lo.

O tráfego confirma: distância de cada membro ao knight, contada a cada passo de qualquer um
dos dois —

| Membro | Distância (moda) | Faixa com 90% dos passos | No mesmo tile |
|--------|------------------|--------------------------|---------------|
| RP (distância 3) | 3 | 2–5 | 1 em 3.000 |
| ED | 4 | 3–6 | 1 |
| MS | 4 | 3–6 | 0 |

- O seguidor **reage no mesmo tick ou no seguinte**: 580 passos a 0 ms do passo do knight,
  283 a 100 ms, 78 a 200 ms.
- Ele anda a **150/200 ms por tile** (speed 868; chão 130 e 150: `ceil50(1000 × chão /
  speed)`), diagonal 550 (`ceil50(3×)`). Os monstros confirmam a fórmula com chão 150: speed
  366 → 450 ms, 386 → 400, 445 e 482 → 350, 518 → 300; diagonal 366 → 1.250.
- Distância de projétil: 1 a **7** tiles (`projectile-move`), com o alvo a 2–6.

## 27. Cadência: dois relógios de ataque e quatro grupos de cooldown

`player-stats.cooldowns` é `{ attack, heal, support, item, spells: { <id>: ms } }`, e o teto
observado de cada um diz o tamanho:

| Grupo / magia | Cooldown |
|---------------|----------|
| `attack` (arma **e** runa de ataque) | 2.000 ms |
| `heal` | 1.000 ms |
| `support` | 2.000 ms |
| `item` (poção) | 1.000 ms |
| avalanche-rune, sudden-death-rune | 2.000 ms |
| ultimate-healing-rune, divine-healing, salvation | 1.000 ms |
| strong-ethereal-spear | 8.000 ms |
| swift-foot | 10.000 ms |

- **A arma tem relógio próprio:** flechas a cada 2.000–2.100 ms (144 de 150 intervalos).
- **A runa de ataque tem outro:** Avalanche a cada 2.000–2.100 ms também, mas **defasada** da
  flecha em 1,5–1,9 s na maioria dos ciclos — ela dispara assim que o grupo `attack` da runa
  libera, sem esperar a flecha. `player-stats` mostra `attack` e `avalanche-rune` com o
  mesmo valor logo após o lançamento (1.6xx), e `strong-ethereal-spear` com o dela.
- **Diamond arrow acerta em área:** um disparo de flecha gerou `creature-hit` em 1 a 14
  criaturas no mesmo instante (moda 5–12); Avalanche, em 2 a 17. É por isso que o RP de
  distância 3 mata a 1,4k de DPS com um alvo só selecionado.
- **Crystalline arrow é a reserva:** 30 disparos em 231 foram `crystallinearrow` — a regra de
  munição (`set-ammo-rules`, §20) troca quando a principal acaba ou por condição.

## 28. O que a rotação fez em 11 minutos

Ditos do paladin (`creature-say`, com `itemId` quando é item), contra o HP% que o servidor
tinha acabado de mandar em `creature-health`:

- `exura san` (Divine Healing) — 84 vezes, sempre com HP entre 85 e 100% *lido depois da
  cura*, o que bate com a janela 75–85% no instante do disparo.
- `exura gran san` (Salvation) — 26, com HP lido 77–91%: disparou abaixo de 75%.
- `Aaaah...` (`itemId 237`, Strong Mana Potion) — 22, com mana lida 63–64%: regra ≤ 60%.
  Ultimate Spirit Potion não foi usada (HP nunca ficou ≤ 30%, nem ≤ 60% com mana ≤ 60%).
- `Ultimate Healing` (runa 3160) — 17, com o HP do paladin em 89–90%: **curou outro membro**
  (alvo da cura = "membro com menos vida", ≤ 50%).
- `exori gran con` — a cada 8 s exatos quando há alvo; `Avalanche` a cada 2 s com ≥ 2 no
  raio; `Sudden Death` só 3 vezes (sem condição, mas compete pelo grupo `attack`).
- `utamo tempo san` (Swift Foot) — só com **zero monstros na tela**, em pares 10 s
  apartados, entre pulls: "lança sem nada no alcance e acaba ao atacar".

O knight (líder): `exeta res` 80 e `exeta amp res` 43 (puxa a aggro para si), `exori gran`
79, `exori min` 69, `exura ico` 358, `exura med ico` 109, `utamo tempo` 40, `utani hur` 17,
e **482 poções**. O druid: `exura sio "<nome>"` 268 vezes, quase sempre no knight — o alvo
da cura dele é "Membro da party: Sucuri", não "menos vida" (só 103 das 268 foram no membro de
menor HP%).

## 29. O que a hunt manda além do combate

- `hunt-analyzer-update` a cada ~10 s: `durationMs`, `kills`, `experience`,
  `rawExperience`, `damageInput: [{ channel: fire|earth|holy|energy|physical|death, value }]`,
  `loot: [{ itemId, name, count, value }]`, `lootValue`, `supplies: [...]`, `waste`. É o
  analisador inteiro, calculado no servidor.
- `party-update`: `leaderId`, `members: [{ id, name, vocation, level, healthPercent,
  manaPercent, dps, hps, damageTotal, healTotal, staminaMinutes, followsLeader }]`,
  `sharedCosts: { active, inHunt, offerPending, spent: [{ id, gold }] }` — o **rateio de
  gasto** é do servidor e aparece no painel ("Gasto médio do grupo / Sua parte: paga").
- `creature-restore { id, value, vital: health|mana }`, `creature-critical { id }`,
  `creature-turn { id, direction }`, `world-effect { position, appearanceId, delayMs? }`
  (10.643 em 155 s — é o efeito por tile de cada área).
- Regras de saída e venda ligadas ao grupo: "Saindo sozinho: alguém do grupo sair" e
  "Vendendo sozinho: a bolsa encher, a cada 30 minutos" (`set-hunt-exit-rules`,
  `set-hunt-sell-rules`).
- C2S do bot: `battle-settings`, `set-action-slot`, `save-/select-/delete-action-bar-preset`,
  `import-action-bar`, `request-action-bar-preset`, `set-action-bar-managed`,
  `sort-action-bar`, `clear-action-bar`, `party-follow-leader`, `set-ammo-rules`,
  `select-ammo`, `set-auto-loot`. S2C: `action-bar-update`, `action-bar-presets`,
  `battle-settings-update`, `player-target`.

## 30. O que NÃO dá para concluir daqui

- **Como o knight escolhe o alvo dele** — só se vê o resultado (o monstro que ele segura).
- **A ordem de avaliação dos slots** quando duas regras passam no mesmo tick (a barra
  parece ser avaliada da esquerda para a direita, mas 11 minutos não separam isso de
  "cura antes de ataque").
- **O que "Preso" e "Magic shield" medem** exatamente, e o que `boss` faz sem boss na hunt.
- **Se a distância é mantida por A\* ou por passo guloso** — o seguidor nunca ficou preso,
  mas a Issavi Steppe é aberta.

---

# Parte V — 2026-09-22: Rat Cellars e Rotworm Caves, catálogo e Cyclopedia

**Fonte:** conta de teste (`Liesh Onshaw`, level 8, sem vocação), mensagens `hunt-catalog` e
`cyclopedia-catalog` decodificadas do socket na tela de personagem. **Não houve captura dentro
das hunts**: ao entrar no jogo o personagem caiu numa escolha permanente de vocação, que é do
dono da conta, e nada foi escolhido. Spawn, cadáver e rota destas duas hunts continuam com os
valores da Parte II (§15) e os `[ABERTO]` de `docs/product/hunt.md`. Os números de referência
do Canary (v3.6.1, `data-otservbr-global/monster/`) entram ao lado como **especificação de
domínio** (ADR 0019): números, nunca código.

## 31. O catálogo tem 73 hunts, e a oitava é a Rotworm Caves

`rat-hunt` (Rat Cellars) é a primeira; depois Spider Nest, Troll Hills, Swamp Troll Cave, Orc
Camp, Folda Icefields, Bone Crypt, **`rotworm-hunt` (Rotworm Caves)**, Dwarf Mines, Minotaur
Maze… Cada uma tem **um monstro só** — nem Cave Rat nem Carrion Worm existem no catálogo deles
(154 monstros na Cyclopedia). Os três tiers são iguais nas duas: `Cautious 2 · Bold 5 ·
Reckless 8`.

| | Rat Cellars | Rotworm Caves |
|---|---|---|
| `id` | `rat-hunt` | `rotworm-hunt` |
| descrição | "Damp cellars full of rats. The classic first hunt." | "Sluggish rotworms that take a beating." |
| monstro (`outfitId`) | Rat (21) | Rotworm (26) |
| loot (raridade) | gold coin (common), cheese (common) | gold coin (common), sword e mace (semi-rare), meat e ham (uncommon), worm (semi-rare), lump of dirt (uncommon), legion helmet (semi-rare) |
| recorde solo | 2.066 XP/h · 1.293 gp/h | 9.346 XP/h · 2.610 gp/h |

Os itens do loot vêm com os números do item: sword `3264` (atk 14, def 12, 35 oz, 2 slots de
imbuement, `sword`), mace `3286` (atk 16, def 11, 38 oz, `club`), legion helmet `3374`
(armor 4, 31 oz, helmet), meat `3577` (13 oz), ham `3582` (20 oz), worm `3492` (0,05 oz),
lump of dirt `9692` (0,68 oz), gold coin `3031` (0,1 oz), cheese `3607` (4 oz).

## 32. A Cyclopedia deles: o monstro em números

```
rat      maxHealth 20  experience 5   speed 172  attack 3–4  a cada 2.000 ms
         elements { earth +20, holy +20, ice −10, death −10 }   killsRequired 2500
         loot: gold coin (common, max 4) · cheese (common)
rotworm  maxHealth 65  experience 40  speed 180  attack 24–30 a cada 2.000 ms
         elements: nenhum   killsRequired 2500
         loot: gold coin (common, max 17) · sword · mace (semi-rare) · meat · ham (uncommon)
               worm (semi-rare, max 3) · lump of dirt (uncommon) · legion helmet (semi-rare)
```

`elements` é o **modificador de dano recebido em porcentagem** (earth +20 = sofre 20 % a
mais de terra) — o mesmo sinal do `percent` do Canary. O `speed` deles é o do Canary
**mais 100** (rat 67+100 = 167 ≈ 172? não: o rato do Canary anda a 67 e o deles a 172;
rotworm 58 → 180 — a relação não é linear e fica como observação, não como fórmula).

## 33. O que o Canary diz dos mesmos dois monstros

Do `rat.lua` e do `rotworm.lua` (v3.6.1), só os números que a Cyclopedia deles não mostra:

| | Rat | Rotworm |
|---|---|---|
| `armor` / `defense` / `mitigation` | 1 / 5 / 0,07 | 8 / 10 / 0,28 |
| `corpse` | 5964 | 5967 |
| melee | 0–8 a cada 2.000 ms | 0–40 a cada 2.000 ms |
| loot (chance em 1/100.000) | gold coin 100.000 (max 4) · cheese 39.410 | gold coin 71.760 (max 17) · sword 3.000 · mace 4.500 · meat 20.000 · ham 20.120 · worm 3.000 (max 3) · lump of dirt 10.000 · legion helmet 1.890 |

As raridades do Huntera **batem com estas chances**: `common` ≥ 70 %, `uncommon` 10–20 %,
`semi-rare` 2–5 %. É a tabela que o Draconya usa para converter raridade em `chance`.

## 34. Onde fica a caverna, no mapa comunitário

Sem o terreno deles, a caverna vem do `otservbr.otbm` pelos spawns do próprio Canary
(`world/otservbr-monster.xml`): o maior bolsão **só de Rotworm e Carrion Worm** do mapa,
sem nenhum outro monstro, é um andar único em **z 9, x 32097..32158, y 32312..32395** (46
rotworms e 19 carrion worms). Recortado na caixa `x 32090..32175, y 32300..32400, z 9..9`
o importador lê ~7.300 tiles, ~3.200 andáveis numa **componente única**, 6 degraus de escada
(que a rota não pode pisar) e nenhuma aparência desconhecida no pacote 1332. A Rat Cellars,
para comparar, tem 2.043 andáveis em 118 × 80.

## 35. O que NÃO dá para concluir daqui

- **Nada de dentro das hunts:** respawn, cadáver, rota do bot, dano real por golpe. A Parte
  II (§15) registrou um rato novo 1,0–2,5 s depois de um sumir — é o único número de spawn.
- **O recorte deles da Rotworm Caves.** O nosso é escolha nossa (ADR 0025), não cópia.
- **Chance de loot deles.** Só a raridade; a chance vem do Canary (§33).

---

# Parte VI — 2026-09-22 (noite): dentro da Rat Cellars e da Rotworm Caves

**Fonte:** a mesma conta de teste, agora **Druid** (escolha do dono da conta), 4,8 min dentro
da Rat Cellars e 4,1 min dentro da Rotworm Caves, tier Cautious, socket decodificado
(3.026 e 3.192 frames úteis), terreno das duas hunts capturado. O personagem lutou de punho
(nenhuma arma na barra) e só lançou Light Healing sozinho — o bot padrão de um personagem
novo é **uma** regra: poção de vida com HP ≤ 70 %, postura `defensive`, `keep-distance 3`,
alvo `nearest` (`action-bar-update` e `battle-settings-update` na entrada).

## 36. Os números medidos por dentro

| | Rat | Rotworm |
|---|---|---|
| HP (dano até morrer, abates solo) | 22 e 22 (11 pares golpe→% batem em 20) | 66 (32 pares batem em 62,5) |
| dano no jogador por golpe | 3–4 (331 golpes) | 24–30, mediana 26 (93 golpes) |
| intervalo de ataque do monstro | ~2.050 ms | ~2.050–2.400 ms |
| XP por abate (level 8, bônus de level +190 %) | 15 (base 5) | 116 (base 40) |
| loot visto | gold 2–3 (2 de 2), cheese (1 de 2) | gold 7, lump of dirt (1 abate) |
| **cadáver no chão** | **29.995 ms** (aparência 5964) | **29.986 ms** (aparência 5967) |
| passo do monstro reto / diagonal | 800 / ~2.300 ms (speed 172) | 750 / ~2.200 ms (speed 180) |
| passo do jogador reto / diagonal | 450 / ~1.400 ms (speed 294) | igual |

Tudo cabe na fórmula da §26: `ceil50(1000 × 130 / 172) = 800`, `ceil50(1000 × 130 / 180) =
750`, `ceil50(1000 × 130 / 294) = 450`, diagonal `ceil50(3×)`. O chão das duas cavernas
vale 130. **O cadáver dura 30 s nas duas** — o `[ABERTO]` de `corpseTtlMs` (10 s) fecha
aqui. O golpe de punho do jogador saiu a cada ~2.050 ms, igual ao do monstro.

## 37. O que "solo" quer dizer lá: instância compartilhada

`instance-enter` deu `rat-hunt-385` e `rotworm-hunt-402` — **shards numerados**, não uma
instância por personagem — e o fluxo de `creature-appear` trouxe mais de uma dúzia de outros
jogadores reais (com level, montaria e outfit) caçando no mesmo mapa. "Solo" é a regra de
posse de loot e XP, não isolamento físico. Consequência para quem mede: os pares
`creature-disappear → creature-appear` misturam respawn de verdade com monstro entrando e
saindo do raio de visão por causa dos outros; a mediana ficou em ~2,3 s (rato) e ~6,8 s
(rotworm), com distância mediana de 33 e 3,6 tiles entre morte e nascimento — **ruído, não
número**. O raio de aggro também não se isola: monstro novo aparece a 16–21 tiles (a borda
da rede) e o primeiro passo fecha para 11–13.

O Draconya **não copia isto**: a hunt é uma sessão instanciada (ADR 0027), e é o que permite
o resultado não depender de quem mais está no mapa (invariante 3).

## 38. A Rotworm Caves deles é a caverna de rotworms de Darashia

O terreno (`otbm:rotworm-cave.otbm:479f7f7c0c7f`, 6.321 tiles numa caixa 88 × 73, 902
andáveis) foi casado contra o `otservbr.otbm` por votação de assinaturas chão + item: **472
votos** para o deslocamento `(+32091, +31392, z8)` contra 65 do segundo colocado, e o mesmo
método devolve a Rat Cellars exata (198 votos em `(+31018, +31154, z8)`). A caverna é a de
**Darashia, z 8, `x 33098..33185, y 32401..32473`** — o importador lê exatamente 6.321 tiles
e 902 andáveis, os mesmos números deles, sem candidato a escada, com 35 spawns de Rotworm (e 7
de Terramite, que eles não usam) do arquivo de spawns do Canary dentro da caixa. É uma
componente principal de 823 tiles mais um corredor isolado de 79 na borda direita. O nosso
recorte da #511 (§34) era outra caverna, três vezes maior e mais aberta; a paridade pede a de
Darashia.

O bot deles andou 38 tiles distintos no bueiro e 174 na caverna, revisitando — **caminhada
oportunista atrás do alvo mais próximo**, não laço fixo. É a diferença que o ADR 0009 assume
de propósito.

## 39. O que NÃO dá para concluir daqui

- **Respawn e aggro** (§37): a instância compartilhada contamina os pares.
- **Chance dos itens raros do rotworm**: um abate só.
- **Analisador**: `hunt-analyzer-update` não é enviado a conta sem Premium.
- **Os pulls Bold e Reckless**: só o Cautious foi jogado.
