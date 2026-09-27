# 0008 — Assets do cliente Tibia com indireção por id

**Status:** aceito
**Data:** 2026-09-07
**Contexto técnico:** `content/`, `client` (pipeline de assets, pacote `things/`)

## Contexto

A arte de um MMORPG em pixel art é um dos maiores custos de produção do gênero, e o documento de
restrições do motor já registrava a tensão diretamente: usar os arquivos de um cliente comercial
existente é risco jurídico direto, não questão de estilo, e a recomendação original era começar
com tileset licenciado provisório e encomendar arte definitiva depois que o jogo se provasse.

A decisão de produto foi em outra direção: usar o pacote de assets do cliente Tibia, cujo formato
já foi mapeado por engenharia reversa do Huntera (`catalog-content.json` como índice,
`appearances-<hash>.dat` em protobuf, folhas `sprites-<hash>.bmp.lzma` comprimidas). Isso destrava
a engenharia imediatamente, sem esperar por um pipeline de arte própria.

A mitigação para essa troca de rumo já existia antes, na separação entre um registro de
aparências e as folhas de sprite propriamente ditas: essa separação é o que permite trocar toda a
arte depois sem tocar no renderizador.

## Decisão

Usar o pacote de assets do cliente Tibia como fonte de arte do MVP. Todo conteúdo em `content/`
referencia apenas `appearanceId` (itens, efeitos) ou `outfitId` (monstros, personagens) — nunca
um caminho de arquivo de sprite. A arte vive isolada em `/things/<versão>/`, com decoder próprio
(varint protobuf para o `.dat`, LZMA para as folhas), decodificação em Web Worker e cache
persistente em IndexedDB/Cache Storage.

## Alternativas

- Tileset comercial licenciado como provisório, com arte definitiva encomendada depois — era a
  recomendação original do documento de restrições do motor; superada por decisão de produto em
  favor do pacote do Tibia, que já vem com engenharia reversa pronta.
- Encomendar arte original desde o início do MVP — descartada pelo mesmo motivo de velocidade:
  não há pipeline de arte própria no plano do MVP.
- `content/` referenciando diretamente arquivos de sprite do pacote, sem indireção por id —
  descartada porque tornaria qualquer troca futura de pacote uma reescrita de conteúdo em vez de
  um remapeamento de tabela.

## Consequências

- Risco jurídico assumido conscientemente: usar arquivos de um cliente comercial existente é
  descrito, no próprio documento de arquitetura, como risco jurídico direto. Esta decisão aceita
  esse risco em troca de velocidade, com o produto ciente da troca — não há mitigação jurídica
  documentada além da reversibilidade técnica abaixo.
- A indireção por id é o que sobra como mitigação: trocar o pacote de assets no futuro é remapear
  `appearanceId`/`outfitId` numa tabela, não reescrever `content/` — praticamente de graça, mas
  só se nenhum atalho gravar caminho de arquivo direto em conteúdo.
- O servidor nunca precisa carregar arte, só ids — o processo `game` fica leve mesmo com o
  cliente lidando com um pacote de assets pesado.
- Junto da decisão vêm melhorias sobre o que o próprio Huntera faz: decodificação em Web Worker
  (o Huntera decodifica LZMA no thread principal), cache persistente (o Huntera redescomprime a
  cada sessão) e versionamento explícito do caminho `/things/<versão>/`.
- Não há plano documentado para o cenário em que a mitigação técnica não seja suficiente frente
  ao risco jurídico — a reversibilidade reduz o custo de trocar de pacote, não o risco de usar o
  atual.

## Invariantes afetados

6 (`content/` nunca contém arte — só `appearanceId` e `outfitId`).

## Emenda — 2026-09-10 (FUN-94): a tabela existe

Esta decisão sempre disse *"trocar o pacote de assets no futuro é remapear `appearanceId`/
`outfitId` numa tabela, não reescrever `content/`"*. **A tabela não existia.** Os ids viviam
inline em cada entidade:

```jsonc
// data/monsters/rat.json — antes
{ "id": "rat", "outfitId": 21, ... }
```

Isso cumpria a letra do invariante 6 — nenhum caminho de arte em `content/` — e não cumpria o
efeito: trocar de pacote era editar todo arquivo de conteúdo, exatamente o que a alternativa
descartada ("`content/` referenciando diretamente arquivos de sprite") custaria.

Agora existe `data/appearances/baseline.json`, uma linha por id de conteúdo, e `buildContent`
resolve a aparência de cada monstro e item a partir dela no boot. A troca de pacote é o diff de
um arquivo.

**A tabela é separada por tipo** (`monsters`, `items`) e não um mapa achatado: id é único dentro
de um tipo, não entre eles, e um dia existe o item "rat" ao lado do monstro "rat".

**O custo que a tabela cobra**, e que a decisão aceita: a aparência órfã. Com o id inline, apagar
a entidade levava o id junto; com a tabela, a linha fica para trás e ninguém percebe. Por isso a
referência cruzada reclama dos dois lados — entidade sem aparência **e** aparência sem entidade —
e por isso `itemSchema`/`monsterSchema` são `strictObject`: Zod descarta chave desconhecida em
silêncio, e um `appearanceId` escrito na entidade por hábito não iria a lugar nenhum sem nada
acusar.

**A versão de conteúdo inclui a tabela.** Trocar de pacote muda a versão, e o invariante 7 faz o
resto: uma hunt que começou com o pacote antigo termina com ele, em vez de trocar de arte no meio
de milhares de sessões desanexadas.

Nada disso muda a decisão nem o risco jurídico que ela assume — é a mitigação técnica passando a
funcionar como estava escrito. Validar que cada id existe no pacote CARREGADO continua sendo a
metade da FUN-21 que depende do pacote, e continua aberta.

## Emenda — 2026-09-12 (ADR 0025): o mapa também

O mapa real do Tibia entra pela mesma porta e com o mesmo tratamento: o `otservbr.otbm` do
Canary é uma reprodução comunitária do mapa da CipSoft, está na mesma classe de risco do pacote
de arte, e por isso **também nunca é versionado** — mora em `things/maps/`, e a pilha de
aparências por tile que o importador produz para o cliente mora em `things/<versão>/maps/`,
servida por `/things/` como as folhas. O que entra em `content/` é só geometria (bloqueio,
velocidade de chão, escadas), regenerável de qualquer fonte. Ver ADR 0025.

## Emenda — 2026-09-26 (#675): o pacote de referência passa a ser o 15.33

**Contexto.** O pacote fixado era o **13.32** (`packs/tibia-1332.json`, `THINGS_VERSION=1332`). A
CipSoft só distribui o cliente ATUAL, e o 13.32 existia numa única máquina: uma máquina nova, um
servidor de deploy ou uma perda de disco deixavam o projeto sem arte, sem caminho oficial para
recuperá-la. Numa máquina com o cliente oficial recém-instalado, a versão servida é a **15.33**.

**Decisão.** O pacote de referência passa a ser o **15.33**, obtido do cliente oficial instalado
(no macOS, `~/Library/Application Support/CipSoft GmbH/Tibia/packages/Tibia.app/Contents/Resources/
assets/`) e copiado para `things/1533/`. `packs/tibia-1533.json` substitui o inventário do 13.32;
`appearances/baseline.json` aponta para ele; `THINGS_VERSION` passa a `1533` em `server/config.ts`,
`.env.example`, `Dockerfile`, `compose.coolify.yml` e nos scripts.

**O que foi conferido antes** (a premissa da troca, medida no pacote instalado):

- os 42 107 objetos e 1 443 outfits do `appearances.dat` do Canary 13.x existem todos no 15.33;
- as 234 referências de aparência de `content/` existem todas — a tabela não mudou uma linha;
- do inventário 13.32 faltam 2 objetos (44780, 44781), que nada usa: nem conteúdo, nem o
  `items.xml` do Canary, nem o mapa;
- do mapa inteiro falta 1 id (2141, "RESERVED SPRITE" no próprio Canary), num tile do andar 14;
- regenerados com as flags do 15.33, Rat Cellars, Rotworm Caves e Darashia Dragon Lair têm
  geometria **idêntica**; Thais muda **um** tile, `(181, 137, 7)` local, no canto sudeste do
  recorte: o objeto 50227 bloqueia, e o 13.32 não o conhecia (era tratado como andável por
  `--allow-unknown`). Com o 15.33 os quatro recortes têm **zero** aparência desconhecida.

**Alternativas.** Manter o 13.32 (descartada: depende de uma cópia sem fonte oficial). Validar o
conteúdo contra os DOIS pacotes (descartada: complexidade sem ganho, já que o 15.33 cobre o 13.32).

**Consequências.** `pnpm check` passa a conferir o inventário contra o pacote real em qualquer
máquina com o cliente instalado. O deploy troca `/things/1332` por `/things/1533` — o `game` recusa
subir com a versão errada (`served-pack.ts`), então a troca é atômica ou não acontece. A arte do
15.33 é às vezes redesenhada para o mesmo id; o que isso muda é só apresentação. Outfits e itens
posteriores ao 13.32 passam a existir no pacote — a vocação Monk, que o plano de paridade deixou de
fora por falta de arte, deixa de ter esse impedimento. **O risco jurídico não muda**: é arte da
CipSoft nas duas versões, e esta decisão continua assumindo-o como no texto original.
