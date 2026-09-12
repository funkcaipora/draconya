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
   **decidido pelo usuário em 2026-09-11** ("Rookgaard, copiar"). A janela de recorte
   `x ∈ [32120, 32270]`, `y ∈ [31990, 32140]` (150×150) vem dos spawns de rato do mapa real
   (`otservbr-monster.xml`: 50 blocos em `x 32135–32252`, `y 32007–32126`, z8) e é só a
   janela: o importador apara o recorte à componente conexa dos corredores, que é o que o
   Huntera serve (9.396 tiles numa caixa de 118×80). A entrada continua **pelo menu, abrindo
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
