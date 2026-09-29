# 0025 — O mapa real vem de um OTBM: recorte por região, pilha de aparências por tile, andares

**Status:** aceito
**Data:** 2026-09-12
**Contexto técnico:** `content` (schema de mapa), `sim` (movimento, andares), `server` (o que a
sessão diz ao cliente), `client` (desenho do tile), `tools` (importador), `things/` (onde o
mapa mora)

## Contexto

Até aqui o mundo era uma grade ASCII de um andar (`#` bloqueia, `.` é livre), um chão e uma
parede por mapa, e uma praça de 10×10. Foi o suficiente para provar a sessão que sobrevive ao
navegador (M3) e o loop da hunt (M4–M10). Não é o suficiente para o que o produto pediu em
seguida: **Thais**, e a primeira hunt "exatamente como no Huntera".

A observação do Huntera (`docs/reference/huntera-observed.md`, Parte II) mostrou o que "igual"
significa em dados: a Cidade deles é `otbm:thais.otbm` — 40.485 tiles, 184×139, andares z0–z7,
cada tile com um chão e uma **pilha de itens** por id de aparência —, e os tiles existem todos,
tile a tile, no recorte `x ∈ [32275, 32458]`, `y ∈ [32153, 32291]` do mapa comunitário
`otservbr.otbm` (Canary v3.6.1, 184 MB). A Rat Cellars deles é outro OTBM, `rook-rats.otbm`: o
bueiro de ratos de Rookgaard (z8 do mapa real), 9.396 tiles num andar só. Nada disso é
"mecanismo de engine": é **conteúdo**, e o ADR 0019 não o cobre.

Quatro perguntas ficaram sem dono, e cada issue do M11 as redecidiria sozinha:

1. de onde vem o mapa, e onde ele mora — considerando que é dado derivado do mapa da CipSoft;
2. como um tile deixa de ser um caractere e passa a ser uma pilha, sem `content/` virar arte;
3. como existe "andar", se `Tilemap` tem um `z` só;
4. como o passo passa a custar o que o chão custa — e por que a Cidade não segue essa regra.

E as cinco perguntas da §75 da referência OpenTibia, respondidas para "mapa e tile" (§9) e
"movimento" (§10):

1. **Mecanismo genérico:** `Map → Tile → { ground, items, creatures }`, com flags agregadas por
   tile (bloqueio, PZ, troca de andar); duração do passo = `chão × 1000 / speed`, diagonal ×3.
2. **Casos de borda conhecidos:** tile sem chão mas com item (degrau); o mesmo tile gravado
   duas vezes no arquivo; item com `unpass` em qualquer posição da pilha bloqueia o tile
   inteiro; troca de andar desloca o tile de chegada.
3. **Específico do Tibia:** os ids, o formato OTBM, as flags do `appearances.dat`, os 3× da
   diagonal, o teto de elevação de 24 px.
4. **Conflita com o Draconya:** a Cidade inerte (ADR 0004) não tem relógio para a fórmula de
   passo por chão — e não precisa dela; o TFS carrega o mundo inteiro, nós carregamos um
   recorte por instância (ADR 0009, sessões isoladas).
5. **Versão mínima:** um importador que recorta região e andares, uma `Tilemap` com andares e
   velocidade de chão, escadas autoradas, e o cliente lendo a pilha de um arquivo servido como
   arte.

## Decisão

**O mundo do Draconya é um recorte do mapa real do Tibia, importado de um OTBM, com a pilha de
itens de cada tile.** Em nove pontos:

1. **Fonte.** `otservbr.otbm` do release v3.6.1 do Canary (`mapDownloadUrl` do
   `config.lua.dist`), fixado por versão e SHA-256 e baixado por `pnpm map:fetch`, como
   `assets:fetch:1098` faz com o pacote 10.98. Os ids de item do arquivo são **ids de cliente**
   — os do `appearances.dat` — desde que o Canary extinguiu o `items.otb` (PR #204). A fonte é
   o mapa comunitário; **nunca os recortes do Huntera**, que são deles.
2. **É a mesma classe de risco do ADR 0008, e recebe o mesmo tratamento.** O OTBM é uma
   reprodução comunitária do mapa da CipSoft. **Nunca é versionado**: mora em `things/maps/`
   (gitignorado, como toda a arte), e o ADR 0008 ganha a emenda "mapa também".
3. **O importador escreve dois produtos, um por consumidor.**
   - `packages/content/data/maps/<id>.json` — o que o **servidor** precisa e é pequeno: por
     andar, grade de bloqueio (`#`/`.`) e grade de velocidade de chão (`bank.waypoints`, por
     paleta), `entryPoint`, `floorChanges` (escadas), e `source: { file, sha256, region }`.
     É versionado, é o que o `sim` lê, e é o que `computeVersion` congela na sessão
     (invariante 7). É derivado do mapa, mas é só geometria — nenhuma arte.
   - `things/<versão>/maps/<id>.json` — a **pilha de aparências por tile**
     (`[x, y, z, ground, [itens…]]`, coordenadas locais ao recorte), servida ao cliente pela
     mesma rota `/things/` que serve os sprites. Não é conteúdo: é arte por id, no volume da
     arte. O invariante 6 continua valendo na letra e no efeito.
   - `pnpm map:import --check` entra no `pnpm check` ao lado de `assets:inventory --check`:
     regenera em memória e compara; sem o OTBM na máquina, avisa e pula.
4. **Bloqueio deriva das flags, no importador, uma vez.** Um tile é `#` se o chão ou qualquer
   item da pilha tem `unpass`. Tile sem chão mas com item **existe** e é decidido pelas flags
   dos itens (12,7 % dos tiles de Thais são assim; os degraus de escada estão entre eles). Só
   tile sem chão e sem item fica fora do mapa. O `sim` nunca vê flag: vê `#` e `.`.
5. **Andares desde o primeiro dia.** `Tilemap` passa a ter `floors` por `z`; a troca de andar é
   **um passo com `z` diferente** — `creature-move` já carrega `Point` com `z` —, cujo destino
   vem de `floorChanges: [{ from, to }]`, autoradas à mão para o recorte (são poucas escadas; o
   importador lista os candidatos pelo nome da aparência). Nada de `items.xml` do Canary como
   fonte de dado.
6. **Dois regimes de passo, os dois em conteúdo.** Na hunt, `ceil50(chão × 1000 / speed)`,
   diagonal ×3 — a fórmula do Tibia (§10.1 da referência), com `speed` em progressão e monstro
   no lugar do `stepDurationMs` fixo por criatura. Na Cidade, `city.stepDurationMs` fixo —
   150 ms, cópia do Huntera, **decidido pelo usuário em 2026-09-11**; o regime do PvP se decide
   quando o PvP existir.
7. **`instance-enter` deixa de ser opcode morto.** O `game` o emite em toda entrada e
   reanexação, com `{ instanceId, map }`, e `session-state.world.mapId` para de ser `null`. É
   por ele que o cliente sabe qual arquivo de `things/maps/` buscar.
8. **A Rat Cellars é o bueiro de ratos de Rookgaard**, como no Huntera — z8 do mapa real —,
   **decidido pelo usuário em 2026-09-11** ("Rookgaard, copiar"). O recorte é
   `x ∈ [32022, 32139]`, `y ∈ [32168, 32247]`, z8 — o bueiro sob a vila —, encontrado
   casando as assinaturas dos tiles do terreno do Huntera contra o mapa real: os 9.396 tiles
   deles existem ali, com 9.386 chãos e 9.392 pilhas idênticas (FUN-118). A entrada continua **pelo menu, abrindo
   uma instância**: sem portal na cidade. **Três tamanhos de pull** com os nomes do Huntera
   (Cauteloso/Ousado/Agressivo) e `monsterCount` total (2/5/8) no lugar das quatro
   dificuldades do PRD §14.5. **Cadáver no chão, só visual, sem loot** — o loot continua na
   caixa da sessão. Isto **reverte** o "sem cadáver" que o ADR 0019 lista como decisão nossa
   (ele ganha a emenda); "sem loot no chão" continua valendo.
9. **Regra de conflito no OTBM.** Um mesmo tile pode aparecer em mais de um `OTBM_TILE_AREA`
   (verificado no arquivo real, centenas de blocos com a mesma base). O importador acumula por
   coordenada absoluta e **o último vence**, contando e reportando conflitos — resultado
   determinístico por ordem de leitura. `TILE_FLAGS` (PZ, no-logout) são ignorados: a Cidade
   inteira já é PZ por construção (ADR 0004).

## Alternativas

- **Editor de mapa próprio, ou mapas autorados à mão na grade ASCII** — descartada: Thais são
  40 mil tiles com 1.259 aparências distintas; à mão é outro produto, e não é "igual ao
  Huntera".
- **Mandar o terreno pelo WebSocket a cada conexão, como o Huntera faz** — descartada: são
  megabytes por login que não mudam entre logins; um arquivo estático em `/things/` é cacheado
  pelo navegador e pelo nginx, como as folhas de sprite já são.
- **Versionar o mapa importado no repositório** — descartada: é dado derivado do mapa da
  CipSoft, e o repositório é público. A geometria (bloqueio, velocidade, escadas) é versionada
  porque o servidor precisa dela e ela não reproduz arte nem layout visível.
- **Bloqueio decidido no servidor a partir das flags, em runtime** — descartada: o servidor não
  carrega o pacote de arte (ADR 0008), e não vai passar a carregar por causa disto.
- **Fórmula do Tibia também na Cidade** — descartada pelo usuário: a Cidade é navegação, não
  simulação, e o Huntera anda a 150 ms para todo mundo.
- **Bueiro de Thais em vez de Rookgaard** — descartada pelo usuário; é o mesmo importador com
  outra região, e fica registrado como alternativa barata.
- **Portal na cidade com caminhada automática (A*) até ele** — descartada pelo usuário: a hunt
  abre pelo menu, como hoje.

## Consequências

- O mundo passa a ser reconhecível: Thais com pilares, fontes, mármore, o depot com escada, o
  bueiro escuro. É o que o produto pediu.
- `content/` ganha um formato de mapa por andar e um campo `source`; mapas autorados à mão
  (a adega 10×10 de teste) continuam válidos como açúcar de um andar só.
- `sim` ganha `z` no movimento e uma duração de passo por chão — `movement.ts` continua o
  único escritor de posição, e a equivalência 1 Hz = 10 Hz continua propriedade da fila
  (ADR 0020), porque a duração é calculada no vencimento, não acumulada.
- O cliente ganha o desenho de pilha do Tibia (chão → borda → bottom → comuns → criaturas →
  top; elevação com teto de 24 px; deslocamento), lido do OTClient (MIT) como regra, não como
  código. Fica mais caro por quadro — medido na FUN-121 — e nunca instancia o que está fora
  da janela.
- Um artefato a mais no deploy: o volume `things` passa a carregar `maps/` além das folhas.
  Staging precisa dele antes de o servidor apontar `city.mapId: "thais"` — o cliente sem o
  arquivo desenha retângulos, não quebra.
- O risco jurídico aumenta na mesma direção do ADR 0008: mais um dado derivado da CipSoft fora
  do repositório. A reversibilidade é a de sempre — o importador aceita outro OTBM, e a
  geometria versionada é regenerável de qualquer fonte.
- **Dois regimes de passo** são uma regra a mais para explicar ao jogador; a Cidade a 150 ms é
  o que o gênero faz, e o PvP fica em aberto.
- O que fica fora, e continua fora até ter issue: casas, NPCs, depot como sistema, teleportes,
  waypoints, luz, minimapa, telhado transparente.

## Invariantes afetados

Nenhum. A decisão precisa respeitar dois, e respeita:

- **6 (`content/` nunca contém arte)** — a pilha de aparências mora em `things/`; em `content/`
  entra só geometria (`#`/`.`, velocidade, escadas) e ids de conteúdo. Nenhum caminho de arte.
- **7 (versão de conteúdo fixada na sessão)** — o mapa versionado entra no `computeVersion`;
  trocar o recorte muda a versão, e uma hunt que começou no recorte antigo termina nele.

Emenda o ADR 0008 (mapa na mesma classe da arte) e o ADR 0019 (o cadáver visual deixa de ser
"decisão nossa em que o TFS é o exemplo do que não fazer"; o loot no chão continua sendo). O
ADR 0009 continua de pé: a rota da hunt segue fixa e sem pathfinding, agora sobre uma grade
importada.

## Emenda — 2026-09-22 (#511): a Rotworm Caves é o mesmo recorte, outra caverna

A decisão 8 acima decide a Rat Cellars; esta emenda repete a forma para a segunda hunt do
Draconya, a oitava do catálogo do Huntera, primeira com loot de item de verdade.

**O recorte** é `x ∈ [33098, 33185]`, `y ∈ [32401, 32473]`, z8 — a caverna de rotworms de
Darashia, a mesma que o Huntera usa. A #511 tinha recortado outra caverna (`x ∈ [32090, 32175]`,
`y ∈ [32300, 32400]`, z9, achada pelo maior bolsão de spawn do arquivo do Canary): três vezes
maior e mais aberta, mas não a de verdade. O terreno capturado de dentro da hunt do Huntera
(`docs/reference/huntera-observed.md` Parte VI §36–§38, 2026-09-22 à noite: `otbm:
rotworm-cave.otbm:479f7f7c0c7f`, 6.321 tiles numa caixa 88×73, 902 andáveis) foi casado contra o
`otservbr.otbm` por votação de assinaturas chão+item — 472 votos para o deslocamento
`(+32091, +31392, z8)` contra 65 do segundo colocado, o mesmo método que já tinha achado a Rat
Cellars exata (198 votos). `pnpm map:import --id rotworm-caves --x 33098..33185 --y 32401..32473
--z 8..8` lê 6.321 tiles, com 902 andáveis e 5.419 bloqueados, e lista 0 candidatos a escada.

**Sem `--keep-from`, mas por outro motivo do que na primeira versão desta emenda.** Ao contrário
do que se pensava, esta caixa NÃO é uma componente andável única: são duas — uma principal de
823 tiles (a caverna de fato) e um corredor isolado de 79 tiles na borda direita, sem conexão com
a principal dentro da caixa (Parte VI §38). `--keep-from` apararia a caixa para a bbox da
componente principal, perdendo a correspondência 88×73 com o recorte do Huntera; em vez disso, a
rota simplesmente nunca visita o corredor isolado — verificado tile a tile (nenhum tile da rota
tem `x ≥ 78`, a coluna onde o corredor isolado começa).

**A rota** usa 13 dos 35 pontos de spawn de Rotworm do arquivo de spawn do Canary dentro da
caixa (a Terramite, 7 pontos, fica de fora — o Huntera usa só Rotworm), todos na componente
principal. A primeira tentativa — os 13 escolhidos por ordenação angular direta ao redor do
centroide, com `--via` igual a `--spawn` — fechava um laço de 276 tiles, mas uma simulação de
dez minutos no pull Cauteloso (nível 8 desarmado) morria em ~70 s: um dos pontos ficava junto a
um funil de 2 tiles de largura que prendia o combate corpo a corpo. A versão final evita os 9
pontos do lobo que só se alcança por aquele funil e separa o FORMATO do laço (`--via`, 26 pontos,
para maximizar o tempo de caminhada entre os dois lugares que o `Spawner` mantém sempre ativos no
Cauteloso) da lista DECLARADA de spawn (`--spawn`, um subconjunto de 13): `pnpm route:trace --id
rotworm-caves --map rotworm-caves --z 8 --via … --spawn …` (os pares exatos estão no comentário
de entrega da #515) fecha um laço de 444 tiles com 13 pontos de spawn, verificado antes de
gravar: nenhuma perna pisa no corredor isolado. Mesmo assim, a sobrevivência de dez minutos no
Cauteloso não foi confirmada em simulação de trial (morte medida entre 272 s e 357 s, contra os
8–30 HP de margem, sem morrer, que o recorte anterior da #511 media nas mesmas condições) — a
caverna de Darashia é genuinamente menor. Contra o mapa REAL e com o bot padrão do personagem
(cura automática, FUN-114) — o cenário que o Huntera de fato usa —, o teste de dez minutos
sobrevive com HP mínimo 74/165, próximo do 116/170 do Druid observado (Parte VI §36); ver
`docs/product/hunt.md` §"Em aberto" para o registro deste risco.

**O monstro** é o rotworm do Canary v3.6.1 (65 HP, 40 XP, ataque 24–30, armadura 8, speed 180),
sem elementos — a Cyclopedia não lista nenhum, ao contrário do rato (que resiste terra e
sagrado). É bem mais forte que o rato, e por isso o critério de sobrevivência de dez minutos
desarmado só é medido no pull Cauteloso (2 vivos); Ousado e Agressivo pressupõem equipamento
que ainda não existe.

**A entrada continua pelo menu**, abrindo uma instância — sem portal na cidade, como a Rat
Cellars. Três tamanhos de pull com os nomes do Huntera (2/5/8) e `respawnDelayMs: 2000` — o
mesmo valor adotado na Rat Cellars (#510, PR #512), a partir da observação do Huntera (Parte II
§15).

## Emenda — 2026-09-25 (#519): a Darashia Dragon Lair é a primeira hunt MULTIANDAR

A decisão 5 (andares desde o primeiro dia) previa a travessia; até aqui nenhuma hunt a
exercitava — Rat Cellars e Rotworm Caves são recortes de um andar só. O M28 (ADR 0037, fidelidade
ao Tibia) pede a Darashia Dragon Lair, três andares de dragão, como primeira hunt copiada
diretamente do **Canary** (não do Huntera): a fonte dos 47 pontos de spawn é
`data-otservbr-global/world/otservbr-monster.xml`, o mesmo arquivo que a referência
`docs/reference/opentibia-engine-reference.md` documenta o mecanismo de, e `dragon.lua` lista
"Darashia Dragon Lair" nas localizações do Bestiário — confirmando o local.

**O recorte** é `x ∈ [33185, 33270]`, `y ∈ [32195, 32315]`, `z 10..12` (86×121). A caixa dos 47
spawns reais é mais justa — `x ∈ [33196, 33269]`, `y ∈ [32202, 32311]` —, mas o recorte importado
precisa de margem: os conectores entre andares (abaixo) caem fora dessa caixa apertada.
`pnpm map:import --id darashia-dragon-lair --x 33185..33270 --y 32195..32315 --z 10..12
--allow-unknown` lê 17.848 tiles: z10 2.036 andáveis de 8.591 (a sala dos 19 Dragon), z11 1.849
de 7.539 (a sala dos 24 Dragon Lord), z12 173 de 1.718 (a sala dos 4 Dragon Lord do fundo — bate
com a TibiaWiki, "o terceiro nível tem 4 Dragon Lords"). `--allow-unknown` porque o recorte
inclui bordas de salas vizinhas com aparências fora do pacote 1332 conferido.

**Os conectores entre andares SÃO degraus reais do Canary, cruzados por item id contra
`items.xml`** (correção de 2026-09-25, revisão adversarial da #535: a primeira versão desta
emenda registrava dois pares por overlap andável entre salas, sem confirmar o item — o que a
revisão pegou é que um cruzamento direto era possível e tinha sido pulado). O OTBM grava ids de
CLIENTE (ADR 0025 decisão 1), e o `items.xml` do Canary (`data/items/items.xml`) numera os
MESMOS ids — confirmado batendo a pilha do recorte (`things/1332/maps/darashia-dragon-lair.json`)
contra as faixas `fromid`/`toid` e os `id` isolados do arquivo: id 469 é "stairs"
(`floorchange="down"`), id 7544 é "ramp" (`floorchange="west"`), id 7729–7736 é "ramp"
(`floorchange="down"`), entre outros — 434 ids do pacote 1332 carregam a flag no total. A
varredura do recorte inteiro por essa flag achou:

- **z10↔z11**: o ÚNICO tile com `floorchange="down"` em z10 é local `(79, 106)` (o degrau
  `ramp`, id 7729–7736). O destino REAL não é o mesmo `(x, y)` um andar abaixo: o algoritmo do
  Canary (`Tile::queryDestination`, `things/sources/canary/src/items/tile.cpp`) olha as flags do
  tile de pouso PADRÃO antes de aceitar — se ele próprio tiver uma flag direcional, desloca. O
  tile de pouso padrão, local `(79, 106, 11)`, carrega `floorchange="west"` (o mesmo id 7544), o
  que desloca `dx` **+1**: o pouso real é `(80, 106, 11)`. A volta é OUTRA transição, não o
  espelho da primeira: o degrau de subida é o PRÓPRIO tile `(79, 106, 11)` — cuja flag `west`
  agora é lida como a do PASSO SENDO DADO (o ramo "sobe" do algoritmo lê a flag do tile de
  partida, não a do pouso) —, e desloca `dx` **−1**: sobe para `(78, 106, 10)`.
- **z11↔z12**: o par que a primeira versão desta emenda já tinha escolhido por coincidência de
  overlap — local `(41, 83)` — de fato TEM um degrau real (`id 469`, `stairs`,
  `floorchange="down"`, em z11). O que a primeira versão errou foi o pouso: `(41, 83, 12)`
  carrega `floorchange="west"` (id 7544, o mesmo "ramp"), então o mesmo deslocamento `dx += 1`
  vale aqui — o pouso real é `(42, 83, 12)`, não `(41, 83, 12)`. Subindo pela flag `west` do
  PRÓPRIO `(41, 83, 12)`, `dx -= 1`: volta para `(40, 83, 11)`.

Os quatro tiles de destino/origem (`(80,106,11)`, `(78,106,10)`, `(42,83,12)`, `(40,83,11)`) são
andáveis e confirmados, por busca em largura de quatro vizinhos, dentro do MESMO componente
conectado que os spawns reais de cada andar — não são estruturas isoladas. **Isto substitui o
"débito de QA visual"** que a versão anterior desta emenda registrava: os dois conectores não são
mais uma escolha pragmática de overlap, são o mecanismo do Canary aplicado com os números dele.

**Fica como possível trabalho futuro, não feito nesta issue**: derivar `floorChanges`
automaticamente no importador, cruzando o inventário do pacote com uma tabela de
`floorchange` — o que exigiria trazer essa tabela (hoje só em `items.xml`, fora do repositório e
fora do pipeline de `things/`) para dentro do fluxo de `pnpm map:import`, decisão de escopo maior
que esta issue. `thais.json` continua com as escadas autoradas à mão como sempre — esta emenda
não o toca.

**A rota** (`pnpm route:trace`, estendido por esta issue para atravessar `floorChanges` — ver
"Rota multiandar" abaixo) liga um laço de 1.494 tiles pelos três andares pelos conectores
corrigidos, ancorando cada um dos 47 pontos de spawn EXATAMENTE na coordenada do Canary
(distância zero — a ferramenta busca o tile andável mais próximo de cada spawn para a ORDEM de
visita, mas guarda a coordenada exata como posição de nascimento, que o `Spawner` já sabe abrir
mão em até `radius` tiles se estiver ocupada). `validateRoute` confere zero problemas: todo passo
é adjacente no mesmo andar, ou pisa exatamente no tile registrado em `floorChanges`.

**Cada spawn declara o monstro e o `spawntime` do Canary** (#519, decisão nova desta issue — ver
"Spawn por ponto" abaixo): os 19 pontos de z10 são `dragon`, os 28 de z11+z12 são `dragon-lord`,
todos com `respawnDelayMs: 90000` (90 s, o `spawntime="90"` do XML, igual nos 47). O `dragon.lua`
e o `dragon_lord.lua` do Canary declaram `isBlockable = false` — a hunt copiada usa isso também
(`blockable`, novo campo do monstro — ver abaixo), mas o VALOR concreto (`false`, herdado do
default do schema) é decisão do conteúdo do monstro em si, que é a #520, não desta issue: aqui
só o MECANISMO existe, testado com um monstro de fixture.

### Rota multiandar (#519)

`scripts/trace-route.ts` fazia BFS num andar só. Agora `shortestPath` também atravessa
`floorChanges`: de um estado `(x, y, z)`, o vizinho que pisa num tile registrado como origem de
uma escada não pára nele — ninguém para numa escada, porque `move()` do `sim` nunca deixa —, e a
busca CONTINUA a partir do destino registrado. O tile GRAVADO no passo da rota é sempre o do
degrau (o argumento que `move()` precisa receber para reconhecer a escada); o destino dela é
implícito, nunca um tile a mais na lista. Um ponto de PASSAGEM (`--via`) nunca pode ser o próprio
degrau — ninguém "para" nele —, e a ferramenta recusa com essa mensagem se alguém tentar.

`packages/content/src/map.ts`'s `validateRoute` acompanha a mesma regra: cada passo é adjacente
no mesmo andar OU pisa num tile de `floorChanges`, e a posição EFETIVA para julgar o passo
seguinte é o destino da escada — nunca o tile autorado —, exatamente como o `sim` de fato resolve
em `move()`. Um tile de escada com o andar de ORIGEM errado no arquivo é um erro nomeado, não uma
rota silenciosamente quebrada.

### Spawn por ponto (#519)

Até aqui todo ponto de spawn era `{ routeIndex, radius }`, e o monstro saía sempre da composição
sorteada da dificuldade — o formato do Huntera (2/5/8 num pull). O Canary funciona diferente: o
XML de spawn declara um `<monster>` por posição, cada um com nome e `spawntime` próprios, nunca
um sorteio. `routeSchema.spawnPoints` ganha três campos opcionais — `monsterId` (o `Spawner` usa
esse monstro, e a composição vira fallback só para quem não declara), `at` (a posição EXATA,
quando não é o tile do `routeIndex` — quase nunca é, no Canary) e `respawnDelayMs` (o `spawntime`
DESTE ponto, por cima do `respawnDelayMs` da dificuldade). Nenhum dos três é obrigatório: Rat
Cellars e Rotworm Caves continuam exatamente como estavam, porque nenhuma delas os declara.

### `blockable`, o `isBlockable` do TFS/Canary (#519)

`spawnClearRadius` (#236) segurava o respawn perto de QUALQUER participante vivo, para toda hunt
que o ligasse. O TFS/Canary fazem o oposto por padrão: `isBlockable` é `false` em 1.640 dos 1.656
monstros do bestiário do Canary — Dragon e Dragon Lord inclusive —, e só quem declara
`isBlockable: true` espera a vista limpar antes de nascer (`Spawn::findPlayer`, alcance do
viewport do servidor — `±11` tiles nas duas direções, `maxViewportX`/`maxViewportY` do TFS —, no
MESMO andar: `getSpectators` com `multifloor: false`). O monstro ganha `blockable` (default
`false`, o do Canary); Rat e Rotworm passam a declarar `blockable: true` explicitamente, porque
o `spawnClearRadius` que os governa vem do Huntera (observado), não do Canary, e a issue não
pode mudar o comportamento deles. `#spawnBlockedFor` (`packages/sim/src/rulesets/hunt.ts`) só
aplica a checagem de distância quando o monstro do ponto é `blockable`.

### Monstro, alvo e área: tudo confere o ANDAR (#519)

Os três andares desta lair compartilham a mesma caixa `(x, y)` — um Dragon Lord de z11 pode ter
coordenada idêntica à de um Dragon em z10, um andar acima. Sem conferir `z`, o monstro
perseguiria, a área de magia acertaria, e o spawn segurada por `spawnClearRadius` enxergaria
através do chão. `chooseTarget`, `selectTarget`/`countTargets`/`countAreaTargets`,
`abilityTargets` (a área de uma ability de monstro) e o próprio `#spawnBlockedFor` passam a
conferir o andar antes da distância — e o monstro em si (`MonsterRuntime.position.z`, opcional,
igual à posição do personagem mas sem exigir formato novo no snapshot) passa a saber o PRÓPRIO
andar, herdado do ponto de spawn. Ele continua sem carregar a CAPACIDADE de trocar de andar
sozinho (`Movable.crossesFloors`, novo — só o personagem tem): o `z` na posição do monstro é
identidade, nunca permissão de subir escada.

**Personagem-a-personagem também confere o andar, mesmo sem party em hunt ainda** (correção de
2026-09-25, revisão adversarial da #535). `#resolveRuleTarget` (regra de cura/suporte com alvo
`member`/`lowest-hp-member`, ADR 0035 d.10) e `#companionAt` (o desvio de quem está parado na
rota, #203) comparavam só `(x, y)` — igual a todo o resto ANTES desta issue tocar neles. A hunt
hospeda um personagem só hoje (§14, Fase 3 traz party), então os dois caminhos são código morto
NA PRÁTICA — mas "todo lugar que compara alvo confere o andar" só fica verdade com os dois
corrigidos, e o dia em que a party entrar numa hunt multiandar sem ninguém reabrir esta auditoria
é exatamente o dia em que o gap deixaria de ser dormant.
