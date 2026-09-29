# Biblioteca local de assets

O repositório não redistribui a arte do Tibia. O ADR 0008 aceita o uso local desse pacote no
MVP, mantém toda a arte sob `things/` e exige a indireção por `appearanceId`/`outfitId`. Esta
biblioteca torna um pacote que já existe na máquina navegável pelo Claude Code sem mudar essa
fronteira.

## Gerar

Um pacote moderno precisa conter `catalog-content.json`, o `appearances-<hash>.dat` apontado por
ele e as folhas `sprites-<hash>.bmp.lzma`:

```bash
pnpm assets:library -- \
  --source /caminho/para/assets \
  --version 1332 \
  --resources /caminho/para/graphics_resources.rcc.lzma
```

O resultado padrão fica em `things/1332/library/`. É sempre local e ignorado pelo Git.

Clientes Open Tibia no formato DatSpr também são reconhecidos automaticamente quando a pasta
contém `Tibia.spr`, `Tibia.dat` e, de preferência, `Tibia.otfi`:

```bash
pnpm assets:library -- --source things/1098 --version 1098
```

O snapshot comunitário 10.98 usado pelo projeto pode ser reproduzido com um comando:

```bash
pnpm assets:fetch:1098
```

Ele baixa o commit fixado de `tibia-oce/assets`, confere SHA-256 de cada arquivo e gera a
biblioteca. A origem, o commit e os hashes também ficam em `things/1098/source.json`.

Como esse formato pode conter centenas de milhares de ids, o gerador cria atlas de 4096 quadros
em vez de centenas de milhares de arquivos pequenos. Cada linha de `sprites.jsonl` informa
`atlas`, `x`, `y`, `width` e `height`, permitindo localizar ou recortar qualquer id diretamente.

`--resources` é opcional. Quando presente, o script desembrulha o LZMA do cliente, extrai o
`qres` versão 1–3 com `qrc2zip` e mantém a árvore de imagens, fontes, cursores, animações e demais
recursos do Qt. Essa etapa exige `xz`, Go e acesso à internet na primeira execução para obter
`github.com/pgaskin/qrc/cmd/qrc2zip@v0.0.2` (MIT).

## Inventário de ids para `content/`

A tabela de aparências (`packages/content/data/appearances/baseline.json`) aponta ids do
pacote, e o pacote não está no Git. O que o repositório versiona é a sombra dele — quais ids
existem em cada registro, como faixas inclusivas — em `packages/content/data/packs/<pack>.json`,
e é contra esse arquivo que `buildContent` recusa um id que não existe (FUN-21):

```bash
pnpm assets:inventory                 # lê things/1332 e escreve packs/tibia-1332.json
pnpm assets:inventory --version 1400  # outro pacote: THINGS_VERSION ou --version
pnpm assets:inventory --check         # confere cada packs/*.json com o pacote local
```

`--check` faz parte do `pnpm check`. Sem o pacote na máquina ele avisa e pula (é o caso do CI,
onde quem confere a tabela é `load.test.ts`, contra o inventário versionado); com o pacote, um
inventário desatualizado reprova e diz em qual registro e em qual faixa. O arquivo guarda o
SHA-256 do `.dat` de que saiu, então trocar o pacote sem regenerar o inventário reprova antes
de qualquer faixa ser comparada.

O inventário é a sombra de UM pacote, e o cliente carrega o de `VITE_THINGS_URL`. Para os dois
não divergirem, o `game` recusa subir quando `THINGS_VERSION` não é a versão do inventário
(`packages/server/src/served-pack.ts`), e `compose.coolify.yml` deriva `VITE_THINGS_URL` de
`THINGS_VERSION`. Trocar de pacote é, portanto: novo `things/<versão>/`, `pnpm
assets:inventory --version <versão>`, `pack` novo em `appearances/baseline.json` com os ids
remapeados, e `THINGS_VERSION` novo no deploy.

## Estrutura para ferramentas

```text
library/
  manifest.json
  sheets.jsonl
  missing-sheets.txt
  sprites.jsonl
  appearances/
    object.jsonl
    outfit.jsonl
    effect.jsonl
    missile.jsonl
  sheets/<primeiro-id>-<ultimo-id>.png
  atlases/<primeiro-id>-<ultimo-id>.png
  sprites/<milhar>/<id>.png
  ui/<arvore-original-do-Qt>
  ui-index.jsonl
```

Os JSONL têm um registro por linha, para que `rg`, `sed` e o Claude Code consultem um id sem
carregar um arquivo JSON gigante. `manifest.json` informa quantas folhas e sprites estão
presentes. O gerador nunca chama um pacote incompleto de completo: quando uma folha citada no
catálogo não existe, o índice preserva o id e grava `png: null`.

**A biblioteca de `things/1332` desta máquina é parcial** (`complete: false`, 47 de 4171 folhas,
5508 de 184443 sprites, gerada em 2026-09-18). O `.dat` de aparências está inteiro — todos os ids
existem no índice —, mas a maioria das folhas de sprite não está no pacote-fonte. A consequência
prática é que ids de **efeito e projétil de combate não têm PNG para abrir** nesta máquina; a
auditoria de apresentação de combate (#242) registra esse bloqueio em vez de inferir fidelidade.
Ver [`combat-presentation-audit.md`](combat-presentation-audit.md) para o método e a tabela.

No formato moderno, `sheets/` e os PNGs individuais são produzidos. No formato DatSpr, `atlases/`
contém todas as páginas e `sprites.jsonl` contém as coordenadas de cada quadro. O `Tibia.dat` é
mantido como fonte e seus totais de objetos, outfits, efeitos e projéteis entram no manifesto;
esse formato não expõe as aparências em JSONL.

Exemplos:

```bash
rg '"id":21,' things/1332/library/appearances/outfit.jsonl
rg '"id":3043,' things/1332/library/appearances/object.jsonl
rg 'icon-battlelist' things/1332/library/ui-index.jsonl
```

A origem e a autorização de uso do pacote são resolvidas antes desta etapa. O gerador não baixa
arte nem publica binários: ele apenas organiza os arquivos locais fornecidos ao projeto.

## O mapa real (FUN-118, ADR 0025)

O mapa comunitário do Tibia — `otservbr.otbm`, release v3.6.1 do Canary, 184 MB — entra pela
mesma porta que a arte e fica fora do Git, em `things/maps/`:

```bash
pnpm map:fetch                                   # baixa e confere o SHA-256 fixado em scripts/fetch-map.ts
pnpm map:import --id thais --x 32275..32458 --y 32153..32291 --z 4..7 --entry 32369,32241,7
pnpm map:import --id rat-cellars --x 32022..32139 --y 32168..32247 --z 8
pnpm map:import --id rotworm-caves --x 33098..33185 --y 32401..32473 --z 8..8
pnpm map:import --check                          # dentro do pnpm check; sem o OTBM, avisa e pula
```

Cada importação escreve dois arquivos, um por consumidor:

- `packages/content/data/maps/<id>.json` — o que o **servidor** precisa: por andar, a grade de
  bloqueio (`#`/`.`) e a de velocidade de chão (um caractere por tile, resolvido por
  `speedPalette`), `entryPoint`, `floorChanges` e `source` (arquivo, SHA-256, região). É
  versionado, e é a única coisa do mapa que entra em `computeVersion`.
- `things/<versão>/maps/<id>.json` — a **pilha de aparências por tile**, para o cliente, em
  coordenadas locais ao recorte (`[x, y, z, chão, [itens…]]`). Servido por `/things/`, nunca
  versionado.

O bloqueio deriva das flags do pacote (`unpass` no chão ou em qualquer item; tile sem chão mas
com item é decidido pelos itens; tile sem nada fica fora), e foi conferido contra o terreno
que o Huntera serve: nos 21.318 tiles de Thais idênticos ao mapa real, **100 %** de acordo. Os
ids do OTBM são ids de cliente, os mesmos do `appearances.dat`; um id que o pacote não tem
derruba a importação (`--allow-unknown` segue e reporta).

**Escadas não são derivadas.** O importador lista candidatos — tiles andáveis sem chão, que é
como o degrau se apresenta — e `floorChanges` é autorado à mão no JSON do mapa; reimportar
preserva o que já estava autorado. `--keep-from x,y,z` apara o recorte à componente andável
que contém o tile (mais a borda de um tile), para uma hunt não carregar o bueiro inteiro. A
componente é do andar da semente — o importador não sabe aonde as escadas levam —, e os outros
andares ficam com o que cai na caixa resultante. Id desconhecido só conta no que ficou.

**A rota de uma hunt num mapa importado** sai de `pnpm route:trace --id <id> --map <mapId>
--z <z> --via x,y x,y … --spawn x,y,raio …` (`scripts/trace-route.ts`, FUN-123): busca em
largura pelos quatro vizinhos entre pontos de passagem, laço fechado, e cada spawn ancorado no
índice da rota mais próximo. A Rat Cellars foi traçada com os lugares onde o mapa real põe rato
como pontos de spawn; o `raio` de cada um é até onde o monstro procura tile livre para nascer.
A Rotworm Caves (#511) tem 58 pontos de spawn do Canary dentro do recorte — mais do que o
molde de ~14 usa —, e por isso 14 deles foram escolhidos por ordenação angular ao redor do
centroide da nuvem inteira, para cobrir a caverna sem aglomerar do mesmo lado (`--via`/`--spawn`
exatos registrados no comentário de entrega da #511).

O leitor (`scripts/otbm.ts`) é iterativo e recorta por região sem alocar o resto: os 184 MB
inteiros passam em ~0,6 s. O formato foi lido de documentação pública e conferido contra o
arquivo real; nenhum código GPL foi copiado (ADR 0019).
