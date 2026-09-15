# @draconya/client

## Propósito

O cliente web: React + PixiJS v8 + Vite. HUD em DOM, mundo em canvas, câmera de ~18×14 tiles.
Pipeline de assets (parser de aparências, decoder LZMA em Worker, cache persistente).

## Fronteiras

**Pode importar:** `protocol`, `content`.
**Não pode importar:** `sim`, `server`, `tools`.

O cliente não simula. Se ele precisar de uma regra de `sim` para decidir algo, ou a regra vira
mensagem do servidor, ou a decisão não é do cliente.

## De onde vêm os assets

O pacote de arte **não é versionado neste repositório** (`things/` está no `.gitignore`) e não
está em nenhum repositório público. Ele vem de uma instalação do cliente do Tibia, e fica local:

```
things/<version>/           # THINGS_DIR e THINGS_VERSION no .env
  catalog-content.json      # índice → catalog.ts
  appearances-<hash>.dat    # protobuf → appearances.ts
  sprites-<hash>.bmp.lzma   # folhas → FUN-17
```

**Os testes do pipeline não dependem disso.** `src/assets/*.test.ts` monta o `.dat` com um
encoder de protobuf próprio (`assets/testing.ts`) e roda em qualquer lugar, CI incluído.
`appearances.pack.test.ts` é o outro lado: ele procura um `appearances*.dat` sob `THINGS_DIR`
e **pula** quando não acha, dizendo por quê numa linha.

A divisão é o ponto. Fixture prova COMPORTAMENTO — defaults do proto2, pulo por wire type,
registros separados — mas não prova que o schema que escrevemos é o schema que existe: ela foi
escrita pela mesma cabeça que escreveu o leitor, e um número de campo errado nos dois lugares
passa nos dois. Só arquivo real pega isso. Um teste que reprova onde o dado não existe seria
desligado no primeiro PR vermelho, e aí não protegeria nada em lugar nenhum.

Para rodar contra um pacote fora do repositório:

```
THINGS_DIR=/caminho/para/things pnpm vitest run packages/client/src/assets
```

### Biblioteca local para o Claude Code

`pnpm assets:library` transforma o pacote bruto numa biblioteca em
`things/<versão>/library/`: índices JSONL por `object`, `outfit`, `effect` e `missile`, folhas
PNG por faixa, quadros individuais por id global e a árvore de UI do
`graphics_resources.rcc.lzma`. O comando e a estrutura estão em `docs/asset-library.md`.
O snapshot comunitário completo 10.98 pode ser reproduzido com `pnpm assets:fetch:1098`.

No Claude Code, invoque `/assets`. A skill começa por `manifest.json`, confere se o pacote está
completo e só então procura ids e abre PNGs. Ela também impõe a regra que costuma se perder nessa
etapa: a escolha visual atualiza `data/appearances/<versão>.json`; nunca põe caminho de arte em
`content/`.

**Os repositórios de OTClient não contêm sprites.** Foi verificado: `opentibiabr/otclient`,
`OTCv8/otclientv8` e `opentibia/yatc` não trazem `Tibia.spr`, `Tibia.dat`, `catalog-content.json`
nem folhas `sprites-*.bmp.lzma`. São clientes que *leem* os assets; a arte própria deles é só de
interface (cursores, skins, fontes).

O que eles trazem e que **vale muito**:

| Fonte | O que aproveitar | Licença |
|---|---|---|
| `opentibiabr/otclient` | **`src/protobuf/appearances.proto`** — o schema proto2 real, com `frameGroups`, categorias e ações. Gere o leitor a partir dele em vez de escrever um leitor de varint na mão | MIT |
| `OTCv8/otclientv8` | Referência de ergonomia e organização de HUD (§5.2 do PRD) | MIT |
| `opentibia/yatc` | Implementação de referência mais antiga | **GPL-2.0** |

**Cuidado de licença:** MIT nos dois primeiros — copiar código é limpo, mantendo o aviso de
copyright. **O YATC é GPL-2.0**, que é copyleft: copiar código de lá obrigaria o Draconya inteiro
a ser GPL. Leia como referência se quiser; não copie linha.

## O pipeline de assets (FUN-16)

```
assets/protobuf.ts     mecanismo: varint, tag, slice, skip por wire type. Não sabe o que é aparência.
assets/appearances.ts  o schema: números de campo do appearances.proto real, e o leitor dirigido
assets/catalog.ts      o índice: qual folha tem qual id, e onde dentro dela
assets/sheet.ts        CIP → LZMA → BMP → RGBA. PURO: entra Uint8Array, sai Uint8Array
assets/sheet-worker.ts a casca de doze linhas que põe `sheet.ts` num worker
assets/sheet-loader.ts o lado do thread principal: fila, id por pedido, encerramento
assets/sprites.ts      id global → folha → recorte → ImageBitmap
assets/outfit.ts       a paleta de 133 cores e a colorização por 4 canais
assets/bitmap-budget.ts o LRU por BYTES que sprites.ts e outfit.ts compartilham
assets/cache.ts        a POLÍTICA: chave, teto de bytes, despejo LRU, degradação
assets/indexeddb.ts    o ARMAZENAMENTO: transação, cursor, clone estruturado
assets/testing.ts      encoder de protobuf, só para fixture
```

**Por que um leitor dirigido em vez de `protobufjs`.** A issue sugeria gerar o leitor a partir
do `.proto`, e a preocupação dela era não ADIVINHAR número de campo — `appearances.ts` cita o
schema real de `opentibiabr/otclient` (MIT) campo a campo, então não adivinhamos. O que um
decoder genérico custaria é o resto: ele materializa TODO campo de TODA mensagem, e
`Appearance.flags` — a maior parte dos 4,8 MB, da qual não usamos nada — viraria objeto para
cada uma das 42 mil aparências. O leitor dirigido pula a submensagem lendo um varint.
(`pbjs --target static-module` ainda emitiria `.js`, que o `source-policy` recusa.)

**O que é lido, e o que é pulado.** Lidos: `id`, `frame_group`, e de `sprite_info` os
`pattern_*`, `layers`, `sprite_id`, `bounding_square` e as durações das fases; e, de `flags`
(FUN-117, ADR 0025), só o que bloqueio e pilha precisam — `bank` (com `waypoints`, a
velocidade do chão), `clip`, `bottom`, `top`, `unpass`, `unmove`, `unsight`, `avoid`,
`no_movement_animation`, `take`, `hang`, `hook`, `shift`, `height`, `lying_object`,
`animate_always`, `fullbank` — booleanos e três números por aparência, com os números de campo
conferidos contra o pacote 1332 real (`appearances.pack.test.ts`). Pulados: o resto das flags
(mercado, NPC, cyclopedia, vocação, luz, minimapa), `name`, `description`,
`bounding_box_per_direction`, `is_opaque` — e todo campo que uma versão futura trouxer, **pelo
wire type**. É isso, e não a lista de campos conhecidos, que mantém o leitor válido quando o
pacote sobe de versão. **`bank` é presença, não número**: o pacote grava `bank {}` em chão sem
velocidade, e `bankWaypoints` vira `0` — "não é chão" é `undefined`.

Medido contra o `appearances.dat` do Canary (4,8 MB): **42.107 objects, 1.443 outfits, 242
effects, 62 missiles, em 136 ms.** O `outfit 21` sai com dois grupos — parado com 4 direções e
1 quadro, andando com 4 direções e 8 fases —, que é a forma que uma criatura do Tibia tem.

## A folha de sprites (FUN-17)

`sprites-<hash>.bmp.lzma` esconde duas camadas, e o nome só conta uma:

1. um **container CIP** de 32 bytes, e depois um stream **LZMA1 CRU** — sem o cabeçalho
   "alone" que todo decoder de prateleira espera;
2. dentro dele, um **BMP de 32 bits** com pixels em BGRA e magenta como transparência.

O formato está documentado em `src/client/spriteappearances.cpp` de `opentibiabr/otclient`
(MIT). Lemos de lá o FORMATO, não o código.

**A conversão para "alone" é a ideia central.** O CIP guarda `[props][dictSize LE32]` e depois
oito bytes de tamanho COMPRIMIDO; o alone guarda os mesmos cinco primeiros bytes e depois oito
de tamanho DESCOMPRIMIDO. Trocar os oito finais por `0xFF` ("desconhecido", o stream termina em
marcador) faz qualquer decoder padrão ler o resto. A alternativa seria um decoder LZMA cru, que
quase nenhuma biblioteca de navegador expõe — cinco bytes sintetizados compram a escolha inteira
de biblioteca.

**`lzma-web@4`**, no subpath `lzma-web/decompress`, que descarta o compressor. Descartadas:
`lzma-js` (20 MB, parado em 2022), `js-lzma` (2022, sem tipos), `xz-decompress` (é XZ, outro
container), `node-liblzma` (binding nativo — o ADR 0013 exige binário para dois arcos).

## Do id ao quadro desenhável (FUN-18)

**A folha é insumo, o quadro é o produto.** Uma folha de 384×384 vira 144 quadros de 32×32, e
o jogo desenha uns poucos por vez — guardar a folha como bitmap gastaria memória de GPU com
143 quadros que ninguém está olhando.

**O orçamento vive em `bitmap-budget.ts`, compartilhado com o compositor de outfit.** As duas
regras dele são fáceis de errar sozinhas, e duplicá-las é como uma das duas para de fechar os
bitmaps e vaza sem ninguém notar.

**O orçamento é em BYTES, nunca em contagem.** Um 64×64 ocupa quatro vezes um 32×32; contar
itens faria o teto real variar por um fator de quatro conforme o que estivesse em cena, e o
estouro chegaria numa hunt cheia de monstros grandes — justamente quando não se pode engasgar.

**`close()` no despejado é obrigatório, não higiene.** `ImageBitmap` segura memória de GPU que
o coletor não recolhe: um cache que respeita o teto e não fecha vaza exatamente igual a um que
não tem teto, e o sintoma é o navegador ficando lento, não o jogo. `clear()` existe pela mesma
razão — trocar de mapa sem ele vaza a tela anterior inteira.

**Duas deduplicações, e são coisas diferentes:** por ID em voo (dez criaturas iguais entrando
em cena criam um bitmap, não dez) e por FOLHA em voo (dez quadros da mesma folha a baixam e
descomprimem uma vez). Sem a primeira, nove bitmaps vazam porque só um fica no cache.

**Sob demanda tem um preço na PRIMEIRA vez, e ele é pago na Cidade** (FUN-112). Com o cache
vazio, o rato era um quadrado por seis a dez segundos na primeira entrada numa hunt — cada
folha do outfit dele só passava pelo Worker quando o primeiro quadro dela era desenhado. O
catálogo traz os outfits dos monstros de cada hunt (`catalogue.hunts[].outfitIds`), e
`useWarmHuntOutfits` chama `AssetPack.warmOutfit` para todos assim que o pacote está pronto:
todos os quadros, grupos, direções e camadas, em segundo plano, no tempo em que o jogador está
configurando o bot. O resultado é só o cache cheio; na segunda visita o IndexedDB já bastava.
Medido: com o cache limpo, os quatro ratos saem em sprite a 1,5 s da entrada.

## Colorização de outfit (FUN-20)

Um outfit tem a camada BASE e uma camada TEMPLATE em que cada cor marca uma região:
**amarelo é cabeça, vermelho é corpo, verde é pernas, azul é pés**, e a composição é
**multiplicação** sobre a base. A regra vem de `src/client/creature.cpp` de
`opentibiabr/otclient` (MIT); lemos de lá o formato e a fórmula, não o código.

**Multiplicar, e não substituir.** A base já traz o sombreado do desenho; substituir a cor
devolveria um boneco chapado. E o **alfa não é multiplicado**: fazê-lo deixaria o personagem
semitransparente quando a cor fosse escura, apagando a silhueta.

**A paleta é FÓRMULA, não tabela** — 19 matizes × 7 valores = 133 cores. Guardar 133 tuplas RGB
seria guardar o resultado de uma conta de trinta linhas, e a primeira mão que mexesse numa
delas faria a paleta divergir da do pacote sem nada acusar.

**A conferência dela é o teste mais importante deste módulo.** `outfit.test.ts` guarda as 133
cores geradas por uma **transliteração literal** do original, em Python, sem refatorar nada —
e é ela que prova a fórmula. A versão daqui é um refactor (sextantes no lugar de cinco `if`
encadeados), e refactor de fórmula é onde erro de borda mora: **ela pegou um**. Sete cores de
matiz vermelho puro saíam magenta, porque a última faixa do original é a continuação da quinta
e não um sexto sextante. Nenhum teste de "a paleta tem 133 cores" pegaria isso.

## O cache persistente (FUN-19)

O Huntera rebaixa e redescomprime as folhas **a cada sessão**. Guardar o resultado decodificado
corta a maior parte do carregamento a partir do segundo acesso, e é uma das três melhorias
deliberadas sobre eles (ADR 0008).

**A chave já resolve a invalidação.** O hash vem no nome do arquivo (`sprites-<hash>.bmp.lzma`)
e é imutável por construção: nunca existe entrada velha para o mesmo hash. A versão do pacote
entra na chave junto, porque duas versões podem trazer folhas de mesmo nome com conteúdo
diferente — e aí o hash sozinho mentiria. Sobra despejo por espaço, e mais nada.

**A versão do SCHEMA do banco não é a versão do pacote.** Subir a do schema apagaria o cache
inteiro a cada deploy que mexesse no formato; a chave já dá coexistência.

**Guardamos os PIXELS, nunca um `ImageBitmap`** — ele não é serializável de forma portável
entre sessões, e recriar o bitmap a partir dos pixels já pula a parte cara, que é o LZMA.

`cache.ts` é a política e `indexeddb.ts` é o armazenamento, pela mesma razão que
`sheet-loader.ts` não conhece `Worker`: despejo, teto e degradação se testam sem banco nenhum.
O adaptador tem teste próprio contra `fake-indexeddb`, que implementa a especificação — um
duplo escrito à mão provaria só que o duplo concorda comigo.

### As fixtures são binárias, e isso é a exceção

`src/assets/fixtures/*.lzma` são **LZMA de verdade**, geradas por
`scripts/make-sheet-fixture.ts` com o `lzma` da linha de comando. Blob binário no repositório é
normalmente o tipo de fixture que ninguém consegue ler — aqui vale, porque o que precisa ser
provado é a decodificação de LZMA REAL, e um mock de LZMA prova exatamente nada. A legibilidade
volta pelo script: a fixture é ilegível, a receita não é, e regerá-la é um comando.

```
pnpm tsx scripts/make-sheet-fixture.ts
```

## Invariantes locais

- **O estado de jogo vive num store mutável fora do React**, em `src/state/`, alimentado pelos
  deltas do WebSocket. São DUAS camadas, e a divisão é a garantia:
  - `state/world.ts` — criaturas, instância, mapa. **Não existe `subscribe` neste módulo.** Um
    `creature-move` não pode causar render de React porque não há caminho do movimento até o
    React. É estrutural, não combinado — disciplina dura até o quinto componente.
  - `state/hud.ts` — o que uma pessoa lê como texto ou barra. Assinatura por fatia, com
    throttle opcional para valor contínuo.

  `state/apply.ts` é a única costura entre socket e estado, e cada `case` dele decide mundo ou
  HUD. **O canvas nunca renderiza através do React**; ele lê `world` direto no laço de render
  (`world/viewport.ts`). Ver ADR 0007.
- **O mundo é desenhado com os SPRITES do pacote, e retângulo é a degradação** (`world/`).
  `AssetPack` entrega o bitmap e `TextureBook` o vira `Texture` uma vez por chave; enquanto o
  quadro não chega — ou quando não há pacote — o lugar dele é um retângulo, e a tela nunca
  fica preta por causa de arte. As chaves são puras (`world/keys.ts`) porque o defeito delas é
  silencioso: **o chão é pedido por CÉLULA do padrão**, `x % largura, y % altura`, como no
  cliente do Tibia — um chão de 4×4 são dezesseis texturas, não uma por tile, e vizinhos ganham
  quadros diferentes em vez de azulejo. **A barra de vida e o nome moram no `overlay`** e não
  dependem de arte: um par `Graphics` + `Text` por criatura, no mesmo pool por id que o sprite,
  redesenhado só quando vida ou nome mudam (`world/health.ts` é a cor e a largura, em números).
  **O outfit é pintado com as cores DA criatura** (`Creature.colors`, FUN-104), que o
  protocolo carrega em `creature-appear` e em cada criatura do `session-state`; o store guarda
  o campo só quando ele veio, tipado pelo PROTOCOLO e não por `assets/outfit.ts` — o store não
  depende da camada de arte. `DEFAULT_OUTFIT_COLORS` (`world/outfit-colors.ts`) é a RESERVA
  para quem chegou sem: um nó `game` anterior num deploy em rolagem, um personagem que nunca
  escolheu, ou monstro, que nunca traz. Reserva e não "sem pintar" porque um template que sobra
  sem multiplicar é um boneco de cores primárias na tela; e para monstro passar cores é
  inofensivo, o pacote devolve a base como está. O que era de antes continua: câmera de 18×14,
  camadas, ordem de desenho por `y`, pool e interpolação.
- **Efeito, projétil e número flutuante são listas no `world`, e o VIEWPORT é quem as expira**
  (`state/world.ts` — `effects`, `missiles`, `texts`; FUN-106). Chegam dezenas por segundo numa
  hunt, então o caminho deles é o mesmo do movimento: `apply.ts` carimba o instante LOCAL em que
  chegaram e empurra na lista; nada passa pelo React, e um `creature-hit` não pode causar render
  porque não há caminho dele até o React. O laço de quadro é o único lugar que sabe que horas
  são, então é ele quem remove da lista o que acabou de tocar — e destrói o sprite junto. A
  conta é pura (`world/effects.ts`): fase pelo tempo decorrido, projétil interpolado de A a B,
  número subindo da posição INTERPOLADA da criatura e continuando de onde ela estava se ela
  sumir no meio — o golpe que mata chega no mesmo lote que o `creature-disappear`, e é o número
  que o jogador mais quer ver. **O instante é o da chegada, não o do servidor:** um lote aplicado
  de uma vez ao voltar de aba de fundo toca junto e acaba junto, em vez de reproduzir dez minutos
  de golpes; e cada lista tem teto (`TRANSIENT_CAP`) porque em aba de fundo o socket anda e o
  `requestAnimationFrame` não. O texto não depende de arte; efeito e projétil viram retângulo
  sem pacote, pela regra de sempre — mas **quadro a caminho NÃO vira retângulo**: as fases de
  um efeito são pedidas TODAS ao livro quando ele nasce (`effectKeysOf`), e enquanto uma ainda
  não chegou o sprite fica invisível. Uma fase real tem 40 ms, e pedida só no quadro em que
  chegava cada uma piscava um quadro amarelo antes da textura. O retângulo é para quadro que
  não existe, nunca para quadro em voo. As chaves de textura (`effectKey`, `missileKey`) são
  por FASE e por CÉLULA do padrão 3×3 — a célula é a direção do voo, por OCTANTE
  (`missileCell`, a regra de `Position::getDirectionFromPosition` do OTClient): `(3, 1)` está
  a 18° e sai com o quadro de leste, não com a diagonal que o sinal de cada eixo daria.
- **A pilha de um tile é desenhada como o Tibia desenha** (`world/tile-stack.ts`, puro;
  `world/scene.ts`; FUN-121, ADR 0025). O mapa importado chega como a pilha de ids por tile
  em `things/<versão>/maps/<id>.json`, buscada pelo `mapId` da sessão (`Viewport.tsx`,
  `loadScene`) quando o laço de quadro nota `world.mapId` mudar — o `world` não avisa ninguém
  (ADR 0007). As regras, lidas no OTClient (MIT — formato e regra, nunca código): **ordem**
  chão → `clip` → `bottom` → comuns na ordem do arquivo → criaturas → `top` (num container
  ACIMA das criaturas: o arco cobre quem passa); **elevação** `height.elevation` acumula pelos
  itens com teto de 24 px e sobe o que vem depois — e a criatura — para cima e para a
  esquerda, `top` ignora; **shift** desloca o próprio item; **padrão** por `(x % w, y % h)`,
  por CONTAGEM para o empilhável que veio com contagem E tem o padrão de 4×2 da tabela (1–4
  na primeira linha, 5/10/25/50 na segunda — a moeda de 4×3 do 13.x volta à posição, como o
  cliente do Tibia faz), pelo GANCHO da parede do mesmo tile para o pendurável (sul → coluna
  1, leste → 2); **âncora** no canto inferior direito do tile, como já era. **Andares**
  (`world/floors.ts`, puro): na superfície desenha-se do andar do jogador até o 7, o de baixo
  primeiro, cada nível abaixo deslocado um tile para baixo e para a direita — o
  `transformPositionTo2D` do OTClient — e sob um véu (`VEIL_PER_FLOOR`, também sobre os
  retângulos de reserva e as criaturas sem quadro: o véu é da profundidade, não da arte); no
  subsolo, só o andar do jogador; quem está ACIMA do jogador não aparece — não há telhado. A
  criatura em cima de uma caixa sobe a elevação do tile, INTERPOLADA ao longo do passo — lida
  só pelo tile arredondado ela pulava 24 px no meio do passo. A ordem de desenho das criaturas
  é pela posição de TELA (deslocada pelo andar). `ambience: 'cavern'` do `instance-enter` é um
  tom sobre as camadas inteiras — a Rat Cellars o declara no conteúdo. **Os itens do chão**
  (`world.groundItems`, FUN-123 — os cadáveres) entram na pilha do tile como itens comuns, por
  cima do que o mapa tem, e `groundItemsVersion` entra na chave da repintura: um cadáver que
  cai repinta o tile dele sem varrer o mapa a cada quadro. Chegam por `ground-item-appear` /
  `ground-item-disappear` e no `session-state.world.groundItems`, que substitui. **Mapa autorado à mão** (a adega de
  teste) vira pilha SINTÉTICA — `[chão]` no livre, `[peça pela vizinhança]` no bloqueado
  (`sceneFromTilemap`) — e passa pelo MESMO pintor: um caminho de desenho, duas origens. Cena
  ausente (sem `VITE_THINGS_URL`, 404) é a grade lisa de reserva, nunca tela preta. Ao
  receber a cena, `AssetPack.warmObjects` aquece as folhas dos ids da janela inicial, como
  `warmOutfit` faz com os monstros.
- **Setas e WASD andam, e a repetição da tecla presa é do CLIENTE** (`shell/walk-keys.ts`,
  puro; `shell/useWalkKeys.ts`, a casca; FUN-122). Só as quatro cardeais, a última tecla
  pressionada vence, nunca diagonal — o que o Huntera faz. O hook ouve a JANELA (o canvas
  não tem foco), ignora `input`/`textarea`/`select`/`contentEditable` e modificadores, e
  solta tudo no `blur` — o `keyup` de um Alt+Tab nunca chega. Um `walk` sai no `keydown`;
  o próximo sai quando o passo PRÓPRIO acabar (o `creature-move` lido do `world` no timer —
  ADR 0007, ninguém avisa, quem quer saber olha) ou 150 ms depois se nenhum chegou. É um
  `setTimeout` por passo, nunca `setInterval`: o intervalo é o do último passo que o servidor
  deu, e mandar antes é ser recusado pela cadência dele. Cada `walk` é a intenção de UM tile
  (invariante 4); o servidor decide.
- **A parede é montada pela VIZINHANÇA, como o Tibia monta muro** (`world/walls.ts`, FUN-105).
  O tilemap só diz "bloqueia"; qual das quatro peças vai em cada `#` — vertical, horizontal,
  canto ou poste — é `wallPiece` quem decide, olhando SÓ os vizinhos de NORTE e OESTE: parede
  ao norte é vertical, a oeste é horizontal, as duas é canto, nenhuma é poste. Sul e leste NÃO
  entram, e isso não é simplificação: o sprite de parede do pacote tem 64×64 e espalha para
  CIMA e para a ESQUERDA do tile dono, então o trecho até o vizinho de sul é desenhado pelo
  vizinho de sul, e o trecho até o de leste, pelo de leste. É por isso que o canto de
  cima-esquerda de todo retângulo é POSTE e o de baixo-direita é canto — e é isso que o pacote
  espera. A regra é a tabela de vizinhança de meia-borda do Remere's Map Editor
  (`WallBrush::half_border_types`), reproduzida como REGRA DE DOMÍNIO — qual peça cada par de
  vizinhos escolhe — e não como código: o RME é GPL, e o limite do ADR 0019 vale para ele.
  **A versão espelhada (norte OU sul, leste OU oeste) parecia certa no papel e estava errada
  na tela:** canto nas quatro quinas e um toco de muro saindo de cada ponta, porque cada
  canto estendia trechos para tiles sem parede. Os ids das peças vêm de
  `appearances.maps.<id>.wall`, e `wallSetOf` (de `content`) faz um id só virar as quatro
  iguais. **Fora do mapa NÃO é parede** (`wallsOf`): `isBlocked` diz que é, e para andar está
  certo — para a peça, a borda inteira do mapa sairia como canto. A diagonal também não conta;
  um `#` com vizinho só na diagonal é poste. `walls.test.ts` prende o histograma da regra
  sobre o `rat-cellars` real (27 verticais, 27 horizontais, 3 cantos, 3 postes), e a fixture
  de `wallsOf` é RETANGULAR de propósito — num mapa quadrado, trocar `width` por `height`
  passa em silêncio. A chave de textura continua sendo id + célula do padrão: as peças têm
  padrão 2×1 e 1×2, e `tileTexture` já resolve isso.
- **A ordem de desenho só é recalculada quando alguém troca de tile.** Dentro de um passo as
  criaturas deslizam sem se ultrapassar, então reordenar a cada quadro é refazer o mesmo
  trabalho 60 vezes por segundo.
- **Reconectar é REANEXAR** (`net/connection.ts`). Não recarrega a página, não recria
  personagem e **não limpa o store**: pede ticket novo e volta para a mesma sessão, que nunca
  parou de rodar. A tela continua mostrando a última coisa verdadeira até o `session-state`
  chegar, em vez de piscar vazia. Se a reconexão parecer um login novo para o jogador, o
  ADR 0001 vazou para a UI.
- **A espera entre tentativas tem jitter.** Sem ele, a queda de um nó faz todos os clientes
  daquele nó voltarem no mesmo instante e o derrubarem de novo — agora com a carga
  concentrada num milissegundo.
- **O estado da conexão fica na tela.** Jogo idle silencioso é indistinguível de jogo travado:
  sem indicador, ninguém sabe se a hunt está rendendo ou se o socket caiu há dez minutos.
- **O cliente só manda intenção** (invariante 4).
- Predição é **só do próprio passo**, com reconciliação. Nunca preveja dano, loot, nem o passo
  dos outros.
- **Não recebe snapshot por tick.** Um passo chega uma vez, com origem, destino e duração; o
  cliente anima os ~400 ms.

## Como testar

```
pnpm vitest run packages/client
pnpm --filter @draconya/client build
```

O pacote **entrou no `pnpm typecheck`** junto com a FUN-22. Antes disso ele não era verificado
por ninguém: o `tsconfig.json` dele tem `composite: false` e `noEmit`, o que o impede de ser
project reference, e o `vite build` usa esbuild, que remove tipo sem checar. Dava para escrever
`const x: number = 'texto'` aqui e o `pnpm check` continuar verde.

O teste de desempenho que importa — com 40 criaturas se movendo, os commits do React ficam
próximos de zero — é medido no `apply.test.ts` uma camada abaixo: commit só acontece se alguém
for avisado, então o teste conta AVISOS, e o número esperado é zero, não "baixo".

## Armadilhas conhecidas

- **`packages/client/tsconfig.json` EXCLUI `*.test.ts`**, e isso é de propósito: o cliente é
  pacote de navegador e não tem tipos do Node. Dá-los a ele faria `node:fs` typecheckar dentro
  do código de produção — que é justamente o que não pode acontecer. Os testes continuam
  checados, pelo `tsconfig.tests.json`, que tem os tipos certos.
- **O id de sprite é GLOBAL entre as folhas**, não índice dentro de uma. `sheetFor` resolve pela
  faixa do `catalog-content.json`, e a faixa é INCLUSIVA nas duas pontas — um `<` no lugar de
  `<=` perde exatamente um sprite por folha, que é o defeito que ninguém acha olhando a tela.
- **`area` do `catalog-content.json` é lido e ignorado.** O que ele significa não foi verificado
  contra um pacote real (FUN-65), e derivar geometria de um campo não conferido seria pior que
  derivá-la de `spritetype`, que a §13.1 documenta. É o primeiro campo a conferir quando um
  pacote de verdade aparecer.
- O decoder LZMA em JS puro é pesado — roda em Web Worker, nunca no thread principal. Quem
  garante isso é `sheet.ts` ser PURO: ele não conhece `Worker` nem `self`, então pô-lo no
  thread errado exige alguém escrever a chamada à mão.
- **São DUAS fixtures de folha, e a segunda existe por causa de uma mutação sobrevivente.** O
  enchimento de zeros do cabeçalho CIP varia com quantos bytes o tamanho em varint de 7 bits
  ocupa; com uma fixture só, trocar a varredura do marcador por uma posição fixa passava em
  todos os testes. `tiny.bmp.lzma` comprime para menos de 128 bytes, o tamanho cabe num byte, e
  o marcador anda um lugar. O gerador RECUSA gerar duas fixtures com o marcador no mesmo lugar.
- **`decompressSync` decide entre `string` e `Uint8Array` por HEURÍSTICA** — "parece texto?". A
  folha é binária, e `decodeSheet` normaliza em vez de confiar: a heurística errando num pacote
  devolveria bytes mutilados, que na tela aparecem como sprite corrompido e não como erro.
- **O alfa do BMP é IGNORADO.** Há folha com alfa 255 em todo pixel, inclusive nos vazios; a
  transparência é a cor magenta. Confiar no alfa desenharia um retângulo magenta atrás de cada
  sprite.
- **O BMP da folha é de BAIXO para cima** — altura positiva, como manda o formato. Ler as
  linhas na ordem do arquivo espelha a folha inteira na vertical, e o sintoma é traiçoeiro: chão
  e parede continuam parecendo chão e parede, mas cada outfit sai de cabeça para baixo, no canto
  errado do quadro, e os ids de animação passam a cair nas linhas de OUTRA criatura — o rato
  andando virava um bicho azul. `fromBitmap` lê o sinal da altura; `DECODED_FORMAT` (`cache.ts`)
  sobe a cada mudança que altere pixels, porque o cache persistente guarda o RESULTADO do decoder
  e o hash do arquivo não sabe que ele mudou.
- **O personagem do Tibia é desenhado a 45°, e isso NÃO é defeito.** O quadro `sul` do outfit
  128 (citizen) tem a cabeça no canto superior esquerdo e os pés no inferior direito — parece
  deitado, e a primeira reação é achar que o decoder virou a folha. Não virou: a imagem oficial
  do outfit no TibiaWiki tem a mesma pose e o Huntera desenha igual. Confira contra o dragão
  (outfit 34) e a leather armor (objeto 3361), que são inconfundíveis, antes de "corrigir" o
  decoder por causa de um humanoide.
- **Falha do cache NUNCA é falha do jogo.** Aba anônima, cota estourada e armazenamento
  bloqueado são normais, não excepcionais: leitura que falha vira `null`, gravação que falha
  vira `false`, e paga-se o LZMA de novo — que é o comportamento de antes do cache existir.
  Mas ela AVISA por `onDegraded`: cache que falha calado é indistinguível de cache que
  funciona, e o sintoma vira "o jogo é lento" sem nada apontando para aqui.
- **O despejo exclui a chave que está ENTRANDO.** Sem isso o cache soma a mesma folha duas
  vezes, conclui que falta espaço e despeja uma folha alheia — e a reconexão de um jogador
  esvazia o cache aos poucos. O teste disso **já foi vácuo**: reescrever a única folha do
  cache chegava ao mesmo estado com e sem o defeito. Precisa de OUTRA folha para perder.
- **`entries()` usa cursor, não `getAll`.** `getAll` carregaria os pixels de todas as folhas
  para responder "quanto ocupa cada uma" — dezenas de MB por consulta de despejo, no thread
  principal, toda vez que uma folha nova chega.
- **O offset dos pixels vem do byte 10 do BMP**, nunca da constante 54: o DIB header tem
  tamanho variável, e um BMP com máscaras de cor faria a leitura começar dentro do cabeçalho.
- Folhas decodificadas vão para IndexedDB. Sem isso, cada sessão rebaixa e redescomprime tudo.
- `requestAnimationFrame` para em aba de fundo. Ao voltar, aplique em bloco o que chegou; não
  tente animar dez minutos de eventos.
- **O analisador é DOM e tem FATIA PRÓPRIA** (`state/hud.ts`, FUN-83). Ler o estado inteiro faria
  a janela re-renderizar a cada golpe, que é exatamente o que o ADR 0007 existe para evitar.
- **Entre duas entregas — `session-state` ou `analyzer` (FUN-110) —, só o TEMPO anda.** O "por
  hora" é uma divisão cujo denominador é
  um relógio local; o numerador é sempre o último número que o servidor mandou. Extrapolar XP ou
  gold mostraria progresso que talvez não tenha acontecido — e o valor andaria PARA TRÁS na
  atualização seguinte. A taxa caindo devagar entre duas atualizações é o lado certo para errar.
- **`Aggregates` e `NotableEvent` do HUD são derivados do protocolo, não redeclarados.** Uma
  cópia à mão diverge no primeiro campo novo, e diverge em silêncio: `decodeS2C` devolve `null`
  sem erro quando a mensagem não bate, e a tela fica vazia sem ninguém ligar uma coisa à outra.
- **Campo opcional dos agregados vira "—", nunca zero.** Eles são opcionais porque um nó `game`
  anterior à FUN-78 manda sem eles (deploy em rolagem). Zero é uma afirmação que o servidor não
  fez.
- **O Bestiário é uma janela como o analisador, e o cliente NÃO conta abate** (`shell/Bestiary.tsx`,
  FUN-113). Os contadores chegam INTEIROS em `bestiary` — no attach e a cada mudança — e
  SUBSTITUEM (`hud.bestiary`, `null` até chegar); os marcos e o bônus por marco vêm no
  `catalogue` (`monsters`, `bestiary`). O que a tela calcula é apresentação —
  `shell/bestiary-progress.ts`, puro: "que marco vem depois" e o bônus GLOBAL (DT-01, marcos de
  todos os monstros somados) —, e se divergisse do `sim` a conta do `sim` é a verdadeira. Mesmas
  classes CSS do analisador, aberta por padrão (FUN-115) e com o bônus no cabeçalho quando
  minimizada. **Sem monstro no catálogo a janela diz "Este servidor não tem Bestiário"**: é um
  nó anterior à FUN-113, que nunca manda `bestiary`, e um painel com "+0 %" e lista vazia
  afirmaria um Bestiário que aquele servidor não tem — e sumir deixaria o botão da barra aceso
  sem nada acontecer. Sem marcos no
  catálogo, "—" e não "0/0" — a regra do "—" de sempre. O `bestiary-milestone` do extrato só
  escreve o "+n %" quando o catálogo trouxe o percentual (`EventNames.percentPerMilestone`).
- **A entrada (`account/`) é HTTP puro, e vem ANTES do socket** (FUN-97). Escolher personagem
  acontece quando ainda não existe sessão de jogo; o socket só abre depois, com o ticket que a
  escolha rende. `credentials: 'include'` em toda chamada — a sessão é cookie httpOnly (ADR 0012),
  e sem ele tudo responde 401 com o sintoma parecendo "não estou logado".
- **`account` é uma store separada do `hud`**, pela mesma razão que o `hud` é separado do `world`:
  ritmos diferentes. A lista de personagens muda três vezes por sessão; o HP muda sessenta vezes
  por segundo.
- **401 em `/api/auth/me` é a RESPOSTA "ninguém", não uma falha.** Tratá-lo como erro mostraria
  uma mensagem vermelha para quem só ainda não entrou — o estado de toda primeira visita.
- **Recusa da API vira frase, e a frase vive em `account/api.ts`.** Traduzir na tela faria a
  mesma recusa dizer coisas diferentes em cada lugar; e um código que ninguém traduziu ainda
  aparece cru, porque "algo deu errado" faz o jogador repetir o mesmo erro.
- **`?character=<id>` fica.** `phase-one-exit.postgres.test.ts` e `pnpm load` entram sem tela, e tirá-lo
  obrigaria os dois a simular login para testar sessão.
- **`net/current.ts` é como um botão manda intenção** (FUN-79). A conexão nasce e morre num
  efeito, e quem clica está em qualquer lugar da árvore: passar `send` por props atravessaria
  seis componentes que não têm nada a ver com socket, e contexto do React traria o socket para
  dentro do ciclo de render — que é o que o ADR 0007 mantém fora.
- **Mandar sem conexão é SILENCIOSO.** O clique pode cair no instante entre uma queda e a volta,
  e derrubar a tela por isso transformaria um piscar de rede em erro de jogo. Reconectar reanexa
  à mesma sessão (ADR 0001): o que se perde é o clique, não o estado.
- **O catálogo de hunts SUBSTITUI a lista, nunca acumula.** Reconectar reenvia a mesma lista, e
  concatenar daria hunts duplicadas a cada queda de rede.
- **A UI do bot não tem lista de opções em código** (FUN-89). Categorias, slots, magias e
  supplies vêm do catálogo (`state/hud.ts`, `catalogue`). Divergir do servidor faz o jogador
  configurar o que o bot recusa — e descobrir pelo extrato que não fecha.
- **Salvar é intenção, e a recusa NÃO descarta o rascunho.** Apagar o que o jogador escreveu é a
  pior resposta a "corrija isto". `bot-config-result` é tipado justamente para a tela não ter de
  casar com o texto de um `system-message`.
- **A ordem dos slots É a prioridade** (§13.4). A lista viaja como está; reordenar na hora de
  mandar mudaria o comportamento sem o jogador ter pedido.
- **O cliente NÃO soma peso** (FUN-90). Capacidade e peso vêm do servidor: quem sabe o que cabe
  é quem recusa, e a mesma conta em dois lugares diverge no primeiro item fracionário — com a
  versão do cliente sendo a errada.
- **A geografia da tela é fixa** (§5.3, §5.5). Inventário e analisador à direita, hunts e bot à
  esquerda, chat embaixo, nos mesmos lugares em hunt e em conteúdo manual. Reorganizar por
  atividade faz o jogador procurar a poção no meio da luta. **Set, mochila e bolsa são seções
  FIXAS da direita desde #161** (`EquipmentPanel`, `ContainerWindow` × 2): sempre montadas, o
  botão "Inventário" da barra minimiza as três (`collapsed` esconde tudo menos o cabeçalho),
  nunca remove. Com bow na mão o escudo é o seletor de munição (`AmmoPicker`). Arrastar é DnD
  nativo por cima de `shell/drag-intent.ts`, que é puro: `dropIntent`/`clickIntent` decidem a
  MENSAGEM e os testes (`prerender`, sem evento) testam a decisão; o `dataTransfer` carrega só o
  lugar de origem. **O bot é uma seção FIXA da esquerda desde #162** (o vBot): sempre montada, minimizável pela barra (`collapsed` esconde
  tudo menos o cabeçalho), nunca removida; uma linha compacta por regra com o interruptor
  (`enabled`), e a edição fina por cima no `RuleEditor`. O interruptor salva sozinho — `bot/store.ts`
  `scheduleSave` com debounce de 300 ms; a store não importa `net/` (ADR 0007), o painel injeta
  o remetente por `setConfigSender` ao montar.
- **A party mora na seleção de hunt, e entra na hunt pelo `connect` de sempre** (#197, ADR 0027).
  `shell/PartyPanel.tsx` fica DENTRO do `HuntMenu` na Cidade (o Huntera põe a party na
  seleção de caçada: propor uma hunt É escolher uma hunt), e `PartyMembers` no lugar dele
  durante a hunt (nome, HP % — do `party-state` e, no meio, do `world` por nome, lido num
  intervalo, porque o mundo não avisa ninguém); `PartyBag` na direita, só em `shared`,
  minimiza com o inventário. A formação é HTTP (`party/api.ts`) e a store (`party/store.ts`)
  guarda a última cópia que o servidor devolveu — não importa `net/` (ADR 0007): a casca
  injeta o cliente e o `enterHunt` em `useConnection`. O polling de `mine` a cada 2 s só
  enquanto há party. **Entrar na hunt é oferecer o ticket à conexão e reconectar**
  (`net/pending-ticket.ts`, `Connection.restart`): o `defaultRequestTicket` pega o oferecido
  antes de pedir outro, e a reconexão de sempre — mesma `session-attach`, mesma troca de estado
  — leva à hunt da party. Um segundo caminho de socket duplicaria tudo o que a reconexão já faz.
- **O mundo ocupa a tela INTEIRA e o resto flutua por cima** (`shell/Shell.tsx`, `shell/TopBar.tsx`,
  FUN-115). É a geografia do Huntera, que é a referência visual: o canvas acompanha o tamanho
  da tela (`resizeTo`), o stage é ampliado por um **zoom inteiro** (`zoomFor`: 1×, 2× a partir
  de 560 px no lado menor, 3× a partir de 1400 — inteiro porque pixel art a 1,5× é borrão), e
  a vista em tiles é o que couber (`viewFor`), com teto em 18×14, que continua sendo o campo de
  visão da rede. **O texto do mundo tem tamanho de TELA, não de mundo:** nome e número flutuante
  são escalados por `1 / zoom`, senão um nome de dez pixels a 3× vira letreiro. A barra do topo
  tem nome, level, vitais, gold e os botões que abrem e fecham cada janela; cada janela é a
  seção de sempre, posicionada numa coluna absoluta — e a moldura É a seção, para que uma seção
  que devolve `null` (analisador na Cidade) não deixe moldura vazia. O bot é uma sobreposição
  fora das colunas: dentro delas ficaria por baixo da barra do topo. Analisador, Bestiário e
  Hunts nascem ABERTOS: quem decide se a janela existe é a barra, e janela que abre minimizada é
  janela que abre vazia. No celular (≤ 720 px) a tela vira página: o mundo numa faixa de 40vh e
  as janelas empilhadas embaixo, roláveis — o caso de uso móvel é configurar o bot (§5.1).
- **Num painel oculto o `requestAnimationFrame` roda a ~1 Hz, e a tela parece quebrada sem
  estar.** Foi meia hora perdida na FUN-115: o rato saía como retângulo em toda captura, o pacote
  respondia em 5 ms, e o laço de quadro é que só rodava uma vez por segundo — cada quadro novo
  era pedido e a captura vinha antes do quadro seguinte. Antes de caçar defeito de textura,
  confira se o painel do navegador está visível (`tabs_context` diz).
- **`inventory` e `catalogue` SUBSTITUEM, nunca acumulam.** O servidor manda o estado inteiro;
  montar a partir de pedaços daria uma mochila que diverge da dele sem nada acusar.
- **A arte de UI vem do pacote, pelo CLIENTE, e nunca é versionada** (FUN-108). Moldura, pedra,
  slot, ícone de slot vazio e barras de HP/mana são PNGs de
  `things/<versão>/library/ui/images/`, servidos pelo mesmo caminho que os sprites
  (`VITE_THINGS_URL`). `assets/ui.ts` é a única tabela — variável CSS → arquivo — e
  `applyUiSkin` a põe no `:root` uma vez, ao montar o `Shell`; `shell.css` consome por
  `var(--ui-x, <cor lisa>)` e **nunca escreve `url()` de arte**. Sem pacote, nenhuma variável
  existe e a tela sai em cor lisa com a mesma estrutura — arte que não carrega não é razão de
  a tela não abrir. Em `content/` continua entrando só `appearanceId` (invariante 6). **Em
  produção, `library/ui/images` precisa estar no volume `things`** (o nginx serve o volume
  inteiro, `deploy/nginx.conf`): um volume só com `catalog-content.json`, `.dat` e as folhas
  desenha o mundo e deixa a casca lisa — o sintoma é só visual, com 404 de PNG na rede. E
  **a origem não serve essa subpasta** — ela é derivada do `.rcc` pelo `pnpm assets:library`
  —, então o script que baixa o pacote da origem não a traz; ela sobe da sua máquina, com o
  `rsync` de `docs/deploy.md` ("O pacote de arte"), que exclui o resto de `library/`.
- **O pacote de arte é UM, montado no `Shell` e entregue por contexto** (`shell/useBrowserPack.ts`,
  `shell/AssetPackContext.tsx`). O viewport desenha o mundo com ele e o inventário desenha o
  sprite de cada item (`shell/ItemSprite.tsx`, um canvas de 32 px por item, `pack.object`);
  um pacote por consumidor seria dois workers de LZMA e dois orçamentos de bitmap. Contexto do
  React aqui NÃO fere o ADR 0007: o pacote muda uma vez, ao carregar, e nada de estado de jogo
  passa por ele. **O `TextureBook` continua sendo do viewport, por montagem:** `destroy()` o
  fecha para sempre (`book.clear()`), e o StrictMode monta o viewport duas vezes com o mesmo
  contexto — um livro compartilhado chegaria fechado à segunda montagem e a tela ficaria em
  retângulos sem erro. O pacote avisa os despejos por `subscribeEvictions`, e cada livro se
  inscreve e desinscreve com a montagem dele. **O viewport NÃO espera o pacote para subir**
  (`shell/Viewport.tsx`): o Pixi monta na hora com `pack: null`, desenha o mapa em retângulos,
  e recebe a arte por `handle.setPack` quando o contexto resolve — são dois efeitos, um por
  ciclo de vida (montagem e contexto), e um efeito só dependente do contexto remontaria o
  canvas quando a arte chegasse. Esperar deixava a área do mundo VAZIA pelo tempo que o
  catálogo levasse para baixar. `setPack` não limpa o livro, e não precisa: com `pack === null`
  nenhum `book.get` roda, então nada foi guardado antes da arte — não há entrada envenenada.
  Conferido no navegador segurando o `catalog-content.json` por 15 s: retângulos até lá,
  sprites depois, sem a câmera andar.
