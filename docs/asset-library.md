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
