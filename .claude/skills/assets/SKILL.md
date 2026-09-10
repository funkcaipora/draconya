---
name: assets
description: Use ao escolher, localizar, inspecionar ou integrar sprites e recursos visuais no Draconya. Consulta a biblioteca local em things/<versao>/library, resolve appearanceId/outfitId, mostra os PNGs relevantes e preserva a indirecao de arte do invariante 6. Acione com "usa esse sprite", "escolhe uma aparencia", "procura um outfit", "integra os assets", "monta essa tela como o client" ou "quais sprites temos".
---

# Usar a biblioteca local de assets

Esta skill existe para que a arte seja consultável sem transformar `content/` num catálogo de
caminhos. A biblioteca é derivada localmente, fica em `things/<versão>/library/` e não é
versionada.

## Passo 1 — localizar e validar a biblioteca

Leia `THINGS_DIR` e `THINGS_VERSION` do ambiente; na ausência deles, use `things/` e a versão
indicada em `.env.example`. Abra primeiro:

```text
things/<versão>/library/manifest.json
```

Não presuma que o pacote está completo. Confira `completeness.complete`,
`availableSheetCount`, `missingSheetCount` e `availableSpriteCount`. Se a biblioteca não existir,
gere-a com o comando documentado em `docs/asset-library.md`. Se o pacote-fonte estiver
incompleto, trabalhe apenas com PNGs cujo índice tenha `png` não nulo e diga quais ids ficaram
indisponíveis.

## Passo 2 — escolher a fonte certa

- Mundo e inventário: `appearances/object.jsonl`.
- Criaturas e personagens: `appearances/outfit.jsonl`.
- Efeitos de magia: `appearances/effect.jsonl`.
- Projéteis: `appearances/missile.jsonl`.
- Botões, molduras, ícones, fontes, cursores e fundos: `ui-index.jsonl` e `ui/`.
- Id global já conhecido: `sprites.jsonl` e `sprites/<milhar>/<id>.png`.

Se `manifest.json` declarar `format: "legacy-spr"`, use `sprites.jsonl` para resolver o atlas e
as coordenadas do id. Abra `atlases/<faixa>.png` para busca visual. Nesse formato, os quatro
totais extraídos do `Tibia.dat` são inventário, não um índice de aparências; não invente a
associação entre um objeto e um sprite.

Use `rg` por registro inteiro, porque cada entrada JSONL ocupa exatamente uma linha:

```bash
rg '"id":21,' things/<versão>/library/appearances/outfit.jsonl
rg '"id":3043,' things/<versão>/library/appearances/object.jsonl
rg -i 'battlelist|progressbar|inventory' things/<versão>/library/ui-index.jsonl
```

Antes de escolher entre alternativas visuais, abra os PNGs com a ferramenta de imagem. Nome e id
não substituem inspeção visual.

## Passo 3 — respeitar a composição

Uma aparência não é necessariamente um PNG. Leia todos os `frameGroups`, `layers`,
`patternWidth`, `patternHeight`, `patternDepth`, `spriteIds` e `phases`. O vetor de ids segue:

```text
((((phase * patternDepth + z) * patternHeight + y) * patternWidth + x) * layers) + layer
```

Outfit pode ter BASE e TEMPLATE; o TEMPLATE é colorizado pelo compositor existente em
`packages/client/src/assets/outfit.ts`. Não escolha uma camada isolada como se fosse a criatura
completa. Para animação, preserve a duração mínima/máxima registrada nas fases.

## Passo 4 — integrar sem vazar caminhos

O conteúdo registra somente `appearanceId` ou `outfitId` através de
`data/appearances/<versão>.json`. Nunca grave caminho de PNG, nome de folha, textura ou imagem em
`packages/content`.

O cliente resolve id global pela faixa inclusiva de `sheets.jsonl`; a posição dentro da folha já
está em `sprites.jsonl`. Reuse `packages/client/src/assets/` para carregar e compor. Não crie um
segundo decoder ou uma segunda tabela de geometria.

Recursos de `ui/` pertencem à apresentação DOM/Pixi e podem ser referenciados pelo caminho do
pacote de arte, nunca pelo conteúdo de jogo.

## Passo 5 — registrar a escolha

Ao adicionar uma entidade, atualize a tabela de aparências da versão e rode `pnpm content:check`.
Na entrega, rode `pnpm check`. Se uma troca de pacote exigir novo mapeamento, crie outro arquivo
de versão em vez de alterar a arte de uma sessão em andamento.
